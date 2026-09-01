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
import logging
import shutil
import subprocess
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

from backend.config import settings
from backend.core.app_settings import cookies_present, get_cookies_path

log = logging.getLogger(__name__)

VALID_MODES = {"video", "audio"}

# Hosts where the network sniffer (core/sniff_media) beats yt-dlp and is tried
# FIRST for video. Threads has no yt-dlp extractor, and even handed the raw CDN
# URL yt-dlp's downloader crawls (~74 s vs <1 s for a direct ranged GET with the
# right Referer). Instagram login-walls yt-dlp on every post now, so without a
# cookie jar that attempt can only fail — while the sniffer pulls the same reel
# logged-out (verified 2026-08-03). yt-dlp stays the fallback, so a cookie user
# keeps the tier that handles what the browser cannot reach. This is just a
# tuning list — the sniffer itself is host-blind and also runs as a universal
# fallback whenever yt-dlp fails on ANY host.
SNIFF_FIRST_HOSTS = ("threads.com", "threads.net", "instagram.com")

# A real download is at least this big; smaller means we grabbed a poster/sprite
# or an error body, not the video.
_MIN_VALID_BYTES = 50_000

# Instagram serves reels as DASH, and its segment URLs carry the byte window in
# the query string. Fetch one and the CDN honours ITS range, not ours: the file
# lands full-size, right content-type, and starts mid-stream. Dropping these
# asks for the whole representation instead.
_BYTE_RANGE_PARAMS = ("bytestart", "byteend")


def _strip_byte_range(url: str) -> str:
    """Remove a DASH segment's byte-window params, if it has any."""
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in _BYTE_RANGE_PARAMS]
    if len(kept) == len(parse_qsl(parts.query, keep_blank_values=True)):
        return url
    return urlunsplit(parts._replace(query=urlencode(kept)))


def _post_permalink(url: str) -> str | None:
    """`url` when it names a single post, else None.

    Only a permalink is worth scoping: a channel page or a homepage has no
    single post to narrow to. The shapes live in `core/permalinks`, shared with
    the renderer, so the two never disagree about what a post URL looks like."""
    from backend.core.permalinks import post_scope

    scope = post_scope(url)
    return scope["url"] if scope else None


