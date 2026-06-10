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

from backend.config import settings
from backend.core.app_settings import cookies_present, get_cookies_path

VALID_MODES = {"video", "audio"}

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


async def localize_media(url: str, workspace_id: str, mode: str, quality: int = DEFAULT_QUALITY) -> dict:
    """Download `url` into FILES_DIR/<workspace>. Returns {path,type,filename}."""
    if mode not in VALID_MODES:
        raise LocalizeError(f"Invalid mode: {mode}")
    return await asyncio.to_thread(_localize_sync, url, workspace_id, mode, quality)
