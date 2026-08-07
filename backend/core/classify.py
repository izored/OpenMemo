"""Canonical memo-type classification.

Single source of truth for "what type is this memo really?" Used both at
ingest time (so memos are filed correctly when saved) and by the background
sorter (a safety net that re-files anything that slipped through wrong).

Type taxonomy (matches the UI filter tabs + card renderers):
    note, link, image, video, audio, document, code, file

There is intentionally NO "article" type — saved web pages are `link`. Any
legacy `article` memo is migrated to `link` by derive_memo_type.
"""

from pathlib import Path
from urllib.parse import urlparse

from backend.core.security.upload import categorize_extension


# URL path extensions that mean the link points straight at a media/doc file
# (e.g. https://site.com/photo.jpg) rather than a web page. Mirrors the
# categorisation map in upload.py so a direct file link is filed like an upload.
def _ext_from_url(url: str) -> str:
    try:
        path = urlparse(url).path
        return Path(path).suffix.lower()
    except Exception:
        return ""


def derive_memo_type(memo) -> str:
    """Return the canonical type for a memo from its strongest signal.

    Priority: uploaded file (extension) > source URL (host + extension) > note.
    Never returns "article" — web pages are "link". Never raises.
    """
    # 1) Uploaded file — the extension is authoritative.
    file_path = getattr(memo, "file_path", None)
    if file_path:
        ext = Path(str(file_path)).suffix.lower()
        if ext:
            return categorize_extension(ext)
        return "file"

    # 2) Source URL — video aggregators, then direct-file extensions, else link.
    source_url = getattr(memo, "source_url", None)
    if source_url:
        # Local import avoids a circular import (extractor imports nothing from
        # here, but keep the dependency one-directional and lazy to be safe).
        from backend.core.extractor import detect_url_type

        url_type = detect_url_type(source_url)
        if url_type == "video":
            # Domain says "media platform", but the specific item may be a photo
            # (FB/TikTok/X photo post) or audio (SoundCloud), not video. Preserve
            # a concrete media type the extractor already resolved; only default
            # to video when we have no stronger signal. Domain ≠ proof of video.
            current = (getattr(memo, "type", None) or "").lower()
            if current in ("image", "audio"):
                return current
            # Instagram's resolver is authoritative (core/extractor._instagram_resolve).
            # A "link" from it is the deliberate graceful needs-login bookmark — keep
            # it a link, don't let the video-host default drag it back to a dead video.
            if current == "link" and "instagram.com" in (source_url or "").lower():
                return "link"
            from backend.core.extractor import _url_media_hint, is_audio_host
            # Audio-only host (SoundCloud/Bandcamp/Mixcloud/…) is audio, never
            # video — even if yt-dlp couldn't probe it (ADR-005, ADR-001).
            if is_audio_host(source_url):
                return "audio"
            if _url_media_hint(source_url) == "image":
                return "image"
            return "video"

        ext = _ext_from_url(source_url)
        if ext:
            cat = categorize_extension(ext)
            # A page URL with a stray extension (".html", ".php", unknown) is
            # still a web page → link. Only file-like categories win.
            if cat in ("image", "video", "audio", "document"):
                return cat
        return "link"

    # 3) No file, no URL → it's a written note.
    return "note"


def derive_audio_kind(memo, explicit: str | None = None) -> str | None:
    """Audio sub-kind for a memo (ADR-005): 'voice' | 'music', or None.

    None for non-audio memos. An explicit caller signal wins (the mic recorder
    posts 'voice'). Otherwise a local recording with no source and a
    "Voice memo …" title is voice; everything else audio (uploaded files +
    linked SoundCloud/Bandcamp/Mixcloud/…) is music. Single source of truth so
    no render/ingest site re-derives this heuristic.
    """
    if (getattr(memo, "type", None) or "").lower() != "audio":
        return None
    if explicit in ("voice", "music"):
        return explicit
    source_url = getattr(memo, "source_url", None)
    title = getattr(memo, "title", None) or ""
    if not source_url and title.startswith("Voice memo"):
        return "voice"
    return "music"


# Memo types eligible for AI summarization (ADR-007). EDIT THIS SET to change
# which types can be summarized — single source of truth, mirrored on the
# frontend (`media.ts` SUMMARIZABLE_TYPES). Music audio is excluded separately
# in can_summarize (a song is not summarizable text), regardless of this set.
SUMMARIZABLE_TYPES = {
    "note", "link", "article", "video", "audio", "document", "code", "file",
}


def can_summarize(memo) -> bool:
    """Whether a memo is eligible for an AI summary (ADR-007).

    True only when the memo has text AND a summarizable type AND is not music.
    Music (audio_kind == 'music') is always excluded — summarizing a song's
    transcript/lyrics is meaningless; voice memos (spoken word) are eligible.
    Mirrors the frontend `canSummarize` so the API refuses what the UI hides.
    """
    if not getattr(memo, "content_text", None):
        return False
    if derive_audio_kind(memo) == "music":
        return False
    return (getattr(memo, "type", None) or "").lower() in SUMMARIZABLE_TYPES


def has_transcript(memo) -> bool:
    """Whether `content_text` really holds a transcript of the spoken audio.

    `transcript_status == 'done'` alone is not enough. `content_text` is seeded
    at ingest with the source's own description/caption, and a run that produced
    no text used to leave the status at 'done' anyway — so a memo could claim a
    transcript while holding nothing but the post's blurb. Anything that reads
    the transcript (the UI card, the summary source, Ask) goes through here, so
    a description can never be presented as speech (ADR-004 update).
    """
    if (getattr(memo, "transcript_status", None) or "") != "done":
        return False
    text = (getattr(memo, "content_text", None) or "").strip()
    if not text:
        return False
    blurbs = {
        (getattr(memo, "video_description", None) or "").strip(),
        (getattr(memo, "description", None) or "").strip(),
    }
    return text not in blurbs


# Types the sorter is allowed to overwrite. We never touch a memo whose current
# type isn't in this set (defensive — keeps unknown/custom types intact).
_KNOWN_TYPES = {
    "note", "link", "article", "image", "video", "audio", "document", "code", "file",
}


async def reclassify_all(db, *, dry_run: bool = False) -> dict:
    """Re-file every memo to its canonical type. Returns a summary.

    Idempotent and safe to run repeatedly. Only updates memos whose stored
    type differs from the derived type AND whose stored type is known. Returns
    {scanned, changed, changes: {"old->new": count}}.
    """
    from sqlalchemy import select

    from backend.db.models import Memo

    rows = (await db.execute(select(Memo))).scalars().all()

    changed = 0
    breakdown: dict[str, int] = {}
    for memo in rows:
        current = (memo.type or "").lower()
        if current not in _KNOWN_TYPES:
            continue
        derived = derive_memo_type(memo)
        if derived and derived != current:
            breakdown[f"{current}->{derived}"] = breakdown.get(f"{current}->{derived}", 0) + 1
            changed += 1
            if not dry_run:
                memo.type = derived
                # A row re-filed to audio (e.g. an old SoundCloud memo mistyped
                # video before ADR-005) needs its sub-kind set too.
                if derived == "audio" and not getattr(memo, "audio_kind", None):
                    memo.audio_kind = derive_audio_kind(memo)

    if changed and not dry_run:
        await db.commit()

    return {"scanned": len(rows), "changed": changed, "changes": breakdown, "dry_run": dry_run}
