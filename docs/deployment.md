# Deployment Guide

## Docker (Recommended)

```bash
git clone https://github.com/izored/OpenMemo.git
cd OpenMemo
cp .env.example .env
# Edit .env if needed — defaults work for most setups
docker-compose up -d
```

Visit `http://openmemo.local`.

### Prerequisites
- Docker Desktop (Windows/Mac) or Docker Engine + Compose (Linux)
- Ollama running locally on port 11434
- ~4GB free RAM for the default 7B models

### Services

| Service | Port | Purpose |
|---------|------|---------|
| nginx | 80 | Reverse proxy, serves frontend + API |
| openmemo-api | 8000 (internal) | FastAPI backend |
| openmemo-web | 3000 (internal) | React frontend |
| chromadb | 8001 | Vector database |

## Cloudflare Tunnel

If you want to access OpenMemo from anywhere:

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

2. In your Cloudflare tunnel config, point to `http://nginx:80`.

3. Add your public domain to `CORS_ORIGINS` in `.env`.

## Without Docker

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend will be on `http://localhost:5173` and proxy API calls to `http://localhost:8000`.

## Chrome Extension

1. Open Chrome → Extensions → Developer mode → Load unpacked
2. Select the `chrome-extension/` folder
3. Click the extension icon → Options → enter your API URL
   - Default: `http://localhost/api`
   - If tunneled: `https://your-domain.com/api`
