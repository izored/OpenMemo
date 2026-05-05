"""Content ingestion API - handles URL saving, file uploads, and processing."""
import uuid
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.config import settings
from backend.db.database import get_db, AsyncSessionLocal
from backend.db.models import Memo

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


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
    collection_id: Optional[str] = None
    workspace_id: Optional[str] = None


# --- Background processing ---

async def process_memo(memo_id: str):
    """Background task to embed memo content."""
    from backend.core.embedder import embed_memo
    
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.content_text:
            return
        
        try:
            chunk_ids = await embed_memo(
                memo_id=memo.id,
                text=memo.content_text,
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
        workspace_id=data.workspace_id or "default",
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
        workspace_id=data.workspace_id or "default",
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
    # Determine type from extension
    ext = Path(file.filename).suffix.lower()
    type_map = {
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
    memo_type = type_map.get(ext, "document")
    
    # Save file
    file_dir = Path(settings.FILES_DIR) / workspace_id
    file_dir.mkdir(parents=True, exist_ok=True)
    
    file_id = str(uuid.uuid4())
    file_path = file_dir / f"{file_id}{ext}"
    
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    # Create memo
    memo = Memo(
        id=file_id,
        workspace_id=workspace_id,
        type=memo_type,
        title=Path(file.filename).stem,
        file_path=str(file_path),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    db.add(memo)
    await db.commit()
    
    # Process in background (extract text from file)
    background_tasks.add_task(process_file_memo, memo.id, str(file_path), memo_type)
    
    return {"id": memo.id, "title": memo.title, "type": memo_type, "status": "processing"}


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
    
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=data.workspace_id or "default",
        type=data.type,
        title=data.title,
        content_text=data.content_text,
        content_raw=data.html,
        source_url=data.url,
        source_domain=domain,
        source_favicon=data.favicon or (f"https://www.google.com/s2/favicons?domain={domain}&sz=32" if domain else None),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    db.add(memo)
    await db.commit()
    
    background_tasks.add_task(process_memo, memo.id)
    
    return {"id": memo.id, "title": memo.title, "status": "saved"}
