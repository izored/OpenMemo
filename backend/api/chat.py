"""Chat API endpoints with streaming RAG."""
import uuid
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.db.database import get_db
from backend.db.models import ChatSession, Message, Memo
from backend.core.security import sanitize_workspace_id

router = APIRouter(prefix="/api/chat", tags=["chat"])


# --- Schemas ---

class ChatRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None
    memo_id: Optional[str] = None
    model: Optional[str] = None
    use_rag: bool = True


class SessionResponse(BaseModel):
    id: str
    title: str
    model_used: Optional[str]
    created_at: datetime


# --- Routes ---

@router.post("/stream")
async def chat_stream(data: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Stream a RAG chat response."""
    from backend.core.rag import rag_chat
    
    # Get or create session. A brand-new session gets a smart LLM title after
    # its first answer (below); until then it falls back to the truncated query.
    is_new_session = not data.session_id
    session_id = data.session_id
    if not session_id:
        session_id = str(uuid.uuid4())
        session = ChatSession(
            id=session_id,
            workspace_id=data.workspace_id or "default",
            collection_id=data.collection_id,
            memo_id=data.memo_id,
            title=data.query[:50],
            model_used=data.model,
        )
        db.add(session)
        await db.commit()
    
    # Save user message
    user_msg = Message(
        id=str(uuid.uuid4()),
        session_id=session_id,
        role="user",
        content=data.query,
    )
    db.add(user_msg)
    await db.commit()
    
    # Detect "@" command for general (no-RAG) mode
    use_rag = data.use_rag
    query = data.query
    if query.startswith("@general ") or query.startswith("@"):
        use_rag = False
        query = query.removeprefix("@general ").removeprefix("@general").removeprefix("@").strip()
    
    # Get chat history for context. Exclude the user message we just saved —
    # rag_chat appends the current query itself; including it here would send
    # the question to the model twice.
    history = []
    if data.session_id:
        result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id, Message.id != user_msg.id)
            .order_by(Message.created_at.desc())
            .limit(6)
        )
        msgs = result.scalars().all()
        msgs = list(reversed(msgs))
        history = [{"role": m.role, "content": m.content} for m in msgs]

    # Single-memo chat: feed the whole memo (description + transcript/extracted)
    # rather than a few retrieved chunks, so Ask sees everything the page shows
    # (OPNMMO-0042). Falls back to normal RAG when there's no memo or no content.
    memo_context = None
    memo_source = None
    memo_thin = False
    if use_rag and data.memo_id:
        from backend.core.rag import build_memo_context, build_memo_header
        memo = await db.get(Memo, data.memo_id)
        if memo:
            body = build_memo_context(
                description=memo.video_description or memo.description,
                content_text=memo.content_text,
                content_raw=memo.content_raw,
                transcript_done=memo.transcript_status == "done",
            )
            # A memo with no transcript/extracted text (a freshly-saved song, a
            # link we didn't pull) still has a title and basic metadata. Feed that
            # as context so Ask can reason from it instead of dead-ending on "use
            # @" (OPNMMO-0045). `thin` = title/metadata only, no real body.
            header = build_memo_header(
                title=memo.title,
                artist=memo.audio_artist,
                album=memo.audio_album,
                domain=memo.source_domain,
                mtype=memo.type,
            )
            memo_thin = not body.strip()
            memo_context = (header + "\n\n" + body).strip() if body.strip() else header
            if memo_context:
                memo_source = {
                    "memo_id": memo.id,
                    "title": memo.title or "This memo",
                    "domain": memo.source_domain or "",
                    "snippet": memo_context[:200],
                    "distance": 0,
                }

    async def event_stream():
        full_response = ""
        sources_data = None

        try:
            async for chunk in rag_chat(
                query=query,
                workspace_id=data.workspace_id,
                collection_id=data.collection_id,
                memo_id=data.memo_id,
                model=data.model,
                history=history,
                use_rag=use_rag,
                memo_context=memo_context,
                memo_source=memo_source,
                memo_thin=memo_thin,
            ):
                if chunk["type"] == "sources":
                    sources_data = chunk["data"]
                    yield f"data: {json.dumps({'type': 'sources', 'data': sources_data})}\n\n"
                elif chunk["type"] == "token":
                    full_response += chunk["data"]
                    yield f"data: {json.dumps({'type': 'token', 'data': chunk['data']})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
            return

        # Save assistant message, then name a fresh thread from its first
        # exchange. Title is set BEFORE the 'done' event so the session list
        # (refetched on done) already shows the smart title, not the fallback.
        async with (await _get_session()) as save_db:
            assistant_msg = Message(
                id=str(uuid.uuid4()),
                session_id=session_id,
                role="assistant",
                content=full_response,
                sources_json=sources_data,
            )
            save_db.add(assistant_msg)
            await save_db.commit()

            if is_new_session and full_response.strip():
                from backend.core.rag import generate_title
                title = await generate_title(query, full_response, data.model)
                if title:
                    sess = await save_db.get(ChatSession, session_id)
                    if sess:
                        sess.title = title
                        await save_db.commit()

        yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Session-Id": session_id,
        },
    )


async def _get_session():
    """Get a new database session for saving after streaming."""
    from backend.db.database import AsyncSessionLocal
    return AsyncSessionLocal()


@router.get("/sessions")
async def list_sessions(
    workspace_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List chat sessions."""
    query = select(ChatSession).order_by(ChatSession.created_at.desc())
    if workspace_id:
        query = query.where(ChatSession.workspace_id == sanitize_workspace_id(workspace_id))
    
    result = await db.execute(query)
    sessions = result.scalars().all()
    
    return [
        {
            "id": s.id,
            "title": s.title,
            "model_used": s.model_used,
            "collection_id": s.collection_id,
            "memo_id": s.memo_id,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ]


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, db: AsyncSession = Depends(get_db)):
    """Get messages for a chat session."""
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    messages = result.scalars().all()
    
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources_json,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a chat session and its messages."""
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await db.delete(session)
    await db.commit()
    return {"status": "deleted"}
