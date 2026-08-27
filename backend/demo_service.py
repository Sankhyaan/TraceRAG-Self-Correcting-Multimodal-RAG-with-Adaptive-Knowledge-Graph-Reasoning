import os
import json
import uuid
import shutil
import logging
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path


from backend.storage import get_supabase, storage_service
from backend.ingest.manager import extraction_manager
from backend.graph.engine import graph_manager
from backend.pipeline.retriever import hybrid_retriever
from backend.pipeline.bm25_index import bm25_manager
from backend.pipeline.vector_store import vector_store

logger = logging.getLogger("trace.demo")

DEMO_CONV_ID = "conv_demo"
DEMO_TITLE = "VoltBus Engineering & Route 101 Operations"

DEMO_FILES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "demo_files"
)
GRAPHS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "graphs"
)
CONVERSATIONS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "conversations"
)
os.makedirs(GRAPHS_DIR, exist_ok=True)
os.makedirs(CONVERSATIONS_DIR, exist_ok=True)


def get_demo_conversation() -> Dict[str, Any]:
    """Returns the canonical demo conversation item."""
    supabase = get_supabase()
    file_count = 0
    message_count = 0
    try:
        f_res = supabase.table("files").select("id").eq("conversation_id", DEMO_CONV_ID).execute()
        file_count = len(f_res.data or [])
    except Exception:
        pass

    try:
        m_res = supabase.table("messages").select("id").eq("conversation_id", DEMO_CONV_ID).execute()
        message_count = len(m_res.data or [])
    except Exception:
        pass

    return {
        "id": DEMO_CONV_ID,
        "title": DEMO_TITLE,
        "file_count": file_count,
        "message_count": message_count,
        "created_at": "2026-08-23T00:00:00Z",
        "updated_at": datetime.utcnow().isoformat(),
        "is_demo": True,
    }


def seed_demo_workspace() -> Dict[str, Any]:
    """
    Ingests and indexes all 5 VoltBus demo files into conv_demo if not already present.
    Also builds the canonical knowledge graph and sample grounded Q&A messages.
    """
    supabase = get_supabase()
    now_iso = datetime.utcnow().isoformat()

    # 1. Ensure conversation record exists
    try:
        supabase.table("conversations").upsert({
            "id": DEMO_CONV_ID,
            "title": DEMO_TITLE,
            "user_id": None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }).execute()
    except Exception as e:
        logger.warning(f"Notice upserting demo conversation: {e}")

    # 2. Check existing files for conv_demo
    existing_files: Dict[str, Dict[str, Any]] = {}
    try:
        f_res = supabase.table("files").select("*").eq("conversation_id", DEMO_CONV_ID).execute()
        for f in f_res.data or []:
            existing_files[f["filename"]] = f
    except Exception as e:
        logger.warning(f"Notice checking existing demo files: {e}")

    # 3. Process each demo file from data/demo_files/
    if os.path.exists(DEMO_FILES_DIR):
        for fname in sorted(os.listdir(DEMO_FILES_DIR)):
            fpath = os.path.join(DEMO_FILES_DIR, fname)
            if not os.path.isfile(fpath):
                continue

            # If already in DB with status done, verify and ensure storage object exists
            if fname in existing_files and existing_files[fname].get("status") == "done":
                storage_path = existing_files[fname].get("storage_path")
                if storage_path:
                    try:
                        with open(fpath, "rb") as f:
                            file_bytes = f.read()
                        ext = Path(fname).suffix.lower()
                        mime = "application/octet-stream"
                        if ext == ".pdf":
                            mime = "application/pdf"
                        elif ext in (".png", ".webp"):
                            mime = f"image/{ext[1:]}"
                        elif ext in (".jpg", ".jpeg"):
                            mime = "image/jpeg"
                        elif ext == ".mp3":
                            mime = "audio/mpeg"
                        elif ext == ".mp4":
                            mime = "video/mp4"
                        supabase.storage.from_(storage_service.bucket).upload(
                            storage_path,
                            file_bytes,
                            {"content-type": mime, "upsert": "true"},
                        )
                    except Exception as e:
                        logger.debug(f"Storage ensure notice for '{fname}': {e}")
                logger.info(f"Demo file '{fname}' verified in database and storage.")
                continue

            try:
                with open(fpath, "rb") as f:
                    file_bytes = f.read()

                # Determine mime type
                ext = Path(fname).suffix.lower()
                mime = "application/octet-stream"
                if ext == ".pdf":
                    mime = "application/pdf"
                elif ext in (".png", ".webp"):
                    mime = f"image/{ext[1:]}"
                elif ext in (".jpg", ".jpeg"):
                    mime = "image/jpeg"
                elif ext == ".mp3":
                    mime = "audio/mpeg"
                elif ext == ".mp4":
                    mime = "video/mp4"

                # Upload to storage
                record = storage_service.upload_file(
                    conversation_id=DEMO_CONV_ID,
                    filename=fname,
                    file_bytes=file_bytes,
                    content_type=mime,
                    user_id=None,
                )
                file_id = record["id"]
                file_type = record["file_type"]

                # Extract and index
                extracted_text = extraction_manager.process_file(
                    file_id=file_id,
                    filename=fname,
                    file_type=file_type,
                    file_bytes=file_bytes,
                    mime_type=mime,
                    conversation_id=DEMO_CONV_ID,
                )

                # Extract knowledge graph entities & relationships
                if extracted_text:
                    try:
                        graph_manager.index_file_text(
                            conversation_id=DEMO_CONV_ID,
                            file_id=file_id,
                            filename=fname,
                            file_type=file_type,
                            text=extracted_text,
                        )
                    except Exception as e:
                        logger.warning(f"Notice building demo graph for '{fname}': {e}")
            except Exception as err:
                logger.error(f"Error seeding demo file '{fname}': {err}")



    # 4. Ensure demo messages exist
    seed_demo_messages()

    return get_demo_conversation()


