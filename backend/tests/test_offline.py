"""openMemo renders with the network unplugged.

Local-first is not a description of where the database lives. It is a claim
about what happens when the wifi is off, and until August 2026 the claim was
false in three places at once: every card fetched its site icon from Google,
every page load fetched the typeface from a CDN, and pictures were served
straight from the source until they expired.

The nuances that stay online are the ones that are inherently online, and they
are narrow:

* **Fetching new content.** Saving a link, re-pulling a post, polling the bot.
  These are the act of going to get something. Offline they fail and say so.
* **Heavy media.** A long video or track on a host with a working player is not
  downloaded unless `auto_download_video` / `auto_download_audio` says so,
  because a library of them fills a disk. `source_url` and embed markup may
  name remote hosts.
* **Checking for a new version.** Asking GitHub whether a release exists cannot
  be done locally. It must fail silently and never block a render.

Everything else has to come off this machine.
"""
import pathlib
import re

import pytest

FRONTEND = pathlib.Path("frontend")

# Hosts a rendered page is allowed to name, and why. Anything else is a leak.
_ALLOWED_IN_SOURCE = (
    # Embed players for heavy media, built per platform. The nuance above.
    "youtube.com", "youtu.be", "player.vimeo.com", "vimeo.com",
    "player.twitch.tv", "clips.twitch.tv", "twitch.tv",
    "platform.twitter.com", "x.com", "twitter.com",
    "tiktok.com", "instagram.com", "facebook.com", "fb.watch",
    "threads.net", "threads.com", "soundcloud.com", "bandcamp.com",
    "open.spotify.com", "music.apple.com", "dailymotion.com", "reddit.com",
    # Version check. Inherently online, already best-effort, never on a render.
    "api.github.com",
    # Prose, licences, schemas.
    "github.com", "opensource.org", "w3.org", "ogp.me", "creativecommons.org",
    "trychroma.com", "ollama.com", "anthropic.com", "claude.ai",
    "localhost", "127.0.0.1", "example.com", "0.0.0.0",
)

_URL = re.compile(r"https?://([a-zA-Z0-9.-]+)")


def _external_hosts(text: str) -> set[str]:
    hosts = set()
    for host in _URL.findall(text):
        host = host.lower()
        if any(host == a or host.endswith("." + a) for a in _ALLOWED_IN_SOURCE):
            continue
        hosts.add(host)
    return hosts


@pytest.mark.skipif(not FRONTEND.exists(), reason="frontend not present")
def test_the_app_shell_asks_no_one_for_anything():
    """index.html is the first thing a browser loads. It must be self-contained.

    It used to carry four links: Google Fonts for Inter and JetBrains Mono that
    nothing rendered, and Fontshare for Satoshi that everything did. With the
    wifi off, openMemo drew its own interface in a fallback face.
    """
    shell = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert not _URL.findall(shell), (
        "index.html loads something over the network. The app shell must be "
        f"self-contained: {_URL.findall(shell)}"
    )


@pytest.mark.skipif(not FRONTEND.exists(), reason="frontend not present")
def test_no_stylesheet_imports_a_remote_font():
    offenders = []
    for path in (FRONTEND / "src").rglob("*.css"):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"@import\s+url\(([^)]+)\)|src:\s*url\(([^)]+)\)", text):
            ref = (match.group(1) or match.group(2) or "").strip("'\" ")
            if ref.startswith("http") or ref.startswith("//"):
                offenders.append(f"{path.as_posix()}: {ref}")

    assert not offenders, f"remote font or stylesheet references: {offenders}"


@pytest.mark.skipif(not FRONTEND.exists(), reason="frontend not present")
def test_the_font_the_tokens_name_is_declared_locally():
    """--font-ui naming a face nobody declares is a silent fallback, which is
    exactly what the removed Fontshare link was hiding."""
    tokens = (FRONTEND / "src/styles/openmemo.css").read_text(encoding="utf-8")
    faces = (FRONTEND / "src/styles/fonts.css").read_text(encoding="utf-8")

    named = re.search(r"--font-ui:\s*'([^']+)'", tokens)
    assert named, "--font-ui no longer names a specific face"
    assert f"font-family: '{named.group(1)}'" in faces, (
        f"{named.group(1)} is the UI face but has no @font-face in fonts.css"
    )
    assert "/fonts/" in faces, "fonts.css must point at locally served files"


def test_the_backend_mints_no_google_favicon_urls():
    """660 memos held `google.com/s2/favicons?domain=…` and the dashboard
    rendered every one of them, so opening openMemo was a request to Google per
    card and a running list of every site in the library."""
    offenders = []
    for path in pathlib.Path("backend").rglob("*.py"):
        rel = path.as_posix()
        if any(v in f"/{rel}" for v in ("/.venv/", "/__pycache__/", "/tests/")):
            continue
        # The one place allowed to name it: the icon store's last-resort source
        # when a site serves no favicon.ico of its own. Reached once per new
        # domain, at ingest, and the bytes land on disk. That is the whole
        # difference from what this test exists to stop.
        if rel.endswith("core/favicons.py"):
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "s2/favicons" in line and not line.lstrip().startswith("#"):
                offenders.append(f"{rel}:{i}")

    assert not offenders, (
        "these mint a Google-hosted favicon URL. Icons are fetched once per "
        f"domain into files/favicons instead (backend/core/favicons.py): {offenders}"
    )


def test_a_served_memo_never_names_a_remote_icon():
    from backend.core.pictures import serve_pictures

    out = serve_pictures({
        "source_domain": "nothing-we-have-an-icon-for.invalid",
        "source_favicon": "https://www.google.com/s2/favicons?domain=x.com&sz=32",
    })

    assert out["source_favicon"] is None
