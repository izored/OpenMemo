"""Read tags + embedded cover art from a local audio file (mutagen).

Used by the album-upload path (POST /api/ingest/album): an uploaded track
carries its own identity in its tags, and often its art baked in, so we lift
title / artist / album / track-number for grouping + ordering and pull the
embedded picture so the album tile has a cover with no extra work.

Everything here is best-effort — a tagless or exotic file simply yields blanks,
never an exception, so one bad file can't sink a whole album upload.
"""
from __future__ import annotations

import base64
from pathlib import Path


def read_audio_tags(path: str | Path) -> dict:
    """Return ``{title, artist, album, track}`` for an audio file.

    ``track`` is the integer track number (for in-album ordering) or None.
    Missing tags come back as None; an unreadable file yields all-None.
    """
    out = {"title": None, "artist": None, "album": None, "track": None}
    try:
        import mutagen

        audio = mutagen.File(str(path), easy=True)
        if audio is None:
            return out

        def _first(key: str) -> str | None:
            val = audio.get(key)
            if not val:
                return None
            s = (val[0] if isinstance(val, list) else val)
            s = str(s).strip()
            return s or None

        out["title"] = _first("title")
        out["artist"] = _first("artist") or _first("albumartist")
        out["album"] = _first("album")
        raw_track = _first("tracknumber")
        if raw_track:
            # Tags store "3" or "3/12" — keep the leading integer.
            head = raw_track.split("/")[0].strip()
            if head.isdigit():
                out["track"] = int(head)
    except Exception:
        pass
    return out


def extract_cover_bytes(path: str | Path) -> tuple[bytes, str] | None:
    """Return ``(image_bytes, mime)`` for a file's embedded front cover, or None.

    Handles the four common containers: FLAC (picture block), MP3 (ID3 APIC),
    MP4/M4A (covr atom) and Ogg/Opus (base64 metadata_block_picture). Anything
    else, or no embedded art, returns None.
    """
    try:
        import mutagen
        from mutagen.flac import FLAC, Picture
        from mutagen.id3 import ID3
        from mutagen.mp4 import MP4

        p = str(path)
        ext = Path(p).suffix.lower()

        # FLAC — native picture blocks.
        if ext == ".flac":
            fl = FLAC(p)
            if fl.pictures:
                pic = _front_or_first(fl.pictures)
                return pic.data, (pic.mime or "image/jpeg")
            return None

        # MP3 / anything ID3 — APIC frames.
        if ext in (".mp3", ".aiff", ".aif", ".wav"):
            try:
                tags = ID3(p)
            except Exception:
                tags = None
            if tags:
                apics = tags.getall("APIC")
                if apics:
                    apic = _front_or_first(apics)
                    return apic.data, (apic.mime or "image/jpeg")
            return None

        # MP4 / M4A / AAC — covr atom.
        if ext in (".m4a", ".mp4", ".aac"):
            mp4 = MP4(p)
            covers = mp4.tags.get("covr") if mp4.tags else None
            if covers:
                cover = covers[0]
                # MP4Cover.imageformat: 13 = JPEG, 14 = PNG.
                mime = "image/png" if getattr(cover, "imageformat", 13) == 14 else "image/jpeg"
                return bytes(cover), mime
            return None

        # Ogg / Opus (and any Vorbis-comment carrier) — base64 FLAC Picture.
        audio = mutagen.File(p)
        if audio is not None and getattr(audio, "tags", None):
            b64 = audio.tags.get("metadata_block_picture")
            if b64:
                raw = base64.b64decode(b64[0] if isinstance(b64, list) else b64)
                pic = Picture(raw)
                return pic.data, (pic.mime or "image/jpeg")
    except Exception:
        pass
    return None


def _front_or_first(pictures: list):
    """The front-cover picture (type == 3) if present, else the first one."""
    for pic in pictures:
        if getattr(pic, "type", None) == 3:
            return pic
    return pictures[0]
