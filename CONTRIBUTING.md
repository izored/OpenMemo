# Contributing to openMemo

Thanks for your interest. This gets you from zero to a running dev environment.

## Development setup

### Prerequisites

- Docker Desktop, or Docker Engine plus Compose
- Node.js 20+ (for the frontend)
- Python 3.12+ (for the backend)
- Ollama running locally, for anything that touches AI
- Git

### One-liner (Docker)

```bash
git clone https://github.com/izored/OpenMemo.git
cd OpenMemo
docker compose up -d
```

Visit `http://localhost:8091`.

The compose file sets the environment inline, so a `.env` is optional. Copy
`.env.example` to `.env` only if you want to override something.

The stack binds to `127.0.0.1` on purpose. openMemo has no login by design, so
"published" and "readable by anyone on the wifi" are the same sentence. Never
drop the loopback prefix to reach it from another device. That is what Mesh is
for.

### Local dev with hot reload

```bash
# Terminal 1, from the REPO ROOT, not backend/
uvicorn backend.main:app --reload --port 8099

# Terminal 2
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

Two things that bite people:

- **Run uvicorn from the repo root.** `backend` is a package, so importing
  `backend.main` needs its parent on `sys.path`. From inside `backend/` it is
  not, and you get `ModuleNotFoundError: No module named 'backend'`.
- **The backend port is 8099, not 8000.** Vite proxies `/api` and `/files` to
  `http://localhost:8099` by default (`frontend/vite.config.ts`). Point the
  backend anywhere else and every API call fails. Override deliberately with
  `VITE_API_TARGET` if you want to hit the Docker container instead, knowing it
  serves the last built image rather than your working tree.

On Windows, `.\dev.ps1` starts both with the right ports already set.

### Enable the secret guard, once per clone

```bash
git config core.hooksPath .githooks
```

This runs `scripts/check_secrets.py` before every commit and blocks it if a
cookie jar, session, password, bot token, database, or anything under `data/`
is staged. It is a backstop behind `.gitignore` for a stray `git add -f`. Full
procedure in `docs/SECURITY-personal-data.md`.

## Project structure

| Directory | What lives here |
|---|---|
| `backend/` | FastAPI, SQLAlchemy async, ChromaDB, Whisper, the job queue, Mesh |
| `frontend/` | React 19, TypeScript strict, Vite, the `om-*` token CSS system |
| `chrome-extension/` | Manifest v3 extension |
| `macOS/` | The native Electron app: window, PIN lock, bundled backend |
| `docs/` | Handbooks, ADRs, changelog |
| `Specs/` | Public roadmap and linked specs |
| `scripts/` | Repo tooling, including the secret checker |

## Coding style

### Frontend

- **Styling:** the `om-*` class system in `frontend/src/styles/openmemo.css`,
  driven by `var(--*)` tokens. See `DESIGN.md`.
- **Tailwind is being phased out.** Do not add new utilities. When you touch a
  component that still uses them, migrate it. This is a correctness issue, not
  taste: the theme is driven by the `data-theme` attribute on `<html>`, not a
  `.dark` class, so Tailwind's `dark:` variant never matches and renders broken
  in one theme.
- **Conditional classes:** `cn()` from `@/lib/utils`.
- **Components:** prefer composition over inheritance.

### Backend

- **Type hints:** everywhere.
- **Async:** all DB and I/O work is `async`. A sync read inside an async route
  blocks the single event loop and freezes every other request.
- **Security:** sanitize user input, validate uploads by magic bytes.
- **File paths:** serve files through `resolve_memo_path()`. Stored paths differ
  between Docker and a host checkout.

## Tests

```bash
python -m pytest backend/tests -q
```

Use `python -m pytest`, not bare `pytest`. The `-m` form puts the current
directory on `sys.path`, which is what makes `import backend` resolve.

Frontend:

```bash
cd frontend
npm run lint     # advisory, see the note in .github/workflows/ci.yml
npm run test
npm run build
```

## Branch strategy

```
main        production-ready, tagged releases
feat/*      new features
fix/*       bug fixes
docs/*      documentation only
chore/*     tooling and maintenance
```

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(mesh): leave this Mesh, and say which computer each device is
fix(db): run migrations against DATABASE_URL, not a hardcoded filename
docs: bring the root files back in step with what shipped
```

## Pull request process

1. Fork and branch from `main`.
2. Keep PRs focused. One concern per PR.
3. Add your entry to `docs/CHANGELOG.md` under the literal `## [Unreleased]`
   heading, in the same session the work lands. Do not write a versioned
   unreleased heading like `## [3.9.4] - Unreleased`; the release script
   searches for the plain string and promotes it.
4. Make sure the backend tests and the frontend build pass.
5. Open the PR and fill out the template.

## Releasing (maintainers only)

One command does all of it:

```powershell
.\bump-version.ps1 minor -Title "A human headline for this release"
```

It promotes `## [Unreleased]` to a dated version section, bumps the version in
all six places that state it, runs the test suite, tags with the full changelog
section as the annotation body, pushes, and then verifies the published release
really carries that changelog. It refuses to half-finish: everything checkable
runs before the first file is touched, and anything that fails after the push
prints the exact recovery command.

Use `-DryRun` to see the whole plan, including the exact tag body, without
touching anything.

## Questions

- `docs/INSTALL.md` for installation and troubleshooting.
- `docs/DECISIONS.md` for the architecture decision records.
- `Specs/ROADMAP.md` for what is planned.
- Open a [Discussion](https://github.com/izored/OpenMemo/discussions) if you are
  not sure it is a bug.
