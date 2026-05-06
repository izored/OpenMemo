"""Unified input sanitization utilities.

Every endpoint that handles user input should import from here.
Never write ad-hoc sanitization inline in route handlers.
"""

import re
from pathlib import Path
from urllib.parse import urlparse
from fastapi import HTTPException


# ─── Path / Identifier Sanitization ───

# Allowed characters for workspace_id: alphanumeric, underscore, hyphen
_WORKSPACE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

# Characters safe in filenames (no path separators, no control chars, no shell metas)
_FILENAME_SAFE_RE = re.compile(r"^[\w\-\.\s]+$")

# Maximum length for identifiers
_MAX_ID_LEN = 128


def sanitize_workspace_id(workspace_id: str | None) -> str:
    """Sanitize workspace_id to prevent path traversal and injection.

    Rules:
    - Whitelist: a-z A-Z 0-9 _ -
    - Max length: 128 chars
    - Cannot be empty
    - Returns 'default' if None
    """
    if workspace_id is None:
        return "default"

    workspace_id = workspace_id.strip()
    if not workspace_id:
        return "default"

    if len(workspace_id) > _MAX_ID_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"workspace_id too long (max {_MAX_ID_LEN} characters)",
        )

    if not _WORKSPACE_ID_RE.match(workspace_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid workspace_id. Allowed: a-z A-Z 0-9 _ -",
        )

    return workspace_id


def sanitize_filename(filename: str) -> str:
    """Sanitize a user-provided filename.

    Rules:
    - Remove path separators and parent directory references
    - Strip control characters
    - Limit length to 255 chars
    """
    if not filename:
        return "untitled"

    # Remove path traversal patterns
    filename = filename.replace("..", "")
    filename = filename.replace("/", "")
    filename = filename.replace("\\", "")

    # Strip control characters
    filename = re.sub(r"[\x00-\x1f\x7f]", "", filename)

    # Strip shell metacharacters
    filename = re.sub(r"[&|;$`\"'<>]", "", filename)

    # Limit length
    name = Path(filename).stem[:128]
    ext = Path(filename).suffix[:32]
    filename = name + ext

    if not filename or filename == ".":
        filename = "untitled"

    return filename


# ─── FTS5 Query Escaping ───

_FTS5_SPECIAL_CHARS_RE = re.compile(r'["*\-\(\)]')


def escape_fts5_query(query: str) -> str:
    """Escape FTS5 special characters and wrap terms in quotes for literal matching.

    This prevents FTS5 syntax errors and injection via search terms.
    """
    if not query or not query.strip():
        return ""

    # Strip FTS5 control characters
    query = _FTS5_SPECIAL_CHARS_RE.sub(" ", query)
    # Normalize whitespace
    query = re.sub(r"\s+", " ", query).strip()
    if not query:
        return ""

    # Wrap each term in double quotes for literal match
    terms = query.split()
    return " ".join(f'"{term}"' for term in terms)


# ─── URL Validation ───

_ALLOWED_SCHEMES = {"http", "https"}


def validate_url(url: str) -> str:
    """Validate a user-provided URL.

    Rules:
    - Must have http:// or https:// scheme
    - Must have a netloc (domain)
    - No file://, javascript:, data:, etc.
    """
    if not url or not url.strip():
        raise HTTPException(status_code=400, detail="URL is required")

    url = url.strip()
    parsed = urlparse(url)

    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid URL scheme: {parsed.scheme or 'missing'}. Only http:// and https:// are allowed.",
        )

    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL: missing domain")

    # Reject localhost / private IPs in production
    # (kept simple for local-first app; can be tightened later)

    return url


# ─── General String Sanitization ───

def sanitize_string(value: str | None, max_length: int = 4096) -> str:
    """Sanitize a generic user input string.

    Rules:
    - Strip leading/trailing whitespace
    - Limit length
    - Strip null bytes
    """
    if value is None:
        return ""

    value = value.strip()
    value = value.replace("\x00", "")

    if len(value) > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"Input too long (max {max_length} characters)",
        )

    return value


# ─── SafePath Helper ───

class SafePath:
    """Helper to safely resolve paths within a base directory.

    Usage:
        safe = SafePath("/app/files")
        target = safe.resolve("workspace1", "memo.pdf")
        # Raises if the resolved path escapes the base directory
    """

    def __init__(self, base_dir: str | Path):
        self.base = Path(base_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def resolve(self, *parts: str) -> Path:
        """Resolve a path relative to base_dir. Raises on traversal escape."""
        target = self.base.joinpath(*parts)
        target_resolved = target.resolve()

        try:
            target_resolved.relative_to(self.base)
        except ValueError:
            raise HTTPException(status_code=404, detail="Path not found")

        return target_resolved

    def ensure_parent(self, *parts: str) -> Path:
        """Like resolve() but also creates parent directories."""
        path = self.resolve(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
