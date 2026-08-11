"""Pasting several image links makes ONE carousel memo.

Drag-and-drop already bundles a folder of files into a set. The gap this fills
is the other way people collect pictures: one at a time, on different sites,
where nothing is on disk to drag. The links ARE the input.

No network here — every link resolution is stubbed. What is under test is the
shape of the memo that comes out.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def no_network(monkeypatch):
    """Resolve any link whose path names an image; everything else holds none.

    The download is stubbed too, because ingest now pulls every picture to disk
    before it commits: a memo is not allowed to exist holding someone else's
    image URL (backend/core/pictures.py). Leaving the fetch real would make
    these tests assert the failure path instead of the shape of a saved
    carousel.
    """
    from backend.api import ingest

    async def _resolve(url: str):
        if ingest._looks_like_image_url(url):
            return {"url": url, "type": "image"}
        return None

    async def _download(src: str, name_stem: str):
        return f"/api/files/thumb/{name_stem}.jpg"

    monkeypatch.setattr(ingest, "_resolve_slide", _resolve)
    monkeypatch.setattr(ingest, "_download_thumb", _download)


def test_several_links_become_one_carousel(client, no_network):
    urls = [
        "https://a.example.com/one.jpg",
        "https://b.example.com/two.png",
        "https://c.example.com/three.webp",
    ]
    r = client.post("/api/ingest/gallery", json={"urls": urls})
    assert r.status_code == 200
    body = r.json()
    assert body["slides"] == 3 and body["failed"] == []

    memo = client.get(f"/api/memos/{body['id']}").json()
    assert memo["type"] == "image"
    # Paste order is the carousel order — the sequence is the user's editing.
    # The slides are local files by now, one per index, never the pasted URLs.
    assert [s["url"] for s in memo["gallery"]] == [
        f"/api/files/thumb/{body['id']}_g{i}.jpg" for i in range(3)
    ]
    assert memo["thumbnail_path"] == f"/api/files/thumb/{body['id']}_g0.jpg"
    assert not body["pictures_pending"]
    # Where each picture came from survives, even after the slides are
    # rewritten to local paths by cache_gallery.
    assert all(u in memo["content_text"] for u in urls)


def test_a_dead_link_does_not_cost_the_others(client, no_network):
    r = client.post("/api/ingest/gallery", json={
        "urls": [
            "https://a.example.com/one.jpg",
            "https://b.example.com/not-a-picture",
            "https://c.example.com/three.png",
        ],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["slides"] == 2
    assert body["failed"] == ["https://b.example.com/not-a-picture"]


def test_the_same_link_twice_is_one_slide(client, no_network):
    r = client.post("/api/ingest/gallery", json={
        "urls": ["https://a.example.com/one.jpg", "https://a.example.com/one.jpg"],
    })
    assert r.status_code == 200
    assert r.json()["slides"] == 1


def test_a_single_image_is_not_a_carousel(client, no_network):
    """One slide is a picture, not a gallery — it must render as the plain image
    memo it is rather than a one-slide carousel with paging controls."""
    r = client.post("/api/ingest/gallery", json={"urls": ["https://a.example.com/solo.jpg"]})
    assert r.status_code == 200
    memo = client.get(f"/api/memos/{r.json()['id']}").json()
    assert memo["type"] == "image"
    assert not memo["gallery"]
    assert memo["thumbnail_path"] == f"/api/files/thumb/{r.json()['id']}.jpg"


def test_a_title_can_be_given(client, no_network):
    r = client.post("/api/ingest/gallery", json={
        "urls": ["https://a.example.com/one.jpg", "https://a.example.com/two.jpg"],
        "title": "Kitchen references",
    })
    assert client.get(f"/api/memos/{r.json()['id']}").json()["title"] == "Kitchen references"


def test_no_links_is_a_400(client, no_network):
    assert client.post("/api/ingest/gallery", json={"urls": ["   ", ""]}).status_code == 400


def test_links_that_all_fail_are_a_400_not_an_empty_memo(client, no_network):
    r = client.post("/api/ingest/gallery", json={"urls": ["https://a.example.com/page"]})
    assert r.status_code == 400
    assert "image" in r.json()["detail"]


def test_a_runaway_paste_is_refused(client, no_network):
    from backend.api.ingest import MAX_GALLERY_SLIDES

    urls = [f"https://a.example.com/{i}.jpg" for i in range(MAX_GALLERY_SLIDES + 1)]
    r = client.post("/api/ingest/gallery", json={"urls": urls})
    assert r.status_code == 400
    assert str(MAX_GALLERY_SLIDES) in r.json()["detail"]


def test_a_non_http_link_is_rejected(client, no_network):
    r = client.post("/api/ingest/gallery", json={
        "urls": ["https://a.example.com/one.jpg", "javascript:alert(1)"],
    })
    assert r.status_code == 400


def test_a_video_link_stays_a_video_slide(client, monkeypatch):
    """A clip pasted into the set must not be filed as a broken picture.

    The picture is downloaded; the clip keeps its URL. That split is the point:
    the local-only rule covers images, and media follows `auto_download_video`
    because a set of long clips is a disk problem, not a picture problem.
    """
    from backend.api import ingest

    async def _download(src: str, name_stem: str):
        return f"/api/files/thumb/{name_stem}.jpg"

    monkeypatch.setattr(ingest, "_download_thumb", _download)

    r = client.post("/api/ingest/gallery", json={
        "urls": ["https://a.example.com/one.jpg", "https://cdn.example.com/clip.mp4"],
    })
    assert r.status_code == 200
    memo = client.get(f"/api/memos/{r.json()['id']}").json()
    assert [s["type"] for s in memo["gallery"]] == ["image", "video"]
    assert memo["gallery"][0]["url"].startswith("/api/files/thumb/")
    assert memo["gallery"][1]["url"] == "https://cdn.example.com/clip.mp4"
