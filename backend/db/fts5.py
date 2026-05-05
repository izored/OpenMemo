"""SQLite FTS5 full-text search helpers."""
import asyncio
from sqlalchemy import text
from backend.db.database import AsyncSessionLocal, engine


async def init_fts5():
    """Create FTS5 virtual table for memo search if it doesn't exist."""
    async with engine.begin() as conn:
        # Create FTS5 virtual table
        await conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(
                title, content_text,
                content='memos', content_rowid='rowid'
            )
        """))
        
        # Create triggers to keep FTS5 index in sync with memos table
        await conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS memos_fts_insert AFTER INSERT ON memos BEGIN
                INSERT INTO memos_fts(rowid, title, content_text)
                VALUES (new.rowid, new.title, new.content_text);
            END
        """))
        
        await conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS memos_fts_update AFTER UPDATE ON memos BEGIN
                UPDATE memos_fts SET 
                    title = new.title,
                    content_text = new.content_text
                WHERE rowid = new.rowid;
            END
        """))
        
        await conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS memos_fts_delete AFTER DELETE ON memos BEGIN
                DELETE FROM memos_fts WHERE rowid = old.rowid;
            END
        """))
        
        # Rebuild index if empty (first run)
        result = await conn.execute(text("SELECT COUNT(*) FROM memos_fts"))
        count = result.scalar()
        if count == 0:
            await conn.execute(text("""
                INSERT INTO memos_fts(rowid, title, content_text)
                SELECT rowid, title, content_text FROM memos
            """))


import re


def _escape_fts5(query: str) -> str:
    """Escape FTS5 special characters and wrap terms in quotes for literal matching."""
    # Strip FTS5 control characters
    query = re.sub(r'["*\-\(\)]', ' ', query)
    # Normalize whitespace
    query = re.sub(r'\s+', ' ', query).strip()
    if not query:
        return ""
    # Wrap each term in double quotes for literal match
    terms = query.split()
    return " ".join(f'"{term}"' for term in terms)


async def search_fts5(query: str, workspace_id: str, limit: int = 20) -> list[dict]:
    """Search memos using FTS5. Returns list of {memo_id, rank}."""
    escaped = _escape_fts5(query)
    if not escaped:
        return []
    
    async with AsyncSessionLocal() as db:
        try:
            # FTS5 search with rank
            result = await db.execute(
                text("""
                    SELECT m.id, memos_fts.rank
                    FROM memos_fts
                    JOIN memos m ON memos_fts.rowid = m.rowid
                    WHERE memos_fts MATCH :query AND m.workspace_id = :workspace_id
                    ORDER BY memos_fts.rank ASC
                    LIMIT :limit
                """),
                {"query": escaped, "workspace_id": workspace_id, "limit": limit}
            )
            rows = result.fetchall()
            return [{"memo_id": row[0], "rank": row[1]} for row in rows]
        except Exception as e:
            # FTS5 may not be available or table not set up
            print(f"FTS5 search error: {e}")
            return []
