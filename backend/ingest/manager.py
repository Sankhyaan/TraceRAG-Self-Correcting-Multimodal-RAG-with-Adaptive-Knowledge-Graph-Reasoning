import logging
from typing import Optional, Dict, Any
from backend.storage import storage_service, get_supabase
from backend.ingest.document_extractor import document_extractor
from backend.ingest.image_extractor import image_extractor
from backend.ingest.audio_extractor import audio_extractor
from backend.ingest.video_extractor import video_extractor
from backend.pipeline.retriever import hybrid_retriever

logger = logging.getLogger("trace.ingest")


class ExtractionManager:
    """Coordinates multimodal extraction, database updates, and automatic retrieval indexing."""

    def __init__(self):
        self._supabase = None

    @property
    def supabase(self):
        if self._supabase is None:
            self._supabase = get_supabase()
        return self._supabase

    def process_file(
        self,
        file_id: str,
        filename: str,
        file_type: str,
        file_bytes: bytes,
        mime_type: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> str:
        """
        Executes modality-specific extraction, updates database, and indexes into Qdrant + BM25.
        """
        logger.info(f"Starting extraction for file_id='{file_id}' ({filename}, type={file_type})")
        self._update_status(file_id, status="processing")

        try:
            extracted_text = ""

            if file_type == "document":
                extracted_text = document_extractor.extract(filename, file_bytes)

            elif file_type == "image":
                extracted_text = image_extractor.extract(filename, file_bytes, mime_type or "image/png")

            elif file_type == "audio":
                extracted_text = audio_extractor.extract(filename, file_bytes)

            elif file_type == "video":
                extracted_text = video_extractor.extract(filename, file_bytes)

            else:
                extracted_text = document_extractor.extract(filename, file_bytes)

            logger.info(f"Extraction successful for '{filename}' ({len(extracted_text)} chars extracted)")

            # Cap extracted text at 1 MB to prevent giant Postgres blobs
            MAX_TEXT_BYTES = 1_000_000
            if len(extracted_text.encode("utf-8", errors="replace")) > MAX_TEXT_BYTES:
                logger.warning(
                    f"Extracted text for '{filename}' exceeds 1MB — truncating to first 1MB."
                )
                extracted_text = extracted_text.encode("utf-8", errors="replace")[:MAX_TEXT_BYTES].decode("utf-8", errors="replace")

            # Auto-index into Qdrant vector store, BM25 index, and Knowledge Graph
            try:
                c_id = conversation_id
                if not c_id:
                    rec = storage_service.get_file(file_id)
                    if rec:
                        c_id = rec.get("conversation_id")

                if c_id and extracted_text.strip():
                    chunks = hybrid_retriever.index_file(
                        file_id=file_id,
                        conversation_id=c_id,
                        filename=filename,
                        file_type=file_type,
                        extracted_text=extracted_text,
                    )
                    # Deeply Index into Knowledge Graph
                    try:
                        from backend.graph.engine import graph_manager
                        graph_manager.index_file_text(
                            conversation_id=c_id,
                            file_id=file_id,
                            filename=filename,
                            file_type=file_type,
                            text=extracted_text,
                        )
                    except Exception as g_err:
                        logger.warning(f"Notice during graph indexing for '{filename}': {str(g_err)}")
            except Exception as index_err:
                logger.warning(f"Notice during automatic retrieval indexing for '{filename}': {str(index_err)}")

            # Update DB with extracted text and set status="done" ONLY after all indexing stages complete
            self._update_result(file_id, status="done", extracted_text=extracted_text)
            return extracted_text

        except Exception as e:
            error_msg = f"Extraction failed: {str(e)}"
            logger.error(f"Error extracting content from '{filename}': {error_msg}")
            self._update_result(file_id, status="failed", extraction_error=error_msg)
            return f"(Extraction error: {error_msg})"

    def _update_status(self, file_id: str, status: str):
        """Updates the status column of the file in Postgres."""
        try:
            self.supabase.table("files").update({"status": status}).eq("id", file_id).execute()
        except Exception:
            pass

    def _update_result(
        self,
        file_id: str,
        status: str,
        extracted_text: Optional[str] = None,
        extraction_error: Optional[str] = None,
    ):
        """Updates extracted_text, status, and extraction_error in Postgres."""
        payload: Dict[str, Any] = {}
        if extracted_text is not None:
            payload["extracted_text"] = extracted_text

        try:
            full_payload = {**payload, "status": status, "extraction_error": extraction_error}
            self.supabase.table("files").update(full_payload).eq("id", file_id).execute()
        except Exception:
            if payload:
                try:
                    self.supabase.table("files").update(payload).eq("id", file_id).execute()
                except Exception as inner_e:
                    logger.error(f"Failed to update extracted_text for {file_id}: {str(inner_e)}")


extraction_manager = ExtractionManager()
