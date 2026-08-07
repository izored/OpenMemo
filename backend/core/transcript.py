"""Extract a transcript for a video/audio memo without re-homing it as the
memo's local file or changing its type.

Two stages, caption-first:

1. **Captions** — ask yt-dlp for the source's own subtitles/closed-captions
   (manual or auto-generated) as WebVTT, *without downloading the media*. Fast,
   free, no Whisper. Works for any yt-dlp host that exposes subs (YouTube,
   Vimeo, Dailymotion, TikTok, …). Parsed into text with inline [mm:ss] markers.

2. **STT fallback** — if the host exposes no captions, run faster-whisper over
   the audio: the memo's own local file when it has one, otherwise an audio
   track downloaded to a TEMP directory and deleted afterwards. The memo keeps
   its original `type` and `file_path` either way — a video memo stays a video
   memo and keeps its player.

If neither stage produces text this raises. It never degrades to the memo's
description: a caption/blurb is not a transcript of what is said.

This is deliberately decoupled from "Make it local" (`localize_media.py`), which
*captures a local file* and (for an explicit audio conversion) changes the memo
type. Transcript extraction never mutates type or file_path. See ADR-004.

Output text carries inline [mm:ss] timestamps so the on-demand summary modes
(timestamp / insights / essay) can anchor to a point in the talk.
"""
import asyncio
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from backend.core.transcribe import fmt_ts, transcribe_audio

# Preferred caption languages, in order. yt-dlp matches these as patterns; the
# trailing wildcards catch regional + auto-generated variants (en-US, en-orig…).
# faster-whisper covers everything else via the STT fallback (multilingual).
_SUB_LANGS = "en.*,en,en-orig"
_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio/best"

_TS_LINE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}"
)
_TAG = re.compile(r"<[^>]+>")


class TranscriptError(Exception):
    """Raised when no transcript can be produced by any stage."""


def _have(binary: str) -> bool:
    return shutil.which(binary) is not None


def _vtt_seconds(h: str, m: str, s: str) -> int:
    return int(h) * 3600 + int(m) * 60 + int(s)


def _parse_vtt(raw: str) -> str:
    """Parse WebVTT into '[mm:ss] text' lines.

    Auto-generated captions roll a sliding window — each cue often repeats the
    previous cue's tail plus a few new words. We strip inline word-timing tags,
    skip cues that add nothing new, and trim the duplicated prefix so the result
    reads as continuous text rather than a stutter.
    """
    out: list[str] = []
    last = ""
    for block in re.split(r"\n\s*\n", raw):
        m = _TS_LINE.search(block)
        if not m:
            continue
        start = _vtt_seconds(m.group(1), m.group(2), m.group(3))
        parts = []
        for ln in block.splitlines():
            if "-->" in ln or ln.strip().upper().startswith("WEBVTT") or ln.startswith(("NOTE", "Kind:", "Language:")):
                continue
            clean = _TAG.sub("", ln).strip()
            if clean:
                parts.append(clean)
        full = " ".join(parts).strip()
        if not full or full == last:
            continue
        # Drop the overlap that auto-subs repeat from the previous cue.
        new = full[len(last):].strip() if last and full.startswith(last) else full
        if new:
            out.append(f"{fmt_ts(start)} {new}")
        last = full
    return "\n".join(out).strip()


def _pull_captions_sync(url: str) -> dict | None:
    """Fetch host captions via yt-dlp (no media download). Return {text, lang}
    or None when the source exposes no usable subtitles."""
    if not _have("yt-dlp"):
        return None
    with tempfile.TemporaryDirectory(prefix="om_subs_") as tmp:
        out_template = str(Path(tmp) / "%(id)s.%(ext)s")
        cmd = [
            "yt-dlp",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs", _SUB_LANGS,
            "--sub-format", "vtt",
            "--no-playlist",
            "-o", out_template,
            url,
        ]
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except Exception:
            return None
        vtts = sorted(Path(tmp).glob("*.vtt"))
        if not vtts:
            return None
        vtt = vtts[0]
        try:
            raw = vtt.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return None
        text = _parse_vtt(raw)
        if not text:
            return None
        # Language code is the middle segment of "<id>.<lang>.vtt".
        lang = vtt.stem.split(".")[-1] if "." in vtt.stem else None
        return {"text": text, "lang": lang}


def _download_audio_temp(url: str) -> dict:
    """Download the audio track to a temp dir. Caller must rmtree the dir."""
    if not _have("yt-dlp"):
        raise TranscriptError("yt-dlp is not installed on the server")
    tmp = tempfile.mkdtemp(prefix="om_stt_")
    out_template = str(Path(tmp) / f"{uuid.uuid4()}.%(ext)s")
    cmd = [
        "yt-dlp",
        "-f", _AUDIO_FORMAT,
        "--no-playlist",
        "--no-part",
        "--print", "after_move:filepath",
        "--no-simulate",
        "-o", out_template,
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        msg = (proc.stderr or proc.stdout or "unknown error").strip().splitlines()
        raise TranscriptError(f"audio download failed: {msg[-1] if msg else 'unknown error'}")
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    if lines and Path(lines[-1]).exists():
        return {"path": lines[-1], "dir": tmp}
    shutil.rmtree(tmp, ignore_errors=True)
    raise TranscriptError("audio download finished but the file was not found")


async def get_transcript(
    url: str | None = None,
    workspace_id: str = "default",
    local_path: str | None = None,
) -> dict:
    """Return {text, lang, source} for a media memo. The single transcript path.

    Stage 1 — host captions, when the memo has a `url`. Fast, free, no Whisper.
    Stage 2 — Whisper STT on `local_path` if the memo already holds a local file
    (nothing to download), otherwise on an audio track pulled to a temp dir and
    deleted afterwards.

    `source` is "captions" or "stt". Raises TranscriptError when no stage yields
    text — the caller must surface that as an error, never fall back to the
    memo's own description (see ADR-004 update).
    """
    if not url and not local_path:
        raise TranscriptError("memo has no local file or source URL to transcribe")

    if url:
        cap = await asyncio.to_thread(_pull_captions_sync, url)
        if cap and cap.get("text"):
            return {"text": cap["text"], "lang": cap.get("lang"), "source": "captions"}

    # No captions: Whisper. A local file is transcribed in place — the memo keeps
    # its file, we just read the audio track out of the container.
    if local_path and Path(local_path).exists():
        result = await transcribe_audio(local_path)
        text = (result.get("text") or "").strip()
        if not text:
            raise TranscriptError("no speech was found in the audio")
        return {"text": text, "lang": result.get("language"), "source": "stt"}

    if not url:
        raise TranscriptError("the memo's local file is missing")

    audio = await asyncio.to_thread(_download_audio_temp, url)
    try:
        result = await transcribe_audio(audio["path"])
        text = (result.get("text") or "").strip()
        if not text:
            raise TranscriptError("no speech was found in the audio")
        return {"text": text, "lang": result.get("language"), "source": "stt"}
    finally:
        shutil.rmtree(audio["dir"], ignore_errors=True)
