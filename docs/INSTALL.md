# OpenMemo — Installation & Troubleshooting Guide

> **Spec Version:** 1.5  
> **Last Updated:** 2026-05-05

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Required Ollama Models](#required-ollama-models)
4. [Development Setup (Recommended for daily use)](#development-setup)
5. [Docker Production Setup](#docker-production-setup)
6. [Ollama Endpoint Configuration](#ollama-endpoint-configuration)
7. [Chrome Extension](#chrome-extension)
8. [Troubleshooting Matrix](#troubleshooting-matrix)
9. [Windows-Specific Notes](#windows-specific-notes)

---

## Overview

OpenMemo has **two ways to run**:

| Mode | When to use | Entry URL |
|------|-------------|-----------|
| **Development** (`npm run dev` + `uvicorn`) | Daily development, debugging, fastest reload | `http://localhost:3000` |
| **Docker Production** (`docker-compose up`) | Stable deployment, single-port access, reverse proxy | `http://localhost:8091` |

> **Why Docker exists:** The `docker-compose.yml` bundles the full stack (backend, frontend, ChromaDB, nginx) into reproducible containers. It adds an **nginx reverse proxy on port 80** that unifies all traffic — no CORS issues, no port juggling, and SSE streaming works out of the box.

---

## Prerequisites

1. **Ollama** installed and running ([ollama.ai](https://ollama.ai))
2. **Python 3.11+**
3. **Node.js 18+**
4. **Docker + Docker Compose** (only for production mode)

### Verify Ollama is running

```bash
ollama --version
ollama list
```

If Ollama is in a Docker container, ensure it is exposed on the correct port (default `11434`).

---

## Required Ollama Models

Pull these before starting OpenMemo:

```bash
# Required
ollama pull nomic-embed-text
ollama pull qwen2.5:7b

# Required for image understanding
ollama pull gemma3:4b

# Optional — deeper reasoning
ollama pull llama3.3:70b
ollama pull qwen2.5:32b
```

| Task | Model | Size |
|------|-------|------|
| Embeddings | `nomic-embed-text` | ~500 MB |
| Fast Chat / Summary | `qwen2.5:7b` | ~4–5 GB |
| Vision (images) | `gemma3:4b` | ~3 GB |
| Deep Reasoning | `llama3.3:70b` | ~40–45 GB |

---

## macOS (Apple Silicon) — Quick Start

OpenMemo runs natively on M-series Macs. Everything it needs ships an arm64
build; nothing has to be replaced. Ollama is **not** installed by OpenMemo — run
your own and point the app at it.

### One-time setup

```bash
# from the repo root
bash macOS/setup-mac.sh
```

This installs the toolchain via Homebrew (`python@3.12`, `node`, `ffmpeg`),
creates `backend/.venv`, installs the Python + frontend deps, and pulls the
headless Chromium used by the link scraper. It does **not** touch Ollama.

### Run it (dev)

```bash
bash macOS/dev-mac.sh        # or double-click macOS/dev.command in Finder
```

Open **`http://localhost:3000`**. Backend is on `:8099`, Vite proxies `/api` and
`/files` to it automatically.

> First run only — make the scripts executable:
> `chmod +x macOS/dev.command macOS/*.sh`

### Ollama (user-provided)

OpenMemo talks to your own Ollama. Defaults expect it on
`http://localhost:11434`; set `OLLAMA_HOST` (in `backend/.env` or the
environment) if yours is elsewhere.

| Task | Model |
|------|-------|
| Embeddings | `nomic-embed-text` |
| Chat / vision | **Gemma 4** recommended (e.g. `gemma4:e4b`) |

### Native `.app` / `.dmg`

A double-click Mac app (the whole UI in its own window, no browser) is built
from `macOS/`. See **[MACOS.md](MACOS.md)** for building and installing it.

---

## Development Setup

### 1. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

The backend will:
- Initialize SQLite at `./data/openmemo.db`
- Initialize ChromaDB at `./data/chroma`
- Attempt to connect to Ollama (see [Ollama Endpoint Configuration](#ollama-endpoint-configuration) if this fails)
- Create a default user & workspace on first run

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **`http://localhost:3000`** in your browser.

The Vite dev server proxies `/api` and `/files` to `localhost:8000` automatically.

---

## Docker Production Setup

### Quick Start

```bash
docker-compose up -d
```

Open **`http://localhost:8091`** in your browser.

### What the compose stack does

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   nginx     │────▶│ openmemo-api│────▶│   Ollama    │
│  (port 80)  │     │  (port 8000)│     │  (port 11434)
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│ openmemo-web│
│  (port 3000)│
└─────────────┘
```

- **nginx** (port 80) → unified entry point
  - `/api/*` → proxied to backend
  - `/files/*` → proxied to backend
  - `/*` → proxied to React frontend
- **openmemo-api** → FastAPI backend (not directly exposed)
- **openmemo-web** → React app served by nginx (not directly exposed)
- **chromadb** → ChromaDB server on port 8001 (for external inspection; backend uses filesystem ChromaDB)

### Stopping

```bash
docker-compose down
```

To wipe data volumes:

```bash
docker-compose down -v
```

### Rebuilding after code changes

```bash
docker-compose up -d --build
```

---

## Ollama Endpoint Configuration

OpenMemo now supports **multiple Ollama endpoints with automatic fallback**. This is critical when running Ollama in Docker or on remote GPUs.

### Default endpoints (pre-configured)

```env
OLLAMA_HOSTS=http://localhost:11434,http://host.docker.internal:11434,http://ollama_gpu0:11434,http://ollama_gpu1:11435
```

The backend tries each host in order until one responds.

### Setup for your environment

| Setup | `OLLAMA_HOSTS` value | Notes |
|-------|----------------------|-------|
| Ollama native (macOS/Windows/Linux) | `http://localhost:11434` | Default — works with dev mode |
| Ollama in Docker (Docker Desktop) | `http://host.docker.internal:11434` | Added automatically by fallback |
| Ollama in Docker (Linux native) | `http://172.17.0.1:11434` or container name | `host.docker.internal` may need `--add-host` |
| Remote GPU server #0 | `http://ollama_gpu0:11434` | Add to Docker network or DNS |
| Remote GPU server #1 | `http://ollama_gpu1:11435` | Non-standard port example |

### Customizing `.env`

Edit `backend/.env` (dev) or set environment variables in `docker-compose.yml` (prod):

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_HOSTS=http://localhost:11434,http://host.docker.internal:11434
```

### Linux Docker: `host.docker.internal` workaround

If you see *"host.docker.internal not found"* on Linux:

**Option A** — Add to `docker-compose.yml` (already included in current version):
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

**Option B** — Use the Docker container's gateway IP:
```env
OLLAMA_HOSTS=http://172.17.0.1:11434
```

**Option C** — Run Ollama container on the same Docker network and reference by name:
```yaml
# Add to docker-compose.yml
services:
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama:/root/.ollama
```
Then set `OLLAMA_HOSTS=http://ollama:11434`.

---

## Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. Click the OpenMemo icon to save any page

> The extension communicates with the API via `http://localhost:8091/api`. The default in `chrome-extension/background.js` is already set to this.

---

## Troubleshooting Matrix

### "Frontend loads but API errors / Ollama disconnected"

**Symptoms:** Dashboard empty, health check shows `ollama_connected: false`.

**Diagnosis:**
```bash
# From host
curl http://localhost:11434/api/tags

# From inside backend container
docker exec -it openmemo-api-1 curl http://host.docker.internal:11434/api/tags
```

**Fix:**
- Ensure Ollama is running: `ollama serve` or `docker run ollama/ollama`
- Update `OLLAMA_HOSTS` to a reachable endpoint (see [Ollama Endpoint Configuration](#ollama-endpoint-configuration))
- On Linux Docker, use `extra_hosts` or the gateway IP

---

### "CORS errors in browser console"

**Symptoms:** `Access-Control-Allow-Origin` errors.

**Fix:**
- Ensure you are accessing via the intended origin:
  - Dev mode: `http://localhost:3000` or `http://127.0.0.1:3000`
  - Docker mode: `http://localhost:8091`
- `backend/config.py` now includes `127.0.0.1:3000` and `localhost:80` in `CORS_ORIGINS`

---

### "SSE chat not streaming / messages arrive all at once"

**Symptoms:** AskMemo chat shows no tokens until the full response is done.

**Cause:** nginx is buffering the SSE stream.

**Fix:** Root `nginx.conf` already has:
```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 300s;
```
If you customized nginx, ensure these lines are present.

---

### "Embeddings never complete / memo stays 'processing'"

**Symptoms:** Saved memos never get `is_processed = true`.

**Fix:**
- Ensure `nomic-embed-text` is pulled: `ollama pull nomic-embed-text`
- Check backend logs for embedding errors
- Verify Ollama connectivity (see first troubleshooting item)

---

### "Cannot access app on port 3000 with Docker"

**Symptoms:** `localhost:3000` loads a blank page or times out.

**Cause:** In production Docker, port 3000 is no longer directly exposed (only via nginx on port 80).

**Fix:** Use **`http://localhost`** (port 80) instead of `localhost:3000`.

---

### "ChromaDB lock errors / database is locked"

**Symptoms:** SQLite errors mentioning locks.

**Cause:** Running the backend natively **and** the Docker `chromadb` service simultaneously, both accessing `./data/chroma`.

**Fix:**
- Stop the native backend before running Docker, or vice versa
- The `chromadb` container is for external inspection only; backend uses filesystem-based ChromaDB

---

### "Linux Docker: host.docker.internal not found"

**Fix:** Already included in `docker-compose.yml`:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

If this still fails, set `OLLAMA_HOSTS=http://172.17.0.1:11434` (find your Docker bridge IP with `ip addr show docker0`).

---

### "Search results are weak / missing obvious matches"

**Cause:** Before v1.5 fixes, search used only `ilike` (substring matching). FTS5 full-text search may not be initialized.

**Fix:**
- FTS5 is initialized automatically on startup
- Rebuild the FTS5 index manually if needed:
  ```sql
  INSERT INTO memos_fts(memos_fts) VALUES ('rebuild');
  ```

---

## Windows-Specific Notes

### PowerShell

Use `;` as the command separator (not `&&`):

```powershell
cd backend; .venv\Scripts\activate; uvicorn backend.main:app --reload --port 8000
```

### WSL2 + Docker Desktop

- `host.docker.internal` works out of the box on Docker Desktop for Windows
- If Ollama runs in WSL2 natively (not Docker), use `http://host.docker.internal:11434`
- If Ollama runs in Windows natively, also use `http://host.docker.internal:11434`

### Path separators

The project uses forward slashes (`/`) in Python code and config, which work fine on Windows via Python's `pathlib`.

---

## Architecture Reminder

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TailwindCSS + TypeScript (strict) |
| State | Zustand + TanStack Query |
| Backend | FastAPI (async Python) |
| Vector DB | ChromaDB (local persistent) |
| Embeddings | Ollama `nomic-embed-text` |
| LLM | Ollama (multi-host fallback) |
| Search | Hybrid: ChromaDB semantic + SQLite FTS5 |
| Chat Streaming | Server-Sent Events (SSE) |
| Database | SQLite (metadata) |
| Reverse Proxy | nginx (Docker production) |

---

## Need More Help?

1. Check backend logs: `docker logs openmemo-api-1` or watch the uvicorn terminal
2. Check liveness: `curl http://localhost:8000/api/ping` (dev) or `curl http://localhost:8091/api/ping` (Docker). Returns `{"status":"ok"}` with no Ollama dependency. `/api/health` additionally reports Ollama reachability (used by the Settings page).
3. Verify Ollama: `curl http://localhost:11434/api/tags`

---

## Mesh (optional)

Two-way sync between your own computers. Off unless you turn it on in
Settings, and it costs nothing while off.

Mesh uses **one extra port, 8770**, serving the sync channel and nothing else.
It takes **two switches**, on purpose:

1. **Mesh** — lets you pair, and installs the change triggers.
2. **Reachable from your other computer** — binds every interface instead of
   loopback. Until this is on, openMemo listens only to itself: you can pair,
   and no peer can connect.

`docker-compose` publishes 8770, which on its own does nothing, because the
listener stays on loopback until you turn switch 2 on. Nothing is exposed by
installing.

The app's own port is never exposed by Mesh and should never be port forwarded:
the local API has no authentication by design.

**Across networks.** Mesh finds peers by mDNS, which does not leave your subnet,
and it has no relay or hole punching. So two computers on different networks
cannot see each other on their own. Put them on a private overlay you control —
Tailscale or any WireGuard setup — and Mesh needs no special handling: the
overlay is an ordinary network interface, so switch 2 covers it and you pair by
the overlay address.

Port forwarding 8770 from your router is the other way, and the worse one. The
sync port refuses anyone without your code, but it puts a listener on the public
internet for a service that has had a security fix this month. Use an overlay.

Override the port with `OPENMEMO_MESH_PORT` if 8770 is taken, or if you run two
instances on one machine.

Pairing two machines step by step, home network or Tailscale:
[MESH-PAIRING-WALKTHROUGH.md](MESH-PAIRING-WALKTHROUGH.md). Full detail in
[ADR-024](ADR-024-MESH.md) and [the handbook](MESH-HANDBOOK.md); what it exposes
and what it encrypts in [MESH-SECURITY.md](MESH-SECURITY.md).
