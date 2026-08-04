"""OpenMemo - Local AI Knowledge OS powered by Ollama."""
import asyncio
import logging
import time
import uuid

logger = logging.getLogger(__name__)
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.config import settings
from backend.db.database import init_db, AsyncSessionLocal, get_db
from backend.db.models import User, Workspace
from backend.core.security import SafePath
from backend.core.file_paths import resolve_memo_path


async def _run_reclassify_job():
    """Background sorter — re-file every memo to its canonical type.

    Safe to run anytime: idempotent, only rewrites mismatched types. Wired to
    run once on startup and twice weekly (see lifespan). Never raises out.
    """
    try:
        from backend.core.classify import reclassify_all

        async with AsyncSessionLocal() as db:
            result = await reclassify_all(db)
        if result.get("changed"):
            logger.info("[sorter] reclassified %d memo(s): %s", result["changed"], result["changes"])
        else:
            logger.debug("[sorter] all memos already correctly typed")
    except Exception as e:  # never let the scheduler die on a bad run
        logger.warning("[sorter] reclassify job failed (non-critical): %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and default workspace on startup."""
    # Ensure directories
    Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.FILES_DIR).mkdir(parents=True, exist_ok=True)
    
    # Init DB
    await init_db()
    
    # Init FTS5 search
    from backend.db.fts5 import init_fts5
    try:
        await init_fts5()
    except Exception as e:
        logger.warning("FTS5 init warning (non-critical): %s", e)

    # Lightweight additive migrations (no migration framework — see CLAUDE.md).
    # Add transcript columns to existing memos tables if missing.
    try:
        from sqlalchemy import text as _sql_text

        async with AsyncSessionLocal() as db:
            cols = (await db.execute(_sql_text("PRAGMA table_info(memos)"))).fetchall()
            names = {c[1] for c in cols}
            for col in ("transcript_status", "transcript_lang", "localize_status", "localize_error", "audio_kind", "audio_artist", "audio_album"):
                if col not in names:
                    await db.execute(_sql_text(f"ALTER TABLE memos ADD COLUMN {col} VARCHAR"))
            # Carousel gallery (Instagram sidecar, multi-photo). JSON list stored
            # as TEXT in SQLite; the SQLAlchemy JSON type (de)serializes it.
            if "gallery" not in names:
                await db.execute(_sql_text("ALTER TABLE memos ADD COLUMN gallery JSON"))
            if "playlist_born" not in names:
                await db.execute(_sql_text(
                    "ALTER TABLE memos ADD COLUMN playlist_born BOOLEAN DEFAULT 0"
                ))
                # Backfill: every track already in a playlist predates the flag.
                # Treat them as playlist-born so the feeds stay clean (we can't
                # tell a dragged-in track from an ingested one retroactively).
                await db.execute(_sql_text(
                    "UPDATE memos SET playlist_born = 1 WHERE id IN ("
                    "SELECT mc.memo_id FROM memo_collections mc "
                    "JOIN collections c ON c.id = mc.collection_id "
                    "WHERE c.kind = 'playlist')"
                ))
            await db.commit()
            # Backfill audio_kind for existing audio memos (idempotent — only NULLs).
            # Mic recordings (no source_url, "Voice memo …" title) → voice; all
            # other audio (uploads + linked SoundCloud/Bandcamp/…) → music.
            # See ADR-005.
            await db.execute(_sql_text(
                "UPDATE memos SET audio_kind = "
                "CASE WHEN (source_url IS NULL AND title LIKE 'Voice memo%') "
                "THEN 'voice' ELSE 'music' END "
                "WHERE type = 'audio' AND audio_kind IS NULL"
            ))
            await db.commit()
            # Collections: kind ('standard' | 'playlist', ADR-015) + the source
            # playlist URL for ingested playlists. Backfill NULL kind so the
            # API's default kind filter can use a plain equality.
            ccols = (await db.execute(_sql_text("PRAGMA table_info(collections)"))).fetchall()
            cnames = {c[1] for c in ccols}
            for col in ("kind", "source_url", "music_kind", "cover_ext"):
                if col not in cnames:
                    await db.execute(_sql_text(f"ALTER TABLE collections ADD COLUMN {col} VARCHAR"))
            await db.execute(_sql_text(
                "UPDATE collections SET kind = 'standard' WHERE kind IS NULL"
            ))
            # Backfill music_kind for existing playlists from their source URL:
            # Spotify /album/ links and YouTube OLAK5uy_ list ids are albums,
            # everything else (incl. hand-made playlists) is a playlist.
            await db.execute(_sql_text(
                "UPDATE collections SET music_kind = "
                "CASE WHEN source_url LIKE '%open.spotify.com/album/%' "
                "OR source_url LIKE '%OLAK5uy%' THEN 'album' ELSE 'playlist' END "
                "WHERE kind = 'playlist' AND music_kind IS NULL"
            ))
            # Tracks inside an album-kind playlist inherit that album's name —
            # their files were downloaded before audio_album existed.
            await db.execute(_sql_text(
                "UPDATE memos SET audio_album = ("
                "SELECT c.name FROM collections c "
                "JOIN memo_collections mc ON mc.collection_id = c.id "
                "WHERE mc.memo_id = memos.id AND c.music_kind = 'album' LIMIT 1) "
                "WHERE audio_album IS NULL AND type = 'audio' AND id IN ("
                "SELECT mc.memo_id FROM memo_collections mc "
                "JOIN collections c ON c.id = mc.collection_id "
                "WHERE c.music_kind = 'album')"
            ))
            await db.commit()
            # Spaces (ADR-020): a Space is a Workspace with kind='space'. Add the
            # presentation + ordering columns and mark every existing workspace
            # as the 'library' kind so the Spaces list (kind='space') stays empty
            # until the user makes one. Additive, idempotent.
            wcols = (await db.execute(_sql_text("PRAGMA table_info(workspaces)"))).fetchall()
            wnames = {c[1] for c in wcols}
            for col in ("kind", "emoji", "icon", "color", "description", "cover_ext", "cover_pos"):
                if col not in wnames:
                    await db.execute(_sql_text(f"ALTER TABLE workspaces ADD COLUMN {col} VARCHAR"))
            if "pinned" not in wnames:
                await db.execute(_sql_text("ALTER TABLE workspaces ADD COLUMN pinned BOOLEAN DEFAULT 0"))
            if "sort_order" not in wnames:
                await db.execute(_sql_text("ALTER TABLE workspaces ADD COLUMN sort_order INTEGER DEFAULT 0"))
            await db.execute(_sql_text(
                "UPDATE workspaces SET kind = 'library' WHERE kind IS NULL"
            ))
            await db.commit()
    except Exception as e:
        logger.warning("Schema migration warning (non-critical): %s", e)

    # Performance indexes for the memo feed. Without these, every list/sort is a
    # full table scan — fine at 60 memos, painful at thousands. Idempotent:
    # CREATE INDEX IF NOT EXISTS is a no-op once built. The feed index matches the
    # default query (WHERE is_deleted=0 ORDER BY recency_at DESC, created_at DESC).
    try:
        from sqlalchemy import text as _sql_text

        async with AsyncSessionLocal() as db:
            for stmt in (
                "CREATE INDEX IF NOT EXISTS ix_memos_feed ON memos (is_deleted, recency_at DESC, created_at DESC)",
                "CREATE INDEX IF NOT EXISTS ix_memos_type ON memos (type)",
                "CREATE INDEX IF NOT EXISTS ix_memos_workspace ON memos (workspace_id)",
                "CREATE INDEX IF NOT EXISTS ix_memo_collections_collection ON memo_collections (collection_id)",
            ):
                await db.execute(_sql_text(stmt))
            await db.commit()
    except Exception as e:
        logger.warning("Index creation warning (non-critical): %s", e)

    # Orphaned downloads (no job table — see music.py). A track left in
    # 'pending'/'processing' when the server stopped has no background task to
    # resume it, so it would spin "downloading" forever. Mark each as error on
    # boot: the tile then shows its cloud/retry control and the playlist's
    # re-download button reappears. Local tracks (file_path set) are untouched.
    try:
        from sqlalchemy import text as _sql_text

        async with AsyncSessionLocal() as db:
            await db.execute(_sql_text(
                "UPDATE memos SET localize_status = 'error', "
                "localize_error = 'Download interrupted (app restarted). Tap to retry.' "
                "WHERE localize_status IN ('pending', 'processing') AND file_path IS NULL"
            ))
            await db.commit()
    except Exception as e:
        logger.warning("Orphaned-download recovery warning (non-critical): %s", e)

    # Create default user and workspace if not exist
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(select(User).limit(1))
        user = result.scalar_one_or_none()
        
        if not user:
            user = User(
                id=str(uuid.uuid4()),
                name="Local User",
                email="local@openmemo.app",
            )
            db.add(user)
            
            workspace = Workspace(
                id="default",
                name="My Knowledge Base",
                owner_id=user.id,
                type="personal",
            )
            db.add(workspace)
            await db.commit()

    # Background sorter: run once now (catch up immediately), then twice weekly.
    import asyncio
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger

    asyncio.create_task(_run_reclassify_job())

    # Telegram capture relay (ADR-020) — dormant until enabled + token set in
    # Settings; the loop itself never raises out, so this can't hurt startup.
    from backend.services.telegram_relay import run_relay_loop

    asyncio.create_task(run_relay_loop())

    # Instagram canary (plan 026) — re-checks a couple of saved posts weekly so
    # the next time Instagram changes the rules, openMemo notices instead of
    # quietly saving worse memos for six weeks. The loop never raises out.
    from backend.core.canary import run_canary_loop

    asyncio.create_task(run_canary_loop())

    # Automatic database snapshots (core/autobackup.py). Media can usually be
    # fetched from its source again; notes, captions, tags and transcripts
    # cannot. Daily, gzipped, last 7 kept, a few MB each.
    from backend.core.autobackup import run_backup_loop

    asyncio.create_task(run_backup_loop())

    # Library integrity (plan 027) — hourly, does every file the database
    # references still exist. The 2026-08-04 wipe served pages normally for
    # ninety minutes because nothing ever asked. Pure stat calls, off-loop.
    from backend.core.integrity import run_integrity_loop

    asyncio.create_task(run_integrity_loop())

    # Persistent job queue (ADR-024 §9). Spawns the bounded worker pool; it does
    # no database I/O itself, and is a no-op until job kinds are registered.
    # Requeuing work interrupted by a restart is the janitor's job, a moment
    # later and off the startup path.
    # Mesh (ADR-024): tables always, triggers only while enabled (§0).
    try:
        from backend.core.mesh import apply_enabled_state, is_enabled, mesh_schema_init

        await mesh_schema_init()
        await apply_enabled_state(is_enabled())
    except Exception as e:
        logger.warning("Mesh schema init warning (non-critical): %s", e)

    from backend.core import jobs

    import backend.core.job_handlers  # noqa: F401 — registers the job kinds

    await jobs.start_workers()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_reclassify_job,
        CronTrigger(day_of_week="mon,thu", hour=3, minute=0),
        id="reclassify_memo_types",
        replace_existing=True,
    )
    scheduler.start()
    app.state.scheduler = scheduler

    yield

    # Shutdown — stop the workers, then the scheduler, cleanly.
    try:
        await jobs.stop_workers()
    except Exception:
        pass
    try:
        scheduler.shutdown(wait=False)
    except Exception:
        pass

    # Close the headless browser used by the link scraper, if it was started.
    try:
        from backend.core.headless import close_browser

        await close_browser()
    except Exception:
        pass


