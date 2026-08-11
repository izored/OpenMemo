"""Pictures that were never copied to disk must not fail silently.

Six Instagram carousels saved between 2026-08-05 and 2026-08-08 rendered every
slide straight from `scontent-*.cdninstagram.com`. Those URLs are signed and
expire in days, so the memos looked perfect on the day they were saved and were
broken by the time anyone opened them again.

Three separate things had to go wrong at once, and each one gets a test here:

1. `cache_gallery` was missing from the job routing table, so the download was
   never queued. Already covered by `test_job_routing.py`.
2. When the download DOES run and fetches nothing, the old code returned
   quietly. Nothing retried, nothing recorded, no error anywhere.
3. The hourly integrity check skipped remote thumbnails entirely, on the
   reasoning that a remote URL "is not ours to lose" — which is true for Apple
   artwork and false for a signed link with a countdown on it.
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api.ingest import PictureNotLocalized, cache_gallery, cache_thumbnail
from backend.core import integrity
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

IG = "https://scontent-bru2-1.cdninstagram.com/v/t51.1-15/abc_n.jpg?oe=68F00000"
APPLE = "https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg/600x600bb.jpg"


@pytest.fixture(autouse=True)
def _schema():
    """Bring the throwaway database up through the app's own startup.

    These tests insert memos directly — what is under test is the relationship
    between a stored URL and the disk, not the create endpoint — so something
    has to have run `init_db` first."""
    from backend.main import app

    with TestClient(app):
        yield


async def _memo(**fields) -> str:
    memo_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db.add(Memo(id=memo_id, type="image", title=f"pic {memo_id[:8]}", **fields))
        await db.commit()
    return memo_id


async def _reload(memo_id: str) -> Memo:
    async with AsyncSessionLocal() as db:
        return await db.get(Memo, memo_id)


@pytest.fixture
def downloads(monkeypatch):
    """Swap the network out. `plan` maps a source URL to a local path or None."""
    from backend.api import ingest

    state = {"plan": {}, "calls": []}

    async def fake(src, name_stem):
        state["calls"].append(src)
        local = state["plan"].get(src, f"/api/files/thumb/{name_stem}.jpg")
        return local

    monkeypatch.setattr(ingest, "_download_thumb", fake)
    return state


class TestExpiringHosts:
    """Which remote URLs are on a clock, and which are merely untidy."""

    def test_instagram_cdn_expires(self):
        assert integrity._expires(IG) is True

    def test_facebook_cdn_expires(self):
        assert integrity._expires("https://scontent.xx.fbcdn.net/v/t1/x.jpg") is True

    def test_apple_artwork_does_not(self):
        # Renders indefinitely. Worth localizing eventually, never urgent —
        # counting it as expiring would bury the six that actually rot.
        assert integrity._expires(APPLE) is False

    def test_a_local_path_is_not_remote(self):
        assert integrity._is_remote("/api/files/thumb/x.jpg") is False
        assert integrity._expires("/api/files/thumb/x.jpg") is False


class TestPictureUrls:
    def test_cover_and_every_slide_are_collected(self):
        gallery = [{"url": "a.jpg"}, {"url": "b.jpg"}]
        assert integrity._picture_urls("cover.jpg", gallery) == ["cover.jpg", "a.jpg", "b.jpg"]

    def test_gallery_stored_as_json_text_is_read(self):
        """SQLite hands the column back as text when read outside the ORM, which
        is exactly how the integrity scan reads it."""
        assert integrity._picture_urls(None, json.dumps([{"url": "a.jpg"}])) == ["a.jpg"]

    def test_unparseable_gallery_is_skipped_not_raised(self):
        assert integrity._picture_urls("cover.jpg", "{not json") == ["cover.jpg"]


class TestFailureIsLoud:
    async def test_a_thumbnail_that_will_not_download_raises(self, downloads):
        downloads["plan"][IG] = None
        memo_id = await _memo(thumbnail_path=IG)

        with pytest.raises(PictureNotLocalized):
            await cache_thumbnail(memo_id)

        assert (await _reload(memo_id)).thumbnail_path == IG

    async def test_a_carousel_with_no_slide_downloaded_raises(self, downloads):
        """The exact shape of the six. Every slide remote, memo committed, and
        before this the job reported success."""
        downloads["plan"] = {IG: None, IG + "&2": None}
        memo_id = await _memo(
            thumbnail_path=IG, gallery=[{"url": IG}, {"url": IG + "&2"}]
        )

        with pytest.raises(PictureNotLocalized):
            await cache_gallery(memo_id)

    async def test_a_partly_dead_carousel_keeps_what_it_got(self, downloads):
        """One dead slide must never cost the live ones — but the job still has
        to report the gap, or a half-broken carousel looks finished."""
        downloads["plan"] = {IG + "&2": None}
        memo_id = await _memo(
            thumbnail_path=IG, gallery=[{"url": IG}, {"url": IG + "&2"}]
        )

        with pytest.raises(PictureNotLocalized, match="1/2"):
            await cache_gallery(memo_id)

        memo = await _reload(memo_id)
        assert memo.gallery[0]["url"].startswith("/api/files/thumb/")
        assert memo.gallery[1]["url"] == IG + "&2"
        # Slide 0 landed, so the cover follows it off the CDN.
        assert memo.thumbnail_path.startswith("/api/files/thumb/")

    async def test_a_fully_localized_carousel_is_silent(self, downloads):
        memo_id = await _memo(thumbnail_path=IG, gallery=[{"url": IG}])

        await cache_gallery(memo_id)

        assert (await _reload(memo_id)).gallery[0]["url"].startswith("/api/files/")

    async def test_an_already_local_thumbnail_is_left_alone(self, downloads):
        memo_id = await _memo(thumbnail_path="/api/files/thumb/done.jpg")

        await cache_thumbnail(memo_id)

        assert not downloads["calls"]


class TestIntegritySeesThem:
    async def test_an_expiring_carousel_is_counted_and_named(self):
        memo_id = await _memo(thumbnail_path=IG, gallery=[{"url": IG}, {"url": IG + "&2"}])

        scan = await integrity.run_integrity_check()

        assert memo_id in scan["expiring_memo_ids"]
        assert scan["expiring_pictures"] >= 3  # cover + two slides

    async def test_stable_remotes_count_as_remote_but_not_expiring(self):
        memo_id = await _memo(thumbnail_path=APPLE)

        scan = await integrity.run_integrity_check()

        assert memo_id not in scan["expiring_memo_ids"]
        assert scan["remote_pictures"] >= 1

    async def test_a_remote_picture_is_never_reported_as_a_missing_file(self):
        """The two are different problems with different repairs, and conflating
        them would turn every fresh Instagram save into a disk-loss alarm."""
        before = await integrity.run_integrity_check()
        await _memo(thumbnail_path=IG)
        after = await integrity.run_integrity_check()

        assert after["missing_thumbs"] == before["missing_thumbs"]
        assert after["status"] != "incident"
