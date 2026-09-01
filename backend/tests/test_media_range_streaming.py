"""Range streaming for media memos (`GET /api/memos/{id}/file`).

Video and audio always request byte ranges, so the 206 branch — not the plain
FileResponse one — is the path every playing memo actually takes. It had no
coverage at all, which is how a blocking `f.read()` sat on the single event loop
long enough to make two memos playing at once stutter against each other
(OPNMMO-0064). These tests pin both halves: the bytes must be exactly right, and
the streamer must not freeze the loop while it produces them.
"""
import asyncio
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api import memos as memos_api
from backend.api.memos import _parse_range, _stream_file_range
from backend.config import settings
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _make_video_memo(payload: bytes) -> str:
    """Write a fake video into the throwaway FILES_DIR and register a memo."""
    memo_id = str(uuid.uuid4())
    files_dir = settings.FILES_DIR
    files_dir.mkdir(parents=True, exist_ok=True)
    path = files_dir / f"{memo_id}.mp4"
    path.write_bytes(payload)

    async def _insert():
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="video", title="range test", file_path=str(path)))
            await db.commit()

    asyncio.run(_insert())
    return memo_id


# --- header parsing -------------------------------------------------------

@pytest.mark.parametrize(
    "header,size,expected",
    [
        ("bytes=0-99", 1000, (0, 99)),
        ("bytes=100-", 1000, (100, 999)),      # open-ended: play to EOF
        ("bytes=-100", 1000, (900, 999)),      # suffix: MP4 moov atom at the tail
        ("bytes=0-99999", 1000, (0, 999)),     # clamped, not rejected
        ("bytes=0-0", 1000, (0, 0)),           # single byte is satisfiable
        ("", 1000, None),
        ("items=0-99", 1000, None),            # wrong unit
        ("bytes=abc-def", 1000, None),
        ("bytes=500-100", 1000, None),         # inverted
        ("bytes=1000-1100", 1000, None),       # starts past EOF
    ],
)
def test_range_headers_parse_to_the_right_byte_window(header, size, expected):
    assert _parse_range(header, size) == expected


# --- endpoint behaviour ---------------------------------------------------

def test_a_range_request_returns_exactly_those_bytes(client):
    payload = bytes(range(256)) * 40  # 10240 bytes, every value distinguishable
    memo_id = _make_video_memo(payload)

    r = client.get(f"/api/memos/{memo_id}/file", headers={"Range": "bytes=1000-1999"})

    assert r.status_code == 206
    assert r.content == payload[1000:2000]
    assert r.headers["content-range"] == f"bytes 1000-1999/{len(payload)}"
    assert r.headers["content-length"] == "1000"
    assert r.headers["accept-ranges"] == "bytes"


def test_a_suffix_range_serves_the_tail(client):
    """Players fetch the last bytes first to find the MP4 index."""
    payload = bytes(range(256)) * 40
    memo_id = _make_video_memo(payload)

    r = client.get(f"/api/memos/{memo_id}/file", headers={"Range": "bytes=-512"})

    assert r.status_code == 206
    assert r.content == payload[-512:]


def test_no_range_header_still_advertises_seekability(client):
    """Without Accept-Ranges the browser renders a dead scrubber."""
    payload = b"\x00\x01\x02" * 100
    memo_id = _make_video_memo(payload)

    r = client.get(f"/api/memos/{memo_id}/file")

    assert r.status_code == 200
    assert r.content == payload
    assert r.headers["accept-ranges"] == "bytes"


def test_an_unsatisfiable_range_falls_back_to_the_whole_file(client):
    payload = b"abc" * 100
    memo_id = _make_video_memo(payload)

    r = client.get(f"/api/memos/{memo_id}/file", headers={"Range": "bytes=99999-"})

    assert r.status_code == 200
    assert r.content == payload


def test_a_malformed_range_also_serves_the_whole_file(client):
    payload = b"abc" * 100
    memo_id = _make_video_memo(payload)

    r = client.get(f"/api/memos/{memo_id}/file", headers={"Range": "bytes=abc-def"})

    assert r.status_code == 200
    assert r.content == payload


