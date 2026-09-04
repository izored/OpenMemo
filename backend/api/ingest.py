"""Content ingestion API - handles URL saving, file uploads, and processing."""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# Shares the "openmemo.music" logger with the resolver so a track's whole
# journey (resolve → community relay status → store/fail) reads as one trail.
log = logging.getLogger("openmemo.music")

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.config import settings
from backend.core.job_handlers import queue_task
from backend.core.pictures import is_picture_slide
from backend.db.database import get_db, AsyncSessionLocal
from sqlalchemy import func, select
from urllib.parse import urlparse
from sqlalchemy.orm.attributes import set_committed_value

from backend.db.models import Memo, Collection, memo_collections
from backend.core.security import sanitize_workspace_id, validate_url, FileUploadHandler
# Apple Music and Spotify links exist only to be pulled through the music relay,
# so the whole surface 404s while the relay is off (core/music_relay.py).
from backend.core.music_relay import require_enabled as music_relay_enabled
from backend.core.classify import derive_memo_type, derive_audio_kind

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# Shared file upload handler
_upload_handler = FileUploadHandler(settings.FILES_DIR)


# Sites whose memos file themselves, mapped to the collection NAME they belong
# in. Deliberately a short, explicit list rather than "match a collection whose
# name looks like the domain": that generic version would also start pulling
# code.org into `Code` and home.com into `Home`, which is a surprise nobody
# asked for. Adding a site here is one line.
#
# Matched by name, and the collection has to exist already. Nothing here creates
# one, so deleting the collection turns the rule off instead of resurrecting it.
_AUTO_FILE_DOMAINS = {
    "temu.com": "Temu",
}


def auto_file_collection_name(memo: Memo) -> Optional[str]:
    """The collection this memo files itself into from its source, or None.

    An EXACT host match, `www.` aside. Not "contains", and not "ends with":
    subdomains are somebody else's to hand out, and `temu.com.evil.io` is a
    domain any stranger can register in an afternoon. A rule that files a memo
    somewhere on the strength of a substring would put that stranger's page in
    your collection. The host either is the site or it is not.
    """
    host = (getattr(memo, "source_domain", "") or "").strip().lower()
    if not host:
        try:
            host = urlparse(getattr(memo, "source_url", "") or "").netloc.lower()
        except Exception:
            return None
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return None
    return _AUTO_FILE_DOMAINS.get(host)


async def _attach_collection(db: AsyncSession, memo: Memo, collection_id: Optional[str]) -> None:
    """Link a memo to a collection: the one asked for, else the one its source
    files itself into.

    The auto-file rule only runs when no collection was chosen. An explicit
    choice is an instruction, and an id that turns out not to exist is a mistake
    worth leaving visible rather than quietly papering over with a guess.
    """
    coll = None
    if collection_id:
        coll = (
            await db.execute(select(Collection).where(Collection.id == collection_id))
        ).scalar_one_or_none()
    else:
        from backend.core.app_settings import get_settings

        name = (
            auto_file_collection_name(memo)
            if get_settings().get("auto_file_by_source", True)
            else None
        )
        if name:
            coll = (
                await db.execute(
                    select(Collection).where(func.lower(Collection.name) == name.lower())
                )
            ).scalar_one_or_none()
    if coll is None:
        return
    # The Collection query autoflushes the pending memo, making it persistent — so
    # `memo.collections.append()` would fire a lazy SELECT to load existing links,
    # illegal under async (MissingGreenlet → 500). A brand-new memo has no links
    # yet, so mark the relationship loaded-and-empty first; the append then needs
    # no IO and the m2m row is written on commit.
    set_committed_value(memo, "collections", [])
    memo.collections.append(coll)


class URLIngest(BaseModel):
    url: str
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None
    # True = save the URL as a plain link, skipping the heavy visual pull
    # (yt-dlp, headless render, media scrape). For pages that choke the pipeline
    # (gif-heavy Threads posts, anything that errors) or when the user just wants
    # the bookmark. A cheap OpenGraph fetch still fills title/favicon/thumbnail
    # when the page offers them, and a total failure degrades to a bare link
    # instead of erroring the save (OPNMMO-0049).
    no_pull: bool = False
    # True = the user asked for the AUDIO of this link (Music page "+"): file it
    # as a music memo and pull the audio track, even when the host is a video
    # platform (YouTube etc.). Ignores auto_download_audio — the intent is
    # explicit, so it never needs the manual "Make it local → audio" step.
    audio_only: bool = False
    # True = pull the media local on save regardless of the embed-host rule and
    # the auto_download_* settings (Telegram relay saves, gated by the
    # telegram_force_localize setting — an on-the-go capture should survive
    # takedown with no manual "Make it local" visit, ADR-020).
    force_localize: bool = False


class PlaylistProbe(BaseModel):
    url: str


class PlaylistIngest(BaseModel):
    url: str
    # Optional user override for the playlist collection's name; defaults to
    # the playlist title yt-dlp reports.
    title: Optional[str] = None
    # False = pull the playlist as remote track memos only (metadata, no media
    # files). Tracks can be downloaded later, per track or all at once, like
    # any music app. True = start the sequential download right away.
    download: bool = True
    workspace_id: Optional[str] = None


class SpotifyProbe(BaseModel):
    url: str


class SpotifyIngest(BaseModel):
    url: str
    # False = save metadata-only remote track memo(s); download later per track
    # or via the playlist's "download all". True = start the FLAC pull now.
    download: bool = True
    # "16" (CD lossless) | "24" (hi-res). None = the saved music_quality setting.
    quality: Optional[str] = None
    # Override the playlist/album collection name (tracks: ignored).
    title: Optional[str] = None
    workspace_id: Optional[str] = None
    # Single track only — file it into an existing playlist collection.
    collection_id: Optional[str] = None


class NoteIngest(BaseModel):
    title: str
    content: str
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None


class GalleryIngest(BaseModel):
    """Bundle several pasted links into ONE carousel memo.

    The counterpart to dropping a folder of files: images you find one at a
    time, across different sites, that belong together as a single memo. Drag
    and drop cannot express that — the files are not on disk — so the links are
    the input.
    """
    urls: list[str]
    # Optional heading. Defaults to a count, since a pile of CDN URLs has no
    # title worth inheriting.
    title: Optional[str] = None
    description: Optional[str] = None
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None


class ExtensionSave(BaseModel):
    type: str
    url: Optional[str] = None
    title: str
    content_text: Optional[str] = None
    html: Optional[str] = None
    favicon: Optional[str] = None
    thumbnail: Optional[str] = None
    description: Optional[str] = None
    collection_id: Optional[str] = None
    workspace_id: Optional[str] = None


class AIIngest(BaseModel):
    """Headless ingestion for AI agents. Pre-supply all fields — no URL fetch."""
    type: str = "note"
    title: str
    content: Optional[str] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    source_domain: Optional[str] = None
    source_favicon: Optional[str] = None
    thumbnail_url: Optional[str] = None
    tags: list[str] = []
    collection_id: Optional[str] = None
    workspace_id: Optional[str] = None


# --- Thumbnail caching ---

THUMBS_DIR = Path(settings.FILES_DIR) / "thumbs"


_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _thumb_headers(src_url: str) -> dict:
    """Browser-like headers that bypass hotlink protection on visual platforms."""
    from urllib.parse import urlparse
    parsed = urlparse(src_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "User-Agent": _BROWSER_UA,
        "Accept": "image/webp,image/avif,image/*,*/*;q=0.8",
        "Referer": origin + "/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin",
    }


async def _download_thumb(src: str, name_stem: str) -> str | None:
    """Fetch a remote image, save to thumbs dir, return local path or None."""
    import httpx

    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(
            timeout=20, follow_redirects=True, headers=_thumb_headers(src)
        ) as client:
            resp = await client.get(src)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            if "image" not in ctype:
                return None
            ext = {
                "image/png": ".png",
                "image/webp": ".webp",
                "image/gif": ".gif",
                "image/avif": ".avif",
            }.get(ctype.split(";")[0].strip(), ".jpg")
            name = f"{name_stem}{ext}"
            (THUMBS_DIR / name).write_bytes(resp.content)
            return f"/api/files/thumb/{name}"
    except Exception:
        return None


async def localize_pictures_inline(memo) -> int:
    """Download a memo's pictures NOW, before the row is committed.

    The background job was always meant to do this within seconds of the save.
    Three different ways of losing it later, it is clear that "we will fetch it
    shortly" is not a promise the ingest path can make on its own — see
    `backend/core/pictures.py` for why a picture has to be a file.

    So the download moves in front of the commit. Slides go in parallel, each
    under `_download_thumb`'s own 20s timeout, so a nine-slide carousel costs
    about as long as its slowest image rather than nine times that. Returns how
    many are STILL remote.

    Best-effort by design: what it cannot fetch keeps its URL for the retry job
    to work on, and the memo saves either way. Refusing the save would trade a
    missing picture for a missing memo, which is the worse of the two. The
    serving layer makes sure the leftover URL is never rendered.
    """
    # The site icon rides along: it is a picture on the card too, it is fetched
    # once per DOMAIN rather than per memo, and by the time this runs the domain
    # is known. Failure is silent and costs the card its icon, nothing more.
    try:
        from backend.core.favicons import ensure_local

        await ensure_local(getattr(memo, "source_domain", None))
    except Exception as e:
        log.info("favicon fetch skipped for %s: %r", getattr(memo, "id", "?"), e)

    urls: list[tuple[int | None, str]] = []
    if memo.thumbnail_path and str(memo.thumbnail_path).startswith("http"):
        urls.append((None, str(memo.thumbnail_path)))
    slides = list(memo.gallery or [])
    for i, slide in enumerate(slides):
        if not isinstance(slide, dict) or not is_picture_slide(slide):
            continue  # a clip in the set follows the media rules, not this one
        src = slide.get("url")
        if src and str(src).startswith("http"):
            urls.append((i, str(src)))
    if not urls:
        return 0

    results = await asyncio.gather(
        *(
            _download_thumb(src, memo.id if i is None else f"{memo.id}_g{i}")
            for i, src in urls
        ),
        return_exceptions=True,
    )

    still_remote = 0
    changed_gallery = False
    for (i, src), local in zip(urls, results):
        if isinstance(local, BaseException) or not local:
            still_remote += 1
            continue
        if i is None:
            memo.thumbnail_path = local
        else:
            slides[i] = {**slides[i], "url": local}
            changed_gallery = True

    if changed_gallery:
        memo.gallery = slides
        first = slides[0].get("url") if isinstance(slides[0], dict) else None
        if first and not str(first).startswith("http"):
            memo.thumbnail_path = first

    if still_remote:
        log.warning(
            "ingest: %d picture(s) for %s could not be downloaded at save time",
            still_remote, memo.id,
        )
    return still_remote


class PictureNotLocalized(Exception):
    """Nothing was copied to disk, so the memo still renders someone else's URL.

    Raised rather than returned so the durable queue does what it is for:
    retry with backoff, then park the job as `failed` with a reason attached.
    The alternative is what shipped before — a silent `return`, a memo that
    looks fine until the CDN link expires, and no record anywhere that the
    download was ever attempted.
    """


async def cache_thumbnail(memo_id: str):
    """Download a remote thumbnail once and serve it locally."""
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.thumbnail_path:
            return
        src = memo.thumbnail_path
        if not src.startswith("http"):
            return
        local = await _download_thumb(src, memo_id)
        if not local:
            raise PictureNotLocalized(f"thumbnail download failed: {src[:120]}")
        memo.thumbnail_path = local
        memo.updated_at = datetime.utcnow()
        await db.commit()


async def cache_gallery(memo_id: str):
    """Localize every slide of a carousel memo so the gallery survives the source
    being deleted (Instagram CDN URLs are signed and expire). Each remote slide
    is downloaded to the thumbs dir and its URL rewritten to the local path; the
    first local slide also becomes thumbnail_path. Best-effort per slide — a
    dead slide keeps its remote URL rather than aborting the rest."""
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.gallery:
            return
        slides = list(memo.gallery)
        changed = False
        attempted = failed = 0
        for i, slide in enumerate(slides):
            src = (slide or {}).get("url") if isinstance(slide, dict) else None
            if not src or not src.startswith("http"):
                continue
            attempted += 1
            local = await _download_thumb(src, f"{memo_id}_g{i}")
            if local:
                slides[i] = {**slide, "url": local}
                changed = True
            else:
                failed += 1
        if changed:
            memo.gallery = slides
            first = slides[0].get("url") if isinstance(slides[0], dict) else None
            if first and not first.startswith("http"):
                memo.thumbnail_path = first
            memo.updated_at = datetime.utcnow()
            await db.commit()

    # Partial success is kept (a dead slide should never cost the live ones),
    # but the job still has to report the gap. A carousel where every slide
    # failed is the exact shape of the six that rotted: committed, on screen,
    # pointing entirely at signed URLs with days to live.
    if failed:
        raise PictureNotLocalized(
            f"{failed}/{attempted} carousel slides not downloaded"
        )


