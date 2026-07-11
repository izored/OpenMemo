"""SQLite pragma wiring (plans/006).

busy_timeout and synchronous are per-connection — they must be set by the
engine's connect listener, not just once at init, or write contention errors
with 'database is locked'.
"""
from sqlalchemy import text

from backend.db.database import engine


async def test_wal_and_busy_timeout_enabled():
    async with engine.connect() as conn:
        journal = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
        busy = (await conn.execute(text("PRAGMA busy_timeout"))).scalar()
        sync = (await conn.execute(text("PRAGMA synchronous"))).scalar()
    assert str(journal).lower() == "wal"
    assert int(busy) >= 5000
    assert int(sync) == 1  # NORMAL