def test_a_range_request_never_reaches_the_frameworks_own_handling(client, monkeypatch):
    """No Range-bearing request may be handed to FileResponse.

    Starlette >= 0.45 parses Range inside FileResponse itself: an unsatisfiable
    one becomes 416, a malformed one 400. This route promises a 200 with the
    whole file for both (a 416 kills a native player; a 200 does not), so the
    promise has to be kept by this route rather than by whichever Starlette the
    pin happens to resolve to. Delegating would make the answer flip on a
    dependency bump with nothing here to catch it.
    """
    payload = b"abc" * 100
    memo_id = _make_video_memo(payload)

    def _boom(*args, **kwargs):
        raise AssertionError("Range request delegated to FileResponse")

    monkeypatch.setattr(memos_api, "FileResponse", _boom)

    for header in ("bytes=99999-", "bytes=abc-def", "bytes=-0", "bytes=0-9"):
        r = client.get(f"/api/memos/{memo_id}/file", headers={"Range": header})
        assert r.status_code in (200, 206), header


# --- the actual bug -------------------------------------------------------

CLIENTS = 10
MEMO_MB = 10

SLOW_READ = 0.05  # 50ms — stands in for a real disk seek


class _SlowFile:
    """A file whose reads are slow, standing in for an uncached disk.

    Real files can't drive this test: once the OS page cache is warm a read
    returns in microseconds, so blocking and threadpooled reads look identical
    and the test would pass against the very bug it exists to catch. What made
    playback stutter was reads that actually hit the disk, so the read is what
    gets made slow here. Everything else is a real file.
    """

    def __init__(self, payload: bytes):
        self._payload = payload
        self._pos = 0
        self.reads = 0

    def seek(self, pos: int) -> None:
        time.sleep(SLOW_READ)
        self._pos = pos

    def read(self, n: int) -> bytes:
        time.sleep(SLOW_READ)
        self.reads += 1
        chunk = self._payload[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk

    def close(self) -> None:
        pass


def test_slow_disk_reads_do_not_freeze_the_event_loop(monkeypatch):
    """A slow read must not stop the world.

    uvicorn serves every client from one event loop, so a synchronous read in
    this generator blocks *all* other requests — every other viewer's next chunk
    included — for as long as the read takes. That is why two memos playing at
    once stuttered while neither ever raised an error.

    A heartbeat ticking every 5ms measures the freeze. With reads on the
    threadpool the loop keeps ticking through them; with a blocking read the
    gaps jump to the full read duration, and the assertion below fails.
    """
    payload = b"\xa5" * (256 * 1024 * 4)  # 4 chunks
    slow = _SlowFile(payload)
    monkeypatch.setattr(memos_api, "open", lambda *a, **k: slow, raising=False)

    async def scenario():
        gaps = []
        stop = asyncio.Event()

        async def heartbeat():
            last = time.perf_counter()
            while not stop.is_set():
                await asyncio.sleep(0.005)
                now = time.perf_counter()
                gaps.append(now - last)
                last = now

        async def drain():
            out = bytearray()
            async for chunk in _stream_file_range("ignored", 0, len(payload) - 1):
                out += chunk
                await asyncio.sleep(0)  # yield, as a real socket write would
            return bytes(out)

        hb = asyncio.create_task(heartbeat())
        data = await drain()
        stop.set()
        await hb
        return data, gaps

    data, gaps = asyncio.run(scenario())

    assert data == payload, "the stream must still deliver every byte"
    assert slow.reads >= 4, "fixture never exercised multiple chunks"
    assert gaps, "heartbeat never ran"
    worst_ms = max(gaps) * 1000
    # A blocking read parks the loop for the whole SLOW_READ (50ms+); a
    # threadpooled one leaves it free to tick. Half of SLOW_READ separates the
    # two cleanly without being tight enough to flake on a loaded box.
    assert worst_ms < SLOW_READ * 1000 / 2, (
        f"event loop stalled {worst_ms:.0f}ms on a slow read — concurrent "
        f"playback will stutter"
    )


def test_many_clients_each_get_their_own_memo_intact(tmp_path):
    """Ten clients, ten different memos, {MEMO_MB}MB each, all at once.

    Guards the streams against crossing files or truncating under real
    concurrency — the loop-freeze question is covered above.
    """
    paths = []
    for i in range(CLIENTS):
        p = tmp_path / f"memo_{i}.bin"
        p.write_bytes(bytes([i]) * (MEMO_MB * 1024 * 1024))
        paths.append(p)
    size = paths[0].stat().st_size

    async def scenario():
        async def drain(path, marker):
            total = 0
            async for chunk in _stream_file_range(path, 0, size - 1):
                assert set(chunk) == {marker}, "streams crossed files"
                total += len(chunk)
                await asyncio.sleep(0)
            return total

        return await asyncio.gather(*(drain(p, i) for i, p in enumerate(paths)))

    totals = asyncio.run(scenario())
    assert totals == [size] * CLIENTS, "every client must get its whole memo"