async def relocalize_pictures_task(memo_id: str):
    """Get a memo's pictures onto disk, re-resolving the post if the links died.

    Repairing an un-localized picture has two cases and only one of them is a
    download. While the signed URL is alive, fetching it is enough. Once it has
    expired, no amount of retrying that URL helps — the post has to be resolved
    again for a fresh set of links, and only then downloaded.

    Deliberately narrower than `repull_memo_task`, which also runs yt-dlp: a
    photo carousel handed to yt-dlp comes back "No video formats found" and
    parks a `localize_error` on a memo whose only real problem was a picture
    that was never copied.
    """
    from urllib.parse import urlparse

    async def _pictures_are_local() -> bool:
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if not memo:
                return True
            urls = [memo.thumbnail_path] + [
                (s or {}).get("url") for s in (memo.gallery or []) if isinstance(s, dict)
            ]
            return not any(u and str(u).startswith("http") for u in urls)

    async def _cache() -> None:
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            has_gallery = bool(memo and memo.gallery)
        if has_gallery:
            await cache_gallery(memo_id)
        else:
            await cache_thumbnail(memo_id)

    try:
        await _cache()
        return
    except PictureNotLocalized:
        pass

    # The links are dead. Instagram is the one host where re-resolving gets a
    # working set back, so it is the only one worth a second attempt.
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        source_url = memo.source_url if memo else None
    if not source_url or "instagram.com" not in urlparse(source_url).netloc:
        raise PictureNotLocalized(f"pictures unreachable and {source_url or 'no source'} cannot be re-resolved")

    from backend.core.extractor import _instagram_resolve

    resolved = await _instagram_resolve(source_url, "instagram.com")
    gallery = resolved.get("gallery") or []
    thumb = resolved.get("thumbnail_path") or (gallery[0]["url"] if gallery else None)
    if not thumb:
        raise PictureNotLocalized(f"re-resolve returned no picture for {source_url}")

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        memo.resolve_tier = resolved.get("resolve_tier") or memo.resolve_tier
        if len(gallery) > 1:
            memo.gallery = gallery
        memo.thumbnail_path = thumb
        memo.updated_at = datetime.utcnow()
        await db.commit()

    await _cache()
    if not await _pictures_are_local():
        raise PictureNotLocalized("re-resolved, but pictures are still remote")


# --- Background processing ---

async def _localize_memo_task(memo_id: str):
    """Download remote images in extracted content so the memo survives the
    source being deleted. Best-effort — never blocks/raises into the request."""
    try:
        from backend.core.localizer import localize_memo

        await localize_memo(memo_id)
    except Exception as e:
        log.warning("Localize failed for %s: %s", memo_id, e)


async def process_memo(memo_id: str):
    """Background task to embed memo content."""
    from backend.core.embedder import embed_memo, build_embed_text

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        # Embed ALL of the memo's text (title + description + transcript/body +
        # summary + notes), not just content_text — so a video with only a
        # platform description is still retrievable (OPNMMO-0058).
        text_to_embed = build_embed_text(memo)
        if not text_to_embed.strip():
            return

        try:
            chunk_ids = await embed_memo(
                memo_id=memo.id,
                text=text_to_embed,
                metadata={
                    "workspace_id": memo.workspace_id,
                    "type": memo.type,
                    "title": memo.title,
                    "source_domain": memo.source_domain or "",
                },
            )
            memo.embedding_ids = chunk_ids
            memo.is_processed = True
            memo.embed_status = "ok"
            memo.updated_at = datetime.utcnow()
            await db.commit()
        except Exception as e:
            log.error("Error processing memo %s: %s", memo_id, e)
            # Persist the failure so the UI can show it and a retry can find it
            # (plans/007) — the bug was precisely that nothing was recorded.
            memo.embed_status = "error"
            memo.updated_at = datetime.utcnow()
            await db.commit()


def schedule_processing(memo_id: str) -> None:
    """Queue the embed pass for a memo.

    Was a bare `asyncio.create_task(process_memo(...))` with a done-callback so
    exceptions were logged rather than swallowed (plans/007). The queue keeps
    that guarantee and adds the ones a loose task cannot give: the work survives
    a restart, retries on failure, and cannot pile up unbounded.
    """
    queue_task(process_memo, memo_id)


# --- Routes ---

async def _light_link(url: str) -> dict:
    """Minimal link resolver for the "don't pull" save (OPNMMO-0049).

    One cheap OpenGraph fetch for a title/favicon/thumbnail, no yt-dlp, no
    headless render, no media scrape. Always returns a usable dict — a page
    that blocks metadata still yields a bare link (title = the URL) instead of
    raising, so the save can never dead-end."""
    from urllib.parse import urlparse
    from backend.core.extractor import _fetch_og_meta

    domain = (urlparse(url).netloc or "").lstrip("www.")
    try:
        meta = await _fetch_og_meta(url)
    except Exception:
        meta = {}
    return {
        "type": "link",
        "title": meta.get("title") or url,
        "description": meta.get("description") or "",
        "content_text": meta.get("description") or url,
        "source_url": url,
        "source_domain": domain,
        "source_favicon": None,
        "thumbnail_path": meta.get("thumbnail_path") or "",
    }


