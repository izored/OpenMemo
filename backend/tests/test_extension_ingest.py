"""The browser extension and a pasted link must produce the same memo.

They did not. `/ingest/extension` rebuilt the memo from the DOM scrape and never
copied `gallery` or `resolve_tier`, so an Instagram carousel saved from the
extension arrived as a single picture with no tier recorded. On a profile page
it was worse: Instagram opens a post in a dialog while the address bar still
says `instagram.com/<handle>/`, so the save carried the profile's bio as the
description and its grid as the content.

No network here — the resolver is stubbed. What is under test is which reader
wins and what survives into the memo.
"""
import pytest
from fastapi.testclient import TestClient

# One permalink per test: the resolver path dedups by source URL now, so tests
# that shared a link were quietly asserting against each other's memo.
POST = "https://www.instagram.com/p/AAAAAAAAAA1/"
POST_2 = "https://www.instagram.com/p/AAAAAAAAAA2/"
POST_3 = "https://www.instagram.com/p/AAAAAAAAAA3/"


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def saved(client):
    """Memos this file creates, cleared away after each test.

    The suite shares one database, and every memo here is an Instagram save on
    a fallback tier -- which is exactly what the Instagram health check counts.
    Left behind, they made test_instagram_health's "an empty library reports ok"
    run against a library holding three degraded saves, and it failed with
    no_session. Only in CI, where the whole suite runs together: per-file, this
    file and that one both pass. Caught on PR 221, 2026-09-09.
    """
    ids: list[str] = []
    yield ids
    for memo_id in ids:
        client.delete(f"/api/memos/{memo_id}")


@pytest.fixture
def resolved_carousel(monkeypatch):
    """What openMemo's own Instagram ladder hands back for a two-photo post."""
    async def _extract_video(url):
        return {
            "type": "image",
            "title": "the caption's first line",
            "description": "the caption's first line\nand the rest of it",
            "content_text": "the caption's first line\nand the rest of it",
            "source_domain": "instagram.com",
            "source_favicon": None,
            "thumbnail_path": "https://cdn/one.jpg",
            "gallery": [
                {"url": "https://cdn/one.jpg", "type": "image"},
                {"url": "https://cdn/two.jpg", "type": "image"},
            ],
            "resolve_tier": "instagram:browser-render",
        }

    async def _pretend_downloaded(memo):
        # Stands in for the real inline download. It has to rewrite the URLs to
        # local paths the way a successful fetch does, because the serving layer
        # refuses to hand back a picture that is still somebody else's URL — a
        # stub that "succeeded" without rewriting produces a memo whose gallery
        # reads as empty over the API.
        slides = list(memo.gallery or [])
        for i, slide in enumerate(slides):
            slides[i] = {**slide, "url": f"/api/files/thumb/{memo.id}_g{i}.jpg"}
        if slides:
            memo.gallery = slides
            memo.thumbnail_path = slides[0]["url"]
        return 0

    # Same for the follow-up jobs. They run inline under TestClient, and with
    # these CDN URLs unreachable they rewrite the memo they could not fetch —
    # which is the post-save story, not what this route produced. The queue
    # refuses a function it cannot route, so each stub keeps its real name.
    async def process_memo(memo_id):
        return None

    async def _localize_memo_task(memo_id):
        return None

    monkeypatch.setattr("backend.core.extractor.extract_video", _extract_video)
    monkeypatch.setattr("backend.api.ingest.localize_pictures_inline", _pretend_downloaded)
    monkeypatch.setattr("backend.api.ingest.process_memo", process_memo)
    monkeypatch.setattr("backend.api.ingest._localize_memo_task", _localize_memo_task)


# What the generic DOM extractor scrapes off an Instagram page: the profile's
# bio, a wall of unrelated grid thumbnails, and the avatar as the cover.
SCRAPE = {
    "type": "article",
    "title": "Anna Louise Gille (@annalouisegille) on Instagram",
    "description": "94K Followers, 1,022 Following, 764 Posts",
    "content_text": "![a neighbour's post](https://cdn/grid1.jpg)\n\n![another](https://cdn/grid2.jpg)",
    "thumbnail": "https://cdn/avatar.jpg",
}


def test_the_resolver_beats_the_dom_scrape(client, resolved_carousel, saved):
    r = client.post("/api/ingest/extension", json={**SCRAPE, "url": POST})
    assert r.status_code == 200
    saved.append(r.json()["id"])
    memo = client.get(f"/api/memos/{r.json()['id']}").json()

    assert memo["type"] == "image"
    assert memo["title"] == "the caption's first line"
    # The profile bio and the grid never reach the memo.
    assert "Followers" not in (memo.get("description") or "")
    assert "grid1.jpg" not in (memo.get("content_text") or "")


def test_a_carousel_survives_the_extension_route(client, resolved_carousel, saved):
    """This is the one the route used to drop on the floor."""
    r = client.post("/api/ingest/extension", json={**SCRAPE, "url": POST_2})
    saved.append(r.json()["id"])
    memo = client.get(f"/api/memos/{r.json()['id']}").json()

    # Two slides, in order, both local by the time the row is written.
    slides = [s["url"] for s in (memo.get("gallery") or [])]
    assert len(slides) == 2
    assert all(u.startswith("/api/files/") for u in slides)
    assert memo["thumbnail_path"] == slides[0]
    # Which tier produced this has to be recorded, or Settings cannot tell the
    # user their saves have quietly dropped to a fallback.
    assert memo["resolve_tier"] == "instagram:browser-render"


def test_the_same_post_twice_is_one_memo(client, resolved_carousel, saved):
    """Extension and paste share the dedup guard now, so a second save of the
    same permalink returns the memo that already exists."""
    first = client.post("/api/ingest/extension", json={**SCRAPE, "url": POST_3}).json()
    saved.append(first["id"])
    second = client.post("/api/ingest/url", json={"url": POST_3}).json()
    assert second["id"] == first["id"]
    assert second["status"] == "duplicate"


def test_an_ordinary_page_still_keeps_its_dom_scrape(client, monkeypatch, saved):
    """The delegation is for hosts openMemo resolves itself. Everywhere else the
    live DOM is the better reader — it is the whole reason the extension exists,
    and a server fetch of a JS-rendered article comes back empty."""
    async def _never(url):
        raise AssertionError("an ordinary page must not be re-fetched wholesale")

    monkeypatch.setattr("backend.core.extractor.extract_video", _never)
    r = client.post("/api/ingest/extension", json={
        "type": "article",
        "url": "https://example.com/an-article",
        "title": "Only the DOM knew this",
        "description": "scraped live",
        "content_text": "the article body",
        "thumbnail": "https://example.com/hero.jpg",
    })
    assert r.status_code == 200
    saved.append(r.json()["id"])
    memo = client.get(f"/api/memos/{r.json()['id']}").json()
    assert memo["title"] == "Only the DOM knew this"
    assert memo["content_text"] == "the article body"
