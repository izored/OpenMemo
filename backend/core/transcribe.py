"""Local speech-to-text via faster-whisper.

Lazy and dependency-tolerant: the library and the model load on first use, in a
worker thread, so the app boots fine even when faster-whisper is not installed
yet — the transcribe path simply reports an actionable error in that case.

Device / precision auto-detect: CUDA + float16 when a GPU is visible, otherwise
CPU + int8. Override with WHISPER_DEVICE / WHISPER_COMPUTE_TYPE in settings.
faster-whisper is multilingual (~99 languages) and auto-detects the language.
"""
import asyncio
import threading
from pathlib import Path

from backend.config import settings

# Loaded WhisperModel (singleton). Guarded by _model_lock for load; _infer_lock
# serializes actual transcription (a single model is not concurrency-safe).
_model = None
_model_lock = threading.Lock()
_infer_lock = threading.Lock()


class TranscriptionError(Exception):
    """Raised when transcription cannot run (missing dep, bad model, etc.)."""


def _resolve_device() -> tuple[str, str]:
    """Resolve (device, compute_type), honoring 'auto' for both."""
    device = (settings.WHISPER_DEVICE or "auto").lower()
    compute = (settings.WHISPER_COMPUTE_TYPE or "auto").lower()
    if device == "auto":
        try:
            from ctranslate2 import get_cuda_device_count

            device = "cuda" if get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    if compute == "auto":
        compute = "float16" if device == "cuda" else "int8"
    return device, compute


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
        except Exception as e:
            raise TranscriptionError(
                "faster-whisper is not installed. Run: pip install faster-whisper"
            ) from e
        device, compute = _resolve_device()
        try:
            _model = WhisperModel(settings.WHISPER_MODEL, device=device, compute_type=compute)
        except Exception as e:
            # GPU detected but CUDA libs missing / OOM → fall back to CPU int8.
            if device != "cpu":
                try:
                    _model = WhisperModel(settings.WHISPER_MODEL, device="cpu", compute_type="int8")
                except Exception as e2:
                    raise TranscriptionError(f"Failed to load STT model: {e2}") from e2
            else:
                raise TranscriptionError(f"Failed to load STT model: {e}") from e
    return _model


def _clean(text: str) -> str:
    """Tidy whitespace. faster-whisper already punctuates and capitalizes."""
    return " ".join(text.split()).strip()


def fmt_ts(seconds: float) -> str:
    """Format a start time as an inline transcript marker: [mm:ss] or [h:mm:ss].

    These markers are preserved in the stored transcript so on-demand summary
    modes (timestamp/insights/essay) can anchor bullets to a point in time.
    """
    s = max(0, int(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"[{h}:{m:02d}:{sec:02d}]" if h else f"[{m:02d}:{sec:02d}]"


def _transcribe_sync(file_path: str) -> dict:
    model = _get_model()
    with _infer_lock:
        segments, info = model.transcribe(
            file_path,
            beam_size=settings.WHISPER_BEAM_SIZE,
            vad_filter=True,
        )
        # segments is a generator; iterating it performs the work. Keep each
        # segment's start time as an inline [mm:ss] marker, one segment per line.
        lines = []
        for seg in segments:
            txt = _clean(seg.text)
            if txt:
                lines.append(f"{fmt_ts(seg.start)} {txt}")
        text = "\n".join(lines)
    return {"text": text, "language": getattr(info, "language", None)}


async def transcribe_audio(file_path: str) -> dict:
    """Transcribe an audio file → {text, language}. Runs off the event loop."""
    if not Path(file_path).exists():
        raise TranscriptionError("Audio file not found")
    return await asyncio.to_thread(_transcribe_sync, file_path)
