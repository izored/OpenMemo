"""Download a remote video/audio source locally via yt-dlp ("Make it local").

Turns a link memo (YouTube, Vimeo, social video, or any yt-dlp-supported URL)
into a self-hosted memo whose media file lives under FILES_DIR — so it keeps
working even if the original is deleted or goes private.

Modes:
    video — best capped-quality video+audio (mp4 preferred)
    audio — audio-only (m4a/opus); an EXPLICIT video→audio "podcast" conversion

Transcript extraction is a separate, non-destructive path (`core/transcript.py`,
see ADR-004) — it never re-homes the file or changes the memo type, so "Make it
local → audio" is now purely a deliberate audio conversion, not a transcript
side door.

Everything runs in a worker thread (yt-dlp is blocking). yt-dlp + ffmpeg are
already required by the extractor / video-thumbnail paths.
"""
import asyncio
import shutil
import subprocess
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

from backend.config import settings
from backend.core.app_settings import cookies_present, get_cookies_path

VALID_MODES = {"video", "audio"}

# Hosts where the network sniffer (core/sniff_media) beats yt-dlp and is tried
# FIRST for video. Threads has no yt-dlp extractor, and even handed the raw CDN
# URL yt-dlp's downloader crawls (~74 s vs <1 s for a direct ranged GET with the
# right Referer). This is just a tuning list — the sniffer itself is host-blind
# and also runs as a universal fallback whenever yt-dlp fails on ANY host.
SNIFF_FIRST_HOSTS = ("threads.com", "threads.net")

# A real download is at least this big; smaller means we grabbed a poster/sprite
# or an error body, not the video.
_MIN_VALID_BYTES = 50_000

_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _is_sniff_first(url: str) -> bool:
    """True when the URL's host is on the sniff-first tuning list."""
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return False
    return any(h in host for h in SNIFF_FIRST_HOSTS)

# User-selectable video quality caps (OPNMMO-0022). 1080 stays the default so
# a casual "make it local" never fills the disk; 4K is an explicit choice.
VALID_QUALITIES = {720, 1080, 1440, 2160}
DEFAULT_QUALITY = 1080

_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio/best"


def _video_format(quality: int) -> str:
    """yt-dlp format selector capped at `quality` pixels of height.

    mp4+m4a is preferred for native browser playback, but above 1080p most
    hosts (YouTube included) only serve VP9/AV1 — so the selector falls back
    to any codec at the requested height before degrading the resolution.
    The merge step still remuxes into an mp4 container.
    """
    q = quality if quality in VALID_QUALITIES else DEFAULT_QUALITY
    return (
        f"bestvideo[height<={q}][ext=mp4]+bestaudio[ext=m4a]"
        f"/bestvideo[height<={q}]+bestaudio"
        f"/best[height<={q}]/best"
    )


class LocalizeError(Exception):
    """Raised when the download cannot be completed."""


def _have(binary: str) -> bool:
    return shutil.which(binary) is not None


def _cookie_args() -> list[str]:
    """`--cookies <jar>` when a cookie jar is configured, else nothing.

    Single source of yt-dlp auth — provider-agnostic, so age-restricted /
    private / login-gated sources work the same for every host (ADR-001).
    """
    if cookies_present():
        return ["--cookies", str(get_cookies_path())]
    return []


def _run_ytdlp(url: str, out_template: str, mode: str, quality: int = DEFAULT_QUALITY) -> Path:
    """Invoke yt-dlp, return the path to the downloaded file. Blocking."""
    if not _have("yt-dlp"):
        raise LocalizeError("yt-dlp is not installed on the server")

    fmt = _AUDIO_FORMAT if mode == "audio" else _video_format(quality)
    cmd = [
        "yt-dlp",
        "-f", fmt,
        "--no-playlist",
        "--no-part",
        *_cookie_args(),
        # Print the FINAL filename (after any merge/convert) so we can locate it.
        "--print", "after_move:filepath",
        "--no-simulate",
        "-o", out_template,
        url,
    ]
    # Merge to mp4 for video so the browser can always play it.
    if mode == "video":
        cmd[1:1] = ["--merge-output-format", "mp4"]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "unknown error").strip().splitlines()
        raise LocalizeError(f"yt-dlp failed: {msg[-1] if msg else 'unknown error'}")

    # The printed path is the last non-empty stdout line.
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    if lines:
        p = Path(lines[-1])
        if p.exists():
            return p
    raise LocalizeError("Download finished but the output file was not found")


