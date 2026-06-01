"""Content ingestion API - handles URL saving, file uploads, and processing."""
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.config import settings
from backend.db.database import get_db, AsyncSessionLocal
from sqlalchemy import select

from backend.db.models import Memo, Collection
from backend.core.security import sanitize_workspace_id, validate_url, FileUploadHandler
from backend.core.classify import derive_memo_type

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Shared file upload handler
_upload_handler = FileUploadHandler(settings.FILES_DIR)


async def _attach_collection(db: AsyncSession, memo: Memo, collection_id: Optional[str]) -> None:
    """Link a memo to a collection by id, if provided and it exists."""
    if not collection_id:
        return
    coll = (
        await db.execute(select(Collection).where(Collection.id == collection_id))
    ).scalar_one_or_none()
    if coll is not None:
        memo.collections.append(coll)


class URLIngest(BaseModel):
    url: str
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None


class NoteIngest(BaseModel):
    title: str
    content: str
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None


class ExtensionSave(BaseModel):
    type: str
    url: Optional[str] = None
    title: str
    content_text: Optional[str] = None
    html: Optional[str] = None
    favicon: Optional[str] = None
    thumbnail: Optional[str] = None
    description: Optional[str] = None
    collection_id: Optional[str] = None
    workspace_id: Optional[str] = None


class AIIngest(BaseModel):
    """Headless ingestion for AI agents. Pre-supply all fields — no URL fetch."""
    type: str = "note"
    title: str
    content: Optional[str] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_domain: Optional[str] = None
    source_favicon: Optional[str] = None
    thumbnail_url: Optional[str] = None
    tags: list[str] = []
    collection_id: Optional[str] = None
    workspace_id: Optional[str] = None


# --- Thumbnail caching ---

THUMBS_DIR = Path(settings.FILES_DIR) / "thumbs"


_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _thumb_headers(src_url: str) -> dict:
    """Browser-like headers that bypass hotlink protection on visual platforms."""
    from urllib.parse import urlparse
    parsed = urlparse(src_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "User-Agent": _BROWSER_UA,
        "Accept": "image/webp,image/avif,image/*,*/*;q=0.8",
        "Referer": origin + "/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin",
    }


async def _download_thumb(src: str, name_stem: str) -> str | None:
    """Fetch a remote image, save to thumbs dir, return local path or None."""
    import httpx

    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(
            timeout=20, follow_redirects=True, headers=_thumb_headers(src)
        ) as client:
            resp = await client.get(src)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            if "image" not in ctype:
                return None
            ext = {
                "image/png": ".png",
                "image/webp": ".webp",
                "image/gif": ".gif",
                "image/avif": ".avif",
            }.get(ctype.split(";")[0].strip(), ".jpg")
            name = f"{name_stem}{ext}"
            (THUMBS_DIR / name).write_bytes(resp.content)
            return f"/api/files/thumb/{name}"
    except Exception:
        return None


async def cache_thumbnail(memo_id: str):
    """Download a remote thumbnail once and serve it locally."""
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.thumbnail_path:
            return
        src = memo.thumbnail_path
        if not src.startswith("http"):
            return
        local = await _download_thumb(src, memo_id)
        if local:
            memo.thumbnail_path = local
            memo.updated_at = datetime.utcnow()
            await db.commit()


# --- Background processing ---

async def _localize_memo_task(memo_id: str):
    """Download remote images in extracted content so the memo survives the
    source being deleted. Best-effort — never blocks/raises into the request."""
    try:
        from backend.core.localizer import localize_memo

        await localize_memo(memo_id)
    except Exception as e:
        print(f"Localize failed for {memo_id}: {e}")


async def process_memo(memo_id: str):
    """Background task to embed memo content."""
    from backend.core.embedder import embed_memo
    
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.content_text:
            return
        
        try:
            text_to_embed = memo.content_text
            if memo.notes:
                text_to_embed += f"\n\n--- Notes ---\n{memo.notes}"
            chunk_ids = await embed_memo(
                memo_id=memo.id,
                text=text_to_embed,
                metadata={
                    "workspace_id": memo.workspace_id,
                    "type": memo.type,
                    "title": memo.title,
                    "source_domain": memo.source_domain or "",
                },
            )
            memo.embedding_ids = chunk_ids
            memo.is_processed = True
            memo.updated_at = datetime.utcnow()
            await db.commit()
        except Exception as e:
            print(f"Error processing memo {memo_id}: {e}")


