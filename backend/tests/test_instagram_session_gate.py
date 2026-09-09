"""The Instagram tiers that need a login must ask whether there is one.

They used to ask whether a cookie FILE existed. The jar is shared with every
host openMemo has ever touched, so one YouTube cookie made that true, and every
Instagram save then paid a guest-API call it could not authenticate plus a
gallery-dl subprocess that could not either, before the browser tiers did the
work that was always going to do it.

Measured on this machine, 2026-09-09: the jar held six instagram.com cookies
and no `sessionid`, `session_status()` correctly said not connected, and both
doomed tiers ran anyway on every save.
"""
import pytest

from backend.core import extractor


@pytest.fixture
def jar(tmp_path, monkeypatch):
    """A cookie jar whose contents the test controls, with no Instagram login."""
    path = tmp_path / "yt_cookies.txt"
    path.write_text(
        "# Netscape HTTP Cookie File\n"
        ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsomething\n"
        ".instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tabc\n"
        ".instagram.com\tTRUE\t/\tTRUE\t0\tds_user_id\t123\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.core.app_settings.get_cookies_path", lambda: path)
    monkeypatch.setattr("backend.core.instagram_login._read_jar_lines",
                        lambda: path.read_text(encoding="utf-8").splitlines())
    # The real situation this exists for: a jar that EXISTS and is non-empty,
    # because of YouTube, while holding no Instagram login. Without this the
    # old file-exists gate reads False here and the tests below pass against
    # the very code they are supposed to catch.
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: True)
    return path


def _add_session(path):
    with path.open("a", encoding="utf-8") as fh:
        fh.write(".instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tsecret\n")


class TestGalleryDl:
    async def test_it_does_not_run_without_an_instagram_login(self, jar, monkeypatch):
        ran = False

        async def _never(*a, **kw):
            nonlocal ran
            ran = True
            raise AssertionError("gallery-dl was launched with no Instagram login")

        monkeypatch.setattr("asyncio.create_subprocess_exec", _never)
        assert await extractor._instagram_gallery_dl("https://instagram.com/p/x/") is None
        assert ran is False

    async def test_it_does_run_once_a_session_is_present(self, jar, monkeypatch):
        launched = {}

        class _Proc:
            returncode = 1  # "found nothing", so the caller falls through

            async def communicate(self):
                return b"", b""

            def kill(self):
                pass

        async def _spawn(*args, **kw):
            launched["args"] = args
            return _Proc()

        _add_session(jar)
        monkeypatch.setattr("asyncio.create_subprocess_exec", _spawn)
        await extractor._instagram_gallery_dl("https://instagram.com/p/x/")
        assert launched, "a real login should let the cookie tier try"
        assert "gallery-dl" in launched["args"][0]


class TestTheApiTier:
    async def test_the_cookie_retry_is_skipped_without_a_login(self, jar, monkeypatch):
        """Tier 2 is the same call as tier 1 plus a jar. With no login in the
        jar it is the same request twice, and the second is pure latency."""
        calls = []

        async def _fetch(url, cookies_path=None):
            calls.append(cookies_path)
            return None

        async def _no_gallery_dl(url):
            return None

        async def _no_sniff(url, **kw):
            return None

        async def _no_render(url, **kw):
            return None

        monkeypatch.setattr("backend.core.instagram.fetch_media_info", _fetch)
        monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _no_gallery_dl)
        monkeypatch.setattr("backend.core.sniff_media.sniff_media", _no_sniff)
        monkeypatch.setattr("backend.core.headless.render_page", _no_render)

        await extractor._instagram_resolve("https://instagram.com/p/x/", "instagram.com")
        assert calls == [None], f"expected one anonymous attempt, got {calls}"

    async def test_the_cookie_retry_happens_once_a_login_exists(self, jar, monkeypatch):
        calls = []

        async def _fetch(url, cookies_path=None):
            calls.append(cookies_path)
            return None

        async def _no_gallery_dl(url):
            return None

        async def _no_sniff(url, **kw):
            return None

        async def _no_render(url, **kw):
            return None

        _add_session(jar)
        monkeypatch.setattr("backend.core.instagram.fetch_media_info", _fetch)
        monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _no_gallery_dl)
        monkeypatch.setattr("backend.core.sniff_media.sniff_media", _no_sniff)
        monkeypatch.setattr("backend.core.headless.render_page", _no_render)

        await extractor._instagram_resolve("https://instagram.com/p/x/", "instagram.com")
        assert len(calls) == 2, "a real login should be tried"
        assert calls[1] is not None
