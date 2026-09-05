"""Library integrity check — notice when the files the database references vanish.

On 2026-08-04 an unisolated test run deleted 435 media files from a live
library. The app kept serving pages for ninety minutes as if nothing had
happened: cards still rendered from cached thumbnails, search still worked, and
the loss was eventually spotted in a screenshot rather than by openMemo. By then
the SSD had reclaimed most of the blocks.

Nothing here would have prevented that. This is the part that was missing
afterwards: a periodic pass answering one question, **do the files the database
references still exist**, and saying so out loud the moment the answer changes.

A run reports one of:
    ok         — every referenced file resolves on disk
    missing    — some files are missing, and the number has not grown
    incident   — MORE files are missing than at the last check

The distinction matters. A library that has been missing 59 uploads for a month
is a known state, not news. A jump from 0 to 435 between two checks is an
incident, and it is worth being loud about while recovery is still possible.

Cheap by construction: one `stat` per referenced path, a few hundred in a
typical library, run on a timer and off the event loop.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

log = logging.getLogger(__name__)

# Hourly. Frequent enough that a loss is caught while the disk may still hold
# the blocks, rare enough to be invisible. The check is pure `stat` calls.
_INTERVAL_S = 60 * 60

# Wait before the first run so a cold start is not competing with migrations,
# the embedder warming up, and everything else the lifespan kicks off.
_STARTUP_DELAY_S = 2 * 60


# Hosts that hand out SIGNED image URLs with an expiry baked in. A picture
# still pointing at one of these is on a clock: it renders today and 403s in a
# few days, with nothing on disk behind it.
#
# This is the gap that let six Instagram carousels rot unnoticed between
# 2026-08-05 and 2026-08-09. `cache_gallery` was missing from the job routing
# table, so every carousel save queued a download that never ran, and the check
# below skipped the memos entirely on the reasoning that a remote URL "is not
# ours to lose". For an expiring host that reasoning is backwards: the URL is
# ours to lose precisely because we failed to copy it while it still worked.
_EXPIRING_IMAGE_HOSTS = ("cdninstagram.com", "fbcdn.net")


def _is_remote(url: str | None) -> bool:
    return bool(url) and str(url).startswith("http")


def _expires(url: str | None) -> bool:
    """A remote picture URL that will stop working on its own."""
    if not _is_remote(url):
        return False
    from urllib.parse import urlparse

    try:
        host = urlparse(str(url)).netloc.lower()
    except ValueError:
        return False
    return any(host.endswith(h) or f".{h}" in host for h in _EXPIRING_IMAGE_HOSTS)


def _picture_urls(thumbnail_path: str | None, gallery) -> list[str]:
    """Every image URL a memo renders: its cover plus each carousel slide."""
    urls: list[str] = []
    if thumbnail_path:
        urls.append(str(thumbnail_path))
    if gallery:
        import json

        try:
            slides = json.loads(gallery) if isinstance(gallery, (str, bytes)) else gallery
        except (ValueError, TypeError):
            slides = []
        for slide in slides or []:
            url = slide.get("url") if isinstance(slide, dict) else None
            if url:
                urls.append(str(url))
    return urls


def _scan_sync() -> dict:
    """Resolve every referenced path. Blocking: called via a thread.

    Media and thumbnails are counted separately on purpose. A thumbnail is
    regenerable and a missing one is cosmetic; a missing media file may be the
    only copy that existed. They also fail independently — the incident that
    prompted this left `files/thumbs` untouched while emptying everything else,
    which is exactly why the cards still looked fine."""
    from sqlalchemy import create_engine, text

    from backend.config import settings
    from backend.core.file_paths import resolve_memo_path, resolve_thumbnail_path

    # A plain synchronous connection: this runs in a worker thread, and the
    # async session/engine belongs to the event loop that is not in it.
    url = settings.DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:")
    engine = create_engine(url, connect_args={"check_same_thread": False})
    try:
        with engine.connect() as con:
            rows = con.execute(
                text(
                    "select file_path, thumbnail_path, source_url, type, id, gallery, "
                    "resolve_tier, audio_kind "
                    "from memos where is_deleted = 0 or is_deleted is null"
                )
            ).fetchall()
    finally:
        engine.dispose()

    from backend.core.localize_media import _has_audio_stream, _has_video_stream

    memos = len(rows)
    with_media = missing_media = recoverable = unrecoverable = 0
    with_thumb = missing_thumbs = silent_videos = 0
    remote_pictures = expiring_pictures = 0
    pictureless_videos = degraded_reads = 0
    expiring_memos: list[str] = []
    pictureless_memos: list[str] = []
    degraded_memos: list[str] = []

    for (
        file_path,
        thumbnail_path,
        source_url,
        memo_type,
        memo_id,
        gallery,
        resolve_tier,
        audio_kind,
    ) in rows:
        # A read that could not narrow to the post. Recorded since 3.18.0 and,
        # until now, read by nobody: the number existed and no surface showed
        # it, which is how a five photo album sat filed as a song for a day.
        # Unlike the counts below this one is not about a lost file. It means
        # the memo probably never got the gallery the post actually has, and a
        # re-pull is likely to fix it because the usual cause (a consent gate)
        # is transient.
        if (resolve_tier or "") == "scope:page":
            degraded_reads += 1
            degraded_memos.append(str(memo_id))
        if file_path:
            with_media += 1
            resolved = resolve_memo_path(file_path)
            if resolved is None:
                missing_media += 1
                if (source_url or "").strip():
                    recoverable += 1
                else:
                    unrecoverable += 1
            elif (memo_type or "").lower() == "video":
                # A video with no audio track. This caught 59 downloads that had
                # silently lost their sound — but it CANNOT tell those from a
                # clip that was posted muted, and plenty are: every one of the
                # six left after the backfill turned out to offer no audio
                # format at its source at all.
                #
                # So it is a number to look at, not an alarm, and the UI says so.
                # Telling someone to re-pull a video that never had sound is a
                # nag that can never be satisfied.
                # `is False` only: None means ffprobe could not tell.
                if _has_audio_stream(resolved) is False:
                    silent_videos += 1
                # The mirror, and unlike its sibling this one IS an alarm. A
                # video with no PICTURES is not a video: it is the audio track
                # the page was playing, saved as an .mp4 because that is the
                # container it arrived in. A photo post with a song attached
                # does this, and `derive_memo_type` then reads the extension
                # and files the post under Videos.
                #
                # It cannot be created any more (`_reject_pictureless` refuses
                # it at every download tier, 3.18.1). This counts the ones made
                # BEFORE that shipped, which nothing else would ever notice.
                # There is no innocent reading of it the way there is for a
                # clip that was posted muted, so the UI may say "re-pull these"
                # without ever nagging about something that cannot be fixed.
                #
                # Only for memos typed `video`. An audio memo's file has no
                # pictures BY DESIGN, and counting those would report the whole
                # music library as broken.
                # A sibling `if`, not `elif`. Chained behind the audio test, a
                # file missing BOTH streams (a truncated container) was filed
                # as merely silent and never tested for pictures, while the
                # repair endpoint tests pictures directly. The scan would then
                # report zero and the repair would find targets, which reads as
                # the app disagreeing with itself.
                # `audio_kind` as well as the type, because `derive_memo_type`
                # reads the file EXTENSION first and the startup sorter runs on
                # every boot: a song that ever lands in an .mp4 container gets
                # retyped `video` while keeping `audio_kind`. Without this the
                # scan reports it for ever and the repair endpoint, which does
                # check `audio_kind`, refuses to touch it — the app disagreeing
                # with itself, in public, at WARNING level, hourly.
                if _has_video_stream(resolved) is False and not audio_kind:
                    pictureless_videos += 1
                    pictureless_memos.append(str(memo_id))
        # A remote thumbnail URL is not a file we can lose, so only local ones
        # count as missing. These resolve differently from media: the column
        # holds the URL the app serves the image at, and `/api/files/thumb/x`
        # lives at `files/thumbs/x`.
        if thumbnail_path and not str(thumbnail_path).startswith("http"):
            with_thumb += 1
            if resolve_thumbnail_path(thumbnail_path) is None:
                missing_thumbs += 1

        # Pictures that were never copied to disk. Counted apart from missing
        # files because the fix is different: nothing was lost, a download did
        # not happen, and re-running it (or re-pulling the post once the signed
        # URL is dead) puts it right.
        urls = _picture_urls(thumbnail_path, gallery)
        remote = [u for u in urls if _is_remote(u)]
        remote_pictures += len(remote)
        expiring = [u for u in remote if _expires(u)]
        if expiring:
            expiring_pictures += len(expiring)
            expiring_memos.append(str(memo_id))

    return {
        "memos": memos,
        "with_media": with_media,
        "missing_media": missing_media,
        "recoverable": recoverable,
        "unrecoverable": unrecoverable,
        "with_thumb": with_thumb,
        "missing_thumbs": missing_thumbs,
        "silent_videos": silent_videos,
        "pictureless_videos": pictureless_videos,
        "pictureless_memo_ids": pictureless_memos[:50],
        "degraded_reads": degraded_reads,
        "degraded_memo_ids": degraded_memos[:50],
        # Un-localized pictures. `remote_pictures` includes stable hosts (Apple
        # artwork, YouTube covers) which are untidy but not urgent;
        # `expiring_pictures` is the subset on a countdown.
        "remote_pictures": remote_pictures,
        "expiring_pictures": expiring_pictures,
        # Capped: this rides in the settings JSON, and the point is to name the
        # memos to repair, not to mirror the table.
        "expiring_memo_ids": expiring_memos[:50],
    }


def _verdict(scan: dict, previous: dict | None) -> tuple[str, int]:
    """Status plus how much worse it got since the last run.

    Any increase is an incident. Files do not go missing on their own, so there
    is no drift to tolerate and no threshold worth tuning: one file that was
    here an hour ago and is not here now is the same class of event as four
    hundred, caught earlier."""
    now = scan["missing_media"] + scan["missing_thumbs"]
    if not previous:
        # First run ever. Report what is missing, but nothing has "jumped" —
        # calling a pre-existing state an incident would cry wolf on install.
        return ("missing" if now else "ok"), 0

    before = previous.get("missing_media", 0) + previous.get("missing_thumbs", 0)
    delta = now - before
    if delta > 0:
        return "incident", delta
    return ("missing" if now else "ok"), delta


async def run_integrity_check() -> dict:
    """Scan, compare against the last run, and return the result."""
    scan = await asyncio.to_thread(_scan_sync)
    previous = last_result()
    status, delta = _verdict(scan, previous)

    result = {
        **scan,
        "status": status,
        "delta": delta,
        "checked_at": datetime.utcnow().isoformat(),
        "previous_checked_at": (previous or {}).get("checked_at"),
    }

    if status == "incident":
        log.error(
            "library integrity: %d MORE files missing since %s (%d media, %d thumbnails)",
            delta, result["previous_checked_at"], scan["missing_media"], scan["missing_thumbs"],
        )
    elif status == "missing":
        log.info(
            "library integrity: %d media and %d thumbnails missing (unchanged)",
            scan["missing_media"], scan["missing_thumbs"],
        )

    # Separate line, separate severity: these pictures are still on screen
    # today. Saying it while the URLs are alive is the whole value — once they
    # expire the only repair left is re-pulling the post.
    if scan.get("expiring_pictures"):
        log.warning(
            "library integrity: %d picture(s) across %d memo(s) never downloaded and "
            "sit on expiring URLs — POST /api/maintenance/relocalize-pictures to fix",
            scan["expiring_pictures"], len(scan.get("expiring_memo_ids") or []),
        )

    # Two wrong-pull signatures, both repairable by re-pulling the post, so
    # neither belongs in the missing-files verdict above. They are reported
    # because until now nothing looked: a memo can be visibly, obviously wrong
    # on the page and still be invisible to every check the app runs.
    if scan.get("pictureless_videos"):
        log.warning(
            "library integrity: %d memo(s) filed as video hold a file with no pictures "
            "in it (the page's audio track) — POST /api/maintenance/repull-wrong-pulls",
            scan["pictureless_videos"],
        )
    if scan.get("degraded_reads"):
        log.info(
            "library integrity: %d memo(s) were saved from a read that could not narrow "
            "to the post, so they may be missing a gallery — "
            "POST /api/maintenance/repull-wrong-pulls",
            scan["degraded_reads"],
        )
    return result


def last_result() -> dict | None:
    """What the last check found, for the Settings UI."""
    try:
        from backend.core.app_settings import get_library_integrity

        return get_library_integrity()
    except Exception:
        return None


async def store(result: dict) -> None:
    from backend.core.app_settings import set_library_integrity

    try:
        set_library_integrity(result)
    except Exception as e:
        log.info("library integrity could not store its result: %r", e)


async def run_integrity_loop() -> None:
    """Forever loop, started from lifespan. Must never raise out.

    Every paired device runs its own, unlike the Instagram canary which elects a
    single machine to do the asking. This one is a question about the local
    disk, so each machine has its own answer and none of them substitutes."""
    await asyncio.sleep(_STARTUP_DELAY_S)
    while True:
        try:
            await store(await run_integrity_check())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("library integrity cycle failed: %r", e)
        await asyncio.sleep(_INTERVAL_S)


if __name__ == "__main__":
    import json

    async def _main() -> None:
        result = await run_integrity_check()
        await store(result)
        print(json.dumps(result, indent=2))

    asyncio.run(_main())
