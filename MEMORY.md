# openMemo, project memory

> Living document for contributors and maintainers: what the project is, the
> decisions that shaped it, and the traps that cost someone a day.
>
> The architecture decision records in `docs/DECISIONS.md` are canonical. The
> roadmap in `Specs/ROADMAP.md` is canonical. This file is the orientation
> layer over both.

---

## Purpose

**openMemo** is a local-first knowledge library.

Save articles, notes, PDFs, images, voice memos, music and videos, then ask
questions across the whole library with grounded, cited answers. Everything runs
on your machine: Ollama for the models, SQLite for structured data, ChromaDB for
vector search, faster-whisper for speech. No cloud, no API keys, no account.

### Core philosophy

- **Local-first.** Rendering the app makes no network request at all. Fonts are
  served from disk, favicons are cached, embeds are click-to-load.
- **Zero-effort capture.** Chrome extension, drag and drop, the New Memo panel,
  and a private Telegram bot for the phone.
- **Retrieval by meaning.** Everything saved is chunked, embedded and indexed.
- **Nothing is exposed by installing.** Every network-facing feature is off by
  default and behind an explicit switch.

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy async, pydantic-settings |
| Frontend | React 19, TypeScript strict, Vite, the `om-*` token CSS system |
| State | Zustand for client state, TanStack Query for server state |
| Database | SQLite with aiosqlite |
| Vector store | ChromaDB, embedded persistent client |
| Full text | SQLite FTS5 |
| AI | Ollama, multi-host fallback |
| Speech to text | faster-whisper, local, GPU or CPU |
| Media | yt-dlp and gallery-dl for ingest, ffmpeg for thumbnails and muxing |
| Background work | A durable job queue with handlers per job type |
| Sync | Mesh, peer to peer over its own port, AES-256, no server |
| Phone capture | Telegram bot, polled outbound from your machine |
| Deploy | Docker Compose (nginx, API, web), or the native macOS app |

### Key decisions

1. **No accounts, but not "no locks."** Single-user local mode. A default user
   and workspace are created on first boot, and there is no login. Two
   deliberate exceptions exist: the macOS app can require a PIN at launch, and
   the Hidden section is behind a passcode. Multi-user is a future milestone,
   not a current priority.

2. **Ollama multi-host fallback.** The backend tries several endpoints
   (`localhost`, `host.docker.internal`, GPU nodes) and caches the one that
   answered. This makes Docker plus native Ollama painless across platforms.

3. **Hybrid search.** FTS5 handles exact keyword matches, ChromaDB handles
   meaning. Results are merged and re-ranked. The retrieval flow for Ask Memo is
   locked in ADR-022, including the chunk pool, the per-memo dedup, and the
   distance cutoff.

4. **ChromaDB is embedded, not a server.** `backend/db/chroma_client.py` uses
   `chromadb.PersistentClient` against `CHROMA_PERSIST_DIR` on disk. Nothing
   opens an HTTP client, and nothing talks to port 8001.

5. **The theme is an attribute.** `data-theme` on `<html>`, values `light` and
   `hi`. Not a `.dark` class and not a media query. Components read `var(--*)`
   tokens and adapt for free. Tailwind's `dark:` variant cannot match, which is
   why Tailwind is being phased out rather than tidied. See `DESIGN.md`.

6. **Push sidebar layout.** The sidebar is a flex push layout with a width
   transition, not an absolute overlay. This avoids z-index fights and backdrop
   blur cost.

7. **Drag and drop with an activation constraint.** Memo cards use
   `@dnd-kit/core` with `distance: 8`, so a normal click still behaves like a
   click.

8. **Background work is a queue.** Importing 40 memos used to start 40
   downloads at once and lose all of them on restart. Work is now enqueued,
   survives a restart, and is resumable.

9. **Mesh has two switches, not one.** Turning Mesh on lets you pair. A second
   switch is what actually opens the listening port. Opening a port is a
   decision the user makes, never something an update does to them.

---

## Gotchas

- **Never point a host backend at the database Docker is serving.** SQLite's WAL
  shared-memory file is not shared across a Docker bind mount, so a host process
  opening `data/openmemo.db` takes the running app down with
  `unable to open database file`. Recovery is
  `docker compose restart openmemo-api`.

- **Run uvicorn from the repo root, on port 8099.** `backend` is a package, so
  `import backend` only resolves with the parent on `sys.path`. The Vite proxy
  targets `:8099` by default, so a backend on `:8000` means every API call
  fails.

- **`python -m pytest`, never bare `pytest`.** The `-m` form puts the current
  directory on `sys.path`. Bare `pytest` fails to collect every test module with
  the same `No module named 'backend'`.

- **`OLLAMA_HOSTS` accepts either form.** A JSON array string
  (`'["http://a","http://b"]'`) and a plain comma-separated list both work; a
  validator in `backend/config.py` splits the second. The old advice that only
  JSON works no longer applies.

- **Blocking IO on the event loop freezes everything.** A synchronous file read
  inside an async route stalls every other request, not just its own. A warm
  page cache hides this from tests that use real files.

- **File paths differ per environment.** A memo saved under Docker stores
  `/app/files/...`; the same library opened from a Windows checkout sees
  `D:\...`. Serve files through `resolve_memo_path()` in every route that
  touches disk.

- **SQLite has no migration tool here.** Adding a column means an `ALTER TABLE`
  or a migration script. `backend/migrate_collections.py` is the template.

- **Hard-refresh after a Docker deploy.** Frontend assets are content-hashed,
  but the shell can still be cached.

---

## Roadmap

`Specs/ROADMAP.md` is the single source of truth for milestones and backlog.

---

## Contributing

See `CONTRIBUTING.md` for setup, ports, tests, the pre-commit secret guard, and
the release process.

---

## Licence

AGPL 3.0. See `LICENSE`, attribution terms in `NOTICE`, plain-English
walkthrough in `docs/LICENSE-EXPLAINED.md`.
