"""Interactive anti-bot walls (OPNMMO-0054).

Temu, DataDome, PerimeterX and friends answer an automated fetch with a slider /
rotate / press-and-hold puzzle. That page parses perfectly well — into a memo
titled "Verify" carrying the CAPTCHA's own artwork. Detecting the wall is what
turns that into an honest link card plus an instruction to use the extension.

The line these tests defend: a wall is a near-empty document. A real page that
merely LOADS a captcha widget somewhere (a review form, a signup box) is not a
wall and must go through the normal extraction path.
"""
from backend.core.headless import _looks_like_bot_wall


def _stub(body: str) -> str:
    return f"<html><head><title>Verify</title></head><body>{body}</body></html>"


def test_slider_puzzle_is_a_wall():
    assert _looks_like_bot_wall(_stub("<div>Slide to verify</div>"))


def test_press_and_hold_is_a_wall():
    assert _looks_like_bot_wall(_stub("<p>Press and Hold to confirm you are human</p>"))


def test_vendor_fingerprints_are_walls():
    for marker in ("px-captcha", "captcha-delivery.com", "geetest", "datadome"):
        assert _looks_like_bot_wall(_stub(f"<div class='{marker}'></div>")), marker


def test_detection_is_case_insensitive():
    assert _looks_like_bot_wall(_stub("<h1>VERIFY YOU ARE HUMAN</h1>"))


def test_a_real_page_carrying_a_captcha_widget_is_not_a_wall():
    # 150 KB of real markup with an hCaptcha on its comment form. Writing this
    # off as a wall would silently downgrade every page that has a signup box.
    article = "<p>" + ("word " * 30_000) + "</p>"
    html = _stub(article + "<div class='h-captcha'></div>")
    assert len(html) > 120_000
    assert not _looks_like_bot_wall(html)


def test_an_ordinary_page_is_not_a_wall():
    assert not _looks_like_bot_wall(_stub("<h1>A perfectly normal article</h1>"))


def test_empty_input_is_not_a_wall():
    assert not _looks_like_bot_wall("")
    assert not _looks_like_bot_wall(None)  # type: ignore[arg-type]


def test_the_extractor_shares_one_definition_of_a_wall():
    """Plain-fetch and headless paths must agree, or a wall detected by one and
    not the other loops between them."""
    from backend.core.extractor import _looks_like_bot_wall as extractor_wall

    wall = _stub("<div>Slide to verify</div>")
    assert extractor_wall(wall) == _looks_like_bot_wall(wall) is True


def test_the_wall_memo_says_what_to_do_instead():
    from backend.core.extractor import _bot_wall_memo

    memo = _bot_wall_memo("https://www.temu.com/thing.html", "temu.com")
    assert memo["type"] == "link"
    assert memo["source_url"] == "https://www.temu.com/thing.html"
    assert memo["resolve_tier"] == "blocked:bot-wall"
    # The description is the only place the user reads, so the instruction goes
    # there rather than into a log line nobody opens.
    assert "extension" in memo["description"]
    assert "temu.com" in memo["description"]
    # No scraped artwork from the CAPTCHA page.
    assert memo["thumbnail_path"] == ""


def test_a_netscape_jar_narrows_to_the_dragged_domain(tmp_path, monkeypatch):
    """The user's own cookies.txt is what gets a session-gated marketplace to
    render at all. It must never leak one site's cookies to another."""
    import backend.core.headless as headless

    jar = tmp_path / "cookies.txt"
    jar.write_text(
        "# Netscape HTTP Cookie File\n"
        ".temu.com\tTRUE\t/\tTRUE\t1893456000\tsession\tabc\n"
        ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\txyz\n"
        "malformed line with too few fields\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: True)
    monkeypatch.setattr("backend.core.app_settings.get_cookies_path", lambda: jar)

    got = headless._netscape_cookies_for("www.temu.com")
    assert [c["name"] for c in got] == ["session"]
    assert got[0]["value"] == "abc"
    assert got[0]["secure"] is True

    assert headless._netscape_cookies_for("example.com") == []


def test_a_session_cookie_becomes_a_playwright_session_cookie(tmp_path, monkeypatch):
    """0 in a Netscape jar means "expires with the session"; Playwright spells
    that -1, and passing 0 through would hand it an already-expired cookie."""
    import backend.core.headless as headless

    jar = tmp_path / "cookies.txt"
    jar.write_text(".temu.com\tTRUE\t/\tFALSE\t0\ttmp\t1\n", encoding="utf-8")
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: True)
    monkeypatch.setattr("backend.core.app_settings.get_cookies_path", lambda: jar)

    assert headless._netscape_cookies_for("temu.com")[0]["expires"] == -1


def test_no_jar_is_not_an_error(monkeypatch):
    import backend.core.headless as headless

    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: False)
    assert headless._netscape_cookies_for("temu.com") == []