def seed_demo_messages():
    """Seeds rich sample Q&A pairs for the VoltBus demo workspace."""
    supabase = get_supabase()
    msgs_path = os.path.join(CONVERSATIONS_DIR, f"{DEMO_CONV_ID}_messages.json")
    seeded_json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "demo_messages_seeded.json")

    sample_msgs = []
    if os.path.exists(seeded_json_path):
        try:
            with open(seeded_json_path, "r", encoding="utf-8") as f:
                sample_msgs = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read {seeded_json_path}: {e}")

    if not sample_msgs:
        # Fallback default interaction
        sample_msgs = [
            {
                "id": "msg_demo_1",
                "conversation_id": DEMO_CONV_ID,
                "role": "user",
                "content": "What hardware components and thermal thresholds govern the VoltBus V3 battery system, and what occurred during the July 12 incident at Stop 7?",
                "created_at": "2026-08-23T00:01:00Z",
            }
        ]

    # Save to Supabase
    for m in sample_msgs:
        try:
            supabase.table("messages").upsert(m).execute()
        except Exception:
            pass

    # Save to local mirror
    try:
        with open(msgs_path, "w", encoding="utf-8") as f:
            json.dump(sample_msgs, f, indent=2)
    except Exception as e:
        logger.warning(f"Notice writing local demo messages: {e}")



