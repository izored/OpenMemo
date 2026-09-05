"""A download that carries no pictures is not a video, on every path.

The third time the same shape of bug shipped. A tier downloads something, reports
success, and nobody checks the bytes against the claim:

  * 2026-08-04 — 51 reels, right size, right content-type, unplayable. Fixed by
    `_playable_container`, at the tier.
  * 2026-08-04 — every recovered reel silent, because DASH serves picture and
    sound separately. Fixed by `_has_audio_stream`, at the tier.
  * 2026-09-04 — a Facebook photo album filed as a video playing the song
    attached to the post. `_has_video_stream` was written for it, and wired into
    `repull_memo_task` only, where it could reach a memo that already held a
    gallery.

That last repair could not reach the memo that most needed it. A Facebook share
link (`/share/p/<code>`) is a redirect wrapper naming nothing on the post's own
page, so the scope narrowed to nothing on the FIRST save, no gallery was ever
written, and the memo re-downloaded the same 270 second Sade track on every
re-pull. Live memo 1b7a96ca, 2026-09-05.

So the gate moved to where the other two already live: the download tiers, which
every entry path goes through — first save, "Make it local", re-pull, and the
playlist pass.
"""
import inspect
import types

import pytest

from backend.core.localize_media import (
    LocalizeError,
    _localize_sync,
    _localize_via_instagram_api,
    _localize_via_sniff,
    _reject_pictureless,
)


def _file(tmp_path, name="clip.mp4"):
    p = tmp_path / name
    p.write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 256)
    return p


# ------------------------------------------------------------ the gate itself


def test_a_song_in_an_mp4_is_refused(tmp_path, monkeypatch):
    """The live failure. One stream, codec_type=audio, 270 seconds, .mp4."""
    monkeypatch.setattr(
        "backend.core.localize_media._has_video_stream", lambda p: False
    )
    f = _file(tmp_path)
    with pytest.raises(LocalizeError) as e:
        _reject_pictureless(f, "sniffed stream")
    assert "no pictures" in str(e.value)


def test_the_refused_file_is_deleted(tmp_path, monkeypatch):
    """Left on disk it is an orphan the integrity report has to explain, and the
    caller is about to try another tier that writes its own file."""
    monkeypatch.setattr(
        "backend.core.localize_media._has_video_stream", lambda p: False
    )
    f = _file(tmp_path)
    with pytest.raises(LocalizeError):
        _reject_pictureless(f)
    assert not f.exists()


def test_a_real_video_passes(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.core.localize_media._has_video_stream", lambda p: True
    )
    f = _file(tmp_path)
    _reject_pictureless(f)
    assert f.exists()


def test_a_box_without_ffprobe_still_gets_its_downloads(tmp_path, monkeypatch):
    """`None` means "I cannot tell". Reading that as "no pictures" would refuse
    every download on a machine with no ffprobe. Same rule as the audio check."""
    monkeypatch.setattr(
        "backend.core.localize_media._has_video_stream", lambda p: None
    )
    f = _file(tmp_path)
    _reject_pictureless(f)
    assert f.exists()


# ------------------------------------------------- every video tier runs it


@pytest.mark.parametrize(
    "tier", [_localize_via_sniff, _localize_via_instagram_api, _localize_sync]
)
def test_every_video_tier_checks_its_own_bytes(tier):
    """The point of the fix. A gate on one tier is a gate the next bug walks
    around, which is exactly what happened to the re-pull-only repair."""
    assert "_reject_pictureless" in inspect.getsource(tier)


def test_the_sniffer_asks_about_pictures_before_it_asks_about_sound():
    """`_recover_audio` and everything below it assume they are looking at a
    video. A file with no pictures must be gone before any of that runs."""
    src = inspect.getsource(_localize_via_sniff)
    assert src.index("_reject_pictureless") < src.index("_has_audio_stream")


def test_an_audio_conversion_is_never_gated():
    """"Make it local -> audio" is SUPPOSED to produce a file with no pictures.
    Gating it would break every podcast conversion in the library."""
    src = inspect.getsource(_localize_sync)
    assert 'if memo_type == "video":' in src
    assert src.index('if memo_type == "video":') < src.index("_reject_pictureless")