def _get_thumbnail_url(url: str) -> str | None:
    """Ask yt-dlp for the thumbnail URL without downloading anything."""
    if not _have("yt-dlp"):
        return None
    try:
        proc = subprocess.run(
            ["yt-dlp", "--no-playlist", *_cookie_args(), "--print", "thumbnail", "--simulate", url],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode == 0:
            line = proc.stdout.strip().splitlines()[-1].strip() if proc.stdout.strip() else ""
            if line.startswith("http"):
                return line
    except Exception:
        pass
    return None


def _localize_sync(url: str, workspace_id: str, mode: str, quality: int) -> dict:
    base = Path(settings.FILES_DIR) / workspace_id
    base.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    # yt-dlp fills in the real extension.
    out_template = str(base / f"{file_id}.%(ext)s")

    path = _run_ytdlp(url, out_template, mode, quality)
    memo_type = "audio" if mode == "audio" else "video"
    thumbnail_url = _get_thumbnail_url(url) if memo_type == "video" else None
    return {"path": str(path), "type": memo_type, "filename": path.name, "thumbnail_url": thumbnail_url}


async def _download_direct(
    media_url: str, dest: Path, *, referer: str | None = None, user_agent: str | None = None
) -> None:
    """Stream a CDN media URL straight to `dest` — the fast 'curl with Referer' path.

    A single ranged GET (`Range: bytes=0-`) with the Referer the page used pulls
    the whole file at full CDN speed, sidestepping yt-dlp's slow generic
    downloader. Raises LocalizeError on any failure or a suspiciously small file.
    """
    headers = {
        "User-Agent": user_agent or _DEFAULT_UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Range": "bytes=0-",
        "Sec-Fetch-Dest": "video",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
    }
    if referer:
        headers["Referer"] = referer
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=30.0), follow_redirects=True
        ) as client:
            async with client.stream("GET", media_url, headers=headers) as resp:
                if resp.status_code >= 400:
                    raise LocalizeError(f"CDN returned HTTP {resp.status_code}")
                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(65536):
                        f.write(chunk)
    except LocalizeError:
        raise
    except Exception as e:
        raise LocalizeError(f"Direct download failed: {e}")

    if not dest.exists() or dest.stat().st_size < _MIN_VALID_BYTES:
        try:
            dest.unlink()
        except Exception:
            pass
        raise LocalizeError("Downloaded media was empty or too small")


