"""Add transcript_source + summaries columns to the memos table.

Idempotent: SQLite errors on a duplicate column, which we catch and ignore, so
re-running is safe. See CLAUDE.md gotcha — no migration framework; ALTER TABLE
guarded by try/except (PRAGMA check equivalent).
"""
import asyncio

from sqlalchemy import text

from backend.db.database import AsyncSessionLocal


async def migrate():
    async with AsyncSessionLocal() as session:
        for ddl, label in [
            ("ALTER TABLE memos ADD COLUMN transcript_source VARCHAR", "transcript_source"),
            ("ALTER TABLE memos ADD COLUMN summaries JSON", "summaries"),
        ]:
            try:
                await session.execute(text(ddl))
                print(f"added column: {label}")
            except Exception as e:
                print(f"{label} column: {e}")
        await session.commit()
        print("Migration complete")


if __name__ == "__main__":
    asyncio.run(migrate())
