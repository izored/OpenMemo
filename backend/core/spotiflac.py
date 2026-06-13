"""SpotiFLAC integration — lossless FLAC for Spotify links, no account needed.

Ports the auth-free download chain from https://github.com/spotbye/SpotiFLAC
(MIT) into Python. The original is a Go/Wails desktop app; this re-implements
only the happy path we need, server-side:

    Spotify URL
      → open.spotify.com embed (__NEXT_DATA__)        title / artist / cover
      → song.link (Odesli) / Deezer                   ISRC + provider ids
      → signed Qobuz public API (embedded app creds)  Qobuz track id
      → SpotiFLAC community endpoint (/api/dl)         direct FLAC stream URL
      → download to FILES_DIR

No Spotify token / TOTP is involved — metadata comes from the public embed,
and the lossless audio comes from the community Qobuz provider, which returns
a *direct* FLAC URL (the Tidal/Amazon community providers hand back encrypted
MP4/DASH that would need CENC decryption + ffmpeg, so they are intentionally
left out — the resolver is provider-pluggable for adding them later).

The community endpoint + api key are AES-GCM obfuscated in the upstream binary.
The decrypted values are inlined below; they were derived with (SHA-256 of the
seed parts → AES-256-GCM key, AAD as shown) and rarely rotate. To re-derive if
upstream changes, see backend/community_*.go in the SpotiFLAC repo.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx

# --- SpotiFLAC community provider (decrypted from the upstream binary) ---
# Source: spotbye/SpotiFLAC backend/community_endpoints.go + community_apikey.go.
_COMMUNITY_API_KEY = "explore-obscure-chivalry-travesty-blinks"
_QOBUZ_COMMUNITY_URL = "https://qbz-foss.spotbye.qzz.io/api/dl"
# Direct-FLAC provider only for now. Tidal/Amazon return encrypted streams.
#   "https://tdl-foss.spotbye.qzz.io/api/dl"  (Tidal — DASH/CENC)
#   "https://amz-foss.spotbye.qzz.io/api/dl"  (Amazon — encrypted MP4)

# --- Qobuz public API (embedded default app credentials, like SpotiFLAC) ---
_QOBUZ_API_BASE = "https://www.qobuz.com/api.json/0.2"
_QOBUZ_APP_ID = "712109809"
_QOBUZ_APP_SECRET = "589be88e4538daea11f509d29e4a23b1"

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)

# Valid Qobuz community qualities. "16" = CD lossless, "24" = hi-res. We always
# ask for 24 and downgrade to 16 in `_community_flac_url` when the release has no
# hi-res master (the community relay 400s instead of falling back server-side).
VALID_QUALITIES = {"16", "24"}
DEFAULT_QUALITY = "24"
_FALLBACK_QUALITY = "16"

_COMMUNITY_MAX_RETRIES = 6
_COMMUNITY_FALLBACK_WAIT = 30.0

_SPOTIFY_URL_RE = re.compile(
    r"(?:open\.spotify\.com/(?:intl-[a-z]{2}/)?|spotify:)"
    r"(track|album|playlist)[:/]([A-Za-z0-9]+)",
    re.IGNORECASE,
)


class SpotiFlacError(Exception):
    """Raised when a Spotify link cannot be turned into a downloadable file."""


# --------------------------------------------------------------------------- #
#  URL parsing
# --------------------------------------------------------------------------- #
def parse_spotify_url(url: str) -> tuple[str, str] | None:
    """Return ``(kind, spotify_id)`` for a Spotify track/album/playlist URL.

    Accepts the web URL, the ``intl-xx`` localized variant, and the
    ``spotify:track:…`` URI form. Returns None for anything else.
    """
    if not url:
        return None
    m = _SPOTIFY_URL_RE.search(url.strip())
    if not m:
        return None
    return m.group(1).lower(), m.group(2)


def is_spotify_url(url: str | None) -> bool:
    return bool(url) and parse_spotify_url(url) is not None


def is_spotify_track_url(url: str | None) -> bool:
    parsed = parse_spotify_url(url) if url else None
    return bool(parsed and parsed[0] == "track")


def spotify_track_url(track_id: str) -> str:
    return f"https://open.spotify.com/track/{track_id}"


# --------------------------------------------------------------------------- #
#  Spotify metadata via the public embed (no auth)
# --------------------------------------------------------------------------- #
def _embed_entity(client: httpx.Client, kind: str, spotify_id: str) -> dict:
    """Fetch the ``__NEXT_DATA__`` entity from the public Spotify embed page."""
    url = f"https://open.spotify.com/embed/{kind}/{spotify_id}"
    resp = client.get(url, headers={"User-Agent": _BROWSER_UA}, timeout=30)
    resp.raise_for_status()
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        resp.text,
        re.S,
    )
    if not m:
        raise SpotiFlacError("Spotify embed returned no metadata")
    try:
        data = json.loads(m.group(1))
        return data["props"]["pageProps"]["state"]["data"]["entity"]
    except (KeyError, ValueError) as e:
        raise SpotiFlacError(f"Unexpected Spotify embed shape: {e}") from e


def _cover_from_entity(entity: dict) -> str | None:
    """Largest cover-art URL from an embed entity (or track item)."""
    sources = (entity.get("coverArt") or {}).get("sources") or []
    if not sources:
        vi = entity.get("visualIdentity") or {}
        sources = vi.get("image") or []
    best = None
    best_w = -1
    for s in sources:
        w = s.get("maxWidth") or s.get("width") or 0
        if s.get("url") and w >= best_w:
            best, best_w = s["url"], w
    return best


def _track_from_embed_item(item: dict) -> dict:
    """Normalize one embed trackList item → {id,title,artist,spotify_url,cover}."""
    uri = item.get("uri") or ""
    tid = uri.split(":")[-1] if uri.startswith("spotify:track:") else (item.get("id") or "")
    # subtitle is "Artist A, Artist B"; trim odd whitespace the embed sometimes adds.
    artist = (item.get("subtitle") or "").strip() or None
    return {
        "id": tid,
        "title": (item.get("title") or "").strip(),
        "artist": artist,
        "spotify_url": spotify_track_url(tid) if tid else None,
        "cover": _cover_from_entity(item),
    }


def spotify_track_meta(client: httpx.Client, track_id: str) -> dict:
    """Title / artist / cover for a single Spotify track."""
    entity = _embed_entity(client, "track", track_id)
    artist = (entity.get("subtitle") or "").strip() or None
    if not artist:
        artists = entity.get("artists") or []
        artist = ", ".join(a.get("name", "") for a in artists if a.get("name")) or None
    return {
        "id": track_id,
        "title": (entity.get("title") or "").strip() or "Unknown track",
        "artist": artist,
        "spotify_url": spotify_track_url(track_id),
        "cover": _cover_from_entity(entity),
    }


def spotify_collection_meta(client: httpx.Client, kind: str, spotify_id: str) -> dict:
    """Title / cover / track list for a Spotify album or playlist.

    The public embed caps the track list (≈50 for big playlists, full for most
    albums). That is plenty for the "save this playlist" flow; the cap is the
    same tradeoff the upstream app accepts for the no-auth path.
    """
    entity = _embed_entity(client, kind, spotify_id)
    items = entity.get("trackList") or []
    tracks = [t for t in (_track_from_embed_item(i) for i in items) if t["id"]]
    return {
        "id": spotify_id,
        "kind": kind,
        "title": (entity.get("title") or "").strip() or kind.title(),
        "description": (entity.get("description") or "").strip()[:1000] or None,
        "cover": _cover_from_entity(entity),
        "tracks": tracks,
    }


# --------------------------------------------------------------------------- #
#  ISRC + provider resolution (song.link / Deezer)
# --------------------------------------------------------------------------- #
def _songlink(client: httpx.Client, spotify_url: str) -> dict:
    """Odesli links for a Spotify URL → {isrc, deezer_id, ...} (best effort)."""
    out: dict = {}
    try:
        r = client.get(
            "https://api.song.link/v1-alpha.1/links?url=" + quote(spotify_url, safe=""),
            headers={"User-Agent": _BROWSER_UA},
            timeout=30,
        )
        r.raise_for_status()
        ebi = r.json().get("entitiesByUniqueId", {})
    except Exception:
        return out
    for key, ent in ebi.items():
        platform = key.split("::")[0].upper()
        if platform == "DEEZER_SONG" and "deezer_id" not in out:
            out["deezer_id"] = ent.get("id")
        if not out.get("isrc") and ent.get("isrc"):
            out["isrc"] = ent["isrc"]
    return out


def _isrc_via_deezer(client: httpx.Client, deezer_id: str) -> str | None:
    try:
        r = client.get(f"https://api.deezer.com/track/{deezer_id}", timeout=30)
        r.raise_for_status()
        return r.json().get("isrc") or None
    except Exception:
        return None


def _resolve_isrc(client: httpx.Client, spotify_url: str) -> str | None:
    links = _songlink(client, spotify_url)
    if links.get("isrc"):
        return links["isrc"]
    if links.get("deezer_id"):
        return _isrc_via_deezer(client, str(links["deezer_id"]))
    return None


# --------------------------------------------------------------------------- #
#  Qobuz signed public API → track id
# --------------------------------------------------------------------------- #
def _qobuz_signature(path: str, params: dict[str, str], ts: str) -> str:
    """MD5 request signature, per SpotiFLAC's qobuz_api.go."""
    norm = path.replace("/", "")
    parts = [norm]
    for key in sorted(params):
        if key in ("app_id", "request_ts", "request_sig"):
            continue
        parts.append(f"{key}{params[key]}")
    parts.append(ts)
    parts.append(_QOBUZ_APP_SECRET)
    return hashlib.md5("".join(parts).encode()).hexdigest()


