from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from pathlib import Path

from backend.config import settings
from backend.db.models import Base

# Ensure data directory exists
Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _run_migrations()


async def _run_migrations():
    """Run lightweight migrations for SQLite."""
    import aiosqlite
    from backend.config import settings
    
    db_path = str(settings.DATA_DIR / "openmemo.db")
    async with aiosqlite.connect(db_path) as db:
        # Check if memos table has notes column
        cursor = await db.execute("PRAGMA table_info(memos)")
        columns = [row[1] for row in await cursor.fetchall()]
        
        if "notes" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN notes TEXT")
            await db.commit()
        
        if "sort_order" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN sort_order INTEGER DEFAULT 0")
            await db.commit()

        if "pinned" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN pinned BOOLEAN DEFAULT 0")
            await db.commit()

        # recency_at drives the single sort order — "recent on top" with drag
        # promotion. Backfilled from created_at so existing libraries keep their
        # current order until the user drags something.
        if "recency_at" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN recency_at TIMESTAMP")
            await db.execute("UPDATE memos SET recency_at = created_at WHERE recency_at IS NULL")
            await db.commit()
