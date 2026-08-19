# Deployment Guide

## Docker (recommended)

```bash
git clone https://github.com/izored/OpenMemo.git
cd OpenMemo
docker compose up -d
```

Visit `http://localhost:8091`.

The compose file sets the environment inline, so a `.env` is optional. Copy
`.env.example` to `.env` only to override something.

### Prerequisites

- Docker Desktop (Windows, macOS) or Docker Engine plus Compose (Linux)
- Ollama running on the host, port 11434
- Enough RAM for the models you pull

### Services

| Service | Ports | Purpose |
|---|---|---|
| nginx | `127.0.0.1:8091` published, listens on 80 | Reverse proxy. Serves the SPA and forwards `/api` |
| openmemo-api | 8000 internal, `8770` published for Mesh | FastAPI backend |
| openmemo-web | 3000 internal | The built React SPA behind its own nginx |
| chromadb | `127.0.0.1:8001` published | Present in the compose file, but the backend does not talk to it. `backend/db/chroma_client.py` uses an embedded `PersistentClient` against `CHROMA_PERSIST_DIR` on disk |

**Everything binds to `127.0.0.1` deliberately.** openMemo has no login by
design, so "published" and "readable by anyone on the wifi" are the same
sentence. Docker's default `0.0.0.0` bind meant every device on the network
could open the whole library. Never drop the loopback prefix to reach openMemo
from your phone.

The Mesh port at `8770` is the exception, and publishing it is necessary but not
sufficient: the listener binds loopback until you turn on
**Settings → Mesh → Reachable on my network**. With that switch off, the
published port forwards to a socket nothing outside the container can reach.
Both switches have to be on, which is the point. Nothing is exposed by
installing.

## Reaching openMemo from outside your machine

**Read this before you tunnel anything.** There is no login. Anyone who reaches
the URL has your entire library: every note, every file, every transcript. A
public hostname plus no authentication is a public library.

**The supported answer is Mesh.** Your machines each hold the whole library and
sync directly, encrypted, with no server in the middle and nothing exposed to
the internet. See `MESH-PAIRING-WALKTHROUGH.md`, including the case where the
two machines are on different networks.

If you still want a tunnel, put authentication in front of it. A Cloudflare
Tunnel with Cloudflare Access, or any reverse proxy that demands a login before
it forwards a byte, is the minimum. A bare tunnel is not a deployment, it is a
disclosure.

With that in place:

1. Create a `docker-compose.override.yml`:

```yaml
services:
  nginx:
    networks:
      - default
      - your_tunnel_network

networks:
  your_tunnel_network:
    external: true
```

2. Point the tunnel at `http://nginx:80`.

3. Add your public domain to `CORS_ORIGINS`.

## Without Docker

Run the backend from the **repo root**, not from `backend/`. `backend` is a
package, so importing `backend.main` needs its parent on `sys.path`; started
from inside `backend/` it fails with `ModuleNotFoundError: No module named
'backend'`.

```bash
python -m venv .venv
source .venv/bin/activate        # .venv\Scripts\activate on Windows
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8099
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend serves on `http://localhost:3000` and proxies `/api` and `/files`
to `http://localhost:8099`. That target is the Vite default; override it with
`VITE_API_TARGET` only if you deliberately want to hit the Docker container,
which serves the last built image rather than your working tree.

On Windows, `.\dev.ps1` starts both with the right ports already set.

## The macOS app

openMemo also ships as a native Mac app with no Docker and no browser. Build and
install steps are in `MACOS.md`.

## Chrome extension

1. Chrome → Extensions → Developer mode → Load unpacked
2. Select the `chrome-extension/` folder
3. Click the extension icon → Options → set your API URL
   - Default: `http://localhost:8091/api`
   - macOS app: `http://localhost:8099/api`
   - Behind an authenticating proxy: `https://your-domain.com/api`