@router.post("/url")
async def ingest_url(
    data: URLIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Ingest content from a URL."""
    return await ingest_url_core(data, db, queue_task)


async def ingest_url_core(data: URLIngest, db: AsyncSession, schedule) -> dict:
    """Shared body of the /url route, callable outside a request (ADR-020: the
    Telegram relay saves through the SAME pipeline as a WebUI paste, no
    HTTP-self-call). `schedule(fn, *args)` receives every follow-up job — the
    route passes `background_tasks.add_task`, the relay passes its own
    fire-and-forget scheduler. All jobs are handed over only after commit."""
    from backend.core.extractor import (
        extract_url, extract_video, detect_url_type, canonical_source_url,
        concise_title,
    )

    # Same source must never mint a twin memo (share-sheet URLs carry tracking
    # params — canonicalized away for hosts where the query is never identity,
    # e.g. Instagram's ?igsh=). Saving twice returns the existing memo instead.
    # audio_only is exempt: "give me the SONG of this link" is a different ask
    # than the earlier bookmark of the same URL (Music page "+").
    data.url = canonical_source_url(data.url)
    # An unresolved Instagram "needs login" bookmark that we UPGRADE in place on a
    # re-save (after the user connects Instagram) instead of returning "duplicate"
    # — otherwise the dedup guard would freeze it as a dead link forever, even
    # though its own message tells the user to save it again.
    upgrade_memo: Optional[Memo] = None
    if not data.audio_only:
        existing = (
            await db.execute(
                select(Memo).where(
                    Memo.source_url == data.url, Memo.is_deleted == False  # noqa: E712
                )
            )
        ).scalars().first()
        if existing is not None:
            stale_ig_link = (
                not data.no_pull
                and existing.type == "link"
                and "instagram.com" in (existing.source_domain or "")
                and not existing.gallery
                and not (existing.thumbnail_path or "")
            )
            if not stale_ig_link:
                return {
                    "id": existing.id,
                    "title": existing.title,
                    "type": existing.type,
                    "status": "duplicate",
                }
            upgrade_memo = existing

    if data.no_pull:
        # "Don't pull" (OPNMMO-0049): no yt-dlp, no headless render, no media
        # scrape — just a cheap OpenGraph fetch for title/favicon/thumbnail, and
        # a bare link if even that fails. Never raises, so a page that breaks the
        # full pipeline can still be saved as a bookmark.
        extracted = await _light_link(data.url)
    else:
        url_type = detect_url_type(data.url)
        try:
            if url_type == "video":
                extracted = await extract_video(data.url)
            else:
                extracted = await extract_url(data.url)
        except Exception as e:
            log.warning("URL extraction failed for %s: %s", data.url, e)
            raise HTTPException(status_code=400, detail="Failed to extract content from this URL")

    # Caption-as-title guard: sources with no title field (Facebook, TikTok…)
    # hand back the whole post as the title. Shorten it to a heading and, if the
    # shortening would otherwise lose text, keep the full caption in description.
    full_title = extracted.get("title") or data.url
    short_title, title_shortened = concise_title(full_title)
    description = extracted.get("description")
    if title_shortened and not (description and str(description).strip()):
        description = full_title

    # Upgrading a stale Instagram link: if it STILL resolves to nothing (cookies
    # not connected yet, or IP still throttled), leave the bookmark untouched
    # rather than churning it — the user can retry once connected.
    if upgrade_memo is not None and extracted.get("type") == "link" and not extracted.get("gallery"):
        return {"id": upgrade_memo.id, "title": upgrade_memo.title, "type": "link", "status": "duplicate"}

    if upgrade_memo is not None:
        # In-place upgrade: keep the id + collection memberships, replace the
        # resolved fields with the freshly pulled media (photo / carousel / video).
        memo = upgrade_memo
        memo.type = extracted.get("type", "link")
        memo.title = short_title
        memo.description = description
        memo.content_text = extracted.get("content_text")
        memo.content_raw = extracted.get("content_raw")
        memo.video_description = extracted.get("video_description")
        memo.source_domain = extracted.get("source_domain")
        memo.source_favicon = extracted.get("source_favicon")
        memo.thumbnail_path = extracted.get("thumbnail_path")
        memo.gallery = extracted.get("gallery")
        memo.resolve_tier = extracted.get("resolve_tier")
        memo.updated_at = datetime.utcnow()
    else:
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=sanitize_workspace_id(data.workspace_id),
            type=extracted.get("type", "link"),
            title=short_title,
            description=description,
            content_text=extracted.get("content_text"),
            content_raw=extracted.get("content_raw"),
            video_description=extracted.get("video_description"),
            source_url=data.url,
            source_domain=extracted.get("source_domain"),
            source_favicon=extracted.get("source_favicon"),
            thumbnail_path=extracted.get("thumbnail_path"),
            # Carousel: the ordered multi-image gallery (Instagram sidecar, …). The
            # first slide is also the thumbnail, so the dashboard shows one cover.
            gallery=extracted.get("gallery"),
            # Which tier of the resolver ladder produced this. Lets Settings see
            # that saves have quietly dropped to a fallback tier (plan 026).
            resolve_tier=extracted.get("resolve_tier"),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
    # "Don't pull" stays a plain link: skip the domain-based type forcing (so a
    # Threads/Reddit URL isn't reclassified video) and the audio kind, and never
    # auto-localize below (OPNMMO-0049).
    if data.no_pull:
        memo.type = "link"
    elif data.audio_only:
        # Music page's "+" pastes a link wanting the SONG, not the video: force
        # the music shape up front so the memo lives on the Music page from the
        # first render, then let the audio localize task pull the file.
        memo.type = "audio"
        memo.audio_kind = "music"
    else:
        # Canonical type from URL signal (video aggregator / direct file / web page).
        memo.type = derive_memo_type(memo)
        # Linked audio (SoundCloud/Bandcamp/…) is always music (ADR-005).
        memo.audio_kind = derive_audio_kind(memo)

    # Auto-download audio pulled from yt-dlp platforms (SoundCloud, Bandcamp,
    # etc.) so it lands as a local, playable memo with no manual "Make it local"
    # step. Gated by the auto_download_audio setting; when off, the memo stays
    # remote and the detail page streams it via the platform embed widget.
    from backend.core.app_settings import get_settings
    from backend.core.extractor import has_embed_player

    auto_localize_audio = (
        not data.no_pull
        and memo.type == "audio"
        and bool(memo.source_url)
        and not memo.file_path
        # audio_only is an explicit "give me the song" — download regardless of
        # the auto_download_audio preference.
        and (data.audio_only or bool(get_settings().get("auto_download_audio", True)))
    )
    # Auto-download a video that has NO inline embed player (Threads, Reddit,
    # unknown host). The sniff/yt-dlp helper makes it a local, playable memo with
    # no manual "Make it local" step — embeddable hosts (YouTube/Vimeo/…) stay
    # remote so we don't fill the disk. Gated by auto_download_video.
    auto_localize_video = (
        not data.no_pull
        and memo.type == "video"
        and bool(memo.source_url)
        and not memo.file_path
        and not has_embed_player(memo.source_url)
        and bool(get_settings().get("auto_download_video", True))
    )
    # Relay saves may force the pull (telegram_force_localize, ADR-020): media
    # downloads regardless of the embed-host rule and the auto_download_*
    # prefs, so an on-the-go capture survives takedown with no manual step.
    if data.force_localize and not data.no_pull and memo.source_url and not memo.file_path:
        if memo.type == "video":
            auto_localize_video = True
        elif memo.type == "audio":
            auto_localize_audio = True
    if auto_localize_audio or auto_localize_video:
        memo.localize_status = "pending"

    # Pictures come down BEFORE the commit, so the row is written already
    # holding local paths. The background job below stays as the retry for
    # whatever this could not reach.
    still_remote = await localize_pictures_inline(memo)

    if upgrade_memo is None:
        # New memo: persist it and file it into the requested collection. An
        # in-place upgrade is already persistent and keeps its memberships —
        # re-attaching would reset its collections (set_committed_value wipes).
        db.add(memo)
        await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    # Process in background
    schedule(process_memo, memo.id)
    # Only what the inline pass could not get. A carousel localizes ALL slides
    # (cache_gallery also owns slide 0's thumbnail); a single-image/link memo
    # just localizes its one thumbnail.
    if still_remote:
        if memo.gallery:
            schedule(cache_gallery, memo.id)
        elif memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
            schedule(cache_thumbnail, memo.id)
    schedule(_localize_memo_task, memo.id)
    if auto_localize_audio:
        schedule(localize_memo_task, memo.id, "audio")
    elif auto_localize_video:
        schedule(localize_memo_task, memo.id, "video")

    return {"id": memo.id, "title": memo.title, "type": memo.type, "status": "processing"}


# --- Playlist ingestion (Music Experience V2, ADR-015) ---

async def _find_saved_playlist(db: AsyncSession, url: str) -> Optional[Collection]:
    """The playlist collection already pulled from this URL, if any."""
    return (
        await db.execute(
            select(Collection).where(
                Collection.kind == "playlist", Collection.source_url == url
            )
        )
    ).scalars().first()


@router.post("/playlist/probe")
async def probe_playlist_url(data: PlaylistProbe, db: AsyncSession = Depends(get_db)):
    """Enumerate a playlist URL without downloading anything (--flat-playlist).

    The new-memo panel calls this when a pasted URL looks playlist-shaped, so
    it can ask "whole playlist or just this one?" with a real title + count.
    """
    from backend.core.playlist import probe_playlist, PlaylistError

    validate_url(data.url)
    try:
        result = await probe_playlist(data.url)
    except PlaylistError as e:
        log.warning("Playlist probe failed for %s: %s", data.url, e)
        raise HTTPException(status_code=400, detail="Could not read playlist from this URL")
    # Already pulled? The panel tells the user instead of letting them mint a
    # duplicate; the ingest endpoint enforces the same rule server-side.
    existing = await _find_saved_playlist(db, data.url)
    # The panel only needs a small preview; cap the entry list it gets back.
    return {
        "is_playlist": True,
        "title": result["title"],
        "uploader": result.get("uploader"),
        "count": result["count"],
        "truncated": result["truncated"],
        "entries": result["entries"][:6],
        "already_saved": {"id": existing.id, "name": existing.name} if existing else None,
    }


@router.post("/playlist")
async def ingest_playlist(
    data: PlaylistIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Ingest an entire playlist as a music playlist collection (ADR-015).

    Enumerates the playlist (flat, no downloads), creates one playlist-kind
    collection plus one pending audio memo per track (title / artist /
    thumbnail from the flat probe), then downloads tracks sequentially in the
    background via the Make-it-local audio pipeline. Progress is derived from
    the per-memo localize_status — no in-memory job state, restart-safe.
    """
    from urllib.parse import urlparse as _urlparse

    from sqlalchemy import insert
    from backend.core.playlist import probe_playlist, PlaylistError

    validate_url(data.url)
    # Same playlist pasted twice → hand back the existing collection instead
    # of minting a duplicate (and re-creating every track memo with it).
    existing = await _find_saved_playlist(db, data.url)
    if existing:
        return {
            "collection_id": existing.id,
            "title": existing.name,
            "total": 0,
            "truncated": False,
            "status": "exists",
        }
    try:
        probed = await probe_playlist(data.url)
    except PlaylistError as e:
        log.warning("Playlist ingest failed for %s: %s", data.url, e)
        raise HTTPException(status_code=400, detail="Could not read playlist from this URL")

    ws = sanitize_workspace_id(data.workspace_id)
    collection = Collection(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        name=(data.title or probed["title"]).strip()[:200] or "Playlist",
        emoji="🎵",
        description=probed.get("description"),
        kind="playlist",
        # YouTube album playlists carry the OLAK5uy_ list-id prefix; everything
        # else yt-dlp enumerates here is a regular playlist/mix.
        music_kind="album" if "OLAK5uy" in data.url else "playlist",
        source_url=data.url,
    )
    db.add(collection)

    # One pending audio memo per track. recency_at is staggered (now - i s) so
    # the default recency sort returns playlist order — same trick as the
    # drag-to-reorder endpoint.
    #
    # Track reuse: a song we already have (same source URL, audio, not
    # deleted) is linked, never re-created — one memo, two memberships, one
    # download. Its playlist_born flag stays untouched: a standalone song
    # pulled into a playlist this way keeps its library spot.
    entry_urls = [e["url"] for e in probed["entries"]]
    existing_memos = (
        await db.execute(
            select(Memo).where(
                Memo.source_url.in_(entry_urls),
                Memo.type == "audio",
                (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
            )
        )
    ).scalars().all()
    by_url = {m.source_url: m for m in existing_memos}

    now = datetime.utcnow()
    memo_ids: list[str] = []       # playlist membership, in playlist order
    download_ids: list[str] = []   # what the background download pass pulls
    new_ids: list[str] = []        # freshly created (need thumbnail caching)
    seen: set[str] = set()
    for i, entry in enumerate(probed["entries"]):
        reused = by_url.get(entry["url"])
        if reused is not None:
            if reused.id in seen:
                continue  # the same video listed twice in one playlist
            seen.add(reused.id)
            # Recency drives playlist order, so the reused track slots in.
            reused.recency_at = now - timedelta(seconds=i)
            memo_ids.append(reused.id)
            if data.download and not reused.file_path and reused.localize_status not in ("processing", "done"):
                reused.localize_status = "pending"
                download_ids.append(reused.id)
            continue
        try:
            domain = (_urlparse(entry["url"]).hostname or "").removeprefix("www.")
        except Exception:
            domain = ""
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=ws,
            type="audio",
            audio_kind="music",
            # Born from a playlist: lives inside it, stays out of the feeds.
            playlist_born=True,
            title=entry["title"],
            audio_artist=entry.get("artist"),
            source_url=entry["url"],
            source_domain=domain or None,
            source_favicon=(
                None
            ),
            thumbnail_path=entry.get("thumbnail"),
            # download=False leaves the track remote (no status) — it can be
            # pulled later per track or via the playlist's "download all".
            localize_status="pending" if data.download else None,
            created_at=now,
            updated_at=now,
            recency_at=now - timedelta(seconds=i),
        )
        db.add(memo)
        seen.add(memo.id)
        memo_ids.append(memo.id)
        new_ids.append(memo.id)
        if data.download:
            download_ids.append(memo.id)

    await db.flush()
    if memo_ids:
        await db.execute(
            insert(memo_collections),
            [{"memo_id": mid, "collection_id": collection.id} for mid in memo_ids],
        )
    await db.commit()

    if data.download and download_ids:
        # The download pass caches each track's thumbnail as it goes.
        queue_task(download_playlist_task, collection.id, download_ids)
    elif new_ids:
        # Still cache the remote cover thumbnails so the tiles survive the
        # source vanishing — metadata-only, no media downloads.
        queue_task(cache_playlist_thumbs_task, new_ids)

    return {
        "collection_id": collection.id,
        "title": collection.name,
        "total": len(memo_ids),
        "truncated": probed["truncated"],
        "status": "processing" if data.download else "saved",
    }


# --- Spotify ingestion (SpotiFLAC integration) ---

@router.post("/spotify/probe", dependencies=[Depends(music_relay_enabled)])
async def probe_spotify_url(data: SpotifyProbe, db: AsyncSession = Depends(get_db)):
    """Preview a Spotify track / album / playlist link without downloading.

    The Music add-modal calls this to show a real title + track count and to
    flag an already-saved playlist before the user commits.
    """
    import asyncio

    import httpx as _httpx

    from backend.core.spotiflac import (
        parse_spotify_url, spotify_track_meta, spotify_collection_meta,
    )

    parsed = parse_spotify_url(data.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Not a Spotify link")
    kind, sid = parsed

    def _fetch():
        with _httpx.Client(follow_redirects=True) as client:
            if kind == "track":
                return {"kind": "track", **spotify_track_meta(client, sid)}
            return {"kind": kind, **spotify_collection_meta(client, kind, sid)}

    try:
        meta = await asyncio.to_thread(_fetch)
    except Exception as e:
        log.warning("Spotify probe failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not read this Spotify link")

    if meta["kind"] == "track":
        return {
            "kind": "track",
            "title": meta["title"],
            "artist": meta.get("artist"),
            "cover": meta.get("cover"),
            "count": 1,
        }
    canonical = f"https://open.spotify.com/{kind}/{sid}"
    existing = await _find_saved_playlist(db, canonical)
    return {
        "kind": kind,
        "title": meta["title"],
        "cover": meta.get("cover"),
        "count": len(meta["tracks"]),
        "entries": [
            {"title": t["title"], "artist": t.get("artist")} for t in meta["tracks"][:6]
        ],
        "already_saved": {"id": existing.id, "name": existing.name} if existing else None,
    }


@router.post("/spotify", dependencies=[Depends(music_relay_enabled)])
async def ingest_spotify(
    data: SpotifyIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a Spotify track / album / playlist as lossless music (SpotiFLAC).

    A track becomes one music memo; an album/playlist becomes a playlist
    collection plus one music memo per track. Each track's `source_url` is its
    canonical Spotify URL, so the shared localize pipeline (which dispatches
    Spotify sources to the FLAC resolver) downloads it — per track, all at
    once, or right now when `download` is true.
    """
    import asyncio

    import httpx as _httpx
    from sqlalchemy import insert

    from backend.core.app_settings import get_settings, update_settings
    from backend.core.spotiflac import (
        parse_spotify_url, spotify_track_url, spotify_track_meta,
        spotify_collection_meta, VALID_QUALITIES,
    )

    parsed = parse_spotify_url(data.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Not a Spotify link")
    kind, sid = parsed
    ws = sanitize_workspace_id(data.workspace_id)

    # A chosen quality is remembered as the music default (the modal's setting).
    if data.quality and data.quality in VALID_QUALITIES:
        update_settings({"music_quality": data.quality})
    elif data.quality:
        raise HTTPException(status_code=400, detail="quality must be '16' or '24'")
    _ = get_settings()  # ensure the settings file exists

    # --- Single track ---
    if kind == "track":
        def _meta():
            with _httpx.Client(follow_redirects=True) as client:
                return spotify_track_meta(client, sid)
        try:
            meta = await asyncio.to_thread(_meta)
        except Exception as e:
            log.warning("Spotify track ingest failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not read this Spotify track")

        now = datetime.utcnow()
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=ws,
            type="audio",
            audio_kind="music",
            title=meta["title"],
            audio_artist=meta.get("artist"),
            source_url=meta["spotify_url"],
            source_domain="open.spotify.com",
            source_favicon=None,
            thumbnail_path=meta.get("cover"),
            localize_status="pending" if data.download else None,
            created_at=now,
            updated_at=now,
            recency_at=now,
        )
        db.add(memo)
        await _attach_collection(db, memo, data.collection_id)
        await db.commit()

        if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
            queue_task(cache_thumbnail, memo.id)
        if data.download:
            queue_task(localize_memo_task, memo.id, "audio")

        return {"id": memo.id, "title": memo.title, "type": "audio",
                "status": "processing" if data.download else "saved"}

    # --- Album / playlist ---
    canonical = f"https://open.spotify.com/{kind}/{sid}"
    existing = await _find_saved_playlist(db, canonical)
    if existing:
        return {"collection_id": existing.id, "title": existing.name,
                "total": 0, "status": "exists"}

    def _coll():
        with _httpx.Client(follow_redirects=True) as client:
            return spotify_collection_meta(client, kind, sid)
    try:
        probed = await asyncio.to_thread(_coll)
    except Exception as e:
        log.warning("Spotify %s ingest failed: %s", kind, e)
        raise HTTPException(status_code=400, detail=f"Could not read this Spotify {kind}")

    if not probed["tracks"]:
        raise HTTPException(status_code=400, detail="No tracks found in this Spotify link")

    collection = Collection(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        name=(data.title or probed["title"]).strip()[:200] or "Playlist",
        emoji="🎵",
        description=probed.get("description"),
        kind="playlist",
        # parse_spotify_url told us exactly what this is.
        music_kind="album" if kind == "album" else "playlist",
        source_url=canonical,
    )
    db.add(collection)

    # Reuse a track we already hold (same Spotify URL, audio, not deleted) —
    # one memo, two memberships, one download. Same rule as yt-dlp playlists.
    entry_urls = [t["spotify_url"] for t in probed["tracks"] if t.get("spotify_url")]
    existing_memos = (
        await db.execute(
            select(Memo).where(
                Memo.source_url.in_(entry_urls),
                Memo.type == "audio",
                (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
            )
        )
    ).scalars().all()
    by_url = {m.source_url: m for m in existing_memos}

    now = datetime.utcnow()
    memo_ids: list[str] = []
    download_ids: list[str] = []
    new_ids: list[str] = []
    seen: set[str] = set()
    for i, track in enumerate(probed["tracks"]):
        turl = track.get("spotify_url")
        if not turl:
            continue
        reused = by_url.get(turl)
        if reused is not None:
            if reused.id in seen:
                continue
            seen.add(reused.id)
            reused.recency_at = now - timedelta(seconds=i)
            memo_ids.append(reused.id)
            if data.download and not reused.file_path and reused.localize_status not in ("processing", "done"):
                reused.localize_status = "pending"
                download_ids.append(reused.id)
            continue
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=ws,
            type="audio",
            audio_kind="music",
            playlist_born=True,
            title=track["title"],
            audio_artist=track.get("artist"),
            # An album's tracks share the album name; playlist tracks get
            # theirs later from the Qobuz match during download.
            audio_album=probed["title"][:200] if kind == "album" else None,
            source_url=turl,
            source_domain="open.spotify.com",
            source_favicon=None,
            thumbnail_path=track.get("cover") or probed.get("cover"),
            localize_status="pending" if data.download else None,
            created_at=now,
            updated_at=now,
            recency_at=now - timedelta(seconds=i),
        )
        db.add(memo)
        seen.add(memo.id)
        memo_ids.append(memo.id)
        new_ids.append(memo.id)
        if data.download:
            download_ids.append(memo.id)

    await db.flush()
    if memo_ids:
        await db.execute(
            insert(memo_collections),
            [{"memo_id": mid, "collection_id": collection.id} for mid in memo_ids],
        )
    await db.commit()

    if data.download and download_ids:
        queue_task(download_playlist_task, collection.id, download_ids)
    elif new_ids:
        queue_task(cache_playlist_thumbs_task, new_ids)

    return {
        "collection_id": collection.id,
        "title": collection.name,
        "total": len(memo_ids),
        "status": "processing" if data.download else "saved",
    }


# --- Apple Music ingestion (second SpotiFLAC front-end, ADR-019) ---
# Apple Music shares the Spotify path's request/response contract exactly (a
# track/album/playlist URL in, the same preview + ingest shapes out), so it
# reuses SpotifyProbe/SpotifyIngest and the same lossless settings — only the
# metadata front-end differs. Audio still comes from Qobuz.
_APPLE_DOMAIN = "music.apple.com"
_APPLE_FAVICON = None


@router.post("/apple/probe", dependencies=[Depends(music_relay_enabled)])
async def probe_apple_url(data: SpotifyProbe, db: AsyncSession = Depends(get_db)):
    """Preview an Apple Music track / album / playlist link without downloading.

    Mirror of /spotify/probe; the Music add-modal calls it to show a real title
    + track count and flag an already-saved playlist before the user commits.
    """
    import asyncio

    import httpx as _httpx

    from backend.core.apple_music import (
        parse_apple_url, apple_track_meta, apple_collection_meta,
    )

    parsed = parse_apple_url(data.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Not an Apple Music link")
    kind = parsed[0]
    url = data.url.strip()

    def _fetch():
        with _httpx.Client(follow_redirects=True) as client:
            if kind == "track":
                return {"kind": "track", **apple_track_meta(client, url)}
            return {"kind": kind, **apple_collection_meta(client, kind, url)}

    try:
        meta = await asyncio.to_thread(_fetch)
    except Exception as e:
        log.warning("Apple Music probe failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not read this Apple Music link")

    if meta["kind"] == "track":
        return {
            "kind": "track",
            "title": meta["title"],
            "artist": meta.get("artist"),
            "cover": meta.get("cover"),
            "count": 1,
        }
    # Apple URLs are already canonical; key the dedup check on the trimmed URL.
    existing = await _find_saved_playlist(db, url)
    return {
        "kind": kind,
        "title": meta["title"],
        "cover": meta.get("cover"),
        "count": len(meta["tracks"]),
        "entries": [
            {"title": t["title"], "artist": t.get("artist")} for t in meta["tracks"][:6]
        ],
        "already_saved": {"id": existing.id, "name": existing.name} if existing else None,
    }


@router.post("/apple", dependencies=[Depends(music_relay_enabled)])
async def ingest_apple(
    data: SpotifyIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Ingest an Apple Music track / album / playlist as lossless music.

    Verbatim sibling of /spotify: a track becomes one music memo; an
    album/playlist becomes a playlist collection + one memo per track, each with
    its canonical Apple URL as source_url so localize_memo_task dispatches it to
    the FLAC resolver (download_apple_track).
    """
    import asyncio

    import httpx as _httpx
    from sqlalchemy import insert

    from backend.core.app_settings import get_settings, update_settings
    from backend.core.apple_music import (
        parse_apple_url, apple_track_meta, apple_collection_meta,
    )
    from backend.core.spotiflac import VALID_QUALITIES

    parsed = parse_apple_url(data.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Not an Apple Music link")
    kind = parsed[0]
    url = data.url.strip()
    ws = sanitize_workspace_id(data.workspace_id)

    if data.quality and data.quality in VALID_QUALITIES:
        update_settings({"music_quality": data.quality})
    elif data.quality:
        raise HTTPException(status_code=400, detail="quality must be '16' or '24'")
    _ = get_settings()

    # --- Single track ---
    if kind == "track":
        def _meta():
            with _httpx.Client(follow_redirects=True) as client:
                return apple_track_meta(client, url)
        try:
            meta = await asyncio.to_thread(_meta)
        except Exception as e:
            log.warning("Apple Music track ingest failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not read this Apple Music track")

        now = datetime.utcnow()
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=ws,
            type="audio",
            audio_kind="music",
            title=meta["title"],
            audio_artist=meta.get("artist"),
            # Apple's track meta already carries the album (header fallback),
            # unlike the Spotify embed — set it now rather than wait for Qobuz.
            audio_album=(meta.get("album") or None),
            source_url=meta["apple_url"],
            source_domain=_APPLE_DOMAIN,
            source_favicon=_APPLE_FAVICON,
            thumbnail_path=meta.get("cover"),
            localize_status="pending" if data.download else None,
            created_at=now,
            updated_at=now,
            recency_at=now,
        )
        db.add(memo)
        await _attach_collection(db, memo, data.collection_id)
        await db.commit()

        if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
            queue_task(cache_thumbnail, memo.id)
        if data.download:
            queue_task(localize_memo_task, memo.id, "audio")

        return {"id": memo.id, "title": memo.title, "type": "audio",
                "status": "processing" if data.download else "saved"}

    # --- Album / playlist ---
    canonical = url
    existing = await _find_saved_playlist(db, canonical)
    if existing:
        return {"collection_id": existing.id, "title": existing.name,
                "total": 0, "status": "exists"}

    def _coll():
        with _httpx.Client(follow_redirects=True) as client:
            return apple_collection_meta(client, kind, url)
    try:
        probed = await asyncio.to_thread(_coll)
    except Exception as e:
        log.warning("Apple Music %s ingest failed: %s", kind, e)
        raise HTTPException(status_code=400, detail=f"Could not read this Apple Music {kind}")

    if not probed["tracks"]:
        raise HTTPException(status_code=400, detail="No tracks found in this Apple Music link")

    collection = Collection(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        name=(data.title or probed["title"]).strip()[:200] or "Playlist",
        emoji="🎵",
        description=probed.get("description"),
        kind="playlist",
        music_kind="album" if kind == "album" else "playlist",
        source_url=canonical,
    )
    db.add(collection)

    # Reuse a track we already hold (same Apple URL, audio, not deleted).
    entry_urls = [t["apple_url"] for t in probed["tracks"] if t.get("apple_url")]
    existing_memos = (
        await db.execute(
            select(Memo).where(
                Memo.source_url.in_(entry_urls),
                Memo.type == "audio",
                (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
            )
        )
    ).scalars().all()
    by_url = {m.source_url: m for m in existing_memos}

    now = datetime.utcnow()
    memo_ids: list[str] = []
    download_ids: list[str] = []
    new_ids: list[str] = []
    seen: set[str] = set()
    for i, track in enumerate(probed["tracks"]):
        turl = track.get("apple_url")
        if not turl:
            continue
        reused = by_url.get(turl)
        if reused is not None:
            if reused.id in seen:
                continue
            seen.add(reused.id)
            reused.recency_at = now - timedelta(seconds=i)
            memo_ids.append(reused.id)
            if data.download and not reused.file_path and reused.localize_status not in ("processing", "done"):
                reused.localize_status = "pending"
                download_ids.append(reused.id)
            continue
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=ws,
            type="audio",
            audio_kind="music",
            playlist_born=True,
            title=track["title"],
            audio_artist=track.get("artist"),
            # Playlist track items already carry their own album; album pages
            # share one, so fall back to the collection title there.
            audio_album=(track.get("album") or (probed["title"][:200] if kind == "album" else None)),
            source_url=turl,
            source_domain=_APPLE_DOMAIN,
            source_favicon=_APPLE_FAVICON,
            thumbnail_path=track.get("cover") or probed.get("cover"),
            localize_status="pending" if data.download else None,
            created_at=now,
            updated_at=now,
            recency_at=now - timedelta(seconds=i),
        )
        db.add(memo)
        seen.add(memo.id)
        memo_ids.append(memo.id)
        new_ids.append(memo.id)
        if data.download:
            download_ids.append(memo.id)

    await db.flush()
    if memo_ids:
        await db.execute(
            insert(memo_collections),
            [{"memo_id": mid, "collection_id": collection.id} for mid in memo_ids],
        )
    await db.commit()

    if data.download and download_ids:
        queue_task(download_playlist_task, collection.id, download_ids)
    elif new_ids:
        queue_task(cache_playlist_thumbs_task, new_ids)

    return {
        "collection_id": collection.id,
        "title": collection.name,
        "total": len(memo_ids),
        "status": "processing" if data.download else "saved",
    }


async def cache_playlist_thumbs_task(memo_ids: list[str]):
    """Background: cache remote track thumbnails locally (no media download)."""
    for memo_id in memo_ids:
        try:
            await cache_thumbnail(memo_id)
        except Exception as e:
            log.warning("Playlist thumbnail cache failed for %s: %s", memo_id, e)


# ── Bulk playlist-download control (restart-safe, no job table) ──
# Two module-level registries track the sequential downloader so the Music page
# can show a Pause button only while a bulk pass is actually running:
#   _ACTIVE  — collection_ids with a download pass in flight right now.
#   _PAUSED  — collection_ids whose pass should stop at the next track boundary.
# The downloader can't interrupt a track mid-fetch (the localize await blocks),
# so pausing stops it from starting further tracks; the one in flight finishes.
_ACTIVE_PLAYLIST_DOWNLOADS: set[str] = set()
_PAUSED_PLAYLIST_DOWNLOADS: set[str] = set()


def playlist_download_active(collection_id: str) -> bool:
    """True while a bulk download pass is running for this playlist."""
    return collection_id in _ACTIVE_PLAYLIST_DOWNLOADS


def pause_playlist_download(collection_id: str) -> None:
    """Ask the running bulk pass to stop after its current track."""
    _PAUSED_PLAYLIST_DOWNLOADS.add(collection_id)


def clear_playlist_pause(collection_id: str) -> None:
    """Drop any pending pause — a fresh download (or resume) clears it."""
    _PAUSED_PLAYLIST_DOWNLOADS.discard(collection_id)


async def download_playlist_task(
    collection_id: str,
    memo_ids: list[str],
    replacing: dict[str, str] | None = None,
):
    """Background: download a playlist's tracks one at a time.

    Sequential on purpose — kind to the host and to the disk. Each track runs
    the existing localize pipeline (status pending → processing → done|error on
    the memo), then its remote thumbnail is cached locally. One dead track
    never aborts the rest; failures stay retryable per memo via Make-it-local.

    Tracks that end the pass in `error` get one more pass after a cooldown —
    the shared Qobuz community endpoint rate-limits bursts (429), so on bigger
    albums a few tracks routinely fail the first time and succeed minutes later.

    A pause request (Music page) stops the loop at the next track boundary; the
    track in flight finishes, the rest are left for the pause endpoint to reset
    back to remote so their cloud chips return.

    `replacing` maps memo_id → the file this pass supersedes (a forced full
    re-download of an album whose tracks are already on disk). The old file is
    deleted only once the memo points at a different file that really landed —
    a failed re-pull leaves the track playing exactly as it was.
    """
    import asyncio

    from backend.core.file_paths import resolve_memo_path

    async def _drop_superseded(memo_id: str):
        old = (replacing or {}).get(memo_id)
        if not old:
            return
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            status = memo.localize_status if memo else None
            new_path = memo.file_path if memo else None
        if status != "done":
            return  # the re-pull failed — the old file is still the only copy
        landed = resolve_memo_path(new_path) if new_path else None
        if landed is None or str(landed) == old:
            return
        try:
            Path(old).unlink()
        except Exception as e:
            log.warning("Could not remove superseded file %s: %s", old, e)

    async def _download_one(memo_id: str):
        try:
            await localize_memo_task(memo_id, "audio")
        except Exception as e:
            log.warning("Playlist track download crashed for %s: %s", memo_id, e)
        try:
            await _drop_superseded(memo_id)
        except Exception as e:
            log.warning("Superseded-file cleanup failed for %s: %s", memo_id, e)
        try:
            await cache_thumbnail(memo_id)
        except Exception as e:
            log.warning("Playlist thumbnail cache failed for %s: %s", memo_id, e)

    _ACTIVE_PLAYLIST_DOWNLOADS.add(collection_id)
    _PAUSED_PLAYLIST_DOWNLOADS.discard(collection_id)
    try:
        for memo_id in memo_ids:
            if collection_id in _PAUSED_PLAYLIST_DOWNLOADS:
                log.info("Playlist %s: download paused", collection_id)
                return
            await _download_one(memo_id)

        async with AsyncSessionLocal() as db:
            rows = await db.execute(
                select(Memo.id).where(Memo.id.in_(memo_ids), Memo.localize_status == "error")
            )
            failed = [r[0] for r in rows]
        if failed and collection_id not in _PAUSED_PLAYLIST_DOWNLOADS:
            log.info("Playlist %s: retrying %d failed track(s) after cooldown", collection_id, len(failed))
            await asyncio.sleep(90)
            for memo_id in failed:
                if collection_id in _PAUSED_PLAYLIST_DOWNLOADS:
                    log.info("Playlist %s: download paused", collection_id)
                    return
                await _download_one(memo_id)

        log.info("Playlist %s: download pass finished (%d track(s))", collection_id, len(memo_ids))
    finally:
        _ACTIVE_PLAYLIST_DOWNLOADS.discard(collection_id)
        _PAUSED_PLAYLIST_DOWNLOADS.discard(collection_id)


@router.post("/note")
async def ingest_note(
    data: NoteIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Create a note memo."""
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type="note",
        title=data.title,
        content_text=data.content,
        content_raw=data.content,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    queue_task(process_memo, memo.id)

    return {"id": memo.id, "title": memo.title, "type": "note", "status": "processing"}


# --- Carousel from pasted links ---

# A URL path ending in one of these IS the picture, so it goes straight into the
# gallery with no network round trip at all.
_IMAGE_URL_RE = re.compile(r"\.(?:jpe?g|png|webp|gif|avif|bmp|svg)(?:[?#]|$)", re.I)

# Hard ceiling on one carousel. Every slide is downloaded and stored locally, so
# an accidental paste of a hundred links should be refused, not obeyed.
MAX_GALLERY_SLIDES = 40


def _looks_like_image_url(url: str) -> bool:
    """True when the URL path itself names an image file."""
    from urllib.parse import urlparse

    try:
        return bool(_IMAGE_URL_RE.search(urlparse(url).path))
    except Exception:
        return False


async def _resolve_slide(url: str) -> Optional[dict]:
    """One pasted link → one carousel slide, or None if it holds no picture.

    Three ways a link can be "an image", cheapest first:
      1. the URL is the file          — a CDN .jpg/.png/… path, used as-is
      2. the URL SERVES an image      — no extension, but the response is one
         (Unsplash /download, signed CDN links, most share URLs)
      3. the URL is a PAGE about one  — resolved through the normal extractor,
         which is what makes an Instagram or Pinterest post work here too

    Returns {"url", "type"} so a video link pasted into the set lands as a video
    slide instead of a broken picture.
    """
    from backend.core.extractor import _is_video_media_url

    if _is_video_media_url(url):
        return {"url": url, "type": "video"}
    if _looks_like_image_url(url):
        return {"url": url, "type": "image"}

    # 2 — ask the server what it serves, without pulling the body. Many CDNs
    # refuse HEAD, so a refusal retries as a streamed GET whose headers arrive
    # before any bytes do.
    import httpx

    try:
        async with httpx.AsyncClient(
            timeout=12, follow_redirects=True, headers=_thumb_headers(url)
        ) as client:
            resp = await client.head(url)
            ctype = resp.headers.get("content-type", "")
            if resp.status_code >= 400 or not ctype:
                async with client.stream("GET", url) as sresp:
                    ctype = sresp.headers.get("content-type", "")
            head = ctype.split(";")[0].strip().lower()
            if head.startswith("image/"):
                return {"url": url, "type": "image"}
            if head.startswith("video/"):
                return {"url": url, "type": "video"}
    except Exception:
        pass

    # 3 — a real page: let the resolver ladder find its picture.
    try:
        from backend.core.extractor import extract_url

        meta = await extract_url(url)
    except Exception:
        return None
    thumb = (meta or {}).get("thumbnail_path") or ""
    # A link that resolves to its OWN carousel contributes only its first slide
    # — one memo, one flat list, no nesting.
    gallery = (meta or {}).get("gallery") or []
    if not thumb and gallery:
        first = gallery[0]
        thumb = first.get("url") if isinstance(first, dict) else None
    if thumb and str(thumb).startswith("http"):
        return {"url": thumb, "type": "image"}
    return None


@router.post("/gallery")
async def ingest_gallery(data: GalleryIngest, db: AsyncSession = Depends(get_db)):
    """Several image links → ONE carousel memo.

    Each link is resolved to a picture (see `_resolve_slide`) and the set becomes
    a single image memo whose `gallery` holds every slide in paste order.
    `cache_gallery` then downloads all of them to disk, so the memo keeps working
    after any of the sources rot — which is the point of bundling them here
    rather than keeping a list of links.

    Links that resolve to nothing are skipped and named in the response, so one
    dead URL in a paste of eight never costs the other seven.
    """
    raw = [u.strip() for u in (data.urls or []) if u and u.strip()]
    # De-dupe, keeping paste order: the same picture twice is never the intent.
    seen: set[str] = set()
    urls = [u for u in raw if not (u in seen or seen.add(u))]
    if not urls:
        raise HTTPException(status_code=400, detail="No links given")
    if len(urls) > MAX_GALLERY_SLIDES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many links ({len(urls)}). A carousel holds at most {MAX_GALLERY_SLIDES}.",
        )
    for u in urls:
        validate_url(u)

    # Resolve concurrently — a paste of ten page links would otherwise be ten
    # sequential fetches. Exceptions are captured, never raised into the request.
    resolved = await asyncio.gather(
        *(_resolve_slide(u) for u in urls), return_exceptions=True
    )
    ok = [isinstance(r, dict) and bool(r.get("url")) for r in resolved]
    slides = [r for r, good in zip(resolved, ok) if good]
    failed = [u for u, good in zip(urls, ok) if not good]

    if not slides:
        raise HTTPException(
            status_code=400, detail="None of those links resolved to an image."
        )

    from urllib.parse import urlparse

    domain = (urlparse(urls[0]).netloc or "").lstrip("www.")
    title = (data.title or "").strip() or (
        f"{len(slides)} images" if len(slides) > 1 else "Saved image"
    )
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type="image",
        title=title,
        description=(data.description or "").strip() or None,
        # The sources stay in the body so the memo still remembers where each
        # picture came from once every slide is a local path.
        content_text="\n".join(urls),
        source_domain=domain or None,
        source_favicon=None,
        thumbnail_path=slides[0]["url"],
        # One surviving slide is not a carousel — leave `gallery` empty so the
        # memo renders as the plain image it is.
        gallery=slides if len(slides) > 1 else None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    still_remote = await localize_pictures_inline(memo)

    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    queue_task(process_memo, memo.id)
    if still_remote:
        if memo.gallery:
            queue_task(cache_gallery, memo.id)
        else:
            queue_task(cache_thumbnail, memo.id)

    return {
        "id": memo.id,
        "title": memo.title,
        "type": "image",
        "status": "processing",
        "slides": len(slides),
        "failed": failed,
        "pictures_pending": still_remote,
    }


# Types a caller may force via `type_override` on /file. Mirrors the taxonomy
# in core/classify.py. Used by the mic recorder: a browser records audio into a
# WebM container (.webm), which the extension map files as "video" — the
# override lets the client declare it is really an audio memo.
_OVERRIDABLE_TYPES = {
    "note", "link", "image", "video", "audio", "document", "code", "file",
}


@router.post("/file")
async def ingest_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    workspace_id: str = Form(default="default"),
    collection_id: Optional[str] = Form(default=None),
    type_override: Optional[str] = Form(default=None),
    transcribe: bool = Form(default=False),
    audio_kind: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Upload and ingest a file (PDF, DOCX, image, audio).

    `type_override` lets a trusted client pin the memo type when the file
    extension would categorize it wrong (e.g. a mic recording in a .webm
    container is audio, not video). Ignored unless it is a known type.

    `transcribe` (audio only) schedules background speech-to-text after save.
    """
    ws = sanitize_workspace_id(workspace_id)

    # Use secure upload handler
    result = await _upload_handler.save(file, workspace_id=ws)

    memo_type = result.type
    if type_override and type_override in _OVERRIDABLE_TYPES:
        memo_type = type_override

    want_transcript = bool(transcribe) and memo_type == "audio"

    # Create memo
    memo = Memo(
        id=Path(result.path).stem,
        workspace_id=ws,
        type=memo_type,
        title=result.filename,
        file_path=result.path,
        transcript_status="pending" if want_transcript else None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    # Audio sub-kind (ADR-005): mic recorder posts audio_kind='voice'; plain
    # uploads default to music. NULL for non-audio memos.
    memo.audio_kind = derive_audio_kind(memo, audio_kind)

    db.add(memo)
    await _attach_collection(db, memo, collection_id)
    await db.commit()

    # Process in background (extract text from file)
    queue_task(process_file_memo, memo.id, result.path, memo_type)
    if want_transcript:
        queue_task(transcribe_memo_task, memo.id)

    return {"id": memo.id, "title": memo.title, "type": memo_type, "status": "processing"}


# --- Album / playlist upload (local files → auto-grouped collection) ---

# Image extensions accepted as a cover alongside the audio in an album upload.
_COVER_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"}
_COVER_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
    ".bmp": "image/bmp",
}


def _save_cover_bytes(data: bytes, mime: str) -> Optional[str]:
    """Persist cover image bytes under the thumbs dir; return its serve URL."""
    if not data:
        return None
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    ext = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
        "image/gif": ".gif", "image/avif": ".avif", "image/bmp": ".bmp",
    }.get((mime or "").split(";")[0].strip(), ".jpg")
    name = f"{uuid.uuid4().hex}{ext}"
    (THUMBS_DIR / name).write_bytes(data)
    return f"/api/files/thumb/{name}"


@router.post("/album")
async def ingest_album(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    workspace_id: str = Form(default="default"),
    mode: str = Form(default="album"),
    name: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Import local audio files as an auto-grouped album (or one playlist).

    Drop a bunch of tracks (optionally with a cover image, or images embedded in
    the files) and this builds playable music with no manual tagging:

    · **mode="album"** — tracks are grouped by their embedded *album* tag; each
      distinct album becomes its own ``music_kind="album"`` collection. Files
      with no album tag fall into one album named from ``name`` (or "Untitled
      Album"). Tracks order by their tag track-number.
    · **mode="playlist"** — every track lands in a single ``music_kind=
      "playlist"`` collection named from ``name`` (or "New Playlist").

    Cover precedence (per the product call): a **dropped image wins** — if any
    image file is in the upload it is the cover for everything created; only when
    no image is supplied do we fall back to art embedded in the tracks.

    Tracks are stored local + playable immediately (no download step) and are
    ``playlist_born`` so they live inside their collection, Spotify-style.
    """
    from sqlalchemy import insert

    from backend.core.audio_meta import read_audio_tags, extract_cover_bytes
    from backend.core.security.upload import categorize_extension

    ws = sanitize_workspace_id(workspace_id)
    mode = mode if mode in ("album", "playlist") else "album"

    # 1) Split the upload into audio tracks (saved to disk) and a dropped cover.
    saved_tracks: list[dict] = []   # {path, filename, tags}
    dropped_cover: Optional[tuple[bytes, str]] = None
    for up in files:
        ext = Path(up.filename or "").suffix.lower()
        if ext in _COVER_EXTS:
            if dropped_cover is None:  # first image is the cover
                data = await up.read()
                if data:
                    dropped_cover = (data, _COVER_MIME.get(ext, "image/jpeg"))
            continue
        if categorize_extension(ext) != "audio":
            continue  # skip anything that isn't audio or a cover image
        result = await _upload_handler.save(up, workspace_id=ws)
        saved_tracks.append({
            "path": result.path,
            "filename": result.filename,
            "tags": read_audio_tags(result.path),
        })

    if not saved_tracks:
        raise HTTPException(status_code=400, detail="No audio files in the upload")

    # 2) Group the tracks into collections.
    fallback_name = (name or "").strip() or ("New Playlist" if mode == "playlist" else "Untitled Album")
    groups: dict[str, dict] = {}
    for t in saved_tracks:
        if mode == "playlist":
            key, display = "__playlist__", fallback_name
        else:
            album = (t["tags"].get("album") or "").strip()
            key = album.lower() if album else "__untitled__"
            display = album or fallback_name
        g = groups.setdefault(key, {"name": display, "tracks": []})
        g["tracks"].append(t)

    # 3) A dropped image is the cover for everything; resolve it once.
    shared_cover_url = _save_cover_bytes(*dropped_cover) if dropped_cover else None

    now = datetime.utcnow()
    created: list[dict] = []
    for g in groups.values():
        tracks = g["tracks"]
        # Order by tag track-number, untagged tracks trailing in upload order.
        tracks.sort(key=lambda t: (t["tags"].get("track") is None, t["tags"].get("track") or 0))

        # Cover: dropped image wins; otherwise the first track's embedded art.
        cover_url = shared_cover_url
        if cover_url is None:
            for t in tracks:
                emb = extract_cover_bytes(t["path"])
                if emb:
                    cover_url = _save_cover_bytes(*emb)
                    break

        collection = Collection(
            id=str(uuid.uuid4()),
            workspace_id=ws,
            name=g["name"][:200] or fallback_name,
            emoji="🎵",
            kind="playlist",
            music_kind="playlist" if mode == "playlist" else "album",
        )
        db.add(collection)

        memo_ids: list[str] = []
        for i, t in enumerate(tracks):
            tags = t["tags"]
            memo = Memo(
                id=Path(t["path"]).stem,
                workspace_id=ws,
                type="audio",
                audio_kind="music",
                playlist_born=True,
                title=(tags.get("title") or Path(t["filename"]).stem)[:300],
                audio_artist=(tags.get("artist") or None),
                audio_album=(g["name"] if mode == "album" else (tags.get("album") or None)),
                file_path=t["path"],
                thumbnail_path=cover_url,
                created_at=now,
                updated_at=now,
                recency_at=now - timedelta(seconds=i),
            )
            db.add(memo)
            memo_ids.append(memo.id)

        await db.flush()
        if memo_ids:
            await db.execute(
                insert(memo_collections),
                [{"memo_id": mid, "collection_id": collection.id} for mid in memo_ids],
            )
        created.append({"collection_id": collection.id, "title": collection.name, "tracks": len(memo_ids)})

    await db.commit()

    # Embed each track's (sparse) text so it is searchable like any memo.
    for t in saved_tracks:
        queue_task(process_memo, Path(t["path"]).stem)

    first = created[0]
    return {
        "collection_id": first["collection_id"],
        "title": first["title"],
        "total": sum(c["tracks"] for c in created),
        "collections": created,
        "status": "saved",
    }


async def transcript_memo_task(memo_id: str):
    """Background: extract a transcript for a video/audio memo without changing
    its type or file_path (caption-first, Whisper STT fallback — see
    core/transcript.py / ADR-004). Stores the timestamped text in content_text
    (so it embeds + is searchable), records language + source. Status flows
    pending → processing → done | error on memo.transcript_status.

    One rule holds the whole thing together: `done` means content_text really is
    a transcript of the spoken audio. When no stage produces text the memo lands
    in `error` with content_text untouched — a video's own description is never
    passed off as its transcript.
    """
    from backend.core.transcript import get_transcript
    from backend.core.file_paths import resolve_memo_path

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not (memo.file_path or memo.source_url):
            return
        url = memo.source_url
        file_path = memo.file_path
        is_audio = memo.type == "audio"
        ws = memo.workspace_id or "default"
        memo.transcript_status = "processing"
        await db.commit()

    local = None
    if file_path:
        local = str(resolve_memo_path(file_path) or Path(file_path))

    error = None
    try:
        result = await get_transcript(url, ws, local_path=local)
        text = (result.get("text") or "").strip()
        lang = result.get("lang")
        source = result.get("source")
        status = "done" if text else "error"
    except Exception as e:
        log.warning("Transcript failed for %s: %s", memo_id, e)
        text, lang, source, status, error = "", None, None, "error", str(e)

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        if text:
            memo.content_text = text
            # For a voice/audio memo the transcript *is* the body, so it also
            # becomes content_raw. A video keeps its own description there.
            if is_audio:
                memo.content_raw = text
            if not memo.description:
                memo.description = text[:200]
        memo.transcript_lang = lang
        memo.transcript_source = source
        memo.transcript_status = status
        memo.updated_at = datetime.utcnow()
        await db.commit()

    if status == "done" and text:
        await process_memo(memo_id)
    elif error:
        log.info("Transcript for %s ended in error: %s", memo_id, error)


async def transcribe_memo_task(memo_id: str):
    """Back-compat entry point. Local-file memos used to take a separate
    Whisper-only path that skipped host captions and marked an empty Whisper
    result 'done'. Everything routes through the one pipeline above now; this
    name survives so jobs queued as kind='transcribe' by an older build (and the
    handler that runs them) still resolve.
    """
    await transcript_memo_task(memo_id)


async def _localize_spotify_track(memo_id: str, url: str, ws: str):
    """Background: resolve a Spotify track to lossless FLAC (SpotiFLAC) and
    re-home it as a local music memo. Status is already 'processing' on entry;
    this writes done | error. Never raises into the caller."""
    import asyncio

    from backend.config import settings as cfg
    from backend.core.app_settings import get_settings
    from backend.core.spotiflac import download_spotify_track, SpotiFlacError

    quality = str(get_settings().get("music_quality", "24"))
    dest_dir = Path(cfg.FILES_DIR) / ws

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        # Pass known title/artist so the resolver can skip the embed lookup,
        # and the cover URL so it gets embedded into the FLAC's tags.
        title = memo.title if memo else None
        artist = memo.audio_artist if memo else None
        cover = memo.thumbnail_path if memo else None
        if cover and not cover.startswith("http"):
            cover = None  # already cached locally — tagging wants the source URL

    try:
        result = await asyncio.to_thread(
            download_spotify_track, url, dest_dir, quality, title, artist, cover
        )
    except SpotiFlacError as e:
        log.warning("spotify localize failed memo=%s: %s", memo_id, e)
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.localize_status = "error"
                memo.localize_error = str(e)[:300]
                memo.updated_at = datetime.utcnow()
                await db.commit()
        return
    except Exception as e:
        log.exception("spotify localize crashed memo=%s: %s", memo_id, e)
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.localize_status = "error"
                memo.localize_error = str(e)[:300]
                memo.updated_at = datetime.utcnow()
                await db.commit()
        return

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        memo.file_path = result["path"]
        memo.type = "audio"
        memo.audio_kind = "music"
        if result.get("artist") and not memo.audio_artist:
            memo.audio_artist = result["artist"][:200]
        if result.get("album") and not memo.audio_album:
            memo.audio_album = result["album"][:200]
        # Keep the Spotify cover as the thumbnail when none is set yet; the
        # caller schedules cache_thumbnail to re-home it locally.
        if result.get("cover") and not memo.thumbnail_path:
            memo.thumbnail_path = result["cover"]
        memo.localize_status = "done"
        memo.localize_error = None
        memo.updated_at = datetime.utcnow()
        await db.commit()


async def _localize_apple_track(memo_id: str, url: str, ws: str):
    """Background: resolve an Apple Music track to lossless FLAC and re-home it.

    Verbatim sibling of _localize_spotify_track — only the resolver differs
    (download_apple_track). Status is 'processing' on entry; writes done | error.
    Never raises into the caller.
    """
    import asyncio

    from backend.config import settings as cfg
    from backend.core.app_settings import get_settings
    from backend.core.apple_music import download_apple_track
    from backend.core.spotiflac import SpotiFlacError

    quality = str(get_settings().get("music_quality", "24"))
    dest_dir = Path(cfg.FILES_DIR) / ws

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        title = memo.title if memo else None
        artist = memo.audio_artist if memo else None
        cover = memo.thumbnail_path if memo else None
        if cover and not cover.startswith("http"):
            cover = None  # already cached locally — tagging wants the source URL

    try:
        result = await asyncio.to_thread(
            download_apple_track, url, dest_dir, quality, title, artist, cover
        )
    except SpotiFlacError as e:
        log.warning("apple localize failed memo=%s: %s", memo_id, e)
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.localize_status = "error"
                memo.localize_error = str(e)[:300]
                memo.updated_at = datetime.utcnow()
                await db.commit()
        return
    except Exception as e:
        log.exception("apple localize crashed memo=%s: %s", memo_id, e)
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.localize_status = "error"
                memo.localize_error = str(e)[:300]
                memo.updated_at = datetime.utcnow()
                await db.commit()
        return

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        memo.file_path = result["path"]
        memo.type = "audio"
        memo.audio_kind = "music"
        if result.get("artist") and not memo.audio_artist:
            memo.audio_artist = result["artist"][:200]
        if result.get("album") and not memo.audio_album:
            memo.audio_album = result["album"][:200]
        if result.get("cover") and not memo.thumbnail_path:
            memo.thumbnail_path = result["cover"]
        memo.localize_status = "done"
        memo.localize_error = None
        memo.updated_at = datetime.utcnow()
        await db.commit()


async def localize_memo_task(memo_id: str, mode: str, quality: int = 1080):
    """Background: download a memo's remote source via yt-dlp and re-home it as a
    local video/audio memo. `mode='audio'` is an explicit video→audio conversion.
    `quality` caps the video height (720/1080/1440/2160, OPNMMO-0022).
    Status flows pending → processing → done | error on memo.localize_status.

    Spotify track sources take a different route entirely (no yt-dlp): the
    SpotiFLAC integration resolves a lossless FLAC. Dispatching here means
    every entry point — the per-track chip, a playlist's "download all", and
    the playlist auto-download pass — handles Spotify with zero extra wiring.
    """
    from backend.core.localize_media import localize_media, LocalizeError
    from backend.core.spotiflac import is_spotify_track_url
    from backend.core.apple_music import is_apple_track_url

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.source_url:
            return
        url = memo.source_url
        ws = memo.workspace_id or "default"
        memo.localize_status = "processing"
        memo.localize_error = None  # clear any stale failure from a prior attempt
        await db.commit()

    if is_spotify_track_url(url):
        await _localize_spotify_track(memo_id, url, ws)
        return

    if is_apple_track_url(url):
        await _localize_apple_track(memo_id, url, ws)
        return

    try:
        result = await localize_media(url, ws, mode, quality)
    except LocalizeError as e:
        log.warning("Localize failed for %s: %s", memo_id, e)
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.localize_status = "error"
                memo.localize_error = str(e)[:300]
                memo.updated_at = datetime.utcnow()
                await db.commit()
        return
    except Exception as e:
        log.error("Localize crashed for %s: %s", memo_id, e)
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.localize_status = "error"
                memo.localize_error = str(e)[:300]
                memo.updated_at = datetime.utcnow()
                await db.commit()
        return

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return
        memo.file_path = result["path"]
        memo.type = result["type"]
        # A localized/converted audio is music (linked source); keep voice intact.
        memo.audio_kind = derive_audio_kind(memo, memo.audio_kind)
        memo.localize_status = "done"
        memo.localize_error = None
        memo.updated_at = datetime.utcnow()
        await db.commit()

    # Thumbnail after localize: prefer source thumbnail (YouTube etc.) over
    # ffmpeg frame. Only extract ffmpeg frame if no thumbnail exists at all.
    if result["type"] == "video":
        try:
            async with AsyncSessionLocal() as db:
                memo = await db.get(Memo, memo_id)
                has_thumb = memo and memo.thumbnail_path

            ytdlp_thumb = result.get("thumbnail_url")
            if not has_thumb and ytdlp_thumb:
                # Cache the source thumbnail locally.
                local = await _download_thumb(ytdlp_thumb, memo_id)
                if local:
                    async with AsyncSessionLocal() as db:
                        memo = await db.get(Memo, memo_id)
                        if memo:
                            memo.thumbnail_path = local
                            memo.updated_at = datetime.utcnow()
                            await db.commit()
                    has_thumb = True

            if not has_thumb:
                from backend.core.video import extract_video_thumbnail

                THUMBS_DIR.mkdir(parents=True, exist_ok=True)
                thumb_target = THUMBS_DIR / f"{memo_id}.jpg"
                if await extract_video_thumbnail(result["path"], thumb_target):
                    async with AsyncSessionLocal() as db:
                        memo = await db.get(Memo, memo_id)
                        if memo:
                            memo.thumbnail_path = f"/api/files/thumb/{memo_id}.jpg"
                            memo.updated_at = datetime.utcnow()
                            await db.commit()
        except Exception as e:
            log.warning("Thumbnail after localize failed for %s: %s", memo_id, e)


# Map code/text extensions to a Markdown fence language for syntax rendering.
_CODE_LANG = {
    ".py": "python", ".js": "javascript", ".jsx": "jsx", ".ts": "typescript",
    ".tsx": "tsx", ".java": "java", ".c": "c", ".h": "c", ".cpp": "cpp",
    ".hpp": "cpp", ".cc": "cpp", ".cs": "csharp", ".go": "go", ".rs": "rust",
    ".rb": "ruby", ".php": "php", ".swift": "swift", ".kt": "kotlin",
    ".scala": "scala", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".ps1": "powershell", ".bat": "batch", ".sql": "sql", ".html": "html",
    ".htm": "html", ".css": "css", ".scss": "scss", ".sass": "sass",
    ".less": "less", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml", ".ini": "ini", ".xml": "xml", ".md": "markdown",
    ".lua": "lua", ".r": "r", ".dart": "dart", ".vue": "vue",
    ".svelte": "svelte", ".graphql": "graphql", ".proto": "protobuf",
}


def _read_audio_artist(file_path: str) -> str | None:
    """Best-effort artist tag from any uploaded audio file (ID3 / MP4 / Vorbis /
    FLAC / …) via mutagen's easy interface. Returns None when there's no tag or
    mutagen isn't installed — we never fall back to the source domain (ADR-010)."""
    try:
        from mutagen import File as MutagenFile

        mf = MutagenFile(file_path, easy=True)
        tags = getattr(mf, "tags", None)
        if not tags:
            return None
        for key in ("artist", "albumartist", "composer"):
            val = tags.get(key)
            if val:
                a = (val[0] if isinstance(val, (list, tuple)) else val)
                a = str(a).strip()
                if a:
                    return a[:200]
    except Exception:
        pass
    return None


async def process_file_memo(memo_id: str, file_path: str, memo_type: str):
    """Background: extract text from file and embed.

    SECURITY: uploaded files are NEVER executed or interpreted. Code/script
    files are only opened in read mode for text extraction and stored — no
    subprocess, exec, eval, import, or shell invocation touches uploaded
    content anywhere in the ingestion path.
    """
    from backend.core.extractor import extract_pdf, extract_docx, extract_image
    from backend.core.pdf_thumb import extract_pdf_thumbnail
    from backend.core.video import extract_video_thumbnail

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return

        # Video → grab a still frame for the grid thumbnail. Best-effort:
        # if ffmpeg is missing or fails, the video memo just renders without
        # a thumb (same path as before).
        if memo_type == "video":
            THUMBS_DIR.mkdir(parents=True, exist_ok=True)
            thumb_name = f"{memo_id}.jpg"
            thumb_target = THUMBS_DIR / thumb_name
            if await extract_video_thumbnail(file_path, thumb_target):
                memo.thumbnail_path = f"/api/files/thumb/{thumb_name}"
                memo.updated_at = datetime.utcnow()
                await db.commit()

        # PDF → page one becomes the card's cover, the same way a video's first
        # frame does. Keyed off the extension rather than memo_type, because a
        # .pdf, a .docx and a .csv are all "document" and only one of them can
        # be drawn. Best-effort throughout: no renderer, an encrypted file or a
        # page that will not draw all leave the memo on its drawn placeholder.
        if Path(file_path).suffix.lower() == ".pdf":
            THUMBS_DIR.mkdir(parents=True, exist_ok=True)
            thumb_name = f"{memo_id}.jpg"
            thumb_target = THUMBS_DIR / thumb_name
            if await extract_pdf_thumbnail(file_path, thumb_target):
                memo.thumbnail_path = f"/api/files/thumb/{thumb_name}"
                memo.updated_at = datetime.utcnow()
                await db.commit()

        # Audio → pull the artist tag (any format) for the player's artist line.
        if memo_type == "audio":
            artist = _read_audio_artist(file_path)
            if artist:
                memo.audio_artist = artist
                memo.updated_at = datetime.utcnow()
                await db.commit()

        try:
            ext = Path(file_path).suffix.lower()
            
            # Known text-ish file extensions whose content is safe to read as
            # UTF-8 even when memo_type is the generic "file" bucket (i.e. a
            # plain text file the categorizer hadn't seen).
            _PLAIN_TEXT_EXTS = {".txt", ".csv", ".log", ".tsv", ".srt", ".vtt"}

            if ext == ".pdf":
                data = await extract_pdf(file_path)
            elif ext in (".doc", ".docx"):
                data = await extract_docx(file_path)
            elif ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                data = await extract_image(file_path)
            elif memo_type == "code" or ext in _PLAIN_TEXT_EXTS:
                # Read as text (code/plain). Opened read-only — never executed.
                # Skipped for memo_type == "file" with an unknown extension so
                # we don't dump replacement-char garbage from a binary blob
                # (3D models, archives, proprietary formats…) into the DB.
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                    data = {"content_text": content, "description": content[:200]}
                    if memo_type == "code":
                        lang = _CODE_LANG.get(ext, "")
                        data["content_raw"] = f"```{lang}\n{content}\n```"
                except Exception:
                    data = {}
            else:
                # Unknown binary / generic file — keep the memo as a pure
                # file reference, no text extraction.
                data = {}

            if data.get("content_text"):
                memo.content_text = data["content_text"]
                if data.get("content_raw"):
                    memo.content_raw = data["content_raw"]
                memo.description = data.get("description", "")[:200]
                await db.commit()
                
                # Now embed
                await process_memo(memo_id)
        except Exception as e:
            log.error("Error processing file %s: %s", file_path, e)


@router.post("/ai")
async def ingest_from_ai(
    data: AIIngest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Headless ingestion for AI agents running locally.

    Unlike /url (fetches + extracts) and /extension (DOM scrape), this endpoint
    accepts pre-populated fields directly — the caller is the AI, so metadata is
    already structured. Background embedding still runs so the memo is searchable.

    Example (curl):
        curl -X POST http://localhost:8099/api/ingest/ai \\
             -H 'Content-Type: application/json' \\
             -d '{
               "type": "link",
               "title": "Attention Is All You Need",
               "source_url": "https://arxiv.org/abs/1706.03762",
               "source_domain": "arxiv.org",
               "description": "Transformer architecture paper.",
               "content": "Full extracted text or summary...",
               "tags": ["ml", "transformers"],
               "collection_id": "optional-uuid"
             }'
    """
    from urllib.parse import urlparse
    from backend.db.models import Tag

    domain = data.source_domain
    if not domain and data.source_url:
        try:
            domain = urlparse(data.source_url).hostname or ''
            domain = domain.removeprefix('www.')
        except Exception:
            domain = ''

    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=data.type,
        title=data.title,
        description=data.description,
        content_text=data.content,
        content_raw=data.content,
        source_url=data.source_url,
        source_domain=domain,
        source_favicon=data.source_favicon or (
            None
        ),
        thumbnail_path=data.thumbnail_url,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    memo.audio_kind = derive_audio_kind(memo)
    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)

    for tag_name in data.tags:
        tag = (await db.execute(select(Tag).where(Tag.name == tag_name))).scalar_one_or_none()
        if not tag:
            tag = Tag(id=str(uuid.uuid4()), name=tag_name)
            db.add(tag)
        memo.tags.append(tag)

    await db.commit()

    queue_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        queue_task(cache_thumbnail, memo.id)

    return {
        "id": memo.id,
        "title": memo.title,
        "type": memo.type,
        "status": "processing",
        "tags": data.tags,
    }


@router.post("/extension")
async def ingest_from_extension(
    data: ExtensionSave,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Save content from the browser extension.

    Converges with the WebUI `/url` path so the SAME source produces the SAME
    memo regardless of entry point: `www.` is stripped from the domain, and a
    video-platform URL is enriched through `extract_video` (yt-dlp metadata +
    thumbnail) exactly like `/url` instead of relying on the DOM scrape. Without
    this the two paths diverged (raw `www.` domain, DOM thumbnail, no auto-DL)."""
    from urllib.parse import urlparse
    from backend.core.extractor import detect_url_type, extract_video, extract_url, has_embed_player
    from backend.core.app_settings import get_settings

    domain = ""
    if data.url:
        parsed = urlparse(data.url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]

    # A video-platform URL goes through the same extractor the WebUI uses, so the
    # result matches; otherwise the DOM scrape is primary and a server fetch fills
    # only what the extension couldn't supply.
    extracted = {}
    is_video_url = bool(data.url) and detect_url_type(data.url) == "video"
    if is_video_url:
        try:
            extracted = await extract_video(data.url)
        except Exception:
            extracted = {}
    elif data.url and (not data.content_text or not data.thumbnail) and data.type in ("article", "link"):
        try:
            extracted = await extract_url(data.url)
        except Exception:
            extracted = {}

    # For a video URL the extractor result wins (parity with /url); otherwise the
    # extension's live DOM scrape wins and the fetch only backfills gaps.
    if is_video_url and extracted:
        pick = lambda ex, dom: extracted.get(ex) or dom
    else:
        pick = lambda ex, dom: dom or extracted.get(ex)

    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=(extracted.get("type") if is_video_url else None) or data.type or extracted.get("type", "link"),
        title=pick("title", data.title) or data.url,
        description=pick("description", data.description),
        content_text=pick("content_text", data.content_text),
        content_raw=pick("content_raw", data.html),
        video_description=extracted.get("video_description"),
        source_url=data.url,
        source_domain=extracted.get("source_domain") or domain,
        source_favicon=data.favicon or extracted.get("source_favicon"),
        thumbnail_path=pick("thumbnail_path", data.thumbnail),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    # Canonical type — the extension's DOM scrape may mislabel (e.g. "article").
    memo.type = derive_memo_type(memo)
    memo.audio_kind = derive_audio_kind(memo)

    # Same auto-localize rules as /url: audio always (when enabled), and a video
    # with no inline embed player (Threads, Reddit, …) so it lands playable.
    auto_localize_audio = (
        memo.type == "audio" and bool(memo.source_url) and not memo.file_path
        and bool(get_settings().get("auto_download_audio", True))
    )
    auto_localize_video = (
        memo.type == "video" and bool(memo.source_url) and not memo.file_path
        and not has_embed_player(memo.source_url)
        and bool(get_settings().get("auto_download_video", True))
    )
    if auto_localize_audio or auto_localize_video:
        memo.localize_status = "pending"

    db.add(memo)
    await _attach_collection(db, memo, data.collection_id)
    await db.commit()

    queue_task(process_memo, memo.id)
    if memo.thumbnail_path and memo.thumbnail_path.startswith("http"):
        queue_task(cache_thumbnail, memo.id)
    queue_task(_localize_memo_task, memo.id)
    if auto_localize_audio:
        queue_task(localize_memo_task, memo.id, "audio")
    elif auto_localize_video:
        queue_task(localize_memo_task, memo.id, "video")

    return {"id": memo.id, "title": memo.title, "status": "saved"}


def _is_placeholder_title(title: str | None, url: str, domain: str) -> bool:
    """Is this a title nobody chose, and therefore safe to replace?

    Re-pull must never overwrite words the user wrote. The old test for that was
    a literal `in ("Instagram post", "Instagram")`, which protected Instagram
    memos and silently refused to fix the title of every other host's, because
    "Temu" was not on the list. This asks the same question generically:

      - empty
      - the raw URL, which is what a failed resolve leaves behind
      - the bare domain or its first label ("temu.com", "Temu")
      - that label plus a generic noun ("Instagram post", "Reddit thread")

    Anything else is treated as the user's, and left alone (ADR-001: one rule,
    no per-host branches).
    """
    t = (title or "").strip()
    if not t:
        return True
    if t == (url or "").strip():
        return True
    bare = (domain or "").lstrip(".").casefold()
    if not bare:
        return False
    label = bare.split(".")[0]
    generic = {bare, label} | {
        f"{label} {noun}" for noun in ("post", "photo", "video", "page", "thread", "link")
    }
    return t.casefold() in generic


def _is_consent_text(text: str) -> bool:
    """True when a memo's body is a cookie-consent screen rather than the page."""
    try:
        from backend.core.headless import _looks_like_consent_wall

        return _looks_like_consent_wall(text)
    except Exception:
        return False


def _apply_resolved_type(memo, resolved: dict, gallery: list) -> None:
    """Let a re-pull correct a memo that was filed as the wrong TYPE.

    Re-pull could already fix a title, a cover and a gallery, but never the
    type — so a memo mistyped by an older resolver stayed mistyped no matter how
    many times it was re-pulled. That is the whole repair path for the posts
    that were typed from their domain: a Threads photo carousel filed as
    `video`, a Reddit text post filed as `video`.

    Three guards, and they are the reason this is safe:

    * A resolve that came back EMPTY-HANDED cannot retype a memo that already
      holds a gallery. This one was missing and it cost a working memo. A
      four-photo Facebook album, correctly filed as images, was re-pulled while
      Facebook happened to serve a consent gate; the scope found nothing, and
      `classify_media` answers `video` when it has learned nothing on a video
      host. That verdict then sailed through here and filed the album back under
      Videos, where no gallery branch renders it. The gallery was evidence, from
      an earlier read of the same post that DID work, and one flaky fetch should
      not outrank it. Meta pages fail this way often enough to matter.
    * The resolver has to be talking about the POST. A resolved type is only
      trusted when the resolve returned media of its own (a gallery) or the memo
      holds no downloaded file to contradict it. A resolver that fell back to a
      bare link card cannot demote a working video.
    * A stale media file is DETACHED, not deleted. `derive_memo_type` reads
      `file_path` first, so leaving an mp4 attached to a memo the source says is
      photographs means the background sorter re-files it as video and undoes
      the repair on the next pass. The bytes stay on disk for the integrity
      report to account for; only the reference goes."""
    new_type = (resolved.get("type") or "").strip().lower()
    if not new_type or new_type == (memo.type or "").lower():
        return
    has_file = bool((memo.file_path or "").strip())
    # Silence is not a verdict. A resolve that found no media at all knows
    # nothing about this post, and the type it hands back is whatever the
    # DOMAIN would have said, which is the thing scoping exists to stop being
    # authoritative. So it may not overwrite a gallery an earlier, successful
    # read gathered. The cost of being wrong here is a post that genuinely
    # turned from an album into a video keeping its old type until the next
    # re-pull that actually reads it; the cost of the alternative is a working
    # album silently disappearing from the page.
    from backend.core.pictures import _slides

    if not gallery and _slides(getattr(memo, "gallery", None)):
        log.info(
            "repull: %s resolved to %s with no media of its own, keeping %s "
            "and the gallery already on it",
            memo.id, new_type, memo.type,
        )
        return
    # A carousel of stills is unambiguous evidence about what the post is.
    carousel = len(gallery) > 1 and any(
        (s or {}).get("type") != "video" for s in gallery
    )
    # Whose opinion is this? A post-level resolver read the post and its answer
    # counts. A generic scrape of an ordinary page did not: `extract_url` calls
    # almost everything a "link", and letting that demote a memo somebody filed
    # as video would turn re-pull into a way to lose a video.
    from backend.core.permalinks import is_post_permalink

    authoritative = (
        carousel
        or bool(resolved.get("resolve_tier"))
        or is_post_permalink(memo.source_url or "")
    )
    if not authoritative:
        return
    # The guard is about DEMOTION only. Promoting a memo to video or audio
    # keeps its file and takes nothing away, so it needs no extra evidence;
    # taking a downloaded file off a memo does.
    if has_file and new_type not in ("video", "audio") and not carousel:
        return
    if has_file and new_type not in ("video", "audio"):
        log.info(
            "repull: %s is %s, detaching the %s that no longer belongs to it",
            memo.id, new_type, memo.file_path,
        )
        memo.file_path = None
        memo.localize_status = None
        memo.localize_error = None
    memo.type = new_type


async def repull_memo_task(memo_id: str, mode: str):
    """Fetch a memo's source again and apply everything that comes back.

    `localize_memo_task` downloads and nothing else, which is the right job for
    "Make it local" and the wrong one when a memo is simply wrong: a reel that
    saved as a still, a carousel that arrived as one photo, a title still
    reading "Instagram post", a cover pointing at a file that is gone.

    So this does the three things a fresh save would, in the order that lets
    each one benefit from the last:

      1. re-resolve the post, for hosts where resolving yields more than a file
      2. download the media
      3. rebuild the cover, now that step 2 may have put a real video on disk
         to lift a frame from

    Never raises: it runs detached from the request, and a failure belongs on
    the memo as `localize_error`, not in a log nobody reads.
    """
    from urllib.parse import urlparse

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo or not memo.source_url:
            return
        url = memo.source_url
        was_type = (memo.type or "").lower()

    # 1. Re-resolve the source. EVERY host, not one (ADR-001).
    #
    # This step used to run only for instagram.com, on the reasoning that it is
    # the host where resolving yields more than a file. True, and beside the
    # point: the resolver is where a title, a description and a cover come from
    # on every host, so gating it on one domain quietly redefined "re-pull this
    # memo" as "re-download the file" for the entire rest of the web. A Temu
    # link whose card was blank got the yt-dlp treatment and a red error chip,
    # and never got the second look that would have fixed it.
    #
    # Instagram is now a TIER INSIDE this step rather than a gate on it: its
    # resolver is still preferred there because it alone returns a carousel.
    domain = urlparse(url).netloc.lstrip("www.")
    resolved: dict = {}
    try:
        from backend.core.extractor import (
            _instagram_resolve,
            detect_url_type,
            extract_url,
            extract_video,
        )

        if "instagram.com" in urlparse(url).netloc:
            resolved = await _instagram_resolve(url, "instagram.com")
        elif detect_url_type(url) == "video":
            resolved = await extract_video(url)
        else:
            resolved = await extract_url(url)
    except Exception as e:
        log.info("repull: re-resolve failed for %s: %r", memo_id, e)

    gallery = (resolved.get("gallery") or []) if resolved else []
    if resolved:
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo:
                memo.resolve_tier = resolved.get("resolve_tier") or memo.resolve_tier
                title = (resolved.get("title") or "").strip()
                # Never overwrite words the user may have written themselves.
                # The old test for that was a literal list of two Instagram
                # strings; `_is_placeholder_title` asks the same question of any
                # host without knowing which host it is talking to.
                if title and _is_placeholder_title(memo.title, url, domain):
                    memo.title = title
                    memo.description = resolved.get("description") or memo.description
                    memo.content_text = resolved.get("content_text") or memo.content_text
                # A body that is a cookie-consent screen is not writing anyone
                # wants to keep, and the title guard above will not touch it:
                # the title alongside it is perfectly real. Meta serves that
                # screen instead of the post to a cold browser profile, so a
                # memo saved before the gate was handled holds the cookie policy
                # forever unless re-pull is allowed to overwrite exactly this.
                fresh_text = (resolved.get("content_text") or "").strip()
                if fresh_text and _is_consent_text(memo.content_text or ""):
                    memo.content_text = fresh_text
                    memo.content_raw = resolved.get("content_raw") or ""
                    memo.description = (
                        resolved.get("description") or memo.description
                    )
                # A cover the memo never had. Only ever fills a gap: a
                # thumbnail already on the memo is left exactly as it is, and
                # step 3 is what repairs a broken one.
                thumb = (resolved.get("thumbnail_path") or "").strip()
                if thumb and not (memo.thumbnail_path or "").strip():
                    memo.thumbnail_path = thumb
                if len(gallery) > 1:
                    memo.gallery = gallery
                    memo.thumbnail_path = gallery[0]["url"]
                _apply_resolved_type(memo, resolved, gallery)
                memo.updated_at = datetime.utcnow()
                await db.commit()
        if len(gallery) > 1:
            await cache_gallery(memo_id)

    # 2. The download. Sets localize_status itself, done | error.
    #
    # Unless there is nothing to download, which is a question about the SOURCE
    # and not about the memo's type. Handing a page with no media stream to
    # yt-dlp buys one guaranteed "No video formats found" and a red error chip
    # on a memo whose only problem was a missing cover. That skip used to be
    # spelled `type == "image"`, which covered the photo carousels that
    # prompted it and nothing else, so every article and shopping link still
    # walked into the same error.
    #
    # The generic question: is this a known video host, or did the resolve just
    # hand us a video stream? If neither, there is no media here to fetch.
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        # `detect_url_type` answers from the DOMAIN, so on a video host it says
        # "video" for a photo carousel and a text post alike, and the download
        # then fails with a red chip on a memo whose media never existed. When
        # the resolve actually read the post and came back with something that
        # is not media, that outranks the host. A resolve that produced nothing
        # leaves the old behaviour exactly as it was.
        resolved_type = ((resolved or {}).get("type") or "").strip().lower()
        has_media = bool(memo) and (
            (memo.type or "").lower() in ("video", "audio")
            or bool((resolved or {}).get("video_url"))
            or (
                detect_url_type(url) == "video"
                and resolved_type not in ("image", "link", "note")
            )
        )
        # An album is not a download. A memo holding a gallery of stills has
        # already said what the post is, and hunting a media stream on it finds
        # whatever the page happens to play. On Facebook that is the song
        # attached to a photo post: the sniffer captures the audio
        # representation, the download "succeeds" with a 133 second .mp4 that
        # has one stream and no pictures, `derive_memo_type` reads the extension
        # first, and a five photo album is filed under Videos with a song where
        # the video should be.
        #
        # It is also self-sustaining, which is how it was found. Once the memo
        # is `video` the first clause above says "has media", so the next
        # re-pull downloads the song again. Three in a row did exactly that on
        # 2026-09-04. An explicit `og:video` still wins: that is the source
        # naming a video of its own rather than us going looking.
        from backend.core.pictures import _slides

        album = bool(memo) and len([
            sl for sl in _slides(getattr(memo, "gallery", None))
            if (sl or {}).get("type") != "video"
        ]) > 1
        if album and not (resolved or {}).get("video_url"):
            has_media = False
            # Repair, not only prevention. A file already attached to an album
            # that holds no pictures was never this memo's, and while it is
            # attached `derive_memo_type` keeps filing the album as a video. The
            # bytes stay on disk for the integrity report; only the reference
            # goes, which is the rule `_apply_resolved_type` already follows.
            if memo.file_path:
                from backend.core.file_paths import resolve_memo_path
                from backend.core.localize_media import _has_video_stream

                on_disk = resolve_memo_path(memo.file_path)
                if on_disk and _has_video_stream(on_disk) is False:
                    log.info(
                        "repull: %s is an album and %s holds no pictures, detaching it",
                        memo.id, memo.file_path,
                    )
                    memo.file_path = None
                    memo.localize_status = None
                    memo.localize_error = None
                    memo.type = "image"
                    memo.updated_at = datetime.utcnow()
                    await db.commit()

        no_media = bool(memo) and not has_media
        if no_media:
            memo.localize_status = None
            memo.localize_error = None
            memo.updated_at = datetime.utcnow()
            await db.commit()

    if no_media:
        log.info("repull: %s has no media stream to download, skipping yt-dlp", memo_id)
    else:
        try:
            await localize_memo_task(memo_id, mode)
        except Exception as e:
            log.warning("repull: localize crashed for %s: %r", memo_id, e)
            async with AsyncSessionLocal() as db:
                memo = await db.get(Memo, memo_id)
                if memo:
                    memo.localize_status = "error"
                    memo.localize_error = str(e)[:300]
                    await db.commit()

    # 3. The cover, last, so a freshly downloaded video can supply a frame.
    try:
        from backend.core.file_paths import resolve_thumbnail_path
        from backend.repair_thumbnails import _repair, local_path_for

        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if not memo:
                return
            stored = memo.thumbnail_path or ""
            broken = bool(local_path_for(stored)) and resolve_thumbnail_path(stored) is None
            needs_cover = not stored or broken

        if needs_cover:
            async with AsyncSessionLocal() as db:
                memo = await db.get(Memo, memo_id)
                outcome, detail = await _repair(memo)
                memo.thumbnail_path = detail or None
                memo.updated_at = datetime.utcnow()
                await db.commit()
                log.info("repull: %s cover %s", memo_id, outcome)
    except Exception as e:
        log.info("repull: cover rebuild failed for %s: %r", memo_id, e)

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if memo:
            log.info(
                "repull: %s finished (%s -> %s, status=%s)",
                memo_id, was_type, memo.type, memo.localize_status,
            )