# --------------------------------------------- the repair, without a gallery


def test_a_pictureless_file_is_detached_even_with_no_gallery():
    """The gap that let this ship twice. The gallery was the only way in to the
    repair, and the broken memo never had one — its scope failed on the first
    save. The file's own bytes are the evidence, and they do not need a gallery
    to be read."""
    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert "pictureless = " in src
    assert "if (album or pictureless or is_picture_post) and not og_video:" in src


def test_an_audio_memo_keeps_its_file():
    """A music memo's file has no pictures by design. Detaching those would take
    the library apart one re-pull at a time."""
    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert '(memo.type or "").lower() == "video"' in src


def test_a_detached_memo_is_filed_by_what_it_left_behind():
    """First cut of this filed every gallery-less post as a `link`, which is how
    the live memo ended up as a bare link card when the whole point was to see
    the photo. A post holding a picture is an image memo; `link` is only for a
    post that left nothing to look at."""
    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert 'memo.type = "image" if (album or has_picture) else "link"' in src


def test_a_link_verdict_survives_the_background_sorter():
    """`derive_memo_type` re-files from the domain, and facebook.com is on the
    video list. It keeps `link` only because the URL is a post permalink, so the
    repair above is undone the moment that stops being true."""
    from backend.core.classify import _type_already_resolved

    assert _type_already_resolved("https://www.facebook.com/share/p/1DHJhfiXSF/")


# ------------------------------------------------- share wrappers resolve first


def _fake_httpx(landed: str | None = None, *, boom: bool = False):
    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def head(self, url):
            if boom:
                raise RuntimeError("network down")
            return types.SimpleNamespace(url=landed or url)

    return _Client


SHARE = "https://www.facebook.com/share/p/1DHJhfiXSF/"
POST = (
    "https://www.facebook.com/keinmagazine/posts/"
    "pfbid02AvAayi4c5crVC6tVNVPWREw16phhofTZeoCoVuWKzPeaFYefpAgVNkwbELFrUEZhl"
)


async def test_a_share_wrapper_resolves_to_the_post(monkeypatch):
    """The wrapper names the post and appears nowhere inside it. The permalink
    it redirects to is spelled the way the page's own anchors spell it, which is
    the only thing the scope can match."""
    import httpx

    from backend.core.permalinks import resolve_permalink

    monkeypatch.setattr(httpx, "AsyncClient", _fake_httpx(POST + "/?rdid=x4c9"))
    assert await resolve_permalink(SHARE) == POST


async def test_the_redirect_tracking_parameters_are_dropped(monkeypatch):
    """`?rdid=`/`?share_url=` make one post look like two to anything that
    compares URLs. `post_scope` normalises them away."""
    import httpx

    from backend.core.permalinks import resolve_permalink

    monkeypatch.setattr(httpx, "AsyncClient", _fake_httpx(POST + "/?rdid=x4c9"))
    assert "rdid" not in await resolve_permalink(SHARE)


async def test_landing_on_a_login_page_changes_nothing(monkeypatch):
    """Meta answers an anonymous request with a wall as often as with the post.
    A destination that is not a permalink is not an answer."""
    import httpx

    from backend.core.permalinks import resolve_permalink

    monkeypatch.setattr(
        httpx, "AsyncClient", _fake_httpx("https://www.facebook.com/login/?next=x")
    )
    assert await resolve_permalink(SHARE) == SHARE


async def test_a_network_failure_changes_nothing(monkeypatch):
    """Fails soft, in the direction of the behaviour that shipped before it."""
    import httpx

    from backend.core.permalinks import resolve_permalink

    monkeypatch.setattr(httpx, "AsyncClient", _fake_httpx(boom=True))
    assert await resolve_permalink(SHARE) == SHARE


async def test_an_ordinary_page_is_never_fetched(monkeypatch):
    """A URL that names no post was never going to be scoped, so it must not pay
    for a round trip. The fake client raises if it is constructed at all."""
    import httpx

    from backend.core.permalinks import resolve_permalink

    def _boom(*a, **kw):
        raise AssertionError("a non-permalink must not be resolved over the network")

    monkeypatch.setattr(httpx, "AsyncClient", _boom)
    url = "https://example.com/blog/an-article"
    assert await resolve_permalink(url) == url