def _qobuz_call(client: httpx.Client, path: str, params: dict[str, str]) -> dict:
    ts = str(int(time.time()))
    signed = dict(params)
    signed["app_id"] = _QOBUZ_APP_ID
    signed["request_ts"] = ts
    signed["request_sig"] = _qobuz_signature(path, params, ts)
    r = client.get(
        f"{_QOBUZ_API_BASE}/{path}",
        params=signed,
        headers={"User-Agent": _BROWSER_UA, "Accept": "application/json", "X-App-Id": _QOBUZ_APP_ID},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def _qobuz_track_match(client: httpx.Client, isrc: str | None, title: str, artist: str | None) -> tuple[str, str | None] | None:
    """Find a Qobuz track by ISRC first, then by 'title artist' text search.

    Returns ``(track_id, album_title)`` — the album name rides along because
    the search result already carries it and nothing else in the chain does
    (the Spotify embed has no album field, the FLAC arrives untagged).
    """
    queries = []
    if isrc:
        queries.append(isrc)
    text = " ".join(p for p in (title, artist) if p).strip()
    if text:
        queries.append(text)
    for query in queries:
        try:
            data = _qobuz_call(client, "track/search", {"query": query, "limit": "5"})
        except Exception:
            continue
        items = (data.get("tracks") or {}).get("items") or []
        if items:
            album = ((items[0].get("album") or {}).get("title") or "").strip() or None
            return str(items[0]["id"]), album
    return None


# --------------------------------------------------------------------------- #
#  Community endpoint → direct FLAC URL
# --------------------------------------------------------------------------- #
def _community_flac_url(client: httpx.Client, qobuz_id: str, quality: str) -> str:
    """POST a Qobuz track id to the community endpoint → direct FLAC URL.

    Always asks for hi-res (24-bit) and **downgrades to 16-bit CD on the fly**
    when the release has no hi-res master: the community relay answers such a
    request with a 400 rather than falling back server-side, so we drop to "16"
    once and retry. Mirrors SpotiFLAC's doCommunityRequest 429 handling (respect
    Retry-After, bounded retries) since the endpoint is shared and rate-limited.
    """
    quality = quality if quality in VALID_QUALITIES else DEFAULT_QUALITY
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-api-key": _COMMUNITY_API_KEY,
        "User-Agent": "SpotiFLAC",
    }
    payload = {"id": str(qobuz_id), "quality": quality}
    last_status = None
    downgraded = False
    for attempt in range(_COMMUNITY_MAX_RETRIES + 1):
        resp = client.post(_QOBUZ_COMMUNITY_URL, json=payload, headers=headers, timeout=60)
        last_status = resp.status_code
        if resp.status_code == 429:
            if attempt == _COMMUNITY_MAX_RETRIES:
                break
            ra = resp.headers.get("Retry-After")
            wait = _COMMUNITY_FALLBACK_WAIT
            if ra and ra.isdigit():
                wait = float(ra) + 0.25
            time.sleep(min(wait, 60.0))
            continue
        if resp.status_code == 200:
            url = _extract_stream_url(resp.json())
            if not url:
                raise SpotiFlacError("No streamable URL in Qobuz community response")
            return url
        # Non-200, non-429: a hi-res ask for a CD-only release 400s here. Drop to
        # 16-bit once and retry; anything else (or a repeat) is a real failure.
        if quality == "24" and not downgraded:
            quality = _FALLBACK_QUALITY
            payload["quality"] = quality
            downgraded = True
            continue
        raise SpotiFlacError(f"Qobuz community API returned {resp.status_code}")
    raise SpotiFlacError(f"Qobuz community API rate limited (last status {last_status})")


