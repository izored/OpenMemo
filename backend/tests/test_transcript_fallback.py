"""A description is never a transcript.

The bug this pins down: a video memo's `content_text` is seeded at ingest with
the source's own caption/description. Whisper's VAD gate scores sung or
whispered vocals as non-speech and can drop every segment, so the STT pass came
back empty — but the memo was still marked `transcript_status='done'`, leaving
the caption in place. The detail page reads "done + content_text" as a
transcript and showed an Instagram post's blurb as "what is said in the video".

Three layers now make that impossible:
  1. an empty first Whisper pass is re-run with the VAD gate off,
  2. an empty transcript run lands in `error`, never `done`,
  3. `has_transcript()` refuses text that is verbatim the memo's own blurb.
"""
import asyncio
import types

import pytest

from backend.core.classify import has_transcript
from backend.core.transcript import TranscriptError, get_transcript


class FakeMemo:
    def __init__(self, **kw):
        self.type = "video"
        self.transcript_status = None
        self.content_text = None
        self.video_description = None
        self.description = None
        self.__dict__.update(kw)


# --- has_transcript: the shared predicate --------------------------------


def test_description_echoed_into_content_text_is_not_a_transcript():
    blurb = "In 1993, Mazzy Star crafted a hypnotic, slow-burning acoustic ballad."
    memo = FakeMemo(transcript_status="done", content_text=blurb, video_description=blurb)
    assert has_transcript(memo) is False


def test_plain_description_echo_is_not_a_transcript():
    blurb = "Follow us for more music content"
    memo = FakeMemo(transcript_status="done", content_text=blurb, description=blurb)
    assert has_transcript(memo) is False


def test_real_transcript_alongside_a_description_counts():
    memo = FakeMemo(
        transcript_status="done",
        content_text="[00:02] I want to hold your hand inside you",
        video_description="In 1993, Mazzy Star crafted a hypnotic ballad.",
    )
    assert has_transcript(memo) is True


@pytest.mark.parametrize("status", [None, "pending", "processing", "error"])
def test_unfinished_runs_never_count(status):
    memo = FakeMemo(transcript_status=status, content_text="[00:02] some words")
    assert has_transcript(memo) is False


def test_done_with_empty_text_does_not_count():
    memo = FakeMemo(transcript_status="done", content_text="   ")
    assert has_transcript(memo) is False


# --- get_transcript: captions first, then Whisper, then fail -------------


def _patch(monkeypatch, *, captions=None, stt=None, downloads=None):
    monkeypatch.setattr(
        "backend.core.transcript._pull_captions_sync", lambda url: captions
    )

    async def fake_transcribe(path):
        if stt is None:
            raise AssertionError("STT should not have run")
        return stt

    monkeypatch.setattr("backend.core.transcript.transcribe_audio", fake_transcribe)

    def fake_download(url):
        if downloads is None:
            raise AssertionError("audio download should not have run")
        downloads.append(url)
        return {"path": __file__, "dir": None}

    monkeypatch.setattr("backend.core.transcript._download_audio_temp", fake_download)
    monkeypatch.setattr("backend.core.transcript.shutil.rmtree", lambda *a, **k: None)


def test_captions_win_when_the_host_has_them(monkeypatch):
    _patch(monkeypatch, captions={"text": "[00:01] hello", "lang": "en"})
    out = asyncio.run(get_transcript("https://example.com/v", local_path=__file__))
    assert out == {"text": "[00:01] hello", "lang": "en", "source": "captions"}


def test_no_captions_falls_back_to_whisper_on_the_local_file(monkeypatch):
    """The reported case: a downloaded Instagram reel with no CC. Whisper must
    read the memo's own file — no second download, and no description."""
    _patch(
        monkeypatch,
        captions=None,
        stt={"text": "[00:02] I want to hold your hand", "language": "en"},
        downloads=None,  # asserts the download path is never taken
    )
    out = asyncio.run(get_transcript("https://instagram.com/reel/x", local_path=__file__))
    assert out == {"text": "[00:02] I want to hold your hand", "lang": "en", "source": "stt"}


def test_remote_only_memo_downloads_audio_for_whisper(monkeypatch):
    seen: list[str] = []
    _patch(monkeypatch, captions=None, stt={"text": "[00:00] words", "language": "fr"}, downloads=seen)
    out = asyncio.run(get_transcript("https://example.com/v"))
    assert out["source"] == "stt" and out["lang"] == "fr"
    assert seen == ["https://example.com/v"]


def test_empty_whisper_result_raises_instead_of_returning_nothing(monkeypatch):
    _patch(monkeypatch, captions=None, stt={"text": "   ", "language": "en"})
    with pytest.raises(TranscriptError):
        asyncio.run(get_transcript("https://example.com/v", local_path=__file__))


def test_nothing_to_work_with_raises(monkeypatch):
    _patch(monkeypatch, captions=None)
    with pytest.raises(TranscriptError):
        asyncio.run(get_transcript(None, local_path=None))


# --- transcribe.py: the VAD gate must not silence a whole clip -----------


def test_vad_filtered_to_nothing_is_retried_ungated(monkeypatch):
    """Silero VAD drops every segment of a sung clip. The second pass, ungated,
    is what turns 'no transcript' into the actual lyrics."""
    from backend.core import transcribe

    calls: list[bool] = []

    class FakeModel:
        def transcribe(self, path, beam_size=None, vad_filter=None):
            calls.append(vad_filter)
            info = types.SimpleNamespace(language="en")
            if vad_filter:
                return iter(()), info
            seg = types.SimpleNamespace(start=1.5, text=" Fading into you ")
            return iter((seg,)), info

    monkeypatch.setattr(transcribe, "_get_model", lambda: FakeModel())
    out = transcribe._transcribe_sync("clip.mp4")
    assert calls == [True, False]
    assert out == {"text": "[00:01] Fading into you", "language": "en"}


def test_a_productive_first_pass_is_not_repeated(monkeypatch):
    from backend.core import transcribe

    calls: list[bool] = []

    class FakeModel:
        def transcribe(self, path, beam_size=None, vad_filter=None):
            calls.append(vad_filter)
            seg = types.SimpleNamespace(start=0.0, text="Hello there")
            return iter((seg,)), types.SimpleNamespace(language="en")

    monkeypatch.setattr(transcribe, "_get_model", lambda: FakeModel())
    out = transcribe._transcribe_sync("talk.m4a")
    assert calls == [True]
    assert out["text"] == "[00:00] Hello there"
