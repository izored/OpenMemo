"""Export API - Markdown, bulk export."""
import io
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.db.models import Memo

router = APIRouter(prefix="/api/export", tags=["export"])


def memo_to_markdown(memo) -> str:
    """Convert a memo to Markdown format."""
    lines = []
    lines.append(f"# {memo.title}")
    lines.append("")
    
    if memo.source_url:
        lines.append(f"**Source:** [{memo.source_domain or memo.source_url}]({memo.source_url})")
    
    lines.append(f"**Type:** {memo.type}")
    lines.append(f"**Date:** {memo.created_at.strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    
    if memo.ai_summary:
        lines.append("## AI Summary")
        lines.append(memo.ai_summary)
        lines.append("")
    
    if memo.content_text:
        lines.append("## Content")
        lines.append(memo.content_text)
    
    return "\n".join(lines)


@router.get("/memo/{memo_id}/markdown")
async def export_memo_markdown(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Export a single memo as Markdown."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    content = memo_to_markdown(memo)
    
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{memo.title[:50]}.md"',
        },
    )


@router.post("/bulk/markdown")
async def export_bulk_markdown(memo_ids: list[str], db: AsyncSession = Depends(get_db)):
    """Export multiple memos as a zip of Markdown files."""
    result = await db.execute(
        select(Memo).where(Memo.id.in_(memo_ids))
    )
    memos = result.scalars().all()
    
    if not memos:
        raise HTTPException(status_code=404, detail="No memos found")
    
    # Create zip in memory
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for memo in memos:
            content = memo_to_markdown(memo)
            filename = f"{memo.title[:50].replace('/', '-')}.md"
            zf.writestr(filename, content)
    
    buffer.seek(0)
    
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="openmemo_export_{datetime.now().strftime("%Y%m%d")}.zip"',
        },
    )
