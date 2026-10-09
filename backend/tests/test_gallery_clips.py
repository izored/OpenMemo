"""Clip slides of a carousel: downloaded next to the memo, served with Range.

A Threads post of three clips is a gallery of `{url: cover, type: video,
video_url: <signed CDN mp4>}` slides. The CDN links die within days, so
`cache_gallery_clips` copies each clip to disk and rewrites the slide to
`/api/memos/<id>/clip/<i>`, which has to answer byte ranges because iOS Safari
will not play a video from a server that cannot.
"""
import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api import ingest
from backend.api.ingest import PictureNotLocalized, cache_gallery_clips, clip_path
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _insert(memo_id: str, gallery: list) -> None:
    async def go():
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="video", title="clips", gallery=gallery,
                        source_url="https://www.threads.com/@a/post/ABCDE1"))
            await db.commit()

    asyncio.run(go())


def _gallery(memo_id: str) -> list:
    async def go():
        async with AsyncSessionLocal() as db:
            return (await db.get(Memo, memo_id)).gallery

    return asyncio.run(go())


def _clip_slides(n: int) -> list:
    return [
        {"url": f"/api/files/thumb/c{i}.jpg", "type": "video", "video_url": f"https://cdn/clip{i}.mp4"}
        for i in range(n)
    ]


# ------------------------------------------------------------------ serving


def test_a_clip_answers_a_range_with_exactly_those_bytes(client):
    memo_id = str(uuid.uuid4())
    p = clip_path(memo_id, 1)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(bytes(range(256)) * 4)

    r = client.get(f"/api/memos/{memo_id}/clip/1", headers={"Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == (bytes(range(256)) * 4)[10:20]
    assert r.headers["content-range"] == "bytes 10-19/1024"
    assert r.headers["content-type"] == "video/mp4"


def test_a_clip_that_was_never_downloaded_is_a_404(client):
    assert client.get(f"/api/memos/{uuid.uuid4()}/clip/0").status_code == 404
    assert client.get(f"/api/memos/{uuid.uuid4()}/clip/-1").status_code == 404


# ------------------------------------------------------------------ download


def test_every_clip_lands_on_disk_and_the_slides_point_at_it(monkeypatch):
    async def fake_download(url, dest, **kw):
        dest.write_bytes(b"mp4:" + url.encode())

    monkeypatch.setattr("backend.core.localize_media._download_direct", fake_download)
    monkeypatch.setattr("backend.core.localize_media._reject_pictureless", lambda *a, **k: None)

    memo_id = str(uuid.uuid4())
    _insert(memo_id, _clip_slides(3))
    asyncio.run(cache_gallery_clips(memo_id))

    gallery = _gallery(memo_id)
    assert [s["video_url"] for s in gallery] == [f"/api/memos/{memo_id}/clip/{i}" for i in range(3)]
    # The cover is untouched: it is a picture, localized by the picture path.
    assert [s["url"] for s in gallery] == [f"/api/files/thumb/c{i}.jpg" for i in range(3)]
    assert clip_path(memo_id, 2).read_bytes() == b"mp4:https://cdn/clip2.mp4"


def test_a_clip_that_fails_keeps_its_source_and_the_job_retries(monkeypatch):
    from backend.core.localize_media import LocalizeError

    async def flaky(url, dest, **kw):
        if url.endswith("clip1.mp4"):
            raise LocalizeError("CDN returned HTTP 403")
        dest.write_bytes(b"ok")

    monkeypatch.setattr("backend.core.localize_media._download_direct", flaky)
    monkeypatch.setattr("backend.core.localize_media._reject_pictureless", lambda *a, **k: None)

    memo_id = str(uuid.uuid4())
    _insert(memo_id, _clip_slides(2))
    with pytest.raises(PictureNotLocalized):
        asyncio.run(cache_gallery_clips(memo_id))

    gallery = _gallery(memo_id)
    assert gallery[0]["video_url"] == f"/api/memos/{memo_id}/clip/0"
    assert gallery[1]["video_url"] == "https://cdn/clip1.mp4"


def test_the_clip_job_is_routed():
    """An unrouted function raises AFTER the memo is committed, which is how
    `cache_gallery` once 500'd every carousel save."""
    from backend.core.job_handlers import _ROUTING

    kind, persist = _ROUTING["cache_gallery_clips"]
    memo_id, payload = persist(("memo-1",))
    assert memo_id == "memo-1"
    assert ingest.cache_gallery_clips.__name__ == "cache_gallery_clips"
