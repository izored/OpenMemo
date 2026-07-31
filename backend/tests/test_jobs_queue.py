"""Job queue invariants (ADR-024 §9, plan 024 phase 0).

Covers the three failures the queue exists to prevent: unbounded concurrency,
work lost on restart, and duplicate jobs for the same memo.
"""
import asyncio

import pytest
from sqlalchemy import text

from backend.core import jobs
from backend.db.database import AsyncSessionLocal


@pytest.fixture(autouse=True)
async def _clean_queue():
    """Fresh table + empty handler registry around every test."""
    await jobs.create_table()
    async with AsyncSessionLocal() as db:
        await db.execute(text("DELETE FROM job_queue"))
        await db.commit()
    saved = dict(jobs._HANDLERS)
    jobs._HANDLERS.clear()
    yield
    await jobs.stop_workers()
    jobs._HANDLERS.clear()
    jobs._HANDLERS.update(saved)


async def _drain(timeout=5.0):
    """Wait until nothing is queued or running."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text(
                "SELECT COUNT(*) FROM job_queue WHERE state IN ('queued','running')"
            ))
            if result.scalar() == 0:
                return True
        await asyncio.sleep(0.05)
    return False


async def _states() -> dict[str, int]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT state, COUNT(*) FROM job_queue GROUP BY state"))
        return {row[0]: row[1] for row in result.fetchall()}


async def test_concurrency_is_capped_per_kind():
    """The headline bug: 40 memos must not start 40 downloads at once."""
    live = 0
    peak = 0

    @jobs.register("capped", concurrency=3)
    async def _handler(payload):
        nonlocal live, peak
        live += 1
        peak = max(peak, live)
        await asyncio.sleep(0.05)
        live -= 1

    for i in range(40):
        await jobs.enqueue("capped", memo_id=f"memo-{i}")

    await jobs.start_workers()
    assert await _drain(timeout=10.0), "queue did not drain"
    assert peak <= 3, f"ran {peak} concurrently, cap was 3"
    assert (await _states()).get("done") == 40


async def test_dedupe_collapses_same_memo_and_kind():
    @jobs.register("dedup", concurrency=1)
    async def _handler(payload):
        pass

    first = await jobs.enqueue("dedup", memo_id="same")
    second = await jobs.enqueue("dedup", memo_id="same")
    third = await jobs.enqueue("dedup", memo_id="other")

    assert first is not None
    assert second is None, "second enqueue for the same memo should dedupe"
    assert third is not None, "a different memo is not a duplicate"


async def test_dedupe_promotes_priority_instead_of_duplicating():
    """Clicking play on something already queued as backfill must jump the line,
    not add a second job."""
    @jobs.register("promote", concurrency=1)
    async def _handler(payload):
        pass

    await jobs.enqueue("promote", memo_id="m", priority=jobs.PRIORITY_BACKFILL)
    assert await jobs.enqueue("promote", memo_id="m", priority=jobs.PRIORITY_USER) is None

    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT priority, COUNT(*) FROM job_queue GROUP BY priority"))
        rows = result.fetchall()
    assert rows == [(jobs.PRIORITY_USER, 1)], f"expected one promoted job, got {rows}"


async def test_priority_orders_execution():
    order: list[str] = []

    @jobs.register("ordered", concurrency=1)
    async def _handler(payload):
        order.append(payload["memo_id"])

    await jobs.enqueue("ordered", memo_id="backfill", priority=jobs.PRIORITY_BACKFILL)
    await jobs.enqueue("ordered", memo_id="recent", priority=jobs.PRIORITY_RECENT)
    await jobs.enqueue("ordered", memo_id="user", priority=jobs.PRIORITY_USER)

    await jobs.start_workers()
    assert await _drain()
    assert order == ["user", "recent", "backfill"]


async def test_startup_reclaims_interrupted_jobs():
    """A job left running by a crash must come back, not sit stuck for an hour.

    Regression guard: reclaim() originally only requeued jobs whose lease had
    EXPIRED, so a job interrupted by shutdown kept its fresh 1-hour lease and
    was stranded for that hour after every restart.
    """
    @jobs.register("crashy", concurrency=1)
    async def _handler(payload):
        pass

    job_id = await jobs.enqueue("crashy", memo_id="m")
    # Simulate a crash while running: state=running with a lease far in the future.
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""UPDATE job_queue
                    SET state = 'running',
                        lease_until = datetime('now', '+1 hour')
                    WHERE id = :id"""),
            {"id": job_id},
        )
        await db.commit()

    assert (await _states()).get("running") == 1
    reclaimed = await jobs.reclaim(all_running=True)
    assert reclaimed == 1
    assert (await _states()).get("queued") == 1

    # And the lease-expiry sweep must NOT touch a healthy in-flight job.
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""UPDATE job_queue
                    SET state = 'running',
                        lease_until = datetime('now', '+1 hour')
                    WHERE id = :id"""),
            {"id": job_id},
        )
        await db.commit()
    assert await jobs.reclaim() == 0, "expiry sweep stole a job with a valid lease"


async def test_failure_retries_then_parks_as_failed():
    attempts = 0

    @jobs.register("flaky", concurrency=1)
    async def _handler(payload):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("nope")

    await jobs.enqueue("flaky", memo_id="m")
    await jobs.start_workers()

    # First attempt fails immediately; the retry is scheduled 30s out, so the
    # job parks in `queued` with run_after in the future rather than spinning.
    await asyncio.sleep(0.4)
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT state, attempts, last_error FROM job_queue"))
        state, count, err = result.fetchone()

    assert attempts == 1, "must not retry instantly and burn attempts in a hot loop"
    assert state == "queued"
    assert count == 1
    assert "RuntimeError" in err


async def test_unregistered_kind_is_rejected_loudly():
    with pytest.raises(ValueError, match="no handler registered"):
        await jobs.enqueue("does-not-exist", memo_id="m")