def _has_audio_stream(path: Path) -> bool | None:
    """Does this file carry sound? None when ffprobe cannot answer.

    Instagram serves DASH, where the video and the audio are SEPARATE streams.
    The sniffer picks the largest `video/mp4` response on the network, which is
    the video-only representation — so the download succeeds, the file plays,
    and it is silent. Every reel recovered on 2026-08-04 came back mute.

    None rather than False when ffprobe is missing: "I cannot tell" must not be
    treated as "no audio", or a box without ffprobe would reject every download.
    """
    probe = str(settings.FFMPEG_BIN).replace("ffmpeg", "ffprobe")
    try:
        out = subprocess.run(
            [probe, "-v", "quiet", "-select_streams", "a", "-show_entries",
             "stream=codec_type", "-of", "csv=p=0", str(path)],
            capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return b"audio" in out.stdout


def _playable_container(path: Path) -> bool:
    """Does this file begin like a media container a player can open?

    The check that was missing on 2026-08-04: 51 recovered Instagram reels were
    the right size, the right content-type and completely unplayable, because
    each one was a bare `moof` fragment with no `ftyp`/`moov` header in front of
    it. Nothing noticed until a video was clicked. A download that cannot be
    decoded is a failed download, and it should fall through to the next tier
    rather than be filed as a success.
    """
    try:
        with open(path, "rb") as fh:
            head = fh.read(16)
    except OSError:
        return False
    if len(head) < 12:
        return False
    return (
        head[4:8] in (b"ftyp", b"moov", b"mdat")      # MP4 / MOV family
        or head[:4] == b"\x1a\x45\xdf\xa3"            # Matroska / WebM
        or head[:4] == b"RIFF"                        # AVI / WAV
        or head[:4] == b"OggS"                        # Ogg
        or head[:3] == b"ID3" or head[:2] == b"\xff\xfb"  # MP3
        or head[:4] == b"fLaC"
    )

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
    return {
        "path": str(path), "type": memo_type, "filename": path.name,
        "thumbnail_url": thumbnail_url,
        # Reported by EVERY tier, not just the sniffer. A silent video is a
        # host-agnostic failure mode: any DASH source can hand over the
        # video-only representation, and the download looks perfect either way.
        "has_audio": _has_audio_stream(path) if memo_type == "video" else None,
    }


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
    media_url = _strip_byte_range(media_url)
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

    if not _playable_container(dest):
        # Right size, right content-type, and no player can open it. Delete it
        # and fail, so the caller falls through to yt-dlp instead of filing a
        # corrupt file as a success.
        try:
            dest.unlink()
        except Exception:
            pass
        raise LocalizeError(
            "Downloaded media is not a playable container (a stream fragment, "
            "not the whole file)"
        )


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
            settings.FFMPEG_BIN, "-y",
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


def _discard(result: dict | None) -> None:
    """Delete a download a later tier made redundant.

    The ladder now keeps a silent copy alive while it tries the next tier for
    sound, so a successful retry leaves an orphan mp4 behind in FILES_DIR that
    no memo references and nothing will ever clean up. Best-effort: a file that
    will not delete is a wasted megabyte, never a failed download."""
    if not result:
        return
    try:
        Path(result["path"]).unlink()
    except Exception:
        pass


def _is_instagram(url: str) -> bool:
    try:
        return "instagram.com" in urlparse(url).netloc.lower()
    except Exception:
        return False


async def _localize_via_instagram_api(url: str, workspace_id: str) -> dict:
    """Download an Instagram reel/video from its PROGRESSIVE rendition.

    The first tier for Instagram, and the reason reels have sound again.
    Instagram's guest media-info API hands back `video_versions[]` — ordinary
    progressive MP4 files with the audio already muxed in. Every other route
    ends up at the DASH manifest instead, where the picture and the sound are
    separate representations and "download the media on the wire" gets the
    silent half of the clip.

    Resolves anonymously first, then with the cookie jar (same ladder as the
    extractor). Raises LocalizeError when the post is not a video, the API is
    throttled, or the download fails — so the caller falls to the sniffer.
    """
    from backend.core.instagram import fetch_media_info

    cookies = get_cookies_path() if cookies_present() else None
    info = await fetch_media_info(url)
    if info is None and cookies is not None:
        info = await fetch_media_info(url, cookies_path=cookies)
    if info is None:
        raise LocalizeError("Instagram media-info API did not answer (login or rate limit)")

    media_url = info.get("video_url")
    if not media_url:
        # A carousel whose FIRST video slide is the thing worth downloading.
        # A photo-only post has none, and that is not a download at all.
        for slide in (info.get("gallery") or []):
            if isinstance(slide, dict) and slide.get("video_url"):
                media_url = slide["video_url"]
                break
    if not media_url:
        raise LocalizeError("Instagram post carries no video")

    base = Path(settings.FILES_DIR) / workspace_id
    base.mkdir(parents=True, exist_ok=True)
    dest = base / f"{uuid.uuid4()}.mp4"
    shortcode = info.get("shortcode") or ""
    await _download_direct(
        media_url, dest,
        referer=f"https://www.instagram.com/p/{shortcode}/" if shortcode
        else "https://www.instagram.com/",
    )
    return {
        "path": str(dest),
        "type": "video",
        "filename": dest.name,
        "thumbnail_url": info.get("thumbnail"),
        "has_audio": _has_audio_stream(dest),
    }


async def _mux_video_audio(video: Path, audio: Path, dest: Path) -> bool:
    """Join a video-only file and an audio-only file into one playable mp4.

    The repair step for DASH: the page served the picture and the sound as two
    separate downloads, and this is what puts them back together. Stream-copy
    first (instant, lossless); if the audio codec will not sit in an mp4 as-is,
    re-encode just the audio to AAC. Returns False and leaves nothing behind on
    failure, so the caller can keep the silent copy rather than lose the clip.
    """
    from backend.core.video import ffmpeg_available

    if not ffmpeg_available():
        return False

    async def _run(codec_args: list[str]) -> bool:
        proc = await asyncio.create_subprocess_exec(
            settings.FFMPEG_BIN, "-y",
            "-i", str(video),
            "-i", str(audio),
            # Explicit stream mapping: take the picture from input 0 and the
            # sound from input 1. ffmpeg's default selection would pick one
            # stream per type across ALL inputs, which on two video-bearing
            # containers silently drops the one we are here for.
            "-map", "0:v:0",
            "-map", "1:a:0",
            *codec_args,
            "-shortest",
            "-movflags", "+faststart",
            str(dest),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=600)
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
            print(f"[localize] ffmpeg mux: {tail[0]}")
        return ok

    if await _run(["-c", "copy"]):
        return True
    if await _run(["-c:v", "copy", "-c:a", "aac"]):
        return True
    try:
        dest.unlink()
    except Exception:
        pass
    return False


async def _recover_audio(
    info: dict, video_path: Path, base: Path, *, user_agent: str | None
) -> bool | Path:
    """Find the sound for an already-downloaded, silent video and mux it in.

    Called when the file that landed has no audio track — which on a DASH host
    is the normal outcome, not an error: the page served the video and the audio
    as two separate responses and we fetched the bigger one. The sniffer handed
    back every response it saw, so the missing half is usually already in the
    list. Rewrites `video_path` in place on success. Returns False when nothing
    usable is found, leaving the silent file untouched.
    """
    candidates = [
        c for c in (info.get("candidates") or [])
        if c.get("url") and c["url"] != info.get("media_url") and c.get("kind") == "progressive"
    ]
    if not candidates:
        return False
    # Anything the host LABELLED audio first (the reliable signal), then the
    # remaining responses largest-first — a mislabelled Content-Type must not be
    # able to hide the soundtrack. Capped: each probe is a real download.
    ordered = (
        [c for c in candidates if c.get("audio_only")]
        + [c for c in candidates if not c.get("audio_only")]
    )[:3]

    for cand in ordered:
        probe = base / f"{uuid.uuid4()}.audio"
        try:
            await _download_direct(
                cand["url"], probe,
                referer=cand.get("referer"), user_agent=user_agent,
            )
        except LocalizeError:
            continue
        # Trust ffprobe, not the Content-Type: this is the only check that
        # cannot be fooled by a host labelling its streams badly.
        if _has_audio_stream(probe) is not True:
            try:
                probe.unlink()
            except Exception:
                pass
            continue
        muxed = base / f"{uuid.uuid4()}.mp4"
        ok = await _mux_video_audio(video_path, probe, muxed)
        try:
            probe.unlink()
        except Exception:
            pass
        if not ok:
            continue
        # The muxed file IS the download now — take over the original's path so
        # nothing downstream has to know a repair happened.
        try:
            video_path.unlink()
        except Exception:
            pass
        try:
            muxed.replace(video_path)
        except OSError:
            # Replace failed (locked file): keep the muxed copy and let the
            # caller point at it instead of dropping the recovered sound.
            return muxed
        return True
    return False


async def _localize_via_sniff(url: str, workspace_id: str) -> dict:
    """Sniff the page for its real media URL, then fetch it directly.

    OpenMemo's built-in 'download helper': loads the page in the headless
    browser, watches the network for the media file, and downloads it with the
    captured Referer. Raises LocalizeError when nothing fetchable is found (or
    only a streaming manifest, which still needs yt-dlp/ffmpeg to mux) so the
    caller can fall back.

    A progressive download that lands silent is not accepted as-is: DASH hosts
    serve the picture and the sound separately, so the audio half is fetched
    from the sniffer's other candidates and muxed in before returning."""
    from backend.core.sniff_media import sniff_media

    # Scope the capture to the post this URL names. A permalink page is one post
    # inside a feed of other posts, and "the biggest clip on the wire" happily
    # answers with a neighbour's — which is how a six-photo Threads carousel was
    # localized as a stranger's video (2026-08-30). A URL that is not a post
    # permalink scopes to nothing and behaves exactly as before.
    info = await sniff_media(url, scope_permalink=_post_permalink(url))
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

    has_audio = _has_audio_stream(dest)
    if has_audio is False:
        recovered = await _recover_audio(
            info, dest, base, user_agent=info.get("user_agent")
        )
        if recovered:
            if isinstance(recovered, Path):
                dest = recovered
            has_audio = _has_audio_stream(dest)
            print(f"[localize] recovered the audio track for {url}")

    return {
        "path": str(dest),
        "type": "video",
        "filename": dest.name,
        "thumbnail_url": info.get("thumbnail_url"),
        # False only when ffprobe positively found no audio track. None means it
        # could not tell, which the caller must not read as silence.
        "has_audio": has_audio,
    }


async def localize_media(url: str, workspace_id: str, mode: str, quality: int = DEFAULT_QUALITY) -> dict:
    """Download `url` into FILES_DIR/<workspace>. Returns {path,type,filename}.

    Routing (video only — audio conversion always uses yt-dlp+ffmpeg):
      0. Instagram → the guest API's progressive rendition (video+audio in one
         file). Instagram is the host that serves DASH to everything else, so
         asking it for the plain MP4 first is what keeps reels from arriving
         silent; the sniffer and yt-dlp remain behind it.
      1. sniff-first hosts (Threads, …) → network sniffer, yt-dlp on failure
      2. every other host → yt-dlp, network sniffer as a universal fallback

    A tier that produces a video with NO audio track is never accepted while a
    later tier might still have sound: the silent file is held aside and only
    returned if everything below it also fails, because some clips genuinely
    were posted muted and a silent video still beats no video.
    """
    if mode not in VALID_MODES:
        raise LocalizeError(f"Invalid mode: {mode}")

    sniff_first = mode == "video" and _is_sniff_first(url)
    mute_fallback: dict | None = None

    if mode == "video" and _is_instagram(url):
        try:
            pulled = await _localize_via_instagram_api(url, workspace_id)
            if pulled.get("has_audio") is False:
                mute_fallback = pulled
                print(f"[localize] Instagram API rendition for {url} has no audio; trying the sniffer")
            else:
                return pulled
        except LocalizeError as e:
            print(f"[localize] Instagram API tier failed for {url} ({e}); trying the sniffer")

    if sniff_first:
        try:
            sniffed = await _localize_via_sniff(url, workspace_id)
            if sniffed.get("has_audio") is False:
                # Still silent after the sniffer's own audio-recovery pass. yt-dlp
                # muxes DASH streams too, so it is worth the next attempt — but
                # KEEP this file, because some clips are genuinely silent and a
                # failed yt-dlp must not cost us a working video.
                _discard(mute_fallback)
                mute_fallback = sniffed
                print(f"[localize] sniffed video for {url} has no audio; trying yt-dlp for sound")
            else:
                _discard(mute_fallback)
                return sniffed
        except LocalizeError as e:
            print(f"[localize] sniff-first failed for {url} ({e}); trying yt-dlp")

    try:
        pulled = await asyncio.to_thread(_localize_sync, url, workspace_id, mode, quality)
        if mute_fallback is not None and pulled.get("has_audio") is False:
            # Both tiers came back silent, from two independent routes. That is
            # the signature of a clip that was posted without sound, not of a
            # broken download — keep the first copy and drop the duplicate.
            _discard(pulled)
            print(f"[localize] every tier for {url} is silent; the clip has no sound")
            return mute_fallback
        _discard(mute_fallback)
        return pulled
    except LocalizeError as ytdlp_err:
        # A silent video beats no video. The clip may simply have no sound.
        if mute_fallback is not None:
            print(f"[localize] yt-dlp also failed for {url}; keeping the silent copy")
            return mute_fallback
        # Universal fallback: yt-dlp can't pull it (no extractor / blocked) and we
        # didn't already sniff — try the network sniffer once before giving up.
        if mode == "video" and not sniff_first:
            try:
                sniffed = await _localize_via_sniff(url, workspace_id)
                if sniffed.get("has_audio") is False:
                    log.warning(
                        "localize: %s produced a video with no audio track", url
                    )
                return sniffed
            except LocalizeError as sniff_err:
                print(f"[localize] sniff fallback failed for {url}: {sniff_err}")
                # The download helper was the LAST attempt, so surface BOTH
                # reasons — the modal must not blame yt-dlp for a sniff failure.
                raise LocalizeError(
                    f"yt-dlp: {ytdlp_err} | download helper: {sniff_err}"
                ) from sniff_err
        raise