def test_the_resolver_runs_before_the_render():
    """`_landed_rescope` retries from wherever the BROWSER landed, and the
    browser never lands on the post when the host walls it. Resolving over plain
    HTTP first is what puts the render on a scopeable page."""
    from backend.core.extractor import extract_video

    src = inspect.getsource(extract_video)
    assert "target = await resolve_permalink(url)" in src
    assert src.index("resolve_permalink") < src.index("_minimal_link(")


def test_the_memo_keeps_the_url_the_user_saved():
    """Rendering the resolved permalink must not rewrite the memo's source. The
    user pasted the share link; dedupe and the open-original button use it."""
    from backend.core.extractor import extract_video

    assert 'result["source_url"] = url' in inspect.getsource(extract_video)


def test_the_sniffer_scopes_to_the_resolved_post():
    """Unscoped, "the biggest stream on the wire" answers with whatever the page
    plays — on a photo post, the song. That is the capture that started this."""
    src = inspect.getsource(_localize_via_sniff)
    assert "target = await resolve_permalink(url)" in src
    assert "sniff_media(target" in src


# ------------------------------- the post is its picture, not a link card

def test_the_rejection_is_its_own_class():
    """A download that FAILED and a download that proved the post is not a
    video need different answers. Same class for both is what left the memo
    typed video with a red chip, which is a lie and also a loop: the next
    re-pull sees a video memo and goes after the same song."""
    from backend.core.localize_media import LocalizeError, PicturelessDownload

    assert issubclass(PicturelessDownload, LocalizeError)


def test_the_verdict_survives_both_tiers_failing():
    """yt-dlp and the sniffer reaching the same audio track is the strongest
    evidence there is. Flattening it to a plain LocalizeError threw that away
    one line before the memo layer read it."""
    src = inspect.getsource(
        __import__("backend.core.localize_media", fromlist=["x"]).localize_media
    )
    assert "isinstance(ytdlp_err, PicturelessDownload)" in src
    assert "isinstance(sniff_err, PicturelessDownload)" in src


def test_a_proven_non_video_is_filed_by_what_it_holds():
    """The memo the user was actually looking at. A post holding a picture and
    an audio track is a photo post with music, and a link card hides the one
    thing that survived the fetch."""
    from backend.api import ingest

    src = inspect.getsource(ingest.localize_memo_task)
    assert "except PicturelessDownload" in src
    assert '"image" if (memo.thumbnail_path or "").strip() else "link"' in src


def test_a_proven_non_video_gets_no_error_chip():
    """"This broke, try again" is wrong. Nothing broke and there is nothing to
    retry."""
    from backend.api import ingest

    src = inspect.getsource(ingest.localize_memo_task)
    head = src[src.index("except PicturelessDownload"):]
    head = head[: head.index("except LocalizeError")]
    assert "memo.localize_status = None" in head
    assert "memo.localize_error = None" in head


def test_the_repull_detach_keeps_the_picture_too():
    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert 'memo.type = "image" if (album or has_picture) else "link"' in src


def test_an_image_memo_is_never_offered_to_the_downloader():
    """Without this a single-photo post loops for ever: the resolve says
    `video` from the domain, so "has media" stays true, so the song is fetched
    and discarded on every re-pull."""
    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert 'is_picture_post = bool(memo) and (memo.type or "").lower() == "image"' in src
    assert "if (album or pictureless or is_picture_post) and not og_video:" in src


# --------------------------- a failed narrowing is not evidence of a video

def test_a_failed_scope_cannot_promote_a_memo_to_video():
    """`scope:page` is the resolver saying it read the feed, not the post. On a
    video host `classify_media` then answers `video` because that is what it
    says when it has learned nothing, and that verdict is not inert: it sends
    the downloader out to fill the memo."""
    from backend.api.ingest import _apply_resolved_type

    memo = _Repullable(type="link", source_url=FB_SHARE)
    _apply_resolved_type(memo, {"type": "video", "resolve_tier": "scope:page"}, [])
    assert memo.type == "link"


