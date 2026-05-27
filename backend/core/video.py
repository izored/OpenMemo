"""Video helpers — thumbnail extraction via ffmpeg subprocess.

ffmpeg is invoked as a separate process. The uploaded video itself is never
decoded inside the Python process and is only read by ffmpeg, which only
emits a single JPEG frame to a fixed destination path.
"""

import asyncio
import shutil
from pathlib import Path


def ffmpeg_available() -> bool:
    """Return True if `ffmpeg` is on PATH. Cached at first call site only —
    callers should treat this as cheap (it's just a PATH lookup)."""
    return shutil.which("ffmpeg") is not None


async def extract_video_thumbnail(
    video_path: str | Path,
    out_path: str | Path,
    seek_seconds: float = 1.0,
    width: int = 480,
    timeout: float = 15.0,
) -> bool:
    """Pull a single frame from `video_path` into `out_path` (JPEG).

    Returns True on success. Falls back to frame 0 if seeking past the end
    of a very short clip fails. Never raises — call sites already treat a
    missing thumbnail as "no thumb" and move on.
    """
    if not ffmpeg_available():
        return False

    video_path = str(video_path)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    async def _run(ss: float) -> bool:
        # -ss BEFORE -i for fast seek (decodes only from the GOP at `ss`).
        # -frames:v 1 → single frame. Scale keeps aspect ratio, even height.
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-ss", f"{ss:.2f}",
            "-i", video_path,
            "-frames:v", "1",
            "-vf", f"scale={width}:-2",
            "-q:v", "4",
            str(out_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return False
        return proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0

    if await _run(seek_seconds):
        return True
    # Retry from start — handles videos shorter than `seek_seconds`.
    return await _run(0.0)