def _extract_stream_url(body: dict) -> str | None:
    for candidate in (
        body.get("download_url"),
        body.get("url"),
        (body.get("data") or {}).get("download_url"),
        (body.get("data") or {}).get("url"),
    ):
        if isinstance(candidate, str) and candidate.startswith("http"):
            return candidate
    return None


# --------------------------------------------------------------------------- #
#  Public entry points
# --------------------------------------------------------------------------- #
def resolve_flac_url(spotify_url: str, quality: str = DEFAULT_QUALITY,
                     title: str | None = None, artist: str | None = None) -> str:
    """Resolve a Spotify track URL to a direct FLAC stream URL.

    Caller may pass title/artist to skip the embed lookup (the playlist path
    already has them). Raises SpotiFlacError when no lossless source is found.
    """
    parsed = parse_spotify_url(spotify_url)
    if not parsed or parsed[0] != "track":
        raise SpotiFlacError("Not a Spotify track URL")
    track_id = parsed[1]
    with httpx.Client(follow_redirects=True) as client:
        if not title:
            meta = spotify_track_meta(client, track_id)
            title, artist = meta["title"], meta["artist"]
        isrc = _resolve_isrc(client, spotify_url)
        match = _qobuz_track_match(client, isrc, title or "", artist)
        if not match:
            raise SpotiFlacError("No matching lossless track found on Qobuz")
        return _community_flac_url(client, match[0], quality)


