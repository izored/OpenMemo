"""Persistent background job queue (ADR-024 §9, plan 024 phase 0).

Before this module, every background operation went through
`BackgroundTasks.add_task` or a bare `asyncio.create_task`: ~25 call sites with
no concurrency cap, no persistence, and no retry. Importing 40 memos started 40
yt-dlp processes at once, and a restart mid-import lost every pending task with
the memo left at `pending`/`processing` forever.

This queue fixes all three:

* **Persistent.** Jobs live in SQLite, so a restart resumes them. A worker that
  dies mid-job lets its lease expire and the job returns to `queued` rather than
  vanishing.
* **Bounded.** Concurrency is capped per kind, so downloads cannot starve the
  box and Whisper still runs one-at-a-time (it already needed
  `transcribe._infer_lock` for exactly that reason).
* **Prioritized.** A track the user just clicked jumps ahead of a 500-item
  backfill.

Deliberately NOT behind `mesh_enabled` — this is ordinary app infrastructure
that fixes a live bug. Mesh (ADR-024) later becomes one more producer of jobs.

Usage:

    @register("thumbnail", concurrency=4)
    async def _thumbnail(payload):
        await cache_thumbnail(payload["memo_id"])

    await enqueue("thumbnail", memo_id=memo.id, priority=PRIORITY_RECENT)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Priority ladder. Lower runs first. Named so call sites read as intent rather
# than as magic numbers.
PRIORITY_USER = 0        # the user is looking at it right now
PRIORITY_PINNED = 10
PRIORITY_RECENT = 20     # normal ingest
PRIORITY_BACKFILL = 100  # bulk/maintenance work, always yields

# How long a claimed job stays leased before another worker may reclaim it. Must
# comfortably exceed the slowest realistic job (a long yt-dlp pull or a Whisper
# pass on CPU) or healthy work gets run twice.
LEASE_SECONDS = 3600

# Ceiling on retries before a job is parked in `failed` with its last error.
MAX_ATTEMPTS = 3

# How long a worker sleeps when it finds nothing to do. Short enough to feel
# instant when the user clicks play, cheap enough to idle on.
IDLE_POLL_SECONDS = 2.0

# How often the janitor sweeps for jobs whose worker died without releasing the
# lease. Only matters for a process that stays up a long time — a restart is
# handled by the janitor's first pass.
RECLAIM_INTERVAL_SECONDS = 900.0


@dataclass
class _Handler:
    fn: Callable[[dict[str, Any]], Awaitable[None]]
    concurrency: int


_HANDLERS: dict[str, _Handler] = {}
_workers: list[asyncio.Task] = []
_shutdown = asyncio.Event()


def register(kind: str, concurrency: int = 1):
    """Register the coroutine that executes `kind`, and how many may run at once.

    Concurrency is per kind, not global: network-bound work (downloads) can run
    several at a time while CPU-bound work (Whisper, embedding) stays at 1.
    """
    def _decorator(fn: Callable[[dict[str, Any]], Awaitable[None]]):
        if kind in _HANDLERS:
            raise ValueError(f"job kind {kind!r} is already registered")
        _HANDLERS[kind] = _Handler(fn=fn, concurrency=concurrency)
        return fn

    return _decorator


async def create_table() -> None:
    """Create the queue table + indexes. Idempotent, called from _run_migrations."""
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS job_queue (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                memo_id     TEXT,
                payload     TEXT NOT NULL DEFAULT '{}',
                priority    INTEGER NOT NULL DEFAULT 20,
                state       TEXT NOT NULL DEFAULT 'queued',
                attempts    INTEGER NOT NULL DEFAULT 0,
                last_error  TEXT,
                lease_until TIMESTAMP,
                run_after   TIMESTAMP,
                created_at  TIMESTAMP NOT NULL,
                updated_at  TIMESTAMP NOT NULL
            )
        """))
        # The claim query filters on (state, kind, run_after) and orders by
        # (priority, created_at) — one covering index keeps it off a table scan
        # once the queue holds a large backfill.
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_job_queue_claim
            ON job_queue (state, kind, run_after, priority, created_at)
        """))
        # Supports the dedupe probe and the per-memo Activity view.
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_job_queue_memo
            ON job_queue (memo_id, kind, state)
        """))
        # Makes dedupe correct rather than merely likely. The read-then-insert in
        # enqueue() races: two callers can both find no pending row and both
        # insert. This partial unique index turns the loser into an
        # IntegrityError, which enqueue() treats as "already queued".
        # NULLs compare distinct in SQLite, so jobs with no memo_id are exempt —
        # which is what we want, they are not per-memo work.
        await db.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_pending
            ON job_queue (kind, memo_id)
            WHERE state IN ('queued', 'running')
        """))
        await db.commit()


async def enqueue(
    kind: str,
    *,
    memo_id: str | None = None,
    payload: dict[str, Any] | None = None,
    priority: int = PRIORITY_RECENT,
    dedupe: bool = True,
) -> str | None:
    """Queue a job. Returns its id, or None when deduped away.

    `dedupe` collapses a job that is already queued or running for the same
    (kind, memo_id) — without it, opening a memo five times would queue five
    identical downloads. Pass dedupe=False for jobs that are genuinely
    repeatable (a user-forced retry).
    """
    if kind not in _HANDLERS:
        raise ValueError(f"no handler registered for job kind {kind!r}")

    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        if dedupe and memo_id is not None:
            existing = await db.execute(
                text("""
                    SELECT id FROM job_queue
                    WHERE kind = :kind AND memo_id = :memo_id
                      AND state IN ('queued', 'running')
                    LIMIT 1
                """),
                {"kind": kind, "memo_id": memo_id},
            )
            row = existing.first()
            if row is not None:
                # Already pending. If the caller is more urgent than whatever
                # queued it (user clicked play on a backfill item), promote it
                # rather than adding a duplicate.
                await db.execute(
                    text("""
                        UPDATE job_queue
                        SET priority = MIN(priority, :priority), updated_at = :now
                        WHERE id = :id AND state = 'queued'
                    """),
                    {"priority": priority, "now": now, "id": row[0]},
                )
                await db.commit()
                return None

        job_id = str(uuid.uuid4())
        try:
            await db.execute(
                text("""
                    INSERT INTO job_queue
                        (id, kind, memo_id, payload, priority, state,
                         attempts, run_after, created_at, updated_at)
                    VALUES
                        (:id, :kind, :memo_id, :payload, :priority, 'queued',
                         0, :now, :now, :now)
                """),
                {
                    "id": job_id,
                    "kind": kind,
                    "memo_id": memo_id,
                    "payload": json.dumps(payload or {}),
                    "priority": priority,
                    "now": now,
                },
            )
            await db.commit()
        except IntegrityError:
            # ux_job_queue_pending fired: a concurrent caller queued the same
            # (kind, memo_id) between our probe and this insert. Same outcome as
            # the probe finding it.
            await db.rollback()
            return None
    return job_id


async def _claim(kind: str) -> dict[str, Any] | None:
    """Atomically take one runnable job of `kind`, or None.

    Two-step claim rather than UPDATE..RETURNING: SELECT a candidate, then UPDATE
    guarded by `state = 'queued'`. If another worker won the race the UPDATE
    matches zero rows and we simply return None and try again next tick. This
    works on every SQLite version rather than requiring 3.35+ for RETURNING.
    """
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        candidate = await db.execute(
            text("""
                SELECT id, kind, memo_id, payload, attempts
                FROM job_queue
                WHERE kind = :kind
                  AND state = 'queued'
                  AND (run_after IS NULL OR run_after <= :now)
                ORDER BY priority ASC, created_at ASC
                LIMIT 1
            """),
            {"kind": kind, "now": now},
        )
        row = candidate.first()
        if row is None:
            return None

        # Decode BEFORE claiming. Decoding after the row is marked `running`
        # means a malformed payload raises with the job already claimed: the
        # worker logs and moves on, the row sits `running` for a full lease, the
        # janitor requeues it, and it fails again — an hourly loop that never
        # counts an attempt and never surfaces as `failed`. Park it instead.
        try:
            payload = json.loads(row[3] or "{}")
        except (ValueError, TypeError) as exc:
            logger.error("jobs: job %s has an unreadable payload, failing it", row[0])
            await db.execute(
                text("""
                    UPDATE job_queue
                    SET state = 'failed', last_error = :err, lease_until = NULL,
                        updated_at = :now
                    WHERE id = :id AND state = 'queued'
                """),
                {"id": row[0], "err": f"unreadable payload: {exc}"[:2000], "now": now},
            )
            await db.commit()
            return None

        claimed = await db.execute(
            text("""
                UPDATE job_queue
                SET state = 'running', lease_until = :lease, updated_at = :now
                WHERE id = :id AND state = 'queued'
            """),
            {
                "id": row[0],
                "lease": now + timedelta(seconds=LEASE_SECONDS),
                "now": now,
            },
        )
        await db.commit()
        if claimed.rowcount != 1:
            return None  # lost the race, another worker has it

        return {
            "id": row[0],
            "kind": row[1],
            "memo_id": row[2],
            "payload": payload,
            "attempts": row[4],
        }


async def _renew_lease(job_id: str) -> None:
    """Keep a running job's lease fresh until it finishes.

    Without this the lease is a hard ceiling on how long a job may take. A big
    playlist download can outlive an hour, and then the janitor requeues it
    *while it is still running* — a second worker starts the same download
    alongside the first. Duplicate work is precisely what this queue exists to
    prevent, so the lease has to track the job rather than guess its length.
    """
    interval = LEASE_SECONDS / 3
    while True:
        await asyncio.sleep(interval)
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    text("""
                        UPDATE job_queue
                        SET lease_until = :lease, updated_at = :now
                        WHERE id = :id AND state = 'running'
                    """),
                    {
                        "id": job_id,
                        "lease": datetime.utcnow() + timedelta(seconds=LEASE_SECONDS),
                        "now": datetime.utcnow(),
                    },
                )
                await db.commit()
        except Exception:
            logger.warning("jobs: could not renew lease for %s", job_id, exc_info=True)


async def _finish(job_id: str, *, error: str | None, attempts: int) -> None:
    """Mark a job done, or schedule a retry, or park it as failed."""
    now = datetime.utcnow()
    if error is None:
        state, run_after, last_error = "done", None, None
    elif attempts + 1 >= MAX_ATTEMPTS:
        state, run_after, last_error = "failed", None, error[:2000]
    else:
        # Exponential backoff: 30s, 120s. A source that is rate-limiting or
        # briefly offline gets room to recover instead of burning the attempts.
        delay = 30 * (4 ** attempts)
        state, run_after, last_error = "queued", now + timedelta(seconds=delay), error[:2000]

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE job_queue
                SET state = :state, attempts = :attempts, last_error = :last_error,
                    run_after = :run_after, lease_until = NULL, updated_at = :now
                WHERE id = :id
            """),
            {
                "id": job_id,
                "state": state,
                "attempts": attempts + 1,
                "last_error": last_error,
                "run_after": run_after,
                "now": now,
            },
        )
        await db.commit()


