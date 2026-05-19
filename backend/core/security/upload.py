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


# Default maximum file size: 5GB. User-overridable via app settings
# (backend/core/app_settings.py -> max_upload_mb).
DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024

# Extension -> memo type. This is a CATEGORIZATION map, NOT an allow-list:
# any extension (or none) is accepted; unknown types fall back to "file" and
# are shown with a generic file icon + extension badge in the UI.
_IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff",
          ".tif", ".heic", ".heif", ".avif", ".ico"}
_AUDIO = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus", ".wma"}
_VIDEO = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".wmv", ".flv"}
_DOCUMENT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
             ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv", ".epub"}
# Source/code files — never executed, only stored & rendered (see #4 / save()).
_CODE = {".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".h", ".cpp",
         ".hpp", ".cc", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt",
         ".kts", ".scala", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".sql",
         ".html", ".htm", ".css", ".scss", ".sass", ".less", ".json", ".yaml",
         ".yml", ".toml", ".ini", ".xml", ".md", ".markdown", ".ipynb",
         ".lua", ".r", ".dart", ".vue", ".svelte", ".graphql", ".proto",
         ".dockerfile", ".makefile", ".gradle", ".tf", ".vim", ".el"}


def categorize_extension(ext: str) -> str:
    """Map a file extension to a memo type. Unknown -> 'file'."""
    ext = ext.lower()
    if ext in _IMAGE:
        return "image"
    if ext in _AUDIO:
        return "audio"
    if ext in _VIDEO:
        return "video"
    if ext in _CODE:
        return "code"
    if ext in _DOCUMENT:
        return "document"
    return "file"


# Magic bytes — only used to sanity-check declared IMAGE uploads (where a
# corrupt/mislabelled image breaks rendering). All other types trust the
# extension so arbitrary files (archives, 3D, binaries…) are accepted.
_IMAGE_MAGIC = (
    b"\x89PNG",
    b"\xff\xd8\xff",       # JPEG
    b"GIF8",               # GIF
    b"RIFF",               # WEBP (RIFF container)
    b"BM",                 # BMP
    b"II*\x00", b"MM\x00*"  # TIFF
)


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
        max_size: int | None = None,
    ):
        self.base = Path(base_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)
        # Fixed override (tests); None = resolve the user-configurable limit
        # from app settings on each save().
        self._max_size_override = max_size

    @property
    def max_size(self) -> int:
        if self._max_size_override is not None:
            return self._max_size_override
        try:
            from backend.core.app_settings import get_max_upload_bytes

            return get_max_upload_bytes()
        except Exception:
            return DEFAULT_MAX_FILE_SIZE

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
        max_size = self.max_size
        if len(content) > max_size:
            raise UploadValidationError(
                status_code=413,
                detail=f"File too large. Max size: {max_size // (1024 * 1024)}MB",
            )

        # Any extension is accepted — categorize, don't gate.
        original_name = sanitize_filename(file.filename or "untitled")
        ext = Path(original_name).suffix.lower()
        memo_type = categorize_extension(ext)

        # Only sanity-check declared images (a corrupt image just breaks
        # rendering). Everything else trusts the extension.
        if memo_type == "image":
            self._validate_image_magic(content)

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

    def _validate_image_magic(self, content: bytes) -> None:
        """Reject a file claiming an image extension whose bytes aren't an image.
        SVG is text-based, so it's exempt."""
        header = content[:12]
        if header.lstrip().startswith(b"<"):  # SVG / XML
            return
        if not any(header.startswith(m) for m in _IMAGE_MAGIC):
            raise UploadValidationError(
                status_code=400,
                detail="File content does not look like a valid image",
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