async def _download_hls(
    manifest_url: str, dest: Path, *, referer: str | None = None, user_agent: str | None = None
) -> None:
    """Mux an HLS (.m3u8) / DASH (.mpd) manifest into a single mp4 via ffmpeg.

    The sniffer hands back the manifest URL when a page streams instead of
    serving one progressive file. ffmpeg fetches every segment (carrying the
    Referer the page used, so the CDN serves us) and remuxes them losslessly.
    Tries a stream copy first; if the source codecs will not sit in an mp4 as-is
    (some TS/ADTS streams), it retries transcoding audio to AAC so the result is
    always browser-playable. Raises LocalizeError on failure."""
    from backend.core.video import ffmpeg_available

    if not ffmpeg_available():
        raise LocalizeError("ffmpeg is not installed on the server")

    ua = user_agent or _DEFAULT_UA
    header_lines = [f"User-Agent: {ua}"]
    if referer:
        header_lines.append(f"Referer: {referer}")
    headers = "\r\n".join(header_lines) + "\r\n"

    async def _run(codec_args: list[str]) -> bool:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            # -headers covers Referer; -user_agent sets the UA the segment
            # fetches use. ffmpeg auto-selects one video + one audio stream.
            "-headers", headers,
            "-user_agent", ua,
            "-i", manifest_url,
            *codec_args,
            "-movflags", "+faststart",
            str(dest),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=1800)
        except asyncio.TimeoutError:
            proc.kill()
            return False
        ok = (
            proc.returncode == 0
            and dest.exists()
            and dest.stat().st_size >= _MIN_VALID_BYTES
        )
        if not ok and err:
            tail = err.decode("utf-8", "ignore").strip().splitlines()[-1:] or [""]
            print(f"[localize] ffmpeg HLS/DASH: {tail[0]}")
        return ok

    if await _run(["-c", "copy"]):           # 1) lossless remux
        return
    if await _run(["-c:v", "copy", "-c:a", "aac"]):  # 2) transcode audio if needed
        return

    try:
        dest.unlink()
    except Exception:
        pass
    raise LocalizeError("HLS/DASH mux via ffmpeg failed")


async def _localize_via_sniff(url: str, workspace_id: str) -> dict:
    """Sniff the page for its real media URL, then fetch it directly.

    OpenMemo's built-in 'download helper': loads the page in the headless
    browser, watches the network for the media file, and downloads it with the
    captured Referer. Raises LocalizeError when nothing fetchable is found (or
    only a streaming manifest, which still needs yt-dlp/ffmpeg to mux) so the
    caller can fall back."""
    from backend.core.sniff_media import sniff_media

    info = await sniff_media(url)
    if not info or not info.get("media_url"):
        raise LocalizeError("No downloadable media stream found on the page")

    base = Path(settings.FILES_DIR) / workspace_id
    base.mkdir(parents=True, exist_ok=True)
    dest = base / f"{uuid.uuid4()}.mp4"
    if info.get("kind") == "manifest":
        # HLS/DASH — ffmpeg fetches + muxes the segments into one mp4.
        await _download_hls(
            info["media_url"], dest,
            referer=info.get("referer"), user_agent=info.get("user_agent"),
        )
    else:
        # Progressive single file — direct ranged GET (the fast path).
        await _download_direct(
            info["media_url"], dest,
            referer=info.get("referer"), user_agent=info.get("user_agent"),
        )
    return {
        "path": str(dest),
        "type": "video",
        "filename": dest.name,
        "thumbnail_url": info.get("thumbnail_url"),
    }


async def localize_media(url: str, workspace_id: str, mode: str, quality: int = DEFAULT_QUALITY) -> dict:
    """Download `url` into FILES_DIR/<workspace>. Returns {path,type,filename}.

    Routing (video only — audio conversion always uses yt-dlp+ffmpeg):
      1. sniff-first hosts (Threads, …) → network sniffer, yt-dlp on failure
      2. every other host → yt-dlp, network sniffer as a universal fallback
    """
    if mode not in VALID_MODES:
        raise LocalizeError(f"Invalid mode: {mode}")

    sniff_first = mode == "video" and _is_sniff_first(url)
    if sniff_first:
        try:
            return await _localize_via_sniff(url, workspace_id)
        except LocalizeError as e:
            print(f"[localize] sniff-first failed for {url} ({e}); trying yt-dlp")

    try:
        return await asyncio.to_thread(_localize_sync, url, workspace_id, mode, quality)
    except LocalizeError:
        # Universal fallback: yt-dlp can't pull it (no extractor / blocked) and we
        # didn't already sniff — try the network sniffer once before giving up.
        if mode == "video" and not sniff_first:
            try:
                return await _localize_via_sniff(url, workspace_id)
            except LocalizeError as e:
                print(f"[localize] sniff fallback failed for {url}: {e}")
        raise