async def reclaim(*, all_running: bool = False) -> int:
    """Return interrupted jobs to `queued`. This is what makes a crash mid-job
    recoverable instead of leaving the row stuck in `running` forever.

    `all_running=True` is used at startup and ignores the lease. A job left
    `running` when the process was not up cannot actually be running, and
    waiting out a full LEASE_SECONDS before retrying it would strand work for an
    hour after every restart. This assumes one process per database, which is
    the only supported topology — Mesh (ADR-024) syncs between devices, it never
    shares a database file.

    The default (lease-expiry only) is for the periodic sweep while running.
    """
    now = datetime.utcnow()
    condition = (
        "state = 'running'"
        if all_running
        else "state = 'running' AND lease_until IS NOT NULL AND lease_until < :now"
    )
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(f"""
                UPDATE job_queue
                SET state = 'queued', lease_until = NULL, updated_at = :now
                WHERE {condition}
            """),
            {"now": now},
        )
        await db.commit()
        count = result.rowcount or 0
    if count:
        logger.info(
            "jobs: reclaimed %d interrupted job(s)%s",
            count, " at startup" if all_running else " from an expired lease",
        )
    return count


async def _worker(kind: str, slot: int) -> None:
    """One worker loop. `concurrency` of these run per kind."""
    handler = _HANDLERS[kind]
    while not _shutdown.is_set():
        try:
            job = await _claim(kind)
        except Exception:
            logger.exception("jobs: claim failed for kind=%s", kind)
            job = None

        if job is None:
            try:
                await asyncio.wait_for(_shutdown.wait(), timeout=IDLE_POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
            continue

        started = time.monotonic()
        error: str | None = None
        heartbeat = asyncio.create_task(_renew_lease(job["id"]))
        try:
            await handler.fn({"memo_id": job["memo_id"], **job["payload"]})
        except asyncio.CancelledError:
            # Shutdown mid-job. Deliberately do NOT write here: we are already
            # being cancelled, so the await would very likely be cancelled too
            # and raise from inside the handler. The row stays `running` and
            # reclaim(all_running=True) requeues it on next boot, without
            # burning a retry attempt.
            heartbeat.cancel()
            raise
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            logger.exception("jobs: %s job %s failed", kind, job["id"])
        finally:
            heartbeat.cancel()

        try:
            await _finish(job["id"], error=error, attempts=job["attempts"])
        except Exception:
            logger.exception("jobs: could not record completion of %s", job["id"])

        logger.debug(
            "jobs: %s/%d finished %s in %.1fs%s",
            kind, slot, job["id"], time.monotonic() - started,
            " (error)" if error else "",
        )


async def _janitor() -> None:
    """Owns every reclaim. One of these runs alongside the worker pool.

    Deliberately does its first reclaim from inside this background task rather
    than from the app's lifespan startup. Touching the database synchronously
    during startup races with anything that writes immediately after the app
    comes up — it made `test_playlist_feed_filter` lose a raw-sqlite3 UPDATE and
    return an empty memo list, intermittently. Startup does no I/O now; the
    janitor picks up interrupted work a moment later, in the background, which
    is also one less thing between boot and serving traffic.
    """
    first = True
    while not _shutdown.is_set():
        try:
            await asyncio.wait_for(
                _shutdown.wait(),
                timeout=IDLE_POLL_SECONDS if first else RECLAIM_INTERVAL_SECONDS,
            )
            return  # shutdown signalled
        except asyncio.TimeoutError:
            pass
        try:
            # The first sweep ignores leases: a job left `running` when the
            # process was down cannot actually be running. Later sweeps only
            # take jobs whose lease genuinely expired, so they never steal work
            # from a healthy in-flight worker.
            await reclaim(all_running=first)
        except Exception:
            logger.exception("jobs: reclaim sweep failed")
        first = False


async def start_workers() -> None:
    """Spawn the worker pool. Called once from the app lifespan startup.

    Does no database I/O itself — see `_janitor`. With nothing registered there
    is nothing to run, so this is a no-op and the queue costs a fresh install
    exactly nothing.

    `OPENMEMO_DISABLE_JOB_WORKERS=1` skips the pool entirely. The test suite sets
    it, because this module keeps its worker set and shutdown Event in module
    globals — correct for the app, which has exactly one event loop for its
    whole life, but wrong for a suite that builds ~90 TestClients each with its
    own loop. Workers spawned in one test's loop outlive it and interfere with
    the next, which showed up as `GET /api/memos` intermittently returning an
    empty list. The queue's own behaviour is covered by `test_jobs_queue.py`,
    which starts and stops the pool explicitly inside a single loop.
    """
    if os.environ.get("OPENMEMO_DISABLE_JOB_WORKERS") == "1":
        logger.debug("jobs: worker pool disabled by OPENMEMO_DISABLE_JOB_WORKERS")
        return
    if _workers or not _HANDLERS:
        return
    _shutdown.clear()
    for kind, handler in _HANDLERS.items():
        for slot in range(handler.concurrency):
            _workers.append(asyncio.create_task(_worker(kind, slot)))
    _workers.append(asyncio.create_task(_janitor()))
    logger.info(
        "jobs: started %d worker(s) across %d kind(s)", len(_workers) - 1, len(_HANDLERS)
    )


async def stop_workers() -> None:
    """Signal shutdown and wait briefly for workers to finish their current job."""
    if not _workers:
        return
    _shutdown.set()
    for task in _workers:
        task.cancel()
    await asyncio.gather(*_workers, return_exceptions=True)
    _workers.clear()


async def stats() -> list[dict[str, Any]]:
    """Queue depth by kind and state — backs the Activity view."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("""
            SELECT kind, state, COUNT(*) FROM job_queue
            GROUP BY kind, state ORDER BY kind, state
        """))
        return [
            {"kind": r[0], "state": r[1], "count": r[2]}
            for r in result.fetchall()
        ]
