import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, BackgroundTasks, Depends
from pydantic import BaseModel
from backend.auth import get_current_user_id
from backend.config import get_settings
from backend.storage import storage_service, get_supabase
from backend.ingest.manager import extraction_manager
from fastapi.responses import FileResponse as FastFileResponse, RedirectResponse


logger = logging.getLogger("trace.routes.files")

router = APIRouter(prefix="/files", tags=["Files"])
settings = get_settings()


class FileResponse(BaseModel):
    id: str
    conversation_id: str
    filename: str
    file_type: str
    storage_path: str
    storage_url: str
    file_size_bytes: int
    mime_type: Optional[str] = None
    extracted_text: Optional[str] = None
    status: Optional[str] = "pending"
    extraction_error: Optional[str] = None
    uploaded_at: Optional[str] = None


@router.post("/upload")
async def upload_files(
    background_tasks: BackgroundTasks,
    conversation_id: str = Form(..., description="ID of the conversation to scope files to"),
    files: List[UploadFile] = File(..., description="List of files to upload"),
    extract_sync: bool = Query(False, description="Run extraction synchronously before returning (useful for tests)"),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Uploads one or multiple files to Supabase Storage, records in Postgres,
    and automatically triggers multimodal extraction.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided for upload.")

    # ── File count limit check ──────────────────────────────────────────────
    try:
        existing = storage_service.list_files(conversation_id=conversation_id)
        existing_count = len(existing)
        limit = settings.max_files_per_conversation
        if existing_count + len(files) > limit:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"File limit reached: this conversation already has {existing_count} file(s). "
                    f"Maximum allowed is {limit}. Delete some files before uploading more."
                ),
            )
    except HTTPException:
        raise
    except Exception:
        pass  # Do not block upload if limit check fails

    uploaded_records = []
    errors = []

    for file in files:
        filename = file.filename or "unnamed_file"
        logger.info(f"Upload attempt: '{filename}' for conversation '{conversation_id}' (user_id={user_id})")
        try:
            content = await file.read()

            # 1. Upload to Supabase Storage + insert DB record
            record = storage_service.upload_file(
                conversation_id=conversation_id,
                filename=filename,
                file_bytes=content,
                content_type=file.content_type,
                user_id=user_id,
            )

            file_id = record["id"]
            file_type = record.get("file_type", "document")

            # 2. Trigger Extraction (Synchronous or Background)
            if extract_sync:
                extracted = extraction_manager.process_file(
                    file_id=file_id,
                    filename=filename,
                    file_type=file_type,
                    file_bytes=content,
                    mime_type=file.content_type,
                    conversation_id=conversation_id,
                )
                record["extracted_text"] = extracted
                record["status"] = "done"
            else:
                background_tasks.add_task(
                    extraction_manager.process_file,
                    file_id,
                    filename,
                    file_type,
                    content,
                    file.content_type,
                    conversation_id,
                )
                record["status"] = "processing"

            uploaded_records.append(record)
        except Exception as e:
            errors.append({"filename": filename, "error": str(e)})

    return {
        "uploaded": uploaded_records,
        "errors": errors,
        "count": len(uploaded_records),
    }


