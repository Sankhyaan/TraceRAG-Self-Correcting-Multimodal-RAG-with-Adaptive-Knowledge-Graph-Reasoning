import os
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from supabase import create_client, Client
from backend.config import get_settings

settings = get_settings()


def get_supabase() -> Client:
    """Returns an authenticated Supabase client using the service role key or API key."""
    key = settings.supabase_service_role_key or settings.supabase_key
    if not settings.supabase_url or not key:
        raise ValueError("Supabase URL and API Key must be configured in .env")
    return create_client(settings.supabase_url, key)


class StorageService:
    """Service handling file uploads, retrieval, signed URLs, and metadata in Supabase."""

    def __init__(self):
        self.client = get_supabase()
        self.bucket = settings.supabase_storage_bucket

    def upload_file(
        self,
        conversation_id: str,
        filename: str,
        file_bytes: bytes,
        content_type: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Uploads a raw file to Supabase Storage and records metadata in the 'files' table.
        Path format: {conversation_id}/{file_id}{ext}
        """
        file_id = str(uuid.uuid4())
        ext = Path(filename).suffix.lower()
        storage_path = f"{conversation_id}/{file_id}{ext}"

        # 1. Validate file extension and size
        is_valid, file_type, err = settings.validate_file(filename, len(file_bytes))
        if not is_valid:
            raise ValueError(err)

        # 2. Upload file to Supabase Storage
        file_options = {"content-type": content_type or "application/octet-stream", "upsert": "true"}
        try:
            self.client.storage.from_(self.bucket).upload(
                path=storage_path,
                file=file_bytes,
                file_options=file_options,
            )
        except Exception as e:
            raise RuntimeError(f"Supabase storage upload failed: {str(e)}")

        # 3. Create a signed reference URL
        try:
            signed_res = self.client.storage.from_(self.bucket).create_signed_url(storage_path, 3600 * 24)
            storage_url = signed_res.get("signedURL") or storage_path
        except Exception:
            storage_url = f"{settings.supabase_url}/storage/v1/object/public/{self.bucket}/{storage_path}"

        # 4. Insert metadata record into 'files' table
        record = {
            "id": file_id,
            "conversation_id": conversation_id,
            "filename": filename,
            "file_type": file_type,
            "storage_path": storage_path,
            "storage_url": storage_url,
            "file_size_bytes": len(file_bytes),
            "mime_type": content_type or "application/octet-stream",
            "extracted_text": None,
            "status": "pending",
            "extraction_error": None,
        }
        if user_id:
            record["user_id"] = user_id

        try:
            res = self.client.table("files").insert(record).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            return record
        except Exception:
            # Fallback if 'status' or 'extraction_error' columns are not yet in the DB table
            fallback_record = {
                k: v for k, v in record.items() if k not in ("status", "extraction_error")
            }
            try:
                res = self.client.table("files").insert(fallback_record).execute()
                if res.data and len(res.data) > 0:
                    data = res.data[0]
                    data["status"] = "pending"
                    return data
                return record
            except Exception as e:
                # Rollback storage object if DB insert fails
                try:
                    self.client.storage.from_(self.bucket).remove([storage_path])
                except Exception:
                    pass
                raise RuntimeError(f"Failed to record file in database: {str(e)}")

    def list_files(
        self,
        conversation_id: str,
        file_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Lists all files for a given conversation_id, with optional filtering by file_type.
        """
        query = (
            self.client.table("files")
            .select("*")
            .eq("conversation_id", conversation_id)
            .order("uploaded_at", desc=True)
        )

        if file_type:
            query = query.eq("file_type", file_type)

        try:
            res = query.execute()
            files = res.data or []
            # Normalize status
            for f in files:
                if not f.get("status"):
                    f["status"] = "done" if f.get("extracted_text") else "pending"
            return files
        except Exception as e:
            raise RuntimeError(f"Failed to list files: {str(e)}")

    def get_file(self, file_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a single file metadata record by file_id."""
        try:
            res = self.client.table("files").select("*").eq("id", file_id).execute()
            if res.data and len(res.data) > 0:
                record = res.data[0]
                if not record.get("status"):
                    record["status"] = "done" if record.get("extracted_text") else "pending"
                return record
            return None
        except Exception as e:
            raise RuntimeError(f"Failed to retrieve file record: {str(e)}")

    def get_signed_url(self, file_id: str, expires_in: int = 3600) -> str:
        """Generates a temporary signed URL for viewing or downloading a file."""
        record = self.get_file(file_id)
        if not record:
            raise ValueError(f"File with id '{file_id}' not found.")

        storage_path = record["storage_path"]
        try:
            res = self.client.storage.from_(self.bucket).create_signed_url(storage_path, expires_in)
            return res.get("signedURL") or ""
        except Exception as e:
            raise RuntimeError(f"Failed to generate signed URL: {str(e)}")

    def delete_file(self, file_id: str) -> bool:
        """
        Deletes a single file from both Supabase Storage and the 'files' table.
        """
        record = self.get_file(file_id)
        if not record:
            return False

        storage_path = record.get("storage_path")

        # 1. Remove from storage
        if storage_path:
            try:
                self.client.storage.from_(self.bucket).remove([storage_path])
            except Exception as e:
                print(f"[Warning] Failed to delete storage object '{storage_path}': {str(e)}")

        # 2. Remove from database
        try:
            self.client.table("files").delete().eq("id", file_id).execute()
            return True
        except Exception as e:
            raise RuntimeError(f"Failed to delete file database record: {str(e)}")

    def clear_conversation_files(self, conversation_id: str) -> int:
        """
        Deletes all storage objects and database records for a given conversation_id.
        Returns the count of deleted files.
        """
        files = self.list_files(conversation_id)
        if not files:
            return 0

        # Collect storage paths
        paths_to_delete = [f["storage_path"] for f in files if f.get("storage_path")]

        # 1. Delete all storage objects in batch
        if paths_to_delete:
            try:
                self.client.storage.from_(self.bucket).remove(paths_to_delete)
            except Exception as e:
                print(f"[Warning] Failed batch storage removal: {str(e)}")

        # 2. Delete all records from database
        try:
            self.client.table("files").delete().eq("conversation_id", conversation_id).execute()
            return len(files)
        except Exception as e:
            raise RuntimeError(f"Failed to delete conversation files in database: {str(e)}")


storage_service = StorageService()