def download_spotify_track(
    spotify_url: str,
    dest_dir: Path,
    quality: str = DEFAULT_QUALITY,
    title: str | None = None,
    artist: str | None = None,
    cover: str | None = None,
) -> dict:
    """Download a Spotify track as FLAC into ``dest_dir``.

    Returns ``{path, type, filename, title, artist, album, cover}``. Blocking —
    call from a worker thread (see localize_spotify_task). Raises SpotiFlacError.
    """
    parsed = parse_spotify_url(spotify_url)
    if not parsed or parsed[0] != "track":
        raise SpotiFlacError("Not a Spotify track URL")
    track_id = parsed[1]
    quality = quality if quality in VALID_QUALITIES else DEFAULT_QUALITY

    dest_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())

    with httpx.Client(follow_redirects=True) as client:
        if not title:
            meta = spotify_track_meta(client, track_id)
            title, artist, cover = meta["title"], meta["artist"], meta["cover"]

        isrc = _resolve_isrc(client, spotify_url)
        match = _qobuz_track_match(client, isrc, title or "", artist)
        if not match:
            raise SpotiFlacError("No matching lossless track found on Qobuz")
        qobuz_id, album = match
        stream_url = _community_flac_url(client, qobuz_id, quality)

        # Stream the FLAC to disk. The community URL points at a CDN; sniff the
        # magic bytes so a stray JSON error page never lands as a ".flac".
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
        if first:  # never wrote anything
            dest.unlink(missing_ok=True)
            raise SpotiFlacError("Empty FLAC stream from provider")

        # The CDN serves the FLAC with zero tags and no art — write the
        # metadata we resolved along the way, so the file keeps its identity
        # outside openMemo (exports, other players). Never fatal: a tagging
        # hiccup must not throw away a finished download.
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


def _tag_flac(client: httpx.Client, path: Path, title: str | None,
              artist: str | None, album: str | None, cover_url: str | None) -> None:
    """Write Vorbis tags + embedded cover art onto a freshly downloaded FLAC."""
    try:
        from mutagen.flac import FLAC, Picture

        audio = FLAC(str(path))
        if title:
            audio["title"] = title
        if artist:
            audio["artist"] = artist
        if album:
            audio["album"] = album
        if cover_url and cover_url.startswith("http"):
            try:
                r = client.get(cover_url, headers={"User-Agent": _BROWSER_UA}, timeout=30)
                r.raise_for_status()
                pic = Picture()
                pic.type = 3  # front cover
                pic.mime = r.headers.get("Content-Type", "image/jpeg").split(";")[0]
                pic.data = r.content
                audio.add_picture(pic)
            except Exception:
                pass  # art is a bonus; tags alone are still worth saving
        audio.save()
    except Exception as e:
        print(f"FLAC tagging failed for {path.name}: {e}")
