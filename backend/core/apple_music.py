"""Apple Music → lossless FLAC — a second front-end onto the SpotiFLAC chain.

Apple Music is only a **metadata + URL front-end** here, exactly like Spotify is
in [spotiflac.py](spotiflac.py). The lossless audio never comes from Apple: an
Apple track URL is resolved to a universal **ISRC** (via song.link / Deezer),
and that ISRC anchors the existing **Qobuz** download chain. So this module owns
only the new half — a URL parser + a reader for Apple's no-auth page JSON — and
imports the platform-neutral back half from spotiflac verbatim:

    Apple URL
      → music.apple.com page (<script id="serialized-server-data">)   metadata
      → song.link (Odesli) / Deezer                                   ISRC
      → [ spotiflac: Qobuz signed API → community endpoint → FLAC ]   audio

No MusicKit token / developer JWT is involved — the public page serializes the
full tracklist server-side (verified to 67/67 on a 67-track playlist, well past
Spotify's ~50 embed cap). Very long lists *may* truncate; that is the same
no-auth tradeoff the Spotify path accepts. Pulling the full list of an
arbitrarily long playlist would need Apple's authenticated amp-api — out of
scope for this no-auth front-end (see ADR-019).
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import httpx

# The whole back half is reused unchanged — these are platform-neutral despite
# their Spotify-flavoured names (`_resolve_isrc` feeds any URL to song.link).
from backend.core.spotiflac import (
    _BROWSER_UA,
    _community_flac_url,
    _qobuz_track_match,
    _resolve_isrc,
    _tag_flac,
    DEFAULT_QUALITY,
    SpotiFlacError,
    VALID_QUALITIES,
)

# music.apple.com/<store>/<kind>/<slug>/<id>   (+ optional ?i=<trackid>)
#   kind ∈ {song, album, playlist}; a playlist id looks like "pl.xxxx".
# The store segment (e.g. /be/) is optional. Keep in sync with appleKind in
# frontend/src/lib/playlistUrl.ts.
_APPLE_URL_RE = re.compile(
    r"music\.apple\.com/(?:([a-z]{2})/)?(song|album|playlist)/[^/]+/([A-Za-z0-9.\-]+)",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- #
#  URL parsing
# --------------------------------------------------------------------------- #
def parse_apple_url(url: str | None) -> tuple[str, str, str | None] | None:
    """Return ``(kind, apple_id, store)`` for an Apple Music URL, else None.

    ``kind`` is normalised to ``'track' | 'album' | 'playlist'``:
      - ``?i=<id>`` present     → ``('track', <i>, store)`` (track-on-album URL)
      - ``/song/<slug>/<id>``   → ``('track', <id>, store)``
      - ``/album/<slug>/<id>``  → ``('album', <id>, store)``
      - ``/playlist/<slug>/<id>`` → ``('playlist', <id>, store)``
    """
    if not url:
        return None
    s = url.strip()
    m = _APPLE_URL_RE.search(s)
    if not m:
        return None
    store, raw_kind, ent_id = m.group(1), m.group(2).lower(), m.group(3)
    i_match = re.search(r"[?&]i=([0-9]+)", s)
    if i_match:
        return "track", i_match.group(1), store
    if raw_kind == "song":
        return "track", ent_id, store
    return raw_kind, ent_id, store  # 'album' | 'playlist'


def is_apple_url(url: str | None) -> bool:
    return bool(url) and parse_apple_url(url) is not None


def is_apple_track_url(url: str | None) -> bool:
    parsed = parse_apple_url(url) if url else None
    return bool(parsed and parsed[0] == "track")


# --------------------------------------------------------------------------- #
#  Apple page metadata (serialized-server-data, no auth)
# --------------------------------------------------------------------------- #
def _artwork_url(art: dict | None, size: int = 600) -> str | None:
    """Apple artwork URLs carry ``{w}``/``{h}``/``{f}`` placeholders that 404
    unless substituted (the surrounding text e.g. ``600x600bb.jpg`` is kept)."""
    d = (art or {}).get("dictionary") or {}
    u = d.get("url")
    if not u:
        return None
    return u.replace("{w}", str(size)).replace("{h}", str(size)).replace("{f}", "jpg")


def _serialized(client: httpx.Client, url: str) -> dict:
    """Fetch the page and return ``root["data"][0]["data"]`` — the object that
    holds ``sections`` (header + tracks + footer) and ``canonicalURL``."""
    resp = client.get(url, headers={"User-Agent": _BROWSER_UA}, timeout=30)
    resp.raise_for_status()
    # Match on the id alone — Apple emits `type=` before `id=` on the <script>,
    # so anchoring to `<script id=` would miss it.
    m = re.search(
        r'id="serialized-server-data"[^>]*>(.*?)</script>',
        resp.text,
        re.S,
    )
    if not m:
        raise SpotiFlacError("Apple Music page returned no metadata")
    try:
        root = json.loads(m.group(1))
        return root["data"][0]["data"]
    except (KeyError, IndexError, ValueError) as e:
        raise SpotiFlacError(f"Unexpected Apple Music page shape: {e}") from e


def _sections_by_kind(data: dict, kind: str) -> list[dict]:
    return [s for s in (data.get("sections") or []) if s.get("itemKind") == kind]


def _artist_from_item(item: dict) -> str | None:
    """Prefer the flat ``artistName``; fall back to joining ``subtitleLinks``."""
    direct = (item.get("artistName") or "").strip()
    if direct:
        return direct
    names = [
        (l.get("title") or "").strip()
        for l in (item.get("subtitleLinks") or [])
        if (l.get("title") or "").strip()
    ]
    return ", ".join(names) or None


def _track_from_item(item: dict) -> dict:
    """Normalise one ``trackLockup`` item → {id,title,artist,album,apple_url,cover}.

    Field names mirror the Spotify path (``apple_url`` ↔ ``spotify_url``) so the
    ingest layer stays uniform.
    """
    cd = item.get("contentDescriptor") or {}
    tid = (cd.get("identifiers") or {}).get("storeAdamID") or item.get("id") or ""
    tert = item.get("tertiaryLinks") or []
    album = (tert[0].get("title") or "").strip() if tert else None
    return {
        "id": str(tid),
        "title": (item.get("title") or "").strip(),
        "artist": _artist_from_item(item),
        "album": album or None,
        "apple_url": cd.get("url"),
        "cover": _artwork_url(item.get("artwork")),
    }


def apple_track_meta(client: httpx.Client, url: str) -> dict:
    """Title / artist / album / cover for a single Apple track.

    A ``/song/<id>`` or ``/album/<id>?i=<id>`` URL renders the album page; pick
    the ``trackLockup`` item whose ``storeAdamID`` matches the ``?i=`` id (or the
    first track when none is given).
    """
    parsed = parse_apple_url(url)
    if not parsed or parsed[0] != "track":
        raise SpotiFlacError("Not an Apple Music track URL")
    want_id = parsed[1]
    data = _serialized(client, url)
    items: list[dict] = []
    for sec in _sections_by_kind(data, "trackLockup"):
        items.extend(sec.get("items") or [])
    if not items:
        raise SpotiFlacError("No tracks found on Apple Music page")
    chosen = next(
        (
            it
            for it in items
            if str(((it.get("contentDescriptor") or {}).get("identifiers") or {}).get("storeAdamID") or it.get("id"))
            == str(want_id)
        ),
        items[0],
    )
    meta = _track_from_item(chosen)
    # On an album page the track items carry no album name / per-track art (the
    # album shares one cover via the header). Backfill from the header so a
    # single-track save still gets an album + thumbnail.
    header_secs = _sections_by_kind(data, "containerDetailHeaderLockup")
    header = (header_secs[0].get("items") or [{}])[0] if header_secs else {}
    if not meta.get("album"):
        meta["album"] = (header.get("title") or "").strip() or None
    if not meta.get("cover"):
        meta["cover"] = _artwork_url(header.get("artwork"))
    # Round-trip the canonical Apple URL (carries ?i=) so song.link resolves it.
    if not meta.get("apple_url"):
        meta["apple_url"] = url
    return meta


def apple_collection_meta(client: httpx.Client, kind: str, url: str) -> dict:
    """Title / cover / track list for an Apple album or playlist."""
    data = _serialized(client, url)
    header_secs = _sections_by_kind(data, "containerDetailHeaderLockup")
    header = (header_secs[0].get("items") or [{}])[0] if header_secs else {}
    tracks: list[dict] = []
    for sec in _sections_by_kind(data, "trackLockup"):
        for it in sec.get("items") or []:
            t = _track_from_item(it)
            if t["title"] and t.get("apple_url"):
                tracks.append(t)
    title = (header.get("title") or "").strip() or kind.title()
    return {
        "id": (parse_apple_url(url) or (None, None, None))[1],
        "kind": kind,
        "title": title,
        "description": (header.get("description") or "").strip()[:1000] or None,
        "cover": _artwork_url(header.get("artwork")),
        "tracks": tracks,
    }


# --------------------------------------------------------------------------- #
#  Download entry point (neutral back half, identical to the Spotify path)
# --------------------------------------------------------------------------- #
def download_apple_track(
    url: str,
    dest_dir: Path,
    quality: str = DEFAULT_QUALITY,
    title: str | None = None,
    artist: str | None = None,
    cover: str | None = None,
) -> dict:
    """Download an Apple Music track as FLAC into ``dest_dir``.

    Returns ``{path, type, filename, title, artist, album, cover}``. Blocking —
    call from a worker thread. Raises SpotiFlacError. The ISRC→Qobuz→FLAC→tag
    tail is the same code the Spotify path runs (imported from spotiflac).
    """
    if not is_apple_track_url(url):
        raise SpotiFlacError("Not an Apple Music track URL")
    quality = quality if quality in VALID_QUALITIES else DEFAULT_QUALITY

    dest_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    album: str | None = None

    with httpx.Client(follow_redirects=True) as client:
        if not title:
            meta = apple_track_meta(client, url)
            title, artist, cover, album = (
                meta["title"], meta["artist"], meta["cover"], meta.get("album"),
            )

        isrc = _resolve_isrc(client, url)
        # Apple's page gives us the album name, and Spotify's embed does not —
        # so this path can feed the candidate scorer one more signal.
        match = _qobuz_track_match(client, isrc, title or "", artist, album)
        if not match:
            raise SpotiFlacError("No matching lossless track found on Qobuz")
        qobuz_id, qobuz_album = match
        album = album or qobuz_album
        stream_url = _community_flac_url(client, qobuz_id, quality)

        # Stream to disk, sniffing the FLAC magic so a JSON error page never
        # lands as a ".flac" (same guard as the Spotify path).
        dest = dest_dir / f"{file_id}.flac"
        with client.stream("GET", stream_url, headers={"User-Agent": _BROWSER_UA}, timeout=120) as r:
            r.raise_for_status()
            first = True
            with open(dest, "wb") as fh:
                for chunk in r.iter_bytes(64 * 1024):
                    if first:
                        if not chunk.startswith(b"fLaC"):
                            fh.close()
                            dest.unlink(missing_ok=True)
                            raise SpotiFlacError("Provider did not return a FLAC stream")
                        first = False
                    fh.write(chunk)
        if first:
            dest.unlink(missing_ok=True)
            raise SpotiFlacError("Empty FLAC stream from provider")

        _tag_flac(client, dest, title, artist, album, cover)

    return {
        "path": str(dest),
        "type": "audio",
        "filename": dest.name,
        "title": title,
        "artist": artist,
        "album": album,
        "cover": cover,
    }
