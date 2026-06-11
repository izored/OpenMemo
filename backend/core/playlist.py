"""Playlist enumeration via yt-dlp ("Music Experience V2", ADR-015).

Turns a playlist URL (YouTube / YouTube Music playlist, SoundCloud set,
Bandcamp album, anything yt-dlp can enumerate) into a list of track entries
WITHOUT downloading anything — `--flat-playlist` returns metadata only.

The actual per-track download reuses the Make-it-local audio pipeline
(`core/localize_media.py`); this module only answers two questions:

    looks_like_playlist(url) — cheap URL heuristic, mirrors lib/playlistUrl.ts.
        Gates the probe so we never run yt-dlp on every pasted link.
    probe_playlist(url)      — real enumeration. Title + capped entry list.

Capped at MAX_PLAYLIST_ITEMS because YouTube Mix/Radio playlists are infinite.
"""
import asyncio
import json
import shutil
import subprocess
from urllib.parse import parse_qs, urlparse

from backend.core.app_settings import cookies_present, get_cookies_path

# Hard cap per playlist — a YouTube Mix (list=RD…) enumerates forever without it.
MAX_PLAYLIST_ITEMS = 100


class PlaylistError(Exception):
    """Raised when a playlist cannot be enumerated."""


def looks_like_playlist(url: str) -> bool:
    """Cheap, host-aware playlist shape check (no network, no yt-dlp).

    True for URLs that CAN be a playlist: YouTube/YT Music with a `list=`
    param or /playlist path, SoundCloud /sets/, Bandcamp /album/. Mirrors the
    frontend heuristic in `lib/playlistUrl.ts` — keep the two in sync.
    """
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower().removeprefix("www.")
        path = (parsed.path or "").lower()
        qs = parse_qs(parsed.query or "")
    except Exception:
        return False
    if "youtube.com" in host or "youtu.be" in host:
        return bool(qs.get("list")) or path.startswith("/playlist")
    if "soundcloud.com" in host:
        return "/sets/" in path
    if "bandcamp.com" in host:
        return "/album/" in path
    return False


def _cookie_args() -> list[str]:
    """Same single source of yt-dlp auth as localize_media (ADR-012)."""
    if cookies_present():
        return ["--cookies", str(get_cookies_path())]
    return []


def _clean_artist(entry: dict) -> str | None:
    """Artist from a flat entry's metadata. Source metadata, never the domain
    (ADR-010). YouTube auto-channels carry a ' - Topic' suffix — strip it."""
    artist = entry.get("artist") or entry.get("uploader") or entry.get("channel")
    if not artist:
        return None
    artist = str(artist).strip()
    if artist.endswith(" - Topic"):
        artist = artist[: -len(" - Topic")].strip()
    return artist[:200] or None


def _entry_thumbnail(entry: dict) -> str | None:
    """Best thumbnail URL from a flat entry (largest listed, else none)."""
    thumbs = entry.get("thumbnails") or []
    if isinstance(thumbs, list) and thumbs:
        best = max(
            (t for t in thumbs if isinstance(t, dict) and t.get("url")),
            key=lambda t: (t.get("width") or 0) * (t.get("height") or 0),
            default=None,
        )
        if best:
            return best["url"]
    t = entry.get("thumbnail")
    return t if isinstance(t, str) and t.startswith("http") else None


def _probe_sync(url: str) -> dict:
    if shutil.which("yt-dlp") is None:
        raise PlaylistError("yt-dlp is not installed on the server")

    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--no-warnings",
        "--playlist-items", f"1-{MAX_PLAYLIST_ITEMS}",
        "--socket-timeout", "20",
        *_cookie_args(),
        url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise PlaylistError("Playlist enumeration timed out")
    if proc.returncode != 0 or not proc.stdout.strip():
        msg = (proc.stderr or "unknown error").strip().splitlines()
        raise PlaylistError(f"yt-dlp failed: {msg[-1] if msg else 'unknown error'}")

    try:
        data = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        raise PlaylistError("yt-dlp returned unreadable playlist data")

    raw_entries = data.get("entries")
    if not isinstance(raw_entries, list) or not raw_entries:
        raise PlaylistError("No playlist entries found at this URL")

    entries = []
    for e in raw_entries[:MAX_PLAYLIST_ITEMS]:
        if not isinstance(e, dict):
            continue
        # Flat YouTube entries may carry a bare id instead of a full URL.
        track_url = e.get("url") or e.get("webpage_url")
        if track_url and not str(track_url).startswith("http"):
            track_url = f"https://www.youtube.com/watch?v={track_url}"
        if not track_url:
            continue
        entries.append({
            "url": str(track_url),
            "title": (e.get("title") or "Untitled track")[:300],
            "artist": _clean_artist(e),
            "thumbnail": _entry_thumbnail(e),
            "duration": e.get("duration"),
        })

    if not entries:
        raise PlaylistError("Playlist has no playable entries")

    # --playlist-items already capped what yt-dlp enumerated; the source's true
    # size only shows up in playlist_count. That's how we know we truncated.
    source_total = data.get("playlist_count") or len(raw_entries)
    return {
        "title": (data.get("title") or "Playlist")[:200],
        "uploader": data.get("uploader") or data.get("channel"),
        "count": len(entries),
        "truncated": int(source_total) > len(entries),
        "entries": entries,
    }


async def probe_playlist(url: str) -> dict:
    """Enumerate a playlist (no downloads). Returns
    {title, uploader, count, truncated, entries:[{url,title,artist,thumbnail,duration}]}.
    Raises PlaylistError when the URL can't be enumerated."""
    return await asyncio.to_thread(_probe_sync, url)
