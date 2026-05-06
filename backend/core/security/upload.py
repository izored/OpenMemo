"""Secure file upload handler.

Usage:
    from backend.core.security import FileUploadHandler

    handler = FileUploadHandler(settings.FILES_DIR)
    result = await handler.save(file, workspace_id="default")
    # result.path is the saved file path
    # result.type is the memo type (image, document, audio)
"""

import uuid
from pathlib import Path
from dataclasses import dataclass
from typing import BinaryIO

from fastapi import HTTPException, UploadFile

from backend.core.security.sanitize import sanitize_workspace_id, sanitize_filename


# Maximum file size: 50MB
DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024

# Allowed extensions and their memo type mapping
ALLOWED_EXTENSIONS = {
    ".pdf": "document",
    ".doc": "document",
    ".docx": "document",
    ".xlsx": "document",
    ".xls": "document",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
    ".ogg": "audio",
}

# Magic bytes for content validation
MAGIC_BYTES = {
    b"%PDF": "document",
    b"\x89PNG": "image",
    b"\xff\xd8\xff": "image",  # JPEG
    b"RIFF": "audio",  # WAV / WEBP
    b"ID3": "audio",  # MP3
    b"\x66\x74\x79\x70": "audio",  # MP4 / M4A
}

# Extensions where magic bytes validation is skipped (compressed/office formats)
MAGIC_BYPASS_EXTENSIONS = {".doc", ".docx", ".xlsx", ".xls", ".ogg", ".m4a"}


class UploadValidationError(HTTPException):
    """Raised when a file fails validation."""

    pass


@dataclass
class UploadResult:
    """Result of a successful file upload."""

    path: str
    filename: str
    type: str
    size: int


class FileUploadHandler:
    """Handles secure file uploads with validation and sanitization.

    Enforces:
    - Size limits
    - Extension whitelist
    - Magic byte content validation
    - Path traversal prevention
    - Safe filename generation
    """

    def __init__(
        self,
        base_dir: str | Path,
        max_size: int = DEFAULT_MAX_FILE_SIZE,
    ):
        self.base = Path(base_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)
        self.max_size = max_size

    async def save(
        self,
        file: UploadFile,
        workspace_id: str | None = "default",
    ) -> UploadResult:
        """Validate and save an uploaded file. Returns UploadResult on success."""
        # Sanitize workspace_id
        ws = sanitize_workspace_id(workspace_id)

        # Read and check size
        content = await file.read()
        if len(content) > self.max_size:
            raise UploadValidationError(
                status_code=413,
                detail=f"File too large. Max size: {self.max_size // (1024 * 1024)}MB",
            )

        # Validate extension
        original_name = sanitize_filename(file.filename or "untitled")
        ext = Path(original_name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise UploadValidationError(
                status_code=400,
                detail=f"File type not allowed: {ext}",
            )

        memo_type = ALLOWED_EXTENSIONS[ext]

        # Validate magic bytes
        self._validate_magic_bytes(content, ext)

        # Build safe path
        file_id = str(uuid.uuid4())
        safe_name = f"{file_id}{ext}"
        target_dir = self.base / ws
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name

        # Defensive: ensure resolved path is still under base
        try:
            target_path.resolve().relative_to(self.base)
        except ValueError:
            raise UploadValidationError(status_code=400, detail="Invalid file path")

        # Write file
        with open(target_path, "wb") as f:
            f.write(content)

        return UploadResult(
            path=str(target_path),
            filename=original_name,
            type=memo_type,
            size=len(content),
        )

    def _validate_magic_bytes(self, content: bytes, ext: str) -> None:
        """Check file content matches expected type via magic bytes."""
        if ext in MAGIC_BYPASS_EXTENSIONS:
            return

        header = content[:8]
        matched = any(header.startswith(magic) for magic in MAGIC_BYTES)

        if not matched:
            raise UploadValidationError(
                status_code=400,
                detail="File content does not match extension",
            )

    def serve_path(self, relative_path: str) -> Path:
        """Resolve a relative file path for serving. Raises on traversal."""
        target = self.base / relative_path
        resolved = target.resolve()

        try:
            resolved.relative_to(self.base)
        except ValueError:
            raise HTTPException(status_code=404, detail="File not found")

        if not resolved.exists():
            raise HTTPException(status_code=404, detail="File not found")

        return resolved
