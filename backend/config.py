import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

# Base directory for the project
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # LLM Provider Configuration ("gemini" or "anthropic")
    llm_provider: str = Field(default="gemini", validation_alias="LLM_PROVIDER")

    # Google Gemini Configuration
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(
        default="gemini-3.6-flash", validation_alias="GEMINI_MODEL"
    )

    # Anthropic API Configuration (Alternative)
    anthropic_api_key: str = Field(default="", validation_alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(
        default="claude-3-5-sonnet-20241022", validation_alias="ANTHROPIC_MODEL"
    )

    # Supabase Configuration
    supabase_url: str = Field(default="", validation_alias="SUPABASE_URL")
    supabase_key: str = Field(default="", validation_alias="SUPABASE_KEY")
    supabase_service_role_key: str = Field(
        default="", validation_alias="SUPABASE_SERVICE_ROLE_KEY"
    )
    supabase_storage_bucket: str = Field(
        default="trace-files", validation_alias="SUPABASE_STORAGE_BUCKET"
    )
    supabase_jwt_secret: str = Field(
        default="", validation_alias="SUPABASE_JWT_SECRET"
    )

    # Qdrant Vector DB Configuration
    qdrant_url: str = Field(default="http://localhost:6333", validation_alias="QDRANT_URL")
    qdrant_api_key: Optional[str] = Field(default=None, validation_alias="QDRANT_API_KEY")

    # Application Limits & Files
    max_upload_size_mb: int = Field(default=50, validation_alias="MAX_UPLOAD_SIZE_MB")
    max_files_per_conversation: int = Field(default=20, validation_alias="MAX_FILES_PER_CONVERSATION")
    allowed_extensions_str: str = Field(
        default="pdf,doc,docx,txt,md,png,jpg,jpeg,webp,mp3,wav,m4a,ogg,mp4,mov,mkv,webm",
        validation_alias="ALLOWED_EXTENSIONS",
    )

    # Frontend URL (used for CORS)
    frontend_url: str = Field(default="http://localhost:3000", validation_alias="FRONTEND_URL")

    # External System Tool Paths (Optional overrides)
    tesseract_cmd: Optional[str] = Field(default=None, validation_alias="TESSERACT_CMD")
    ffmpeg_cmd: str = Field(default="ffmpeg", validation_alias="FFMPEG_CMD")

    @property
    def allowed_file_types(self) -> Dict[str, List[str]]:
        """Categorized mapping of allowed file types and their extensions."""
        return {
            "document": [".pdf", ".doc", ".docx", ".txt", ".md"],
            "image": [".png", ".jpg", ".jpeg", ".webp"],
            "audio": [".mp3", ".wav", ".m4a", ".ogg"],
            "video": [".mp4", ".mov", ".mkv", ".webm"],
        }

    @property
    def allowed_extensions_set(self) -> set[str]:
        """Flattened set of allowed lowercase extensions including the dot."""
        exts = set()
        for ext in self.allowed_extensions_str.split(","):
            ext = ext.strip().lower()
            if not ext.startswith("."):
                ext = f".{ext}"
            exts.add(ext)
        return exts

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    def validate_file(self, filename: str, file_size_bytes: Optional[int] = None) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Validates whether a file extension and optional size are allowed.
        Returns: (is_valid, media_type, error_message)
        """
        ext = Path(filename).suffix.lower()
        if not ext or ext not in self.allowed_extensions_set:
            return False, None, f"Unsupported file extension '{ext}'. Allowed: {', '.join(sorted(self.allowed_extensions_set))}"

        if file_size_bytes is not None and file_size_bytes > self.max_upload_size_bytes:
            return False, None, f"File size exceeds limit of {self.max_upload_size_mb} MB"

        # Determine media category
        media_type = None
        for category, extensions in self.allowed_file_types.items():
            if ext in extensions:
                media_type = category
                break

        return True, media_type, None


@lru_cache()
def get_settings() -> Settings:
    """Returns cached instance of the application settings."""
    return Settings()
