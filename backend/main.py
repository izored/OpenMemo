"""OpenMemo - Local AI Knowledge OS powered by Ollama."""
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.config import settings
from backend.db.database import init_db, AsyncSessionLocal, get_db
from backend.db.models import User, Workspace
from backend.core.security import SafePath
from backend.core.file_paths import resolve_memo_path


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and default workspace on startup."""
    # Ensure directories
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.FILES_DIR).mkdir(parents=True, exist_ok=True)
    
    # Init DB
    await init_db()
    
    # Init FTS5 search
    from backend.db.fts5 import init_fts5
    try:
        await init_fts5()
    except Exception as e:
        print(f"FTS5 init warning (non-critical): {e}")
    
    # Create default user and workspace if not exist
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(select(User).limit(1))
        user = result.scalar_one_or_none()
        
        if not user:
            user = User(
                id=str(uuid.uuid4()),
                name="Local User",
                email="local@openmemo.app",
            )
            db.add(user)
            
            workspace = Workspace(
                id="default",
                name="My Knowledge Base",
                owner_id=user.id,
                type="personal",
            )
            db.add(workspace)
            await db.commit()
    
    yield


app = FastAPI(
    title="OpenMemo API",
    version=settings.VERSION,
    description="Local AI Knowledge OS powered by Ollama",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # Browser extension fetches originate from chrome-extension://<id>.
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secure file serving — check ownership before returning files
_file_store = SafePath(settings.FILES_DIR)


_thumb_store = SafePath(settings.FILES_DIR / "thumbs")


_extracted_store = SafePath(settings.FILES_DIR / "extracted")


# Must be registered BEFORE the catch-all /api/files/{file_path:path} (same
# route-ordering gotcha as the thumb route). Serves locally-cached images
# from extracted article content (public; only under files/extracted).
@app.get("/api/files/extracted/{memo_id}/{name}")
async def serve_extracted(memo_id: str, name: str):
    import mimetypes

    target = _extracted_store.resolve(f"{memo_id}/{name}")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Asset not found")
    ext = target.suffix.lower()
    media_type = {
        ".webp": "image/webp", ".avif": "image/avif",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".svg": "image/svg+xml", ".bmp": "image/bmp",
    }.get(ext) or mimetypes.guess_type(str(target))[0] or "image/jpeg"
    return FileResponse(str(target), media_type=media_type)


# NOTE: must be registered BEFORE the catch-all /api/files/{file_path:path};
# otherwise the greedy :path param swallows "thumb/<name>" and the request
# is routed to serve_file (Memo-ownership check) and 404s.
@app.get("/api/files/thumb/{name}")
async def serve_thumb(name: str):
    """Serve a locally-cached thumbnail (public; only images under files/thumbs)."""
    target = _thumb_store.resolve(name)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    import mimetypes
    ext = target.suffix.lower()
    media_type = {
        ".webp": "image/webp", ".avif": "image/avif",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
    }.get(ext) or mimetypes.guess_type(str(target))[0] or "image/jpeg"
    return FileResponse(str(target), media_type=media_type)


@app.get("/api/files/{file_path:path}")
async def serve_file(file_path: str):
    """Serve an uploaded file if it belongs to a memo in the workspace.

    Looks up the memo by either the exact stored `file_path` OR the tolerant
    relative form (after the `files/` segment) so that legacy memos created
    under a different environment (Docker `/app/files/...` vs Windows
    `D:\\...\\files\\...`) still resolve.
    """
    from sqlalchemy import select
    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Memo

    # SafePath resolves and validates traversal
    target = _file_store.resolve(file_path)

    async with AsyncSessionLocal() as db:
        # Try exact path match first (fast path).
        result = await db.execute(
            select(Memo).where(Memo.file_path == str(target))
        )
        memo = result.scalar_one_or_none()

        # Fallback: scan memos and resolve each path tolerantly. Only triggers
        # when the URL is reached at all, so cost is bounded by one missed
        # request; in practice the UI uses `/api/memos/{id}/file` for image
        # rendering so this branch is rarely hit.
        if not memo:
            all_memos = (
                await db.execute(select(Memo).where(Memo.file_path.is_not(None)))
            ).scalars().all()
            for candidate in all_memos:
                resolved = resolve_memo_path(candidate.file_path)
                if resolved and resolved == target:
                    memo = candidate
                    break

        if not memo:
            raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(str(target))


@app.get("/api/proxy/image")
async def proxy_image(url: str, memo_id: str | None = None):
    """Proxy a remote image with browser headers to bypass hotlink protection.
    Optionally caches the result and updates the memo's thumbnail_path."""
    import httpx
    from starlette.responses import StreamingResponse
    from backend.api.ingest import _download_thumb, _thumb_headers, THUMBS_DIR

    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")

    # Try to cache if we have a memo_id and it's not already cached
    if memo_id:
        cached = await _download_thumb(url, memo_id)
        if cached:
            from backend.db.database import AsyncSessionLocal
            from backend.db.models import Memo
            from datetime import datetime
            async with AsyncSessionLocal() as db:
                memo = await db.get(Memo, memo_id)
                if memo and memo.thumbnail_path == url:
                    memo.thumbnail_path = cached
                    memo.updated_at = datetime.utcnow()
                    await db.commit()
            # Serve from local cache
            name = cached.split("/")[-1]
            target = THUMBS_DIR / name
            if target.exists():
                return FileResponse(str(target))

    # Fallback: stream the remote image
    try:
        async with httpx.AsyncClient(
            timeout=15, follow_redirects=True, headers=_thumb_headers(url)
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "image/jpeg")
            if "image" not in ctype:
                raise HTTPException(status_code=422, detail="Not an image")
            return StreamingResponse(
                iter([resp.content]),
                media_type=ctype,
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy failed: {e}")


# Register routers
from backend.api.memos import router as memos_router
from backend.api.chat import router as chat_router
from backend.api.collections import router as collections_router
from backend.api.ingest import router as ingest_router
from backend.api.export import router as export_router
from backend.api.search import router as search_router
from backend.api.maintenance import router as maintenance_router
from backend.api.backup import router as backup_router
from backend.api.settings import router as settings_router

app.include_router(memos_router)
app.include_router(chat_router)
app.include_router(collections_router)
app.include_router(ingest_router)
app.include_router(export_router)
app.include_router(search_router)
app.include_router(maintenance_router)
app.include_router(backup_router)
app.include_router(settings_router)


@app.get("/api/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate stats for the settings dashboard."""
    from sqlalchemy import func, select, and_
    from backend.db.models import Memo, Collection, Tag
    from datetime import datetime, timedelta
    from pathlib import Path

    total_memos = (await db.execute(select(func.count()).select_from(Memo))).scalar() or 0
    total_collections = (await db.execute(select(func.count()).select_from(Collection))).scalar() or 0
    total_tags = (await db.execute(select(func.count()).select_from(Tag))).scalar() or 0

    week_ago = datetime.utcnow() - timedelta(days=7)
    memos_this_week = (
        await db.execute(select(func.count()).select_from(Memo).where(Memo.created_at >= week_ago))
    ).scalar() or 0

    by_type_rows = (
        await db.execute(select(Memo.type, func.count()).group_by(Memo.type))
    ).all()
    by_type = {row[0]: row[1] for row in by_type_rows}

    def _size(path: Path) -> int:
        if not path.exists():
            return 0
        if path.is_file():
            try:
                return path.stat().st_size
            except OSError:
                return 0
        total = 0
        for p in path.rglob("*"):
            if p.is_file():
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
        return total

    db_bytes = _size(settings.DATA_DIR / "openmemo.db")
    files_bytes = _size(settings.FILES_DIR)
    cache_bytes = _size(Path(settings.CHROMA_PERSIST_DIR))

    return {
        "total_memos": total_memos,
        "total_collections": total_collections,
        "total_tags": total_tags,
        "memos_this_week": memos_this_week,
        "by_type": by_type,
        "storage": {
            "db_bytes": db_bytes,
            "files_bytes": files_bytes,
            "cache_bytes": cache_bytes,
            "total_bytes": db_bytes + files_bytes + cache_bytes,
        },
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    from backend.core.ollama_client import ollama_client
    
    ollama_status = await ollama_client.health_check()
    
    return {
        "status": "ok",
        "ollama_connected": ollama_status,
        "version": settings.VERSION,
    }


_EMBED_FAMILIES = {"bert", "nomic-bert", "nomic-bert-moe"}

@app.get("/api/models")
async def list_models():
    """List available Ollama models, excluding embed-only models."""
    from backend.core.ollama_client import ollama_client

    try:
        models = await ollama_client.list_models()
        chat_models = [
            m for m in models
            if "embed" not in m.get("name", "").lower()
            and not any(
                f in _EMBED_FAMILIES
                for f in (m.get("details", {}).get("families") or [])
            )
        ]
        return {"models": chat_models}
    except Exception as e:
        return {"models": [], "error": str(e)}



