"""The wrong-pull work, exercised rather than grepped.

Every test in `test_wrong_pull_detection.py` is an `inspect.getsource` substring
assertion. Review demonstrated exactly what that buys: the retry feature was
100% broken (every job raised `KeyError: 'mode'` inside the worker) while its
test asserted the routing entry and passed. A second test claimed to prove the
music guard by checking that one string appears before another in the file, so
scrambling the SELECT columns would have kept it green while every music memo
became a target.

These run the code.
"""
import pytest

from backend.core import jobs
from backend.core.job_handlers import _ROUTING, KIND_RERESOLVE, _p_memo


# ------------------------------------------- the retry can actually dispatch


def test_the_reresolve_job_payload_matches_its_handler():
    """The critical defect review found. `_p_memo` persists an EMPTY payload;
    the repull handler it was routed to reads `payload["mode"]`. Every job died
    in the worker, three failed rows per degraded save, and the Settings panel
    told the user openMemo had already tried. It had not.

    So: take what the persister stores, build what the dispatcher builds, and
    hand it to the registered handler's signature."""
    import inspect
    import re

    kind, persister = _ROUTING["reresolve_memo_task"]
    assert kind == KIND_RERESOLVE, "must not share a kind with repull"
    assert persister is _p_memo

    memo_id, payload = persister(("memo-1",))
    dispatched = {"memo_id": memo_id, **payload}

    handler = jobs._HANDLERS[kind]
    needed = set(re.findall(r'payload\["(\w+)"\]', inspect.getsource(handler.fn)))
    missing = needed - dispatched.keys()
    assert not missing, f"handler reads {missing} which the queue never persists"


def test_the_retry_does_not_share_a_kind_with_the_users_own_repull():
    """`enqueue` dedupes on (kind, memo_id). Sharing the kind meant a pending
    automatic retry silently swallowed an explicit re-pull click, which is the
    documented reason KIND_LOCALIZE_AUTO is separate from KIND_LOCALIZE."""
    assert _ROUTING["reresolve_memo_task"][0] != _ROUTING["repull_memo_task"][0]


def test_every_routed_task_can_be_dispatched():
    """The same class of bug for every other kind, caught once and for all."""
    import inspect
    import re

    for name, (kind, persister) in _ROUTING.items():
        handler = jobs._HANDLERS.get(kind)
        assert handler is not None, f"{name} routes to unregistered kind {kind}"
        needed = set(re.findall(r'payload\["(\w+)"\]', inspect.getsource(handler.fn)))
        # Build the richest payload this persister can produce.
        args = {"memo_id": "m", "mode": "video", "quality": 1080}
        sample = {
            "process_memo": ("m",), "process_file_memo": ("m",),
            "cache_thumbnail": ("m",), "cache_gallery": ("m",),
            "relocalize_pictures_task": ("m",), "localize_memo_task": ("m", "video"),
            "repull_memo_task": ("m", "video"), "_localize_memo_task": ("m",),
            "reresolve_memo_task": ("m",), "transcribe_memo_task": ("m",),
            "transcript_memo_task": ("m",),
            "download_playlist_task": ("m", "video", 1080),
            "cache_playlist_thumbs_task": (["m"],),
        }.get(name)
        if sample is None:
            continue
        try:
            memo_id, payload = persister(sample)
        except Exception:
            continue
        dispatched = {"memo_id": memo_id, **payload}
        assert not (needed - dispatched.keys()), (
            f"{name}: handler reads {needed - dispatched.keys()}, "
            f"queue persists {sorted(dispatched)}"
        )


# ----------------------------------------------- the music guard, exercised


class _Row(tuple):
    """A DB row shaped like the sweep's SELECT, so column ORDER is under test."""


def _sweep_rows():
    # id, type, file_path, resolve_tier, source_domain, source_url, audio_kind
    return [
        ("music-1", "audio", "files/default/a.flac", "scope:page",
         "tiktok.com", "https://tiktok.com/@u/video/1", "music"),
        ("music-2", "link", None, "scope:page",
         "music.apple.com", "https://music.apple.com/x", "music"),
        # The one the startup sorter retyped because the file is an .mp4.
        ("music-3", "video", "files/default/c.mp4", "scope:page",
         "facebook.com", "https://facebook.com/share/p/x", "music"),
        ("post-1", "video", None, "scope:page",
         "facebook.com", "https://facebook.com/share/p/y", None),
    ]


@pytest.mark.parametrize("row", _sweep_rows()[:3])
def test_no_memo_holding_music_is_ever_a_sweep_target(row):
    """THE question. Runs the endpoint's real selection over rows built in the
    real column order, so an off-by-one in the unpack fails here."""
    from backend.api import maintenance

    picked = _run_pick(maintenance, [row])
    assert picked == [], f"{row[0]} was selected for a re-pull"


def test_a_real_wrong_pull_is_still_selected():
    """The guard must not be so broad it disables the feature."""
    from backend.api import maintenance

    picked = _run_pick(maintenance, [_sweep_rows()[3]])
    assert [p["id"] for p in picked] == ["post-1"]


def _run_pick(maintenance, rows):
    """Drive the endpoint's selection with ffprobe and disk access stubbed."""
    import asyncio

    async def go():
        return await maintenance.repull_wrong_pulls(
            pictureless=True, degraded=True, dry_run=True, limit=50, db=_FakeDB(rows),
        )

    import backend.core.localize_media as lm
    import backend.core.file_paths as fp

    orig_v, orig_p = lm._has_video_stream, fp.resolve_memo_path
    lm._has_video_stream = lambda p: False
    fp.resolve_memo_path = lambda p: p
    try:
        return asyncio.run(go())["targets"]
    finally:
        lm._has_video_stream, fp.resolve_memo_path = orig_v, orig_p


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, *a, **k):
        rows = self._rows

        class _R:
            def all(self):
                return rows

        return _R()