def clone_demo_workspace(user_id: str, new_conv_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Clones the canonical demo workspace into an authenticated user's private workspace.
    This copies files, messages, graph JSON, and indexes chunks for the new conversation.
    """
    supabase = get_supabase()
    target_conv_id = new_conv_id or f"conv_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.utcnow().isoformat()

    logger.info(f"Cloning demo workspace for user_id='{user_id}' -> conv_id='{target_conv_id}'")

    # 1. Ensure demo workspace is seeded
    seed_demo_workspace()

    # 2. Insert new conversation owned by user_id
    supabase.table("conversations").upsert({
        "id": target_conv_id,
        "title": DEMO_TITLE,
        "user_id": user_id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }).execute()

    # 3. Clone files
    file_count = 0
    file_id_map: Dict[str, str] = {}
    filename_map: Dict[str, str] = {}
    try:
        f_res = supabase.table("files").select("*").eq("conversation_id", DEMO_CONV_ID).execute()
        for f_row in f_res.data or []:
            old_file_id = f_row.get("id")
            new_file_id = str(uuid.uuid4())
            if old_file_id:
                file_id_map[old_file_id] = new_file_id
            if f_row.get("filename"):
                filename_map[f_row["filename"]] = new_file_id

            new_f = dict(f_row)
            new_f["id"] = new_file_id
            new_f["conversation_id"] = target_conv_id
            new_f["user_id"] = user_id
            new_f["uploaded_at"] = now_iso

            supabase.table("files").insert(new_f).execute()
            file_count += 1

            # Index chunks for new conversation in BM25 & Qdrant asynchronously
            ext_text = f_row.get("extracted_text")
            if ext_text:
                def _bg_index(fid=new_file_id, cid=target_conv_id, fn=f_row.get("filename", "file"), ft=f_row.get("file_type", "document"), txt=ext_text):
                    try:
                        hybrid_retriever.index_file(
                            file_id=fid,
                            conversation_id=cid,
                            filename=fn,
                            file_type=ft,
                            extracted_text=txt,
                        )
                    except Exception as e:
                        logger.warning(f"Notice indexing cloned file: {e}")

                threading.Thread(target=_bg_index, daemon=True).start()
    except Exception as err:
        logger.error(f"Error cloning demo files: {err}")


    # 4. Clone messages
    message_count = 0
    try:
        m_res = supabase.table("messages").select("*").eq("conversation_id", DEMO_CONV_ID).execute()
        cloned_msgs = []
        for m_row in m_res.data or []:
            new_msg_id = f"msg_{uuid.uuid4().hex[:10]}"
            new_m = dict(m_row)
            new_m["id"] = new_msg_id
            new_m["conversation_id"] = target_conv_id
            new_m["user_id"] = user_id

            supabase.table("messages").insert(new_m).execute()
            cloned_msgs.append(new_m)
            message_count += 1

        # Write local mirror for cloned messages
        loc_path = os.path.join(CONVERSATIONS_DIR, f"{target_conv_id}_messages.json")
        with open(loc_path, "w", encoding="utf-8") as f:
            json.dump(cloned_msgs, f, indent=2)
    except Exception as err:
        logger.error(f"Error cloning demo messages: {err}")

    # 5. Clone Knowledge Graph JSON with mapped file IDs
    try:
        src_graph = os.path.join(GRAPHS_DIR, f"{DEMO_CONV_ID}.json")
        dst_graph = os.path.join(GRAPHS_DIR, f"{target_conv_id}.json")
        if os.path.exists(src_graph):
            with open(src_graph, "r", encoding="utf-8") as f:
                g_data = json.load(f)
            g_data["conversation_id"] = target_conv_id

            # Remap all node file_ids and edge file_ids
            for node in g_data.get("nodes", []):
                old_fids = node.get("file_ids", [])
                node["file_ids"] = [file_id_map.get(fid, fid) for fid in old_fids]
            for edge in g_data.get("edges", []):
                old_fid = edge.get("file_id")
                if old_fid in file_id_map:
                    edge["file_id"] = file_id_map[old_fid]
                elif edge.get("filename") in filename_map:
                    edge["file_id"] = filename_map[edge.get("filename")]

            with open(dst_graph, "w", encoding="utf-8") as f:
                json.dump(g_data, f, indent=2)
        else:
            logger.info(f"Source demo graph not found on disk at {src_graph}")
    except Exception as err:
        logger.error(f"Error cloning demo graph: {err}")



    return {
        "id": target_conv_id,
        "title": DEMO_TITLE,
        "file_count": file_count,
        "message_count": message_count,
        "created_at": now_iso,
        "updated_at": now_iso,
        "is_demo": False,
    }
