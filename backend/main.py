"""OpenMemo - Local AI Knowledge OS powered by Ollama."""
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.db.database import init_db, AsyncSessionLocal
from backend.db.models import User, Workspace


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and default workspace on startup."""
    # Ensure directories
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.FILES_DIR).mkdir(parents=True, exist_ok=True)
    
    # Init DB
    await init_db()
    
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

# Mount static files for uploaded content
files_path = Path(settings.FILES_DIR)
files_path.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(files_path)), name="files")

# Register routers
from backend.api.memos import router as memos_router
from backend.api.chat import router as chat_router
from backend.api.collections import router as collections_router
from backend.api.ingest import router as ingest_router
from backend.api.export import router as export_router
from backend.api.memocast import router as memocast_router

app.include_router(memos_router)
app.include_router(chat_router)
app.include_router(collections_router)
app.include_router(ingest_router)
app.include_router(export_router)
app.include_router(memocast_router)


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


@app.get("/api/models")
async def list_models():
    """List available Ollama models."""
    from backend.core.ollama_client import ollama_client
    
    try:
        models = await ollama_client.list_models()
        return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.get("/api/search")
async def hybrid_search(
    q: str,
    workspace_id: str = "default",
    limit: int = 20,
):
    """Hybrid search: full-text + semantic."""
    from backend.core.embedder import search_similar
    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Memo
    from sqlalchemy import select, or_
    
    results = []
    
    # Semantic search
    try:
        semantic_results = await search_similar(
            query=q,
            workspace_id=workspace_id,
            n_results=limit,
        )
        
        # Get unique memo IDs
        memo_ids = list(set(
            r["metadata"]["memo_id"] for r in semantic_results
            if r["metadata"].get("memo_id")
        ))
        
        async with AsyncSessionLocal() as db:
            if memo_ids:
                result = await db.execute(
                    select(Memo).where(Memo.id.in_(memo_ids))
                )
                memos = result.scalars().all()
                
                for memo in memos:
                    results.append({
                        "id": memo.id,
                        "type": memo.type,
                        "title": memo.title,
                        "description": memo.description,
                        "source_domain": memo.source_domain,
                        "thumbnail_path": memo.thumbnail_path,
                        "created_at": memo.created_at.isoformat(),
                        "match_type": "semantic",
                    })
            
            # Also do full-text search for additional results
            ft_result = await db.execute(
                select(Memo).where(
                    or_(
                        Memo.title.ilike(f"%{q}%"),
                        Memo.content_text.ilike(f"%{q}%"),
                    )
                ).limit(limit)
            )
            ft_memos = ft_result.scalars().all()
            
            existing_ids = {r["id"] for r in results}
            for memo in ft_memos:
                if memo.id not in existing_ids:
                    results.append({
                        "id": memo.id,
                        "type": memo.type,
                        "title": memo.title,
                        "description": memo.description,
                        "source_domain": memo.source_domain,
                        "thumbnail_path": memo.thumbnail_path,
                        "created_at": memo.created_at.isoformat(),
                        "match_type": "fulltext",
                    })
    except Exception as e:
        # Fallback to full-text only
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Memo).where(
                    or_(
                        Memo.title.ilike(f"%{q}%"),
                        Memo.content_text.ilike(f"%{q}%"),
                    )
                ).limit(limit)
            )
            memos = result.scalars().all()
            results = [
                {
                    "id": m.id,
                    "type": m.type,
                    "title": m.title,
                    "description": m.description,
                    "source_domain": m.source_domain,
                    "thumbnail_path": m.thumbnail_path,
                    "created_at": m.created_at.isoformat(),
                    "match_type": "fulltext",
                }
                for m in memos
            ]
    
    return {"results": results, "total": len(results)}
