"""Instagram reels must arrive with their sound.

Instagram serves reels as DASH: the picture and the sound are SEPARATE
representations on the network. Every route that asks "what is the biggest
media response on this page" therefore gets the video-only half, downloads it
successfully, and files a silent memo. That is what kept happening.

Three things fixed it, and each is pinned here:
  1. the guest media-info API's `video_versions[]` — ordinary progressive MP4s
     with the audio already muxed in — became the FIRST download tier
  2. the sniffer now hands back every media response it saw, not just the
     biggest, and never mistakes an audio-only response for the video
  3. a download that lands silent has its audio fetched from those other
     candidates and muxed back in before it is accepted
"""
from pathlib import Path

import pytest

from backend.core.instagram import _best_video, _item_to_slide
from backend.core.sniff_media import _is_audio_ctype
from backend.core import localize_media


# --- 1. the progressive rendition, which is the one that has sound ----------

def test_the_highest_resolution_rendition_wins():
    """`video_versions` is keyed by an opaque `type` code whose order is not
    guaranteed, so taking [0] can hand back 480p with 1080p sitting right
    there."""
    item = {
        "media_type": 2,
        "image_versions2": {"candidates": [{"url": "https://cdn/poster.jpg"}]},
        "video_versions": [
            {"url": "https://cdn/480.mp4", "width": 480, "height": 852},
            {"url": "https://cdn/1080.mp4", "width": 1080, "height": 1920},
            {"url": "https://cdn/720.mp4", "width": 720, "height": 1280},
        ],
    }
    assert _best_video(item) == "https://cdn/1080.mp4"
    assert _item_to_slide(item)["video_url"] == "https://cdn/1080.mp4"


def test_a_rendition_without_dimensions_is_still_usable():
    """Older payloads omit width/height. A URL with no size beats no URL."""
    assert _best_video({"video_versions": [{"url": "https://cdn/v.mp4"}]}) == "https://cdn/v.mp4"


def test_a_photo_has_no_video_url():
    assert _best_video({"media_type": 1, "video_versions": []}) is None


# --- 2. the sniffer must not confuse the soundtrack for the video ----------

@pytest.mark.parametrize("ctype,expected", [
    ("audio/mp4", True),
    ("audio/mp4; codecs=\"mp4a.40.2\"", True),
    ("video/mp4", False),
    ("", False),
    (None, False),
])
def test_audio_only_responses_are_recognised(ctype, expected):
    assert _is_audio_ctype(ctype) is expected


# --- 3. recovering the sound for a download that landed silent -------------

def _fake_probe(monkeypatch, verdicts: dict):
    """Make _has_audio_stream answer from a {filename-suffix: verdict} map."""
    def _probe(path):
        for key, verdict in verdicts.items():
            if str(path).endswith(key):
                return verdict
        return False
    monkeypatch.setattr(localize_media, "_has_audio_stream", _probe)


@pytest.mark.asyncio
async def test_the_audio_labelled_candidate_is_tried_first(tmp_path, monkeypatch):
    """The whole point: the sound was on the wire all along, one response over
    from the video. It must be fetched and muxed in, not shrugged at."""
    fetched: list[str] = []

    async def _fake_download(url, dest, *, referer=None, user_agent=None):
        fetched.append(url)
        Path(dest).write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 1000)

    async def _fake_mux(video, audio, dest):
        Path(dest).write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 2000)
        return True

    monkeypatch.setattr(localize_media, "_download_direct", _fake_download)
    monkeypatch.setattr(localize_media, "_mux_video_audio", _fake_mux)
    _fake_probe(monkeypatch, {".audio": True})

    video = tmp_path / "clip.mp4"
    video.write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 1000)

    info = {
        "media_url": "https://cdn/video.mp4",
        # Deliberately out of size order: the big decoy is listed first, so a
        # naive "largest other candidate" pick would fetch the wrong one.
        "candidates": [
            {"url": "https://cdn/decoy.mp4", "kind": "progressive",
             "content_type": "video/mp4", "size": 9_000_000, "audio_only": False},
            {"url": "https://cdn/audio.mp4", "kind": "progressive",
             "content_type": "audio/mp4", "size": 400_000, "audio_only": True},
        ],
    }
    result = await localize_media._recover_audio(info, video, tmp_path, user_agent=None)

    assert result is True
    assert fetched == ["https://cdn/audio.mp4"]


@pytest.mark.asyncio
async def test_a_candidate_with_no_audio_track_is_rejected(tmp_path, monkeypatch):
    """Content-Type is a hint, ffprobe is the verdict. A host that mislabels its
    streams must not be able to mux silence into the file and call it fixed."""
    async def _fake_download(url, dest, *, referer=None, user_agent=None):
        Path(dest).write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 1000)

    async def _never(*_a, **_k):
        raise AssertionError("mux must not run on a silent candidate")

    monkeypatch.setattr(localize_media, "_download_direct", _fake_download)
    monkeypatch.setattr(localize_media, "_mux_video_audio", _never)
    _fake_probe(monkeypatch, {})  # nothing has audio

    video = tmp_path / "clip.mp4"
    video.write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 1000)

    info = {
        "media_url": "https://cdn/video.mp4",
        "candidates": [
            {"url": "https://cdn/lies.mp4", "kind": "progressive",
             "content_type": "audio/mp4", "size": 400_000, "audio_only": True},
        ],
    }
    assert await localize_media._recover_audio(info, video, tmp_path, user_agent=None) is False
    assert video.exists(), "the silent video must survive a failed repair"


@pytest.mark.asyncio
async def test_nothing_to_recover_from_is_not_an_error(tmp_path):
    """A single-response page (no DASH) has no second half. Returning False
    leaves the caller free to keep the file — plenty of clips are posted mute."""
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"\x00" * 100)
    info = {"media_url": "https://cdn/video.mp4", "candidates": []}
    assert await localize_media._recover_audio(info, video, tmp_path, user_agent=None) is False


def test_a_superseded_download_is_deleted(tmp_path):
    """The ladder keeps a silent copy alive while it tries the next tier. When
    the retry wins, the loser must not stay on disk as an orphan no memo
    references."""
    orphan = tmp_path / "old.mp4"
    orphan.write_bytes(b"x" * 10)
    localize_media._discard({"path": str(orphan)})
    assert not orphan.exists()


def test_discarding_a_missing_file_is_harmless():
    localize_media._discard({"path": "/nope/does-not-exist.mp4"})
    localize_media._discard(None)
