"""OpenMemo - Local AI Knowledge OS powered by Ollama."""
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.config import settings
from backend.db.database import init_db, AsyncSessionLocal
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

# Register routers
from backend.api.memos import router as memos_router
from backend.api.chat import router as chat_router
from backend.api.collections import router as collections_router
from backend.api.ingest import router as ingest_router
from backend.api.export import router as export_router
from backend.api.memocast import router as memocast_router
from backend.api.search import router as search_router

app.include_router(memos_router)
app.include_router(chat_router)
app.include_router(collections_router)
app.include_router(ingest_router)
app.include_router(export_router)
app.include_router(memocast_router)
app.include_router(search_router)


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



