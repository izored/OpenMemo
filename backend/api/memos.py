"""Memo CRUD API endpoints."""
import mimetypes
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from backend.db.database import get_db
from backend.db.models import Memo, Collection, Tag, memo_collections, memo_tags
from backend.core.security import sanitize_workspace_id
from backend.core.file_paths import resolve_memo_path

router = APIRouter(prefix="/api/memos", tags=["memos"])


# Explicit audio MIME map. `mimetypes.guess_type` is unreliable for these on
# many systems (returns None / octet-stream for .flac, .opus, .weba), and the
# browser's <audio> element refuses to play a non-audio Content-Type. Forcing a
# correct audio/* type makes lossless (FLAC/WAV) and recorded (WebM/Opus) memos
# play and seek. FileResponse already emits Accept-Ranges + handles Range, so
# seeking works for free.
_AUDIO_MIME = {
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
    ".opus": "audio/ogg", ".flac": "audio/flac", ".weba": "audio/webm",
    ".webm": "audio/webm", ".wma": "audio/x-ms-wma", ".aiff": "audio/aiff",
    ".aif": "audio/aiff", ".mka": "audio/x-matroska",
}


# --- Schemas ---

class MemoCreate(BaseModel):
    type: str
    title: str
    description: Optional[str] = None
    content_text: Optional[str] = None
    content_raw: Optional[str] = None
    source_url: Optional[str] = None
    source_domain: Optional[str] = None
    source_favicon: Optional[str] = None
    thumbnail_path: Optional[str] = None
    workspace_id: Optional[str] = None
    collection_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None


class MemoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    content_text: Optional[str] = None
    content_raw: Optional[str] = None
    source_url: Optional[str] = None
    notes: Optional[str] = None
    collection_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None


class MemoResponse(BaseModel):
    id: str
    type: str
    title: str
    description: Optional[str]
    content_text: Optional[str]
    source_url: Optional[str]
    source_domain: Optional[str]
    source_favicon: Optional[str]
    thumbnail_path: Optional[str]
    ai_summary: Optional[str]
    audio_kind: Optional[str] = None
    is_processed: bool
    created_at: datetime
    updated_at: datetime
    collections: list[dict] = []
    tags: list[str] = []

    class Config:
        from_attributes = True


# --- Routes ---

def _apply_sort(query):
    """Single sort order: most recent on top. `recency_at` is bumped to
    NOW() on memo creation and rewritten when the user drags a card, so
    "recent" implicitly captures both fresh memos and explicit drag intent.
    `created_at` is the stable tiebreaker for memos created in the same
    millisecond (test seeds, bulk imports).
    """
    return query.order_by(desc(Memo.recency_at), desc(Memo.created_at))


