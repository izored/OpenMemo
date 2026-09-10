"""The album's photos have to reach disk, and a failure has to reach the screen.

`core/facebook` finds a walled Facebook post's photo set and hands back
`lookaside.fbsbx.com/lookaside/crawler/media/?media_id=<id>` for each one. That
endpoint is named for the client it serves: it answers an image only to a
link-preview crawler, and hands a browser user agent `text/html` and a login
page. `_download_thumb` correctly refuses a non-image, so every slide failed.

Two consequences, both live on 2026-09-10:

  * `4/4 carousel slides not downloaded`, so the memo kept four remote URLs the
    viewer's browser cannot load either.
  * `cache_gallery` raises that on purpose, so the durable queue retries and
    parks the job. But it runs in step 1 of `repull_memo_task`, and step 2 is
    what sets `localize_status`. The raise left the memo stamped `pending`,
    which the memo page renders as work in progress. Four presses of re-pull,
    four background failures, four spinners that never stopped, and nothing on
    screen. "Nothing happens."
"""
import pytest

from backend.api import ingest
from backend.api.ingest import PictureNotLocalized, _thumb_headers
from backend.core.extractor import _CRAWLER_UA
from backend.core.facebook import MEDIA_URL

ALBUM_PHOTO = MEDIA_URL.format("28570772159223917")


# ------------------------------------------------------ asking as the client


def test_metas_crawler_endpoint_is_asked_as_a_crawler():
    """The one address a walled album's photos come from."""
    assert _thumb_headers(ALBUM_PHOTO)["User-Agent"] == _CRAWLER_UA


def test_the_crawler_request_drops_the_browser_theatre():
    """Referer and Sec-Fetch-* are what the endpoint refuses. Sending them is
    how a browser user agent gets a login page instead of a photo."""
    headers = _thumb_headers(ALBUM_PHOTO)
    assert "Referer" not in headers
    assert not any(k.startswith("Sec-Fetch") for k in headers)


@pytest.mark.parametrize(
    "url",
    [
        "https://scontent.cdninstagram.com/v/t51/photo.jpg",
        "https://pbs.twimg.com/media/abc.jpg",
        "https://example.com/cover.png",
    ],
)
def test_every_other_host_keeps_the_browser_headers(url):
    """The browser headers exist to beat hotlink protection elsewhere, and this
    change must not quietly hand every CDN a crawler user agent instead."""
    headers = _thumb_headers(url)
    assert headers["User-Agent"] != _CRAWLER_UA
    assert headers["Sec-Fetch-Dest"] == "image"
    assert headers["Referer"].startswith("https://")


# ----------------------------------------------- the failure reaches the memo

@pytest.mark.asyncio
async def test_a_failed_slide_download_leaves_a_terminal_status(monkeypatch):
    """The real `repull_memo_task`, against a real row, with `cache_gallery`
    failing the way it did in production. The memo must not still say
    `pending` when the dust settles — that is the state the memo page renders
    as a spinner, and it is what made four presses of re-pull look like four
    presses of nothing."""
    from backend.db.database import AsyncSessionLocal, init_db
    from backend.db.models import Memo

    await init_db()

    memo_id = "fb-album-pending-1"
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id,
            title="an album",
            type="image",
            source_url="https://www.facebook.com/share/1VAZoyFq8Z/",
            source_domain="facebook.com",
            localize_status="pending",
            content_text="",
        ))
        await db.commit()

    async def resolved_album(url, domain=None):
        return {
            "type": "image",
            "title": "an album",
            "gallery": [
                {"url": MEDIA_URL.format("1"), "type": "image"},
                {"url": MEDIA_URL.format("2"), "type": "image"},
            ],
        }

    async def slides_will_not_download(_memo_id):
        raise PictureNotLocalized("2/2 carousel slides not downloaded")

    monkeypatch.setattr("backend.core.extractor.extract_video", resolved_album)
    monkeypatch.setattr(ingest, "cache_gallery", slides_will_not_download)

    with pytest.raises(PictureNotLocalized):
        await ingest.repull_memo_task(memo_id, "video")

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        assert memo.localize_status == "error", "a spinner that never stops"
        assert "not downloaded" in (memo.localize_error or "")


@pytest.mark.asyncio
async def test_reporting_a_failure_never_raises_its_own(monkeypatch):
    """`_mark_localize_error` exists to report a failure. Replacing that failure
    with a database error would lose the reason and the status both."""
    class Boom:
        def __call__(self, *a, **k):
            raise RuntimeError("database is gone")

    monkeypatch.setattr(ingest, "AsyncSessionLocal", Boom())
    await ingest._mark_localize_error("memo-1", "anything")
