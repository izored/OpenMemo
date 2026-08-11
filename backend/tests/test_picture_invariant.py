"""openMemo never hands a browser a picture it does not own.

The core promise is that a saved thing outlives its source. A card that fetches
its own thumbnail from the source every time it renders breaks that promise
silently: it looks saved, it looks fine, and it goes blank on the source's
schedule. Six Instagram carousels did exactly that in August 2026.

So this is an invariant, not a preference, and it is tested at the boundary
rather than at the twelve places that build a memo payload. Any future endpoint
that forgets `serve_pictures` fails here.

The one deliberate exception lives elsewhere and is about heavy media, not
pictures: a long video on a host with a working embed player stays remote
unless `auto_download_video` says otherwise, because a library of those fills a
disk. `source_url`, `content_text` and embed markup may all name remote hosts.
Only rendered IMAGES must be local.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.core.pictures import is_remote, serve_pictures
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

IG = "https://scontent-bru2-1.cdninstagram.com/v/t51.1-15/abc_n.jpg?oe=68F00000"


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


async def _remote_memo(**extra) -> str:
    """A memo in the exact broken state: every picture on someone else's CDN."""
    memo_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id,
            workspace_id="default",
            type="image",
            title=f"remote {memo_id[:8]}",
            source_url="https://www.instagram.com/p/ABC/",
            source_domain="instagram.com",
            thumbnail_path=IG,
            **extra,
        ))
        await db.commit()
    return memo_id


class TestServePictures:
    def test_a_remote_cover_becomes_null(self):
        out = serve_pictures({"thumbnail_path": IG})
        assert out["thumbnail_path"] is None
        assert out["pictures_pending"] == 1

    def test_a_local_cover_is_untouched(self):
        out = serve_pictures({"thumbnail_path": "/api/files/thumb/a.jpg"})
        assert out["thumbnail_path"] == "/api/files/thumb/a.jpg"
        assert "pictures_pending" not in out

    def test_remote_slides_are_dropped_and_local_ones_kept(self):
        out = serve_pictures({
            "thumbnail_path": "/api/files/thumb/a.jpg",
            "gallery": [
                {"url": "/api/files/thumb/a.jpg"},
                {"url": IG},
                {"url": "/api/files/thumb/c.jpg"},
            ],
        })
        assert [s["url"] for s in out["gallery"]] == [
            "/api/files/thumb/a.jpg", "/api/files/thumb/c.jpg",
        ]
        assert out["pictures_pending"] == 1

    def test_a_carousel_reduced_to_one_slide_stops_being_a_carousel(self):
        """Swipe chrome around a single picture reads as a bug, not a carousel."""
        out = serve_pictures({
            "thumbnail_path": "/api/files/thumb/a.jpg",
            "gallery": [{"url": "/api/files/thumb/a.jpg"}, {"url": IG}],
        })
        assert out["gallery"] is None

    def test_the_source_url_is_never_touched(self):
        """Remembering where a memo came from is the point. Only the rendered
        picture has to be local."""
        out = serve_pictures({"source_url": "https://instagram.com/p/A/", "thumbnail_path": IG})
        assert out["source_url"] == "https://instagram.com/p/A/"

    def test_a_gallery_stored_as_json_text_is_handled(self):
        out = serve_pictures({"gallery": '[{"url": "/api/files/thumb/a.jpg"}, {"url": "%s"}]' % IG})
        assert out["gallery"] is None
        assert out["pictures_pending"] == 1


def _image_urls(node, found=None):
    """Every value in a response that a browser would load as an image."""
    found = [] if found is None else found
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("thumbnail_path", "cover_url") and isinstance(value, str):
                found.append(value)
            elif key in ("covers",) and isinstance(value, list):
                found.extend(v for v in value if isinstance(v, str))
            elif key == "gallery" and isinstance(value, list):
                found.extend(
                    s["url"] for s in value if isinstance(s, dict) and isinstance(s.get("url"), str)
                )
            else:
                _image_urls(value, found)
    elif isinstance(node, list):
        for item in node:
            _image_urls(item, found)
    return found


class TestNoEndpointLeaksARemotePicture:
    """One memo in the broken state, walked past every endpoint that renders it."""

    async def test_list_detail_search_and_pinned_all_stay_local(self, client):
        memo_id = await _remote_memo(
            gallery=[{"url": IG}, {"url": IG + "&2"}], pinned=True
        )

        responses = {
            "list": client.get("/api/memos?limit=200"),
            "detail": client.get(f"/api/memos/{memo_id}"),
            "pinned": client.get("/api/memos/pinned/list"),
            "search": client.get("/api/search?q=remote"),
            "playlists": client.get("/api/music/playlists"),
        }

        for name, resp in responses.items():
            assert resp.status_code == 200, f"{name} returned {resp.status_code}"
            leaked = [u for u in _image_urls(resp.json()) if is_remote(u)]
            assert not leaked, f"{name} served remote image URLs: {leaked[:3]}"

    async def test_the_detail_response_says_the_picture_is_pending(self, client):
        memo_id = await _remote_memo()

        body = client.get(f"/api/memos/{memo_id}").json()

        assert body["thumbnail_path"] is None
        assert body["pictures_pending"] == 1
        # The URL is still in the database — the repair pass needs it.
        async with AsyncSessionLocal() as db:
            assert (await db.get(Memo, memo_id)).thumbnail_path == IG


def test_every_memo_payload_builder_runs_it():
    """A new endpoint that builds a memo dict by hand must not forget the rule.

    The runtime test above only covers endpoints it knows to call. This one
    reads the source: any file that emits a `thumbnail_path` key has to import
    the helper that strips remote ones.
    """
    import pathlib

    offenders = []
    for rel in ("backend/api/memos.py", "backend/api/search.py", "backend/api/music.py"):
        text = pathlib.Path(rel).read_text(encoding="utf-8")
        if '"thumbnail_path":' in text and "from backend.core.pictures import" not in text:
            offenders.append(rel)

    assert not offenders, (
        f"{offenders} build memo payloads without importing backend.core.pictures. "
        "Wrap the dict in serve_pictures() so a remote image URL cannot reach a browser."
    )
