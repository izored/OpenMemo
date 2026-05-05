"""MemoCast API - podcast script generation and audio."""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.config import settings
from backend.db.database import get_db, AsyncSessionLocal
from backend.db.models import Memo, MemoCast

router = APIRouter(prefix="/api/memocast", tags=["memocast"])


class MemoCastCreate(BaseModel):
    memo_ids: Optional[list[str]] = None  # If None, use last 24h memos
    workspace_id: Optional[str] = None
    model: Optional[str] = None


@router.get("")
async def list_memocasts(
    workspace_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all memocast episodes."""
    query = select(MemoCast).order_by(MemoCast.created_at.desc())
    if workspace_id:
        query = query.where(MemoCast.workspace_id == workspace_id)
    
    result = await db.execute(query)
    episodes = result.scalars().all()
    
    return [
        {
            "id": e.id,
            "title": e.title,
            "duration": e.duration,
            "audio_path": e.audio_path,
            "memos_json": e.memos_json,
            "created_at": e.created_at.isoformat(),
        }
        for e in episodes
    ]


@router.get("/{episode_id}")
async def get_memocast(episode_id: str, db: AsyncSession = Depends(get_db)):
    """Get a memocast episode with script."""
    episode = await db.get(MemoCast, episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    
    return {
        "id": episode.id,
        "title": episode.title,
        "script_text": episode.script_text,
        "audio_path": episode.audio_path,
        "duration": episode.duration,
        "memos_json": episode.memos_json,
        "created_at": episode.created_at.isoformat(),
    }


@router.post("")
async def create_memocast(
    data: MemoCastCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Create a new memocast episode."""
    from backend.core.rag import generate_memocast_script
    
    workspace_id = data.workspace_id or "default"
    
    # Get memos
    if data.memo_ids:
        result = await db.execute(
            select(Memo).where(Memo.id.in_(data.memo_ids))
        )
    else:
        # Last 24 hours
        since = datetime.utcnow() - timedelta(hours=24)
        result = await db.execute(
            select(Memo).where(
                and_(
                    Memo.workspace_id == workspace_id,
                    Memo.created_at >= since,
                )
            ).order_by(Memo.created_at.desc()).limit(10)
        )
    
    memos = result.scalars().all()
    
    if not memos:
        raise HTTPException(status_code=400, detail="No memos found for episode")
    
    # Generate script
    memo_texts = [
        {"title": m.title, "text": m.content_text or m.description or ""}
        for m in memos
    ]
    
    script = await generate_memocast_script(memo_texts, model=data.model)
    
    # Create episode
    episode = MemoCast(
        id=str(uuid.uuid4()),
        workspace_id=workspace_id,
        title=f"Episode {datetime.now().strftime('%b %d')} - {memos[0].title[:30]}",
        script_text=script,
        memos_json=[m.id for m in memos],
        created_at=datetime.utcnow(),
    )
    
    db.add(episode)
    await db.commit()
    
    # Generate audio in background
    background_tasks.add_task(generate_episode_audio, episode.id)
    
    return {
        "id": episode.id,
        "title": episode.title,
        "script_text": script,
        "status": "generating_audio",
    }


async def generate_episode_audio(episode_id: str):
    """Background: generate TTS audio for episode."""
    from backend.core.tts import generate_audio
    from pathlib import Path
    
    async with AsyncSessionLocal() as db:
        episode = await db.get(MemoCast, episode_id)
        if not episode or not episode.script_text:
            return
        
        audio_dir = Path(settings.FILES_DIR) / "memocast"
        audio_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(audio_dir / f"{episode_id}.wav")
        
        result = await generate_audio(episode.script_text, output_path)
        
        if result:
            episode.audio_path = result
            # Estimate duration (~150 words per minute)
            word_count = len(episode.script_text.split())
            episode.duration = int((word_count / 150) * 60)
            await db.commit()
