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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secure file serving — check ownership before returning files
_file_store = SafePath(settings.FILES_DIR)


@app.get("/api/files/{file_path:path}")
async def serve_file(file_path: str):
    """Serve an uploaded file if it belongs to a memo in the workspace."""
    from sqlalchemy import select
    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Memo

    # SafePath resolves and validates traversal
    target = _file_store.serve_path(file_path)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Memo).where(Memo.file_path == str(target))
        )
        memo = result.scalar_one_or_none()
        if not memo:
            raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(str(target))


_thumb_store = SafePath(settings.FILES_DIR / "thumbs")


@app.get("/api/files/thumb/{name}")
async def serve_thumb(name: str):
    """Serve a locally-cached thumbnail (public; only images under files/thumbs)."""
    target = _thumb_store.serve_path(name)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(target))

# Register routers
from backend.api.memos import router as memos_router
from backend.api.chat import router as chat_router
from backend.api.collections import router as collections_router
from backend.api.ingest import router as ingest_router
from backend.api.export import router as export_router
from backend.api.search import router as search_router
from backend.api.maintenance import router as maintenance_router
from backend.api.backup import router as backup_router

app.include_router(memos_router)
app.include_router(chat_router)
app.include_router(collections_router)
app.include_router(ingest_router)
app.include_router(export_router)
app.include_router(search_router)
app.include_router(maintenance_router)
app.include_router(backup_router)


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