def test_a_scope_that_worked_still_speaks():
    from backend.api.ingest import _apply_resolved_type

    memo = _Repullable(type="link", source_url=FB_SHARE)
    _apply_resolved_type(memo, {"type": "video", "resolve_tier": "scope:post"}, [])
    assert memo.type == "video"


def test_a_resolve_with_no_tier_at_all_is_unaffected():
    """yt-dlp succeeding sets no tier, and it genuinely did read the video."""
    from backend.api.ingest import _apply_resolved_type

    memo = _Repullable(type="link", source_url=FB_SHARE)
    _apply_resolved_type(memo, {"type": "video"}, [])
    assert memo.type == "video"


def test_a_failed_scope_can_still_demote():
    """The guard is about promotion to video only. A read that found stills is
    still allowed to take a wrongly typed video apart."""
    from backend.api.ingest import _apply_resolved_type

    memo = _Repullable(type="video", source_url=FB_SHARE)
    _apply_resolved_type(
        memo,
        {"type": "image", "resolve_tier": "scope:page"},
        [{"url": "a.jpg", "type": "image"}, {"url": "b.jpg", "type": "image"}],
    )
    assert memo.type == "image"


FB_SHARE = "https://www.facebook.com/share/p/1DHJhfiXSF/"


class _Repullable:
    """The fields `_apply_resolved_type` reads and may write."""

    def __init__(self, **kw):
        self.id = "memo-1"
        self.type = "video"
        self.file_path = None
        self.gallery = None
        self.localize_status = None
        self.localize_error = None
        self.thumbnail_path = None
        self.source_url = FB_SHARE
        self.__dict__.update(kw)


# ------------------- a consent banner is not a verdict about the post

async def test_a_consent_gate_does_not_discard_the_scoped_photos(monkeypatch):
    """The real root cause, found 2026-09-05 by rendering the live post directly:
    `scoped=True media=5`. The renderer had walked the post's own subtree and
    come back with five full-size stills. Every one was thrown away, because the
    page WRAPPED AROUND the post carried a cookie banner and the branch that
    drops that banner's text also dropped the media.

    Nothing downstream then saw any media, so `classify_media` answered `video`
    from the domain, and the downloader went after the song attached to the
    album. Two different questions, two independent failures: the body text can
    be a cookie policy while the scoped read is perfect."""
    from backend.core import extractor

    stills = [{"url": f"https://cdn/{i}.jpg", "type": "image"} for i in range(5)]

    async def _rendered(url, **kw):
        return {
            "html": "<html><body>Allow cookies?</body></html>",
            "post_media": stills,
            "post_text": "the caption",
            "scoped": True,
            "consent_wall": True,
            "bot_wall": False,
            "main_image": None,
            "slides": [],
        }

    async def _og(url, user_agent=None):
        return {"title": "KEIN", "description": "Sade on repeat.",
                "thumbnail_path": "https://cdn/cover.jpg"}

    monkeypatch.setattr("backend.core.headless.render_page", _rendered)
    monkeypatch.setattr(extractor, "_fetch_og_meta", _og)
    monkeypatch.setattr(extractor, "_looks_like_consent_gate", lambda t: True)

    out = await extractor._minimal_link("https://www.facebook.com/x/posts/123", "facebook.com")

    assert out["_scoped"] is True
    assert len(out["_post_media"]) == 5


async def test_the_scoped_read_survives_a_render_with_no_usable_text(monkeypatch):
    """Same rule, stated as the invariant rather than the incident: whatever
    text path `_minimal_link` ends up taking, a scoped read that succeeded
    travels with the result."""
    from backend.core import extractor

    async def _rendered(url, **kw):
        return {"html": "", "post_media": [{"url": "https://cdn/a.jpg", "type": "image"}],
                "post_text": "", "scoped": True, "bot_wall": False, "main_image": None}

    async def _og(url, user_agent=None):
        return {"title": "t", "description": "d", "thumbnail_path": "https://cdn/c.jpg"}

    monkeypatch.setattr("backend.core.headless.render_page", _rendered)
    monkeypatch.setattr(extractor, "_fetch_og_meta", _og)

    out = await extractor._minimal_link("https://www.facebook.com/x/posts/123", "facebook.com")
    assert out["_scoped"] is True
    assert len(out["_post_media"]) == 1
