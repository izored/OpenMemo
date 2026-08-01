"""queue_task routing (ADR-024 §9, plan 024 phase 0).

The call-site migration swapped ~27 `background_tasks.add_task(fn, *args)` calls
for `queue_task(fn, *args)`. The risk in that change is not that it fails
loudly — it is that a function's positional arguments get mapped into the wrong
payload shape and the job explodes later, in a worker, far from the call site.

So this pins the arg-shape contract for every routed function, and asserts the
routing table matches the real function signatures in the API modules.
"""
import asyncio
import inspect

import pytest
from sqlalchemy import text

from backend.core import job_handlers as jh
from backend.core import jobs
from backend.db.database import AsyncSessionLocal


@pytest.fixture(autouse=True)
async def _clean():
    await jobs.create_table()
    async with AsyncSessionLocal() as db:
        await db.execute(text("DELETE FROM job_queue"))
        await db.commit()
    yield


async def _rows():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT kind, memo_id, payload FROM job_queue ORDER BY created_at")
        )
        return result.fetchall()


def _fake(name):
    """A stand-in carrying only __name__, which is what routing keys on."""
    def f():
        pass
    f.__name__ = name
    return f


@pytest.mark.parametrize(
    "fn_name, args, expect_kind, expect_memo, expect_payload",
    [
        ("process_memo", ("m1",), "process", "m1", {}),
        ("cache_thumbnail", ("m2",), "thumbnail", "m2", {}),
        ("transcribe_memo_task", ("m3",), "transcribe", "m3", {}),
        ("transcript_memo_task", ("m4",), "transcript", "m4", {}),
        # auto-localize picks its own mode, so it must NOT carry one
        ("_localize_memo_task", ("m5",), "localize_auto", "m5", {}),
        # explicit localize carries mode, and quality only when given
        ("localize_memo_task", ("m6", "audio"), "localize", "m6", {"mode": "audio"}),
        ("localize_memo_task", ("m7", "video", 720), "localize", "m7",
         {"mode": "video", "quality": 720}),
        ("process_file_memo", ("m8", "/tmp/a.mp3", "audio"), "process_file", "m8",
         {"file_path": "/tmp/a.mp3", "memo_type": "audio"}),
        # playlist work is not per-memo: memo_id must stay NULL so dedupe (which
        # treats NULLs as distinct) never collapses two different playlists
        ("download_playlist_task", ("c1", ["a", "b"]), "playlist_download", None,
         {"collection_id": "c1", "memo_ids": ["a", "b"]}),
        ("cache_playlist_thumbs_task", (["a", "b"],), "playlist_thumbs", None,
         {"memo_ids": ["a", "b"]}),
    ],
)
async def test_routing_shapes(fn_name, args, expect_kind, expect_memo, expect_payload):
    import json

    jh.queue_task(_fake(fn_name), *args)
    await asyncio.sleep(0.05)  # queue_task schedules the insert

    rows = await _rows()
    assert len(rows) == 1, f"expected exactly one job, got {rows}"
    kind, memo_id, payload = rows[0]
    assert kind == expect_kind
    assert memo_id == expect_memo
    assert json.loads(payload) == expect_payload


async def test_every_routed_function_exists_with_that_signature():
    """Guards against the routing table drifting from the real functions —
    a rename would otherwise leave a route that silently never matches."""
    from backend.api import ingest

    for name in jh._ROUTING:
        fn = getattr(ingest, name, None)
        assert fn is not None, f"{name} is routed but no longer exists in ingest.py"
        assert inspect.iscoroutinefunction(fn), f"{name} must be async"


async def test_every_route_has_a_registered_handler():
    for kind, _ in jh._ROUTING.values():
        assert kind in jobs._HANDLERS, f"{kind} is routed but has no handler"


async def test_unrouted_function_raises_instead_of_dropping_work():
    with pytest.raises(ValueError, match="unrouted function"):
        jh.queue_task(_fake("some_new_task_nobody_registered"), "m")


async def test_auto_and_explicit_localize_both_survive_dedupe():
    """Regression: ingest's auto-download path queues auto-localize AND an
    explicit audio localize for the same memo. Sharing one kind meant dedupe
    (keyed on kind + memo_id) silently dropped the explicit one, so nothing was
    ever downloaded."""
    jh.queue_task(_fake("_localize_memo_task"), "same-memo")
    jh.queue_task(_fake("localize_memo_task"), "same-memo", "audio")
    await asyncio.sleep(0.05)

    rows = await _rows()
    assert len(rows) == 2, f"one of the two localize jobs was deduped away: {rows}"
    assert {r[0] for r in rows} == {"localize", "localize_auto"}


async def test_relay_path_routes_through_the_queue():
    """Review pass 1 (second round). The Telegram relay collected follow-up jobs
    and ran them itself with _fire_and_forget, bypassing the queue entirely — so
    the heaviest ingest path kept the exact pile-up the queue exists to stop.
    It must hand them over instead."""
    import inspect
    from backend.services import telegram_relay

    src = inspect.getsource(telegram_relay._save_url)
    assert "queue_task(fn, *args)" in src, "relay must hand follow-ups to the queue"
    assert "_fire_and_forget" not in src, "relay must not run follow-ups itself"
    assert not hasattr(telegram_relay, "_fire_and_forget"), "dead helper should be gone"


async def test_no_background_task_call_sites_remain():
    """Nothing should start a background chore outside the queue."""
    import pathlib

    offenders = []
    for f in ["backend/api/ingest.py", "backend/api/memos.py", "backend/api/music.py",
              "backend/services/telegram_relay.py"]:
        for i, line in enumerate(pathlib.Path(f).read_text(encoding="utf-8").splitlines(), 1):
            s = line.strip()
            if s.startswith("#") or s.startswith('"') or s.startswith("*"):
                continue
            if "background_tasks.add_task(" in s:
                offenders.append(f"{f}:{i}")
    assert not offenders, f"un-migrated call sites: {offenders}"


def test_deployments_stay_single_process():
    """The queue assumes ONE process per database.

    `reclaim(all_running=True)` requeues every row left in `running` at startup,
    because a job cannot be running if the process was down. Add a second
    uvicorn worker and that becomes false: process B's startup sweep would steal
    jobs process A is actively running, and the same download would run twice
    with no error anywhere.

    Both deployments currently spawn a single uvicorn (no --workers), so the
    assumption holds. This pins it, because the failure mode is silent and the
    change that breaks it looks harmless.
    """
    import pathlib

    docker = pathlib.Path("backend/Dockerfile").read_text(encoding="utf-8")
    assert "--workers" not in docker, (
        "Dockerfile now starts multiple uvicorn workers. The job queue's startup "
        "reclaim assumes one process per database — see backend/core/jobs.reclaim. "
        "Give the queue a leader election or disable it on all but one worker."
    )

    mac = pathlib.Path("macOS/src/backend.ts")
    if mac.exists():
        assert "--workers" not in mac.read_text(encoding="utf-8"), (
            "macOS wrapper now starts multiple uvicorn workers — same problem."
        )
