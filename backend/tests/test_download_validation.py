"""A download that cannot be played is a failed download.

On 2026-08-04, 51 Instagram reels were recovered, written to disk at the right
size with the right content-type, and filed as successes. Every one was a bare
DASH `moof` fragment with no `ftyp` header in front of it, so no player could
open a single one. Nothing noticed until a video was clicked.
"""
from pathlib import Path

import pytest

from backend.core.localize_media import (
    LocalizeError,
    _download_direct,
    _playable_container,
    _strip_byte_range,
)


def _write(tmp_path: Path, name: str, head: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(head + b"\x00" * 256)
    return p


def test_a_real_mp4_is_playable(tmp_path):
    assert _playable_container(_write(tmp_path, "a.mp4", b"\x00\x00\x00\x20ftypisom"))


def test_a_bare_fragment_is_not(tmp_path):
    """The exact shape of all 51: real bytes, real size, starts mid-stream."""
    assert not _playable_container(_write(tmp_path, "b.mp4", b"\x00\x00\x02\xbcmoof"))


def test_an_html_error_page_is_not(tmp_path):
    assert not _playable_container(_write(tmp_path, "c.mp4", b"<!DOCTYPE html><html>"))


@pytest.mark.parametrize("head", [
    b"\x1a\x45\xdf\xa3",          # webm
    b"RIFF\x00\x00\x00\x00AVI ",  # avi
    b"OggS\x00\x02\x00\x00",      # ogg
    b"fLaC\x00\x00\x00\x22",      # flac
    b"ID3\x04\x00\x00\x00\x00",   # mp3
])
def test_other_containers_are_accepted(tmp_path, head):
    assert _playable_container(_write(tmp_path, "d.bin", head))


def test_a_truncated_file_is_not_playable(tmp_path):
    p = tmp_path / "tiny.mp4"
    p.write_bytes(b"\x00\x00")
    assert not _playable_container(p)


def test_byte_window_params_are_dropped():
    """Instagram's DASH segment URLs carry the window in the query string, and
    the CDN honours ITS range rather than the one we ask for — which is how a
    fragment arrives looking like a whole file."""
    url = "https://cdn.example.com/v.mp4?efg=abc&bytestart=1234&byteend=5678&oh=xyz"
    out = _strip_byte_range(url)
    assert "bytestart" not in out and "byteend" not in out
    assert "efg=abc" in out and "oh=xyz" in out


def test_a_url_without_a_byte_window_is_untouched():
    url = "https://cdn.example.com/v.mp4?efg=abc"
    assert _strip_byte_range(url) == url


@pytest.mark.asyncio
async def test_an_unplayable_download_fails_and_leaves_nothing_behind(tmp_path, monkeypatch):
    """It must raise, so the caller falls through to yt-dlp, and it must not
    leave the corrupt file on disk pretending to be the memo's media."""
    import httpx

    fragment = b"\x00\x00\x02\xbcmoof" + b"\x00" * 100_000

    class _Resp:
        status_code = 200

        async def aiter_bytes(self, _n):
            yield fragment

    class _Stream:
        async def __aenter__(self):
            return _Resp()

        async def __aexit__(self, *a):
            return False

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, *a, **k):
            return _Stream()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)

    dest = tmp_path / "out.mp4"
    with pytest.raises(LocalizeError) as e:
        await _download_direct("https://cdn.example.com/v.mp4", dest)

    assert "playable" in str(e.value)
    assert not dest.exists()


def test_a_silent_video_is_detected_not_shipped(tmp_path, monkeypatch):
    """Instagram serves DASH: video and audio are separate streams, and the
    sniffer picks the largest video/mp4 on the wire — the video-only one. Every
    reel recovered on 2026-08-04 came back mute and nothing noticed."""
    import subprocess as sp

    from backend.core import localize_media

    class _Out:
        returncode = 0
        stdout = b""            # ffprobe found no audio streams

    monkeypatch.setattr(sp, "run", lambda *a, **k: _Out())
    assert localize_media._has_audio_stream(tmp_path / "x.mp4") is False


def test_audio_present_is_reported(tmp_path, monkeypatch):
    import subprocess as sp

    from backend.core import localize_media

    class _Out:
        returncode = 0
        stdout = b"audio\n"

    monkeypatch.setattr(sp, "run", lambda *a, **k: _Out())
    assert localize_media._has_audio_stream(tmp_path / "x.mp4") is True


def test_no_ffprobe_means_unknown_not_silent(tmp_path, monkeypatch):
    """"I cannot tell" must never read as "no audio", or a box without ffprobe
    would reject every download it makes."""
    import subprocess as sp

    from backend.core import localize_media

    def _boom(*_a, **_k):
        raise OSError("ffprobe not found")

    monkeypatch.setattr(sp, "run", _boom)
    assert localize_media._has_audio_stream(tmp_path / "x.mp4") is None
