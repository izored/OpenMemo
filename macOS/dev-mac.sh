#!/usr/bin/env bash
#
# dev-mac.sh — start backend + frontend for local dev on macOS (no Docker).
#
# The macOS twin of dev.ps1: backend on uvicorn :8099 (avoids macOS-reserved
# :5000/:7000 AirPlay ports), frontend on Vite :3000 with its /api + /files
# proxy pointed at the local backend. Ctrl-C stops both.
#
# Prereq: run scripts/setup-mac.sh once first. Ollama is user-provided.
#
# Usage:   bash scripts/dev-mac.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

VENV_PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "!!  backend/.venv missing. Run: bash scripts/setup-mac.sh"
  exit 1
fi

PORT_BACKEND=8099

echo "==> Starting backend  →  http://localhost:$PORT_BACKEND"
"$VENV_PY" -m uvicorn backend.main:app --reload --port "$PORT_BACKEND" &
BACKEND_PID=$!

# Stop the backend whenever this script exits (Ctrl-C, error, or normal end).
cleanup() {
  echo ""
  echo "==> Stopping backend (pid $BACKEND_PID)"
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Give uvicorn a moment to bind before Vite starts proxying to it.
sleep 1

echo "==> Starting frontend →  http://localhost:3000"
cd "$ROOT/frontend"
export VITE_API_TARGET="http://localhost:$PORT_BACKEND"
npm run dev
