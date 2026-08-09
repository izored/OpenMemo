from sqlalchemy import event
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
    # The aiosqlite dialect defaults to NullPool — a fresh connection per
    # checkout, closed on return — so there is no fixed-size pool to exhaust.
    # That makes releasing the DB session BEFORE a media stream begins the real
    # fix (see api/memos.get_memo_file, OPNMMO-0052): otherwise every lingering
    # iOS/Cloudflare audio connection pins an open SQLite connection (+ its
    # worker thread + file descriptors) for the whole song, and the accumulation
    # eventually starves the process. pool_recycle drops any connection idle for
    # too long as a backstop; NullPool rejects pool_size/max_overflow/timeout.
    pool_recycle=1800,
)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    """Per-connection pragmas (plans/006). journal_mode=WAL persists in the DB
    file (set in _run_migrations), but busy_timeout and synchronous are
    per-connection — without this listener every engine connection ran with
    busy_timeout=0 and errored 'database is locked' under write contention."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


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
    
    # Take the file from DATABASE_URL rather than assuming DATA_DIR/openmemo.db.
    # The engine above already uses DATABASE_URL, so a deployment that points it
    # at a differently named SQLite file had its migrations run here against an
    # empty file created on the spot, while the real database stayed unmigrated
    # and every query failed with "no such table: memos". Docker's relative
    # ./data/openmemo.db and the Windows default both resolve unchanged.
    url = settings.DATABASE_URL
    db_path = url.split("///", 1)[-1] if url.startswith("sqlite") else str(settings.DATA_DIR / "openmemo.db")
    async with aiosqlite.connect(db_path) as db:
        # WAL persists in the DB file header, so setting it once here applies to
        # every later connection: readers no longer block the single writer (and
        # vice-versa), which matters when many media streams hold connections at
        # once. busy_timeout lets a contended write wait briefly instead of
        # erroring "database is locked" outright.
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=5000")
        await db.commit()

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

        # Hidden memos: out of the dashboard, still in collections, listed in
        # the passcode-gated hidden section (OPNMMO-0016).
        if "hidden" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN hidden BOOLEAN DEFAULT 0")
            await db.commit()

        # Liked songs — music-surface flag, independent of pinned.
        if "liked" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN liked BOOLEAN DEFAULT 0")
            await db.commit()

        # User-chosen dashboard tile size ('wide' spans two columns). NULL = normal.
        if "card_size" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN card_size VARCHAR")
            await db.commit()

        # Embed outcome per memo — lets the UI show and retry failed embeds
        # instead of memos silently missing from RAG/search (plans/007).
        if "embed_status" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN embed_status TEXT")
            await db.commit()

        if "is_deleted" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN is_deleted BOOLEAN DEFAULT 0")
            await db.commit()

        if "deleted_at" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN deleted_at TIMESTAMP")
            await db.commit()

        # Which resolver tier produced this memo. A tier ladder degrades
        # silently by design — every tier "succeeds", just with less. Recording
        # the winner is what let Settings notice that six weeks of Instagram
        # saves had quietly dropped to the last-resort tier (plan 026).
        if "resolve_tier" not in columns:
            await db.execute("ALTER TABLE memos ADD COLUMN resolve_tier TEXT")
            await db.commit()

    # Persistent background job queue (ADR-024 §9). Owns its own schema so the
    # table + indexes stay next to the code that reads them. Idempotent.
    from backend.core.jobs import create_table as _create_job_queue

    await _create_job_queue()
