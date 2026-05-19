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
from backend.db.models import Memo
from backend.core.security import sanitize_workspace_id, validate_url, FileUploadHandler

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Shared file upload handler
_upload_handler = FileUploadHandler(settings.FILES_DIR)


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
    from backend.core.extractor import extract_url, extract_youtube, detect_url_type
    
    url_type = detect_url_type(data.url)
    
    try:
        if url_type == "youtube":
            extracted = await extract_youtube(data.url)
        else:
            extracted = await extract_url(data.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to extract: {str(e)}")
    
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=extracted.get("type", "article"),
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
    
    db.add(memo)
    await db.commit()
    
    # Process in background
    background_tasks.add_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        background_tasks.add_task(cache_thumbnail, memo.id)

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
    await db.commit()
    
    background_tasks.add_task(process_memo, memo.id)
    
    return {"id": memo.id, "title": memo.title, "type": "note", "status": "processing"}


@router.post("/file")
async def ingest_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    workspace_id: str = Form(default="default"),
    collection_id: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Upload and ingest a file (PDF, DOCX, image, audio)."""
    ws = sanitize_workspace_id(workspace_id)

    # Use secure upload handler
    result = await _upload_handler.save(file, workspace_id=ws)

    # Create memo
    memo = Memo(
        id=Path(result.path).stem,
        workspace_id=ws,
        type=result.type,
        title=result.filename,
        file_path=result.path,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    db.add(memo)
    await db.commit()

    # Process in background (extract text from file)
    background_tasks.add_task(process_file_memo, memo.id, result.path, result.type)

    return {"id": memo.id, "title": memo.title, "type": result.type, "status": "processing"}


async def process_file_memo(memo_id: str, file_path: str, memo_type: str):
    """Background: extract text from file and embed."""
    from backend.core.extractor import extract_pdf, extract_docx, extract_image
    
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        
        try:
            ext = Path(file_path).suffix.lower()
            
            if ext == ".pdf":
                data = await extract_pdf(file_path)
            elif ext in (".doc", ".docx"):
                data = await extract_docx(file_path)
            elif ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                data = await extract_image(file_path)
            else:
                # Try reading as text
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    data = {"content_text": content, "description": content[:200]}
                except Exception:
                    data = {}
            
            if data.get("content_text"):
                memo.content_text = data["content_text"]
                memo.description = data.get("description", "")[:200]
                await db.commit()
                
                # Now embed
                await process_memo(memo_id)
        except Exception as e:
            print(f"Error processing file {file_path}: {e}")


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
        type=data.type or extracted.get("type", "article"),
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
    
    db.add(memo)
    await db.commit()
    
    background_tasks.add_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        background_tasks.add_task(cache_thumbnail, memo.id)

    return {"id": memo.id, "title": memo.title, "status": "saved"}
