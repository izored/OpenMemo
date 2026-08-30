"""Interactive anti-bot walls (OPNMMO-0054).

Temu, DataDome, PerimeterX and friends answer an automated fetch with a slider /
rotate / press-and-hold puzzle. That page parses perfectly well — into a memo
titled "Verify" carrying the CAPTCHA's own artwork. Detecting the wall is what
turns that into an honest link card plus an instruction to use the extension.

The line these tests defend: a wall is a near-empty document. A real page that
merely LOADS a captcha widget somewhere (a review form, a signup box) is not a
wall and must go through the normal extraction path.
"""
import pytest

from backend.core.headless import _looks_like_bot_wall

TAB = "\t"


def _stub(body: str) -> str:
    return f"<html><head><title>Verify</title></head><body>{body}</body></html>"


def _jar(tmp_path, monkeypatch, *lines: str):
    """Write a Netscape cookies.txt and point the settings helpers at it."""
    import backend.core.headless as headless  # noqa: F401  (imported by callers)

    path = tmp_path / "cookies.txt"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: True)
    monkeypatch.setattr("backend.core.app_settings.get_cookies_path", lambda: path)
    return path


def _row(domain: str, name: str, value: str, *, secure="TRUE", expires="1893456000") -> str:
    return TAB.join([domain, "TRUE", "/", secure, expires, name, value])


# ── Wall detection ───────────────────────────────────────────────────────────

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


# ── The user's own cookie jar, handed to the headless browser ────────────────

def test_a_netscape_jar_narrows_to_the_dragged_domain(tmp_path, monkeypatch):
    """The user's own cookies.txt is what gets a session-gated marketplace to
    render at all. It must never leak one site's cookies to another."""
    import backend.core.headless as headless

    _jar(
        tmp_path, monkeypatch,
        "# Netscape HTTP Cookie File",
        _row(".temu.com", "session", "abc"),
        _row(".youtube.com", "SID", "xyz"),
        "malformed line with too few fields",
    )

    got = headless._netscape_cookies_for("www.temu.com")
    assert [c["name"] for c in got] == ["session"]
    assert got[0]["value"] == "abc"
    assert got[0]["secure"] is True

    assert headless._netscape_cookies_for("example.com") == []


def test_a_session_cookie_becomes_a_playwright_session_cookie(tmp_path, monkeypatch):
    """0 in a Netscape jar means "expires with the session"; Playwright spells
    that -1, and passing 0 through would hand it an already-expired cookie."""
    import backend.core.headless as headless

    _jar(tmp_path, monkeypatch, _row(".temu.com", "tmp", "1", secure="FALSE", expires="0"))

    assert headless._netscape_cookies_for("temu.com")[0]["expires"] == -1


def test_httponly_cookies_are_not_mistaken_for_comments(tmp_path, monkeypatch):
    """Every exporter writes an httpOnly cookie as `#HttpOnly_<domain>`, a data
    line wearing a comment's clothes. Skipping it as a comment throws away
    exactly the cookies this feature exists for: a login session is httpOnly
    almost by definition."""
    import backend.core.headless as headless

    _jar(
        tmp_path, monkeypatch,
        "# Netscape HTTP Cookie File",
        "# This is a genuine comment",
        "#HttpOnly_" + _row(".temu.com", "session", "secret"),
        _row(".temu.com", "plain", "visible"),
    )

    got = {c["name"]: c for c in headless._netscape_cookies_for("temu.com")}
    assert set(got) == {"session", "plain"}
    assert got["session"]["value"] == "secret"
    assert got["session"]["httpOnly"] is True
    assert got["session"]["domain"] == ".temu.com"
    assert got["plain"]["httpOnly"] is False


def test_a_cookie_with_an_empty_value_survives(tmp_path, monkeypatch):
    """That line ends in a trailing TAB, which is a real seventh field. Calling
    .strip() on the line eats it, leaves six fields, and drops the cookie."""
    import backend.core.headless as headless

    _jar(tmp_path, monkeypatch, _row(".temu.com", "empty", "", secure="FALSE", expires="0"))

    got = headless._netscape_cookies_for("temu.com")
    assert [c["name"] for c in got] == ["empty"]
    assert got[0]["value"] == ""


def test_a_real_comment_is_still_skipped(tmp_path, monkeypatch):
    import backend.core.headless as headless

    _jar(
        tmp_path, monkeypatch,
        "# Netscape HTTP Cookie File",
        "# https://curl.se/docs/http-cookies.html",
        "",
    )

    assert headless._netscape_cookies_for("temu.com") == []


@pytest.mark.parametrize("line_ending", ["\n", "\r\n"])
def test_a_jar_exported_on_any_platform_parses(tmp_path, monkeypatch, line_ending):
    """A jar exported on Windows arrives with CRLF and is then read on macOS or
    in the Linux container. The parser must not care which."""
    import backend.core.headless as headless

    path = tmp_path / "cookies.txt"
    body = line_ending.join(["# Netscape HTTP Cookie File", _row(".temu.com", "s", "v"), ""])
    # newline='' so the exact bytes above reach disk, CR included.
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(body)
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: True)
    monkeypatch.setattr("backend.core.app_settings.get_cookies_path", lambda: path)

    got = headless._netscape_cookies_for("temu.com")
    assert [(c["name"], c["value"]) for c in got] == [("s", "v")]


def test_no_jar_is_not_an_error(monkeypatch):
    import backend.core.headless as headless

    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: False)
    assert headless._netscape_cookies_for("temu.com") == []