@router.get("")
def list_files(
    conversation_id: str = Query(..., description="Conversation ID to filter files for"),
    file_type: Optional[str] = Query(None, description="Optional filter: document, image, audio, video"),
):
    """
    Lists all files for a conversation, optionally filtered by media type.
    Includes extraction status and type aggregate counts.
    """
    try:
        if not conversation_id:
            return {"conversation_id": "", "files": [], "total": 0, "by_type": {"document": 0, "image": 0, "audio": 0, "video": 0}}

        all_files = storage_service.list_files(conversation_id=conversation_id)

        # Normalize status if status column not populated
        for f in all_files:
            if not f.get("status"):
                f["status"] = "done" if f.get("extracted_text") else "pending"

        by_type = {
            "document": sum(1 for f in all_files if f.get("file_type") == "document"),
            "image": sum(1 for f in all_files if f.get("file_type") == "image"),
            "audio": sum(1 for f in all_files if f.get("file_type") == "audio"),
            "video": sum(1 for f in all_files if f.get("file_type") == "video"),
        }

        if file_type:
            filtered_files = [f for f in all_files if f.get("file_type") == file_type]
        else:
            filtered_files = all_files

        return {
            "conversation_id": conversation_id,
            "files": filtered_files,
            "total": len(filtered_files),
            "by_type": by_type,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/{file_id}/extracted")
def get_extracted_content(file_id: str):
    """
    Retrieves the full extracted text, timestamps, and captions for a file.
    """
    try:
        record = storage_service.get_file(file_id)
        if not record:
            raise HTTPException(status_code=404, detail="File not found")

        status = record.get("status") or ("done" if record.get("extracted_text") else "pending")
        return {
            "file_id": file_id,
            "filename": record.get("filename"),
            "file_type": record.get("file_type"),
            "status": status,
            "extracted_text": record.get("extracted_text"),
            "extraction_error": record.get("extraction_error"),
            "uploaded_at": record.get("uploaded_at"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{file_id}/re-extract")
async def re_extract_file(file_id: str, background_tasks: BackgroundTasks):
    """
    Triggers re-extraction for an existing file in Supabase.
    """
    record = storage_service.get_file(file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    storage_path = record.get("storage_path")
    if not storage_path:
        raise HTTPException(status_code=400, detail="Missing storage path")

    try:
        sb = get_supabase()
        file_bytes = sb.storage.from_(storage_service.bucket).download(storage_path)

        background_tasks.add_task(
            extraction_manager.process_file,
            file_id=file_id,
            filename=record["filename"],
            file_type=record["file_type"],
            file_bytes=file_bytes,
            mime_type=record.get("mime_type"),
            conversation_id=record.get("conversation_id"),
        )
        return {"success": True, "message": "Re-extraction scheduled in background", "file_id": file_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch file for re-extraction: {str(e)}")


@router.get("/{file_id}/url")
def get_file_url(
    file_id: str,
    expires_in: int = Query(3600, description="Signed URL validity in seconds"),
):
    """
    Generates a secure temporary signed URL for viewing/downloading the file.
    """
    try:
        record = storage_service.get_file(file_id)
        if not record:
            raise HTTPException(status_code=404, detail="File not found")

        signed_url = storage_service.get_signed_url(file_id, expires_in=expires_in)
        return {
            "file_id": file_id,
            "filename": record.get("filename"),
            "file_type": record.get("file_type"),
            "signed_url": signed_url,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Deletes a single file from Supabase Storage, PostgreSQL, Qdrant Cloud, BM25 index, and Knowledge Graph.
    """
    try:
        record = storage_service.get_file(file_id)
        if not record:
            raise HTTPException(status_code=404, detail="File not found or already deleted")

        conversation_id = record.get("conversation_id")
        if conversation_id == "conv_demo":
            raise HTTPException(status_code=403, detail="Files in the shared VoltBus demo workspace cannot be deleted.")

        # 1. Delete from Supabase Storage & Database
        success = storage_service.delete_file(file_id)
        if not success:
            raise HTTPException(status_code=404, detail="File not found or already deleted")

        # 2. Delete vectors from Qdrant Cloud
        try:
            vector_store.delete_file_chunks(file_id)
        except Exception as e:
            print(f"[delete_file] Qdrant delete notice: {e}")

        # 3. Delete from BM25 sparse index
        if conversation_id:
            try:
                bm25_manager.remove_file(conversation_id, file_id)
            except Exception as e:
                print(f"[delete_file] BM25 remove notice: {e}")

        # 4. Remove from Knowledge Graph
        if conversation_id:
            try:
                cg = graph_manager.get_graph(conversation_id)
                edges_to_remove = [
                    (u, v, k)
                    for u, v, k, d in cg.graph.edges(keys=True, data=True)
                    if d.get("file_id") == file_id
                ]
                for u, v, k in edges_to_remove:
                    cg.graph.remove_edge(u, v, key=k)
                # Prune orphan nodes with degree 0
                orphans = [n for n in list(cg.graph.nodes()) if cg.graph.degree(n) == 0]
                for n in orphans:
                    cg.graph.remove_node(n)
                cg._save_to_disk()
            except Exception as e:
                print(f"[delete_file] Graph prune notice: {e}")

        return {"success": True, "deleted_id": file_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/conversation/{conversation_id}/clear")
def clear_conversation(
    conversation_id: str,
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """
    Wipes all files (storage + database + Qdrant + BM25 + Knowledge Graph) scoped to a conversation.
    """
    if conversation_id == "conv_demo":
        raise HTTPException(status_code=403, detail="Files in the shared VoltBus demo workspace cannot be deleted.")

    try:
        # 1. Clear Supabase
        deleted_count = storage_service.clear_conversation_files(conversation_id)


        # 2. Clear Qdrant
        try:
            vector_store.delete_conversation_chunks(conversation_id)
        except Exception as e:
            print(f"[clear_conversation] Qdrant clear notice: {e}")

        # 3. Clear BM25
        try:
            bm25_manager.clear_conversation(conversation_id)
        except Exception as e:
            print(f"[clear_conversation] BM25 clear notice: {e}")

        # 4. Clear Knowledge Graph
        try:
            graph_manager.clear_conversation(conversation_id)
        except Exception as e:
            print(f"[clear_conversation] Graph clear notice: {e}")

        return {
            "success": True,
            "conversation_id": conversation_id,
            "deleted_count": deleted_count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}/stream")
def stream_file(file_id: str):
    """
    Streams a file from Supabase Storage for in-browser audio/video playback.
    Returns a redirect to the Supabase signed URL, or serves local file fallback.
    """
    import os

    try:
        record = storage_service.get_file(file_id)
        if not record:
            raise HTTPException(status_code=404, detail="File not found")

        storage_path = record.get("storage_path", "")
        filename = record.get("filename", "")
        mime_type = record.get("mime_type") or "application/octet-stream"

        # Check local demo file fallback
        demo_local = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "demo_files", filename)
        if os.path.exists(demo_local):
            return FastFileResponse(demo_local, media_type=mime_type, filename=filename)

        # Generate signed URL from the correct bucket
        sb = get_supabase()
        sign_res = sb.storage.from_(storage_service.bucket).create_signed_url(storage_path, 3600)
        signed_url = sign_res.get("signedURL") or sign_res.get("signed_url") or sign_res.get("signedUrl")

        if not signed_url:
            raise HTTPException(status_code=500, detail="Could not generate signed URL")

        return RedirectResponse(url=signed_url, status_code=302)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}/thumbnail")
def get_thumbnail(file_id: str):
    """
    Returns a thumbnail/preview for image and video files.
    For images: redirects to the Supabase signed URL or serves local file.
    """
    import os

    try:
        record = storage_service.get_file(file_id)
        if not record:
            raise HTTPException(status_code=404, detail="File not found")

        file_type = record.get("file_type", "")
        mime_type = record.get("mime_type", "")
        storage_path = record.get("storage_path", "")
        filename = record.get("filename", "")

        # Only serve thumbnails for image types
        if file_type != "image" and not mime_type.startswith("image/"):
            raise HTTPException(status_code=404, detail="Thumbnail only available for images")

        # Check local demo file fallback
        demo_local = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "demo_files", filename)
        if os.path.exists(demo_local):
            return FastFileResponse(demo_local, media_type=mime_type, filename=filename)

        sb = get_supabase()
        sign_res = sb.storage.from_(storage_service.bucket).create_signed_url(storage_path, 3600)
        signed_url = sign_res.get("signedURL") or sign_res.get("signed_url") or sign_res.get("signedUrl")

        if not signed_url:
            raise HTTPException(status_code=404, detail="Could not generate thumbnail URL")

        return RedirectResponse(url=signed_url, status_code=302)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



