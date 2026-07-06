#!/usr/bin/env bash
#
# setup-mac.sh — one-shot macOS (Apple Silicon) dev setup for OpenMemo.
#
# Mirrors what the Windows side gets from the repo, but for an M-series Mac:
# installs the native toolchain via Homebrew, builds the backend venv, pulls the
# headless Chromium for the link scraper, and installs the frontend deps.
#
# Ollama is intentionally NOT installed or managed here — it's user-provided.
# Run your own Ollama and point OpenMemo at it (OLLAMA_HOST, default
# http://localhost:11434).
#
# Usage:   bash macOS/setup-mac.sh
#
set -euo pipefail

# --- resolve repo root (this script lives in <root>/macOS) -------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "==> OpenMemo macOS setup"
echo "    repo: $ROOT"

# --- 0. sanity: Apple Silicon ------------------------------------------------
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "!!  This script targets Apple Silicon (arm64). Detected: $(uname -m)."
  echo "    It may still work, but the bundled .app target is arm64-only."
fi

# --- 1. Homebrew + system deps (NO ollama — user-provided) -------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "!!  Homebrew not found. Install it from https://brew.sh then re-run."
  exit 1
fi

echo "==> Installing system deps via Homebrew (python@3.12, node, ffmpeg)"
brew install python@3.12 node ffmpeg

PYTHON_BIN="$(brew --prefix python@3.12)/bin/python3.12"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"   # fall back to whatever python3 brew linked
fi

# --- 2. backend venv + deps --------------------------------------------------
echo "==> Creating backend venv (backend/.venv)"
"$PYTHON_BIN" -m venv backend/.venv
# shellcheck disable=SC1091
source backend/.venv/bin/activate

echo "==> Installing backend requirements"
pip install --upgrade pip
pip install -r backend/requirements.txt

echo "==> Installing headless Chromium for the link scraper (patchright)"
# Self-hosted replacement for Microlink (backend/core/headless.py). Degrades
# gracefully if this is skipped — the scraper just falls back to plain HTTP.
python -m patchright install chromium

# --- 3. frontend deps --------------------------------------------------------
echo "==> Installing frontend deps (npm ci)"
( cd frontend && npm ci )

# --- 4. macOS desktop shell deps (for the native app) ------------------------
echo "==> Installing macOS desktop shell deps (npm ci)"
( cd macOS && npm ci )

deactivate

# --- 5. Ollama reminder (one line — no hand-holding) -------------------------
cat <<'EOF'

==> Done.

OpenMemo talks to YOUR Ollama — it does not ship one.
  • Embeddings model: nomic-embed-text
  • Chat / vision:    Gemma 4 recommended (e.g. gemma4:e4b)
  • If Ollama isn't on http://localhost:11434, set OLLAMA_HOST accordingly.

Run in a browser:    bash macOS/dev-mac.sh   (or double-click macOS/dev.command)
                     then open http://localhost:3000
Run as the app:      npm --prefix frontend run build && npm --prefix macOS run dev
Build the .dmg:      cd macOS && CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
EOF
