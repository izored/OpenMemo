# Contributing to OpenMemo

Thanks for your interest in OpenMemo! This guide will get you from zero to a running dev environment in minutes.

## Development Setup

### Prerequisites
- Docker Desktop (or Docker Engine + Compose)
- Node.js 20+ (if running frontend outside Docker)
- Python 3.12+ (if running backend outside Docker)
- Git

### One-liner (Docker)
```bash
git clone https://github.com/izored/OpenMemo.git
cd OpenMemo
cp .env.example .env
docker-compose up -d
```

Visit `http://openmemo.local` and you're good to go.

### Local Dev (hot reload)
```bash
# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

## Project Structure

| Directory | What lives here |
|-----------|-----------------|
| `backend/` | FastAPI + SQLAlchemy + ChromaDB |
| `frontend/` | React 19 + Tailwind v4 + Vite |
| `chrome-extension/` | Manifest v3 extension |
| `docs/` | Extended documentation |

## Coding Style

### Frontend
- **Linting:** `npm run lint` (ESLint + TypeScript)
- **Formatting:** Follow existing Tailwind patterns. Use `cn()` from `@/lib/utils` for conditional classes.
- **Components:** Prefer composition over inheritance.

### Backend
- **Type hints:** Use them everywhere.
- **Async:** All DB and I/O operations should be `async`.
- **Security:** Sanitize all user inputs. Validate file uploads with magic bytes.

## Branch Strategy

```
main        ← production-ready, tagged releases
feat/*      ← new features
fix/*       ← bug fixes
docs/*      ← documentation only
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add sortable drag-and-drop to memo grid
fix: prevent MissingGreenlet on memo update
docs: update Docker setup instructions
refactor: replace hardcoded colors with CSS variables
```

## Pull Request Process

1. Fork the repo and create your branch from `main`.
2. Make your changes. Keep PRs focused — one concern per PR.
3. Update `docs/CHANGELOG.md` under the `[Unreleased]` section.
4. Ensure `npm run lint` and `npm run build` pass (frontend).
5. Open a PR and fill out the template.
6. A maintainer will review within a few days.

## Releasing (maintainers only)

1. Run `.\bump-version.ps1 minor|patch`
2. Fill in the new CHANGELOG section in `docs/CHANGELOG.md`
3. Write formatted release notes in `RELEASE_NOTES.md` (emoji-rich, copy-paste ready)
4. Commit, tag, and push:
   ```bash
   git add -A && git commit -m "Release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```
5. Publish the GitHub release (copy from `RELEASE_NOTES.md`):
   ```bash
   gh release create vX.Y.Z --title "OpenMemo vX.Y.Z" --notes-file RELEASE_NOTES.md
   ```

## Questions?

- Check `docs/INSTALL.md` for troubleshooting.
- Check `MEMORY.md` for architecture decisions.
- Open a [Discussion](https://github.com/izored/OpenMemo/discussions) if you're not sure it's a bug.