app = FastAPI(
    title="OpenMemo API",
    version=settings.VERSION,
    description="Local AI Knowledge OS powered by Ollama",
    lifespan=lifespan,
)

# CORS
_cors_origins = list(settings.CORS_ORIGINS)
if settings.EXTENSION_ORIGIN:
    _cors_origins.append(settings.EXTENSION_ORIGIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # Browser extension fetches originate from chrome-extension://<id>. Only
    # fall back to the broad regex when no explicit EXTENSION_ORIGIN is set —
    # configure it (from chrome://extensions) to lock this down (plans/004).
    allow_origin_regex=None if settings.EXTENSION_ORIGIN else r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secure file serving — check ownership before returning files
_file_store = SafePath(settings.FILES_DIR)


_thumb_store = SafePath(settings.FILES_DIR / "thumbs")


_extracted_store = SafePath(settings.FILES_DIR / "extracted")


# Must be registered BEFORE the catch-all /api/files/{file_path:path} (same
# route-ordering gotcha as the thumb route). Serves locally-cached images
# from extracted article content (public; only under files/extracted).
@app.get("/api/files/extracted/{memo_id}/{name}")
async def serve_extracted(memo_id: str, name: str):
    import mimetypes

    target = _extracted_store.resolve(f"{memo_id}/{name}")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Asset not found")
    ext = target.suffix.lower()
    media_type = {
        ".webp": "image/webp", ".avif": "image/avif",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".svg": "image/svg+xml", ".bmp": "image/bmp",
    }.get(ext) or mimetypes.guess_type(str(target))[0] or "image/jpeg"
    return FileResponse(str(target), media_type=media_type)


# NOTE: must be registered BEFORE the catch-all /api/files/{file_path:path};
# otherwise the greedy :path param swallows "thumb/<name>" and the request
# is routed to serve_file (Memo-ownership check) and 404s.
@app.get("/api/files/thumb/{name}")
async def serve_thumb(name: str):
    """Serve a locally-cached thumbnail (public; only images under files/thumbs)."""
    target = _thumb_store.resolve(name)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    import mimetypes
    ext = target.suffix.lower()
    media_type = {
        ".webp": "image/webp", ".avif": "image/avif",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
    }.get(ext) or mimetypes.guess_type(str(target))[0] or "image/jpeg"
    return FileResponse(str(target), media_type=media_type)


@app.get("/api/files/{file_path:path}")
async def serve_file(file_path: str):
    """Serve an uploaded file if it belongs to a memo in the workspace.

    Looks up the memo by either the exact stored `file_path` OR the tolerant
    relative form (after the `files/` segment) so that legacy memos created
    under a different environment (Docker `/app/files/...` vs Windows
    `D:\\...\\files\\...`) still resolve.
    """
    from sqlalchemy import select
    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Memo

    # SafePath resolves and validates traversal
    target = _file_store.resolve(file_path)

    async with AsyncSessionLocal() as db:
        # Try exact path match first (fast path).
        result = await db.execute(
            select(Memo).where(Memo.file_path == str(target))
        )
        memo = result.scalar_one_or_none()

        # Fallback: scan memos and resolve each path tolerantly. Only triggers
        # when the URL is reached at all, so cost is bounded by one missed
        # request; in practice the UI uses `/api/memos/{id}/file` for image
        # rendering so this branch is rarely hit.
        if not memo:
            all_memos = (
                await db.execute(select(Memo).where(Memo.file_path.is_not(None)))
            ).scalars().all()
            for candidate in all_memos:
                resolved = resolve_memo_path(candidate.file_path)
                if resolved and resolved == target:
                    memo = candidate
                    break

        if not memo:
            raise HTTPException(status_code=404, detail="File not found")

    import mimetypes as _mimetypes
    _media_type = _mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    _SAFE_INLINE = {"image/", "audio/", "video/", "application/pdf"}
    _inline = any(_media_type.startswith(p) for p in _SAFE_INLINE)
    if _inline:
        return FileResponse(str(target), media_type=_media_type)
    return FileResponse(
        str(target),
        media_type=_media_type,
        headers={"Content-Disposition": f'attachment; filename="{target.name}"'},
    )


@app.get("/api/proxy/image")
async def proxy_image(url: str, memo_id: str | None = None):
    """Proxy a remote image with browser headers to bypass hotlink protection.
    Optionally caches the result and updates the memo's thumbnail_path."""
    import httpx
    from starlette.responses import StreamingResponse
    from backend.api.ingest import _download_thumb, _thumb_headers, THUMBS_DIR
    from backend.core.security import validate_proxy_url

    validate_proxy_url(url)

    # Try to cache if we have a memo_id and it's not already cached
    if memo_id:
        cached = await _download_thumb(url, memo_id)
        if cached:
            from backend.db.database import AsyncSessionLocal
            from backend.db.models import Memo
            from datetime import datetime
            async with AsyncSessionLocal() as db:
                memo = await db.get(Memo, memo_id)
                if memo and memo.thumbnail_path == url:
                    memo.thumbnail_path = cached
                    memo.updated_at = datetime.utcnow()
                    await db.commit()
            # Serve from local cache
            name = cached.split("/")[-1]
            target = THUMBS_DIR / name
            if target.exists():
                return FileResponse(str(target))

    # Fallback: stream the remote image
    try:
        async with httpx.AsyncClient(
            timeout=15, follow_redirects=True, headers=_thumb_headers(url)
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "image/jpeg")
            if "image" not in ctype:
                raise HTTPException(status_code=422, detail="Not an image")
            return StreamingResponse(
                iter([resp.content]),
                media_type=ctype,
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception as e:
        logger.warning("Image proxy failed for %s: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch image")


# Register routers
from backend.api.memos import router as memos_router
from backend.api.chat import router as chat_router
from backend.api.collections import router as collections_router
from backend.api.ingest import router as ingest_router
from backend.api.export import router as export_router
from backend.api.search import router as search_router
from backend.api.maintenance import router as maintenance_router
from backend.api.backup import router as backup_router
from backend.api.mesh import router as mesh_router
from backend.api.settings import router as settings_router
from backend.api.music import router as music_router
from backend.api.spaces import router as spaces_router

app.include_router(memos_router)
app.include_router(chat_router)
app.include_router(collections_router)
app.include_router(ingest_router)
app.include_router(export_router)
app.include_router(search_router)
app.include_router(maintenance_router)
app.include_router(backup_router)
app.include_router(settings_router)
app.include_router(music_router)
app.include_router(spaces_router)
# Mesh (ADR-024). Every route 404s until the user enables it (core/mesh.py).
app.include_router(mesh_router)


def _dir_size(path: Path) -> int:
    """Recursive byte size of a file or directory. Blocking — call via a thread."""
    if not path.exists():
        return 0
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def _compute_storage() -> dict:
    db_bytes = _dir_size(settings.DATA_DIR / "openmemo.db")
    files_bytes = _dir_size(settings.FILES_DIR)
    cache_bytes = _dir_size(Path(settings.CHROMA_PERSIST_DIR))
    return {
        "db_bytes": db_bytes,
        "files_bytes": files_bytes,
        "cache_bytes": cache_bytes,
        "total_bytes": db_bytes + files_bytes + cache_bytes,
    }


# Cache the storage walk: it rglob()s the whole files dir (can be GBs over a
# Docker bind mount → ~20s) and the numbers barely move minute-to-minute.
_storage_cache: dict = {"at": 0.0, "data": None}
_STORAGE_TTL = 60.0


@app.get("/api/stats")
async def get_stats(
    include_storage: bool = False,
    workspace_id: str = None,
    db: AsyncSession = Depends(get_db),
):
    """Aggregate stats. Counts are cheap COUNT()s and always returned.

    Storage sizes are an expensive filesystem walk, so they are opt-in
    (`include_storage=true`, used by the Settings page), computed in a worker
    thread (never blocks the event loop), and cached. The sidebar calls this on
    every page for the memo count alone — it must stay instant.

    Spaces isolation (ADR-020): counts are scoped to the main library by
    default; a Space sidebar passes its workspace_id for that Space's counts.
    """
    from sqlalchemy import func, select
    from backend.db.models import Memo, Collection, Tag
    from backend.core.security import sanitize_workspace_id
    from datetime import datetime, timedelta

    ws = sanitize_workspace_id(workspace_id) if workspace_id else "default"

    total_memos = (await db.execute(
        select(func.count()).select_from(Memo).where(Memo.workspace_id == ws)
    )).scalar() or 0
    total_collections = (await db.execute(
        select(func.count()).select_from(Collection).where(Collection.workspace_id == ws)
    )).scalar() or 0
    total_tags = (await db.execute(select(func.count()).select_from(Tag))).scalar() or 0

    week_ago = datetime.utcnow() - timedelta(days=7)
    memos_this_week = (
        await db.execute(select(func.count()).select_from(Memo).where(
            Memo.workspace_id == ws, Memo.created_at >= week_ago
        ))
    ).scalar() or 0

    by_type_rows = (
        await db.execute(
            select(Memo.type, func.count()).where(Memo.workspace_id == ws).group_by(Memo.type)
        )
    ).all()
    by_type = {row[0]: row[1] for row in by_type_rows}

    resp = {
        "total_memos": total_memos,
        "total_collections": total_collections,
        "total_tags": total_tags,
        "memos_this_week": memos_this_week,
        "by_type": by_type,
    }

    if include_storage:
        now = time.monotonic()
        if _storage_cache["data"] is None or (now - _storage_cache["at"]) > _STORAGE_TTL:
            _storage_cache["data"] = await asyncio.to_thread(_compute_storage)
            _storage_cache["at"] = now
        resp["storage"] = _storage_cache["data"]

    return resp


@app.get("/api/ping")
async def ping():
    """Liveness probe — no external dependencies, never touches Ollama.

    The container healthcheck (docker-compose.yml) uses THIS so a down Ollama
    can't mark the API unhealthy: memos, search and browsing all work with the
    LLM offline. Ollama reachability is a separate, on-demand concern reported
    by /api/health (called only by the Settings page).
    """
    return {"status": "ok", "version": settings.VERSION}


@app.get("/api/health")
async def health_check():
    """Ollama reachability for the Settings UI — on-demand, fast, cached.

    NOT a liveness signal (that's /api/ping). Probes Ollama with a short timeout
    and a 15s result cache so a down LLM returns in ~1.5s instead of stalling.
    """
    from backend.core.ollama_client import ollama_client
    
    ollama_status = await ollama_client.health_check()
    
    return {
        "status": "ok",
        "ollama_connected": ollama_status,
        "version": settings.VERSION,
    }


_EMBED_FAMILIES = {"bert", "nomic-bert", "nomic-bert-moe"}

@app.get("/api/models")
async def list_models():
    """List available Ollama models, excluding embed-only models."""
    from backend.core.ollama_client import ollama_client

    try:
        models = await ollama_client.list_models()
        chat_models = [
            m for m in models
            if "embed" not in m.get("name", "").lower()
            and not any(
                f in _EMBED_FAMILIES
                for f in (m.get("details", {}).get("families") or [])
            )
        ]
        return {"models": chat_models}
    except Exception as e:
        logger.warning("Failed to list Ollama models: %s", e)
        return {"models": [], "error": "Could not reach Ollama"}


# --- Single-process SPA serving (desktop app) --------------------------------
# When FRONTEND_DIST points at the built frontend, the backend serves the SPA
# from its own origin so the macOS .app's Electron window can load
# http://127.0.0.1:<port>/ and have every relative /api URL, /api/files asset,
# upload, and SSE stream work same-origin — no nginx, no Vite proxy, no CORS.
# No-op when unset: Docker keeps using nginx and dev keeps the Vite proxy.
# Registered LAST so every /api route above wins; this catch-all only handles
# the SPA shell and its static assets.
if settings.FRONTEND_DIST:
    _frontend_dist = Path(settings.FRONTEND_DIST)
    if _frontend_dist.is_dir():
        _dist_root = _frontend_dist.resolve()
        _spa_index = _dist_root / "index.html"

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            # /api/* is registered above and matches first; anything reaching
            # here under api/ is a real 404, not a client route.
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not found")
            # Serve a real built asset (hashed JS/CSS, icons) when the path maps
            # to a file inside dist — with a traversal guard so nothing outside
            # the dist dir is ever served.
            candidate = (_dist_root / full_path).resolve()
            if full_path and _dist_root in candidate.parents and candidate.is_file():
                return FileResponse(str(candidate))
            # Otherwise it's a client-side route (/settings, /space/x …) — hand
            # back index.html and let React Router resolve it.
            return FileResponse(str(_spa_index))
    else:
        logger.warning(
            "FRONTEND_DIST=%s is not a directory; SPA not served", settings.FRONTEND_DIST
        )