@router.get("")
async def list_memos(
    workspace_id: Optional[str] = None,
    type: Optional[str] = None,
    collection_id: Optional[str] = None,
    search: Optional[str] = None,
    offset: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    if workspace_id:
        workspace_id = sanitize_workspace_id(workspace_id)
    """List memos with filtering and pagination."""
    query = select(Memo).options(
        selectinload(Memo.collections),
        selectinload(Memo.tags),
    )

    if workspace_id:
        query = query.where(Memo.workspace_id == workspace_id)
    query = query.where((Memo.is_deleted == False) | (Memo.is_deleted == None))  # noqa: E712
    if type and type != "all":
        # `type` may be a comma-separated group (e.g. the Files tab maps to
        # document,file,code,audio) so one tab can cover several memo types.
        types = [t.strip() for t in type.split(",") if t.strip()]
        if len(types) == 1:
            query = query.where(Memo.type == types[0])
        elif types:
            query = query.where(Memo.type.in_(types))
    if collection_id:
        query = query.join(memo_collections).where(
            memo_collections.c.collection_id == collection_id
        )
    if search:
        query = query.where(
            Memo.title.ilike(f"%{search}%") | Memo.content_text.ilike(f"%{search}%")
        )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    # Fetch with pagination
    query = _apply_sort(query).offset(offset).limit(limit)
    result = await db.execute(query)
    memos = result.scalars().all()
    
    return {
        "items": [
            {
                "id": m.id,
                "type": m.type,
                "title": m.title,
                "description": m.description,
                "content_text": (m.content_text[:400] if m.content_text else None),
                "source_url": m.source_url,
                "source_domain": m.source_domain,
                "source_favicon": m.source_favicon,
                "thumbnail_path": m.thumbnail_path,
                "file_path": m.file_path,
                "ai_summary": m.ai_summary,
                "notes": m.notes,
                "sort_order": m.sort_order,
                "pinned": m.pinned,
                "audio_kind": m.audio_kind,
                "is_processed": m.is_processed,
                "created_at": m.created_at.isoformat(),
                "updated_at": m.updated_at.isoformat(),
                "collections": [{"id": c.id, "name": c.name, "color": c.color} for c in m.collections],
                "tags": [t.name for t in m.tags],
            }
            for m in memos
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/{memo_id}")
async def get_memo(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single memo by ID."""
    query = select(Memo).options(
        selectinload(Memo.collections),
        selectinload(Memo.tags),
    ).where(Memo.id == memo_id)
    
    result = await db.execute(query)
    memo = result.scalar_one_or_none()
    
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    return {
        "id": memo.id,
        "type": memo.type,
        "title": memo.title,
        "description": memo.description,
        "content_text": memo.content_text,
        "content_raw": memo.content_raw,
        "video_description": memo.video_description,
        "transcript_status": memo.transcript_status,
        "transcript_lang": memo.transcript_lang,
        "transcript_source": memo.transcript_source,
        "localize_status": memo.localize_status,
        "audio_kind": memo.audio_kind,
        "notes": memo.notes,
        "source_url": memo.source_url,
        "source_domain": memo.source_domain,
        "source_favicon": memo.source_favicon,
        "file_path": memo.file_path,
        "thumbnail_path": memo.thumbnail_path,
        "ai_summary": memo.ai_summary,
        "summaries": memo.summaries,
        "notes": memo.notes,
        "sort_order": memo.sort_order,
        "pinned": memo.pinned,
        "is_processed": memo.is_processed,
        "created_at": memo.created_at.isoformat(),
        "updated_at": memo.updated_at.isoformat(),
        "collections": [{"id": c.id, "name": c.name, "color": c.color} for c in memo.collections],
        "tags": [t.name for t in memo.tags],
    }


def _parse_range(range_header: str, file_size: int) -> tuple[int, int] | None:
    """Parse a single 'bytes=start-end' range against file_size.

    Returns an inclusive (start, end) byte range, or None if the header is
    absent/malformed/unsatisfiable (caller then serves the full file). Only the
    first range of a (rare) multi-range request is honored — enough for media
    seeking, which always sends a single range.
    """
    if not range_header or not range_header.strip().lower().startswith("bytes="):
        return None
    spec = range_header.split("=", 1)[1].split(",")[0].strip()
    start_s, _, end_s = spec.partition("-")
    try:
        if start_s == "":
            # Suffix range: bytes=-N → last N bytes.
            n = int(end_s)
            if n <= 0:
                return None
            start = max(0, file_size - n)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
    except ValueError:
        return None
    end = min(end, file_size - 1)
    if start > end or start >= file_size:
        return None
    return start, end


async def _stream_file_range(path, start: int, end: int, chunk_size: int = 1024 * 1024):
    """Yield a byte range of a file in chunks (keeps RSS flat for big files)."""
    remaining = end - start + 1
    with open(path, "rb") as f:
        f.seek(start)
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.get("/{memo_id}/file")
async def get_memo_file(
    request: Request,
    memo_id: str,
    download: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Serve the original uploaded file for a memo.

    Inline by default (used for image rendering); pass ?download=1 to force a
    download with the original filename. Honors HTTP Range requests explicitly
    (206 Partial Content) so audio/video can seek — we don't rely on the
    framework's implicit Range handling, which proved unreliable behind the
    proxy. Always advertises Accept-Ranges so players show a seekable scrubber.
    """
    memo = (
        await db.execute(select(Memo).where(Memo.id == memo_id))
    ).scalar_one_or_none()
    if not memo or not memo.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    p = resolve_memo_path(memo.file_path)
    if p is None:
        raise HTTPException(status_code=404, detail="File not found")

    ext = p.suffix.lower()
    media_type = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    # Audio memos: always serve an audio/* type so <audio> will play them.
    # (A .webm recording is stored as type "audio" but guesses to video/webm.)
    if memo.type == "audio" and ext in _AUDIO_MIME:
        media_type = _AUDIO_MIME[ext]
    elif ext in _AUDIO_MIME and media_type in (None, "application/octet-stream"):
        media_type = _AUDIO_MIME[ext]

    if download:
        filename = (memo.title or p.name).replace('"', "")
        return FileResponse(str(p), media_type=media_type, filename=filename)

    file_size = p.stat().st_size
    rng = _parse_range(request.headers.get("range", ""), file_size)

    if rng is None:
        # Full file — still advertise range support so players enable seeking.
        return FileResponse(
            str(p),
            media_type=media_type,
            headers={"Accept-Ranges": "bytes"},
        )

    start, end = rng
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
    }
    return StreamingResponse(
        _stream_file_range(p, start, end),
        status_code=206,
        media_type=media_type,
        headers=headers,
    )


@router.post("/{memo_id}/transcribe")
async def transcribe_memo(
    memo_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off (or re-run) transcript extraction for a video/audio memo. Runs in
    the background; the client polls the memo until transcript_status is done.

    Two non-destructive paths, neither changes the memo's type or file_path:
      • Local file present  → faster-whisper STT on the local audio/video.
      • Remote only (source_url, no file) → caption-first, STT fallback via
        core/transcript.py (see ADR-004). A video memo keeps its embed."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if memo.type not in ("audio", "video"):
        raise HTTPException(status_code=400, detail="Only video/audio memos can be transcribed")
    if not memo.file_path and not memo.source_url:
        raise HTTPException(status_code=400, detail="Memo has no local file or source URL to transcribe")

    memo.transcript_status = "pending"
    memo.updated_at = datetime.utcnow()
    await db.commit()

    from backend.api.ingest import transcribe_memo_task, transcript_memo_task

    # faster-whisper reads video containers (PyAV) and pulls the audio track, so
    # a downloaded video can be transcribed too. Remote-only memos use the
    # caption-first extractor so the original stays a remote embed.
    if memo.file_path:
        background_tasks.add_task(transcribe_memo_task, memo_id)
    else:
        background_tasks.add_task(transcript_memo_task, memo_id)
    return {"id": memo_id, "status": "pending"}


class LocalizeRequest(BaseModel):
    mode: str = "video"  # video | audio (audio = explicit video→audio conversion)


@router.post("/{memo_id}/localize")
async def localize_memo(
    memo_id: str,
    body: LocalizeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """"Make it local" — download a remote video/audio source via yt-dlp so the
    memo survives the original being deleted. Runs in the background; the client
    polls the memo until localize_status is done."""
    from backend.core.localize_media import VALID_MODES

    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if not memo.source_url:
        raise HTTPException(status_code=400, detail="Memo has no source URL to download")
    if body.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {body.mode}")

    memo.localize_status = "pending"
    memo.updated_at = datetime.utcnow()
    await db.commit()

    from backend.api.ingest import localize_memo_task

    background_tasks.add_task(localize_memo_task, memo_id, body.mode)
    return {"id": memo_id, "status": "pending", "mode": body.mode}


@router.post("")
async def create_memo(data: MemoCreate, db: AsyncSession = Depends(get_db)):
    """Create a new memo."""
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=data.type,
        title=data.title,
        description=data.description,
        content_text=data.content_text,
        content_raw=data.content_raw,
        source_url=data.source_url,
        source_domain=data.source_domain,
        source_favicon=data.source_favicon,
        thumbnail_path=data.thumbnail_path,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    # Add to collections
    if data.collection_ids:
        for cid in data.collection_ids:
            col = await db.get(Collection, cid)
            if col:
                memo.collections.append(col)
    
    # Add tags
    if data.tags:
        for tag_name in data.tags:
            # Get or create tag
            result = await db.execute(select(Tag).where(Tag.name == tag_name))
            tag = result.scalar_one_or_none()
            if not tag:
                tag = Tag(id=str(uuid.uuid4()), name=tag_name)
                db.add(tag)
            memo.tags.append(tag)
    
    db.add(memo)
    await db.commit()
    await db.refresh(memo)
    
    return {"id": memo.id, "status": "created"}


@router.put("/{memo_id}")
async def update_memo(memo_id: str, data: MemoUpdate, db: AsyncSession = Depends(get_db)):
    """Update an existing memo."""
    result = await db.execute(
        select(Memo)
        .options(selectinload(Memo.collections), selectinload(Memo.tags))
        .where(Memo.id == memo_id)
    )
    memo = result.scalar_one_or_none()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    if data.title is not None:
        memo.title = data.title
    if data.description is not None:
        memo.description = data.description
    if data.content_text is not None:
        memo.content_text = data.content_text
    if data.content_raw is not None:
        memo.content_raw = data.content_raw
    if data.source_url is not None:
        memo.source_url = data.source_url
    if data.notes is not None:
        memo.notes = data.notes
    
    # Trigger re-embedding if content changed
    content_changed = data.content_text is not None or data.notes is not None
    
    # Update collections
    if data.collection_ids is not None:
        memo.collections = []
        for cid in data.collection_ids:
            col = await db.get(Collection, cid)
            if col:
                memo.collections.append(col)
    
    # Update tags
    if data.tags is not None:
        memo.tags = []
        for tag_name in data.tags:
            result = await db.execute(select(Tag).where(Tag.name == tag_name))
            tag = result.scalar_one_or_none()
            if not tag:
                tag = Tag(id=str(uuid.uuid4()), name=tag_name)
                db.add(tag)
            memo.tags.append(tag)
    
    memo.updated_at = datetime.utcnow()
    await db.commit()
    
    # Re-embed in background if content changed
    if content_changed:
        from backend.api.ingest import process_memo
        import asyncio
        asyncio.create_task(process_memo(memo_id))
    
    return {"id": memo.id, "status": "updated"}


class RecencyUpdate(BaseModel):
    recency_at: datetime


@router.put("/{memo_id}/recency")
async def update_memo_recency(memo_id: str, body: RecencyUpdate, db: AsyncSession = Depends(get_db)):
    """Set a memo's recency timestamp directly. Used by drag-to-reorder to
    place the memo at a chosen position in the recency-sorted list.
    """
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    memo.recency_at = body.recency_at
    memo.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": memo.id, "recency_at": memo.recency_at.isoformat(), "status": "updated"}


class PinUpdate(BaseModel):
    pinned: bool


@router.put("/{memo_id}/pin")
async def update_memo_pin(memo_id: str, body: PinUpdate, db: AsyncSession = Depends(get_db)):
    """Pin or unpin a memo so it surfaces in the sidebar Pinned section."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    memo.pinned = bool(body.pinned)
    memo.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": memo.id, "pinned": memo.pinned, "status": "updated"}


@router.get("/pinned/list")
async def list_pinned_memos(db: AsyncSession = Depends(get_db)):
    """Return memos with pinned=True, ordered by recency."""
    rows = (
        await db.execute(
            select(Memo)
            .where(Memo.pinned.is_(True))
            .where((Memo.is_deleted == False) | (Memo.is_deleted == None))  # noqa: E712
            .order_by(desc(Memo.recency_at), desc(Memo.created_at))
        )
    ).scalars().all()
    return [
        {
            "id": m.id,
            "type": m.type,
            "title": m.title,
            "thumbnail_path": m.thumbnail_path,
            "source_domain": m.source_domain,
            "source_favicon": m.source_favicon,
            "pinned": m.pinned,
            "sort_order": m.sort_order,
        }
        for m in rows
    ]


@router.delete("/{memo_id}")
async def delete_memo(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete a memo (recoverable from Settings within the session)."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    memo.is_deleted = True
    memo.deleted_at = datetime.utcnow()
    await db.commit()
    return {"status": "deleted"}


@router.post("/{memo_id}/restore")
async def restore_memo(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Restore a soft-deleted memo."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    memo.is_deleted = False
    memo.deleted_at = None
    await db.commit()
    return {"status": "restored"}


@router.get("/deleted/list")
async def list_deleted_memos(db: AsyncSession = Depends(get_db)):
    """Return recently soft-deleted memos, newest first."""
    rows = (
        await db.execute(
            select(Memo)
            .options(selectinload(Memo.collections), selectinload(Memo.tags))
            .where(Memo.is_deleted == True)  # noqa: E712
            .order_by(desc(Memo.deleted_at))
            .limit(20)
        )
    ).scalars().all()
    return [
        {"id": m.id, "type": m.type, "title": m.title,
         "deleted_at": m.deleted_at.isoformat() if m.deleted_at else None}
        for m in rows
    ]


class SummaryRequest(BaseModel):
    mode: str = "insights"  # insights | timestamp | essay


@router.post("/{memo_id}/summary")
async def generate_memo_summary(
    memo_id: str,
    body: SummaryRequest = Body(default_factory=SummaryRequest),
    db: AsyncSession = Depends(get_db),
):
    """Generate an AI summary for a memo in one of three modes, fed the full
    transcript/content. Results are cached per-mode in `summaries` so switching
    back to a mode is instant. `insights` mirrors to `ai_summary` for back-compat."""
    from backend.core.rag import SUMMARY_MODES

    if body.mode not in SUMMARY_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid summary mode: {body.mode}")
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")

    # Eligibility is one predicate, shared with the frontend (ADR-007): refuse
    # music and non-summarizable types so the API can't be summoned past the UI.
    from backend.core.classify import can_summarize
    if not can_summarize(memo):
        raise HTTPException(status_code=400, detail="This memo can't be summarized")

    from backend.core.rag import generate_summary
    summary = await generate_summary(memo.content_text, mode=body.mode)

    # Cache per-mode. dict(...) forces a new object so SQLAlchemy detects the
    # change on the JSON column (in-place mutation of a JSON dict isn't tracked).
    cached = dict(memo.summaries or {})
    cached[body.mode] = summary
    memo.summaries = cached
    if body.mode == "insights":
        memo.ai_summary = summary
    memo.updated_at = datetime.utcnow()
    await db.commit()

    return {"id": memo.id, "mode": body.mode, "summary": summary}


@router.get("/{memo_id}/related")
async def get_related_memos(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Get semantically related memos."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    from backend.core.embedder import search_similar
    
    # Use memo title + description as query
    query_text = f"{memo.title} {memo.description or ''}"
    results = await search_similar(query=query_text, n_results=5)
    
    # Filter out self and deduplicate by memo_id
    seen = set()
    related = []
    for r in results:
        mid = r["metadata"].get("memo_id")
        if mid and mid != memo_id and mid not in seen:
            seen.add(mid)
            related.append(mid)
    
    # Fetch memo details
    if related:
        query = select(Memo).where(Memo.id.in_(related[:4]))
        result = await db.execute(query)
        memos = result.scalars().all()
        return [
            {
                "id": m.id,
                "type": m.type,
                "title": m.title,
                "thumbnail_path": m.thumbnail_path,
                "source_domain": m.source_domain,
            }
            for m in memos
        ]
    
    return []