# --- Routes ---

@router.post("/url")
async def ingest_url(
    data: URLIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Ingest content from a URL."""
    from backend.core.extractor import (
        extract_url, extract_youtube, extract_social_video, detect_url_type,
    )

    url_type = detect_url_type(data.url)

    try:
        if url_type == "youtube":
            extracted = await extract_youtube(data.url)
        elif url_type == "social_video":
            extracted = await extract_social_video(data.url)
        else:
            extracted = await extract_url(data.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to extract: {str(e)}")

    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=extracted.get("type", "link"),
        title=extracted.get("title", data.url),
        description=extracted.get("description"),
        content_text=extracted.get("content_text"),
        content_raw=extracted.get("content_raw"),
        source_url=data.url,
        source_domain=extracted.get("source_domain"),
        source_favicon=extracted.get("source_favicon"),
        thumbnail_path=extracted.get("thumbnail_path"),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    # Canonical type from URL signal (video aggregator / direct file / web page).
    memo.type = derive_memo_type(memo)

    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    # Process in background
    background_tasks.add_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        background_tasks.add_task(cache_thumbnail, memo.id)
    background_tasks.add_task(_localize_memo_task, memo.id)

    return {"id": memo.id, "title": memo.title, "type": memo.type, "status": "processing"}


@router.post("/note")
async def ingest_note(
    data: NoteIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Create a note memo."""
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type="note",
        title=data.title,
        content_text=data.content,
        content_raw=data.content,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    background_tasks.add_task(process_memo, memo.id)

    return {"id": memo.id, "title": memo.title, "type": "note", "status": "processing"}


# Types a caller may force via `type_override` on /file. Mirrors the taxonomy
# in core/classify.py. Used by the mic recorder: a browser records audio into a
# WebM container (.webm), which the extension map files as "video" — the
# override lets the client declare it is really an audio memo.
_OVERRIDABLE_TYPES = {
    "note", "link", "image", "video", "audio", "document", "code", "file",
}


@router.post("/file")
async def ingest_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    workspace_id: str = Form(default="default"),
    collection_id: Optional[str] = Form(default=None),
    type_override: Optional[str] = Form(default=None),
    transcribe: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Upload and ingest a file (PDF, DOCX, image, audio).

    `type_override` lets a trusted client pin the memo type when the file
    extension would categorize it wrong (e.g. a mic recording in a .webm
    container is audio, not video). Ignored unless it is a known type.

    `transcribe` (audio only) schedules background speech-to-text after save.
    """
    ws = sanitize_workspace_id(workspace_id)

    # Use secure upload handler
    result = await _upload_handler.save(file, workspace_id=ws)

    memo_type = result.type
    if type_override and type_override in _OVERRIDABLE_TYPES:
        memo_type = type_override

    want_transcript = bool(transcribe) and memo_type == "audio"

    # Create memo
    memo = Memo(
        id=Path(result.path).stem,
        workspace_id=ws,
        type=memo_type,
        title=result.filename,
        file_path=result.path,
        transcript_status="pending" if want_transcript else None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    db.add(memo)
    await _attach_collection(db, memo, collection_id)
    await db.commit()

    # Process in background (extract text from file)
    background_tasks.add_task(process_file_memo, memo.id, result.path, memo_type)
    if want_transcript:
        background_tasks.add_task(transcribe_memo_task, memo.id)

    return {"id": memo.id, "title": memo.title, "type": memo_type, "status": "processing"}


async def transcribe_memo_task(memo_id: str):
    """Background: transcribe an audio memo, store the cleaned text in
    content_text (so it embeds + is searchable), record the detected language,
    then embed it. Status flows pending → processing → done | error.
    """
    from backend.core.transcribe import transcribe_audio
    from backend.core.file_paths import resolve_memo_path

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.file_path:
            return
        file_path = memo.file_path
        memo.transcript_status = "processing"
        await db.commit()

    p = resolve_memo_path(file_path) or Path(file_path)
    try:
        result = await transcribe_audio(str(p))
        text = (result.get("text") or "").strip()
        lang = result.get("language")
        status = "done"
    except Exception as e:
        print(f"Transcription failed for {memo_id}: {e}")
        text, lang, status = "", None, "error"

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        if text:
            memo.content_text = text
            memo.content_raw = text
            if not memo.description:
                memo.description = text[:200]
        memo.transcript_lang = lang
        memo.transcript_status = status
        memo.updated_at = datetime.utcnow()
        await db.commit()

    if status == "done" and text:
        await process_memo(memo_id)


# Map code/text extensions to a Markdown fence language for syntax rendering.
_CODE_LANG = {
    ".py": "python", ".js": "javascript", ".jsx": "jsx", ".ts": "typescript",
    ".tsx": "tsx", ".java": "java", ".c": "c", ".h": "c", ".cpp": "cpp",
    ".hpp": "cpp", ".cc": "cpp", ".cs": "csharp", ".go": "go", ".rs": "rust",
    ".rb": "ruby", ".php": "php", ".swift": "swift", ".kt": "kotlin",
    ".scala": "scala", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".ps1": "powershell", ".bat": "batch", ".sql": "sql", ".html": "html",
    ".htm": "html", ".css": "css", ".scss": "scss", ".sass": "sass",
    ".less": "less", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml", ".ini": "ini", ".xml": "xml", ".md": "markdown",
    ".lua": "lua", ".r": "r", ".dart": "dart", ".vue": "vue",
    ".svelte": "svelte", ".graphql": "graphql", ".proto": "protobuf",
}


async def process_file_memo(memo_id: str, file_path: str, memo_type: str):
    """Background: extract text from file and embed.

    SECURITY: uploaded files are NEVER executed or interpreted. Code/script
    files are only opened in read mode for text extraction and stored — no
    subprocess, exec, eval, import, or shell invocation touches uploaded
    content anywhere in the ingestion path.
    """
    from backend.core.extractor import extract_pdf, extract_docx, extract_image
    from backend.core.video import extract_video_thumbnail

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return

        # Video → grab a still frame for the grid thumbnail. Best-effort:
        # if ffmpeg is missing or fails, the video memo just renders without
        # a thumb (same path as before).
        if memo_type == "video":
            THUMBS_DIR.mkdir(parents=True, exist_ok=True)
            thumb_name = f"{memo_id}.jpg"
            thumb_target = THUMBS_DIR / thumb_name
            if await extract_video_thumbnail(file_path, thumb_target):
                memo.thumbnail_path = f"/api/files/thumb/{thumb_name}"
                memo.updated_at = datetime.utcnow()
                await db.commit()

        try:
            ext = Path(file_path).suffix.lower()
            
            # Known text-ish file extensions whose content is safe to read as
            # UTF-8 even when memo_type is the generic "file" bucket (i.e. a
            # plain text file the categorizer hadn't seen).
            _PLAIN_TEXT_EXTS = {".txt", ".csv", ".log", ".tsv", ".srt", ".vtt"}

            if ext == ".pdf":
                data = await extract_pdf(file_path)
            elif ext in (".doc", ".docx"):
                data = await extract_docx(file_path)
            elif ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                data = await extract_image(file_path)
            elif memo_type == "code" or ext in _PLAIN_TEXT_EXTS:
                # Read as text (code/plain). Opened read-only — never executed.
                # Skipped for memo_type == "file" with an unknown extension so
                # we don't dump replacement-char garbage from a binary blob
                # (3D models, archives, proprietary formats…) into the DB.
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                    data = {"content_text": content, "description": content[:200]}
                    if memo_type == "code":
                        lang = _CODE_LANG.get(ext, "")
                        data["content_raw"] = f"```{lang}\n{content}\n```"
                except Exception:
                    data = {}
            else:
                # Unknown binary / generic file — keep the memo as a pure
                # file reference, no text extraction.
                data = {}

            if data.get("content_text"):
                memo.content_text = data["content_text"]
                if data.get("content_raw"):
                    memo.content_raw = data["content_raw"]
                memo.description = data.get("description", "")[:200]
                await db.commit()
                
                # Now embed
                await process_memo(memo_id)
        except Exception as e:
            print(f"Error processing file {file_path}: {e}")


@router.post("/ai")
async def ingest_from_ai(
    data: AIIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Headless ingestion for AI agents running locally.

    Unlike /url (fetches + extracts) and /extension (DOM scrape), this endpoint
    accepts pre-populated fields directly — the caller is the AI, so metadata is
    already structured. Background embedding still runs so the memo is searchable.

    Example (curl):
        curl -X POST http://localhost:8099/api/ingest/ai \\
             -H 'Content-Type: application/json' \\
             -d '{
               "type": "link",
               "title": "Attention Is All You Need",
               "source_url": "https://arxiv.org/abs/1706.03762",
               "source_domain": "arxiv.org",
               "description": "Transformer architecture paper.",
               "content": "Full extracted text or summary...",
               "tags": ["ml", "transformers"],
               "collection_id": "optional-uuid"
             }'
    """
    from urllib.parse import urlparse
    from backend.db.models import Tag

    domain = data.source_domain
    if not domain and data.source_url:
        try:
            domain = urlparse(data.source_url).hostname or ''
            domain = domain.removeprefix('www.')
        except Exception:
            domain = ''

    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=data.type,
        title=data.title,
        description=data.description,
        content_text=data.content,
        content_raw=data.content,
        source_url=data.source_url,
        source_domain=domain,
        source_favicon=data.source_favicon or (
            f"https://www.google.com/s2/favicons?domain={domain}&sz=32" if domain else None
        ),
        thumbnail_path=data.thumbnail_url,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)

    for tag_name in data.tags:
        tag = (await db.execute(select(Tag).where(Tag.name == tag_name))).scalar_one_or_none()
        if not tag:
            tag = Tag(id=str(uuid.uuid4()), name=tag_name)
            db.add(tag)
        memo.tags.append(tag)

    await db.commit()

    background_tasks.add_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        background_tasks.add_task(cache_thumbnail, memo.id)

    return {
        "id": memo.id,
        "title": memo.title,
        "type": memo.type,
        "status": "processing",
        "tags": data.tags,
    }


