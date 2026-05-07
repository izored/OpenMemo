# Worktree Dev Setup — Known Issues for Opus

This documents every friction point hit when running the worktree dev environment (`claude/sharp-neumann-88bb36`). Collected during the MarkdownEditor fix session (2026-05-07). Opus: please investigate and fix or document a clean setup guide.

---

## 1. Backend venv — not shared, must recreate per worktree

**What happened:** Worktree has no `.venv`. Running `uvicorn` fails immediately.

**Why:** Git worktrees share history and tracked files only. `backend/.venv/` is in `.gitignore`, so each worktree starts with no Python environment.

**What we had to do:**
```powershell
# Find a usable Python
# /c/Program Files/Python312/python (in bash)
# Note: D:\ eigent venv existed at D:\APPS - 2026\OpenMemo\.eigent\venvs\backend-0.0.90
# but lacked sqlalchemy — can't reuse it

cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt   # ~2 min, installs 90+ packages
```

**Issues along the way:**
- `uvicorn: command not found` in bash — uvicorn.exe is in `.venv/Scripts/`, not on PATH in bash. Fix: `python -m uvicorn` instead of bare `uvicorn`.
- `ModuleNotFoundError: No module named 'backend'` — ran from inside `backend/` subdir. Fix: run from project root: `python -m uvicorn backend.main:app --reload --port 8001`.
- The eigent venv at `D:\APPS - 2026\OpenMemo\.eigent\venvs\backend-0.0.90\` lacks `sqlalchemy`/`aiosqlite` — unusable as a shortcut.

**Suggested fix for Opus:** Either:
- Add a `Makefile` / PowerShell bootstrap script `scripts/setup-dev.ps1` that creates the venv and installs deps in one command.
- Or document in README/CONTRIBUTING that each worktree needs `python -m venv backend/.venv && pip install -r backend/requirements.txt`.

---

## 2. Backend .env — not tracked, must create per worktree

**What happened:** `backend/.env` is in `.gitignore`. Worktree starts with no env file. App starts but uses default SQLite path `./data/openmemo.db` — an empty DB relative to the worktree directory, not the real main-repo DB.

**Why this matters:** Can't test real data without connecting to `D:\APPS - 2026\OpenMemo\data\openmemo.db`.

**What we created (`backend/.env` in worktree):**
```
OLLAMA_HOST=http://localhost:11434
OLLAMA_HOSTS=http://localhost:11434,http://host.docker.internal:11434,http://ollama_gpu0:11434,http://ollama_gpu1:11435
EMBED_MODEL=nomic-embed-text-v2-moe:latest
DEFAULT_CHAT_MODEL=qwen2.5:7b
DEFAULT_VISION_MODEL=gemma3:4b
DATABASE_URL=sqlite+aiosqlite:///D:/APPS - 2026/OpenMemo/data/openmemo.db
CHROMA_PERSIST_DIR=D:/APPS - 2026/OpenMemo/data/chroma
FILES_DIR=D:/APPS - 2026/OpenMemo/files
HOST=0.0.0.0
PORT=8001
```

Key points:
- `DATABASE_URL` uses absolute path to main repo's DB so real data is accessible.
- `PORT=8001` avoids clash with port 8000 (Plane or another service was running there).

**Suggested fix for Opus:**
- Add `backend/.env.example` to the repo with all keys and placeholder values. Add a note to README/CONTRIBUTING: "Copy `backend/.env.example` to `backend/.env` and fill in your values."
- For worktrees specifically: the absolute DB path approach works well. Could also make `config.py` fall back gracefully and log a clear warning when no `.env` is found.

---

## 3. Vite proxy port — not worktree-aware

**What happened:** `frontend/vite.config.ts` proxies `/api` to `http://localhost:8000`. Main dev server runs on 8000. But if 8000 is taken (e.g. by Plane), the backend must use a different port — and vite.config.ts must be updated too.

**What we changed (worktree only, NOT committed):**
```ts
proxy: {
  '/api': { target: 'http://localhost:8001', changeOrigin: true },
  '/files': { target: 'http://localhost:8001', changeOrigin: true },
}
```

**Note:** This change was intentionally excluded from the commit. Main branch still targets 8000.

**Suggested fix for Opus:** Make proxy port configurable via env var so worktrees don't need to dirty `vite.config.ts`:
```ts
const backendPort = process.env.VITE_BACKEND_PORT ?? '8000';
proxy: {
  '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true },
}
```
Then each worktree `.env` (or `.env.local`) can set `VITE_BACKEND_PORT=8001`.

---

## 4. Frontend node_modules — not shared, must npm install per worktree

**What happened:** Worktree has no `node_modules`. Running `npm run dev` fails: `vite: not found`.

**Why:** `node_modules/` is in `.gitignore`. Each worktree is a fresh directory.

**Fix:** `cd frontend && npm install` (takes ~30s if registry is fast).

**Suggested fix for Opus:** Document in README/CONTRIBUTING. Could also add to `scripts/setup-dev.ps1`.

---

## 5. GET /api/memos returning 404 (unresolved)

**What happened:** Backend starts successfully (`Application startup complete.`), health check at `/api/health` responded, but `GET http://localhost:8001/api/memos` returns `HTTP 404` with `chroma-trace-id` header (confirming it's our FastAPI app, not a different service).

**Route definition in `backend/api/memos.py`:**
```python
router = APIRouter(prefix="/api/memos", tags=["memos"])

@router.get("")
async def list_memos(...):
```

**Tried:** Both `/api/memos` and `/api/memos/` — both 404.

**Hypothesis:** Possibly a middleware issue (CORS preflight?), or `redirect_slashes` FastAPI setting, or the route truly isn't being mounted. The `chroma-trace-id` header in the 404 response is unusual — chromadb's OTEL instrumentation may be intercepting the request.

**Suggested fix for Opus:** 
1. Add `app.router.redirect_slashes = False` and try both paths.
2. Check if any middleware (CORS, OTEL) is returning 404 before the route handler.
3. Try `curl -v http://localhost:8001/openapi.json` and check if `GET /api/memos` appears in the schema.
4. Check chromadb version — opentelemetry instrumentation for fastapi can sometimes shadow routes.

---

## Summary — Worktree Dev Setup Checklist (current state, manual)

```
1. cd backend && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
2. Create backend/.env with absolute paths (see Section 2 above)
3. cd frontend && npm install
4. Update frontend/vite.config.ts proxy to match backend port (see Section 3)
5. Start backend: cd <project-root> && backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8001
6. Start frontend: cd frontend && npm run dev
```

Goal for Opus: reduce this to a single `scripts/setup-dev.ps1` + clear README section.