@router.post("/extension")
async def ingest_from_extension(
    data: ExtensionSave,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Save content from the browser extension."""
    from urllib.parse import urlparse
    
    domain = ""
    if data.url:
        parsed = urlparse(data.url)
        domain = parsed.netloc

    # The extension extracts from the live rendered DOM (works on SPA /
    # bot-walled sites). Server fetch is only a fallback for the bits the
    # extension couldn't supply.
    extracted = {}
    need_fallback = not data.content_text or not data.thumbnail
    if data.url and need_fallback and data.type in ("article", "link"):
        from backend.core.extractor import extract_url
        try:
            extracted = await extract_url(data.url)
        except Exception:
            extracted = {}

    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=data.type or extracted.get("type", "link"),
        title=data.title or extracted.get("title") or data.url,
        description=data.description or extracted.get("description"),
        content_text=data.content_text or extracted.get("content_text"),
        content_raw=data.html or extracted.get("content_raw"),
        source_url=data.url,
        source_domain=domain,
        source_favicon=data.favicon or extracted.get("source_favicon") or (f"https://www.google.com/s2/favicons?domain={domain}&sz=32" if domain else None),
        thumbnail_path=data.thumbnail or extracted.get("thumbnail_path"),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    # Canonical type — the extension's DOM scrape may mislabel (e.g. "article").
    memo.type = derive_memo_type(memo)

    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    background_tasks.add_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        background_tasks.add_task(cache_thumbnail, memo.id)
    background_tasks.add_task(_localize_memo_task, memo.id)

    return {"id": memo.id, "title": memo.title, "status": "saved"}
