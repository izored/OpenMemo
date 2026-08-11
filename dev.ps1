# dev.ps1 — start backend + frontend for local dev (no Docker required)
# Usage: .\dev.ps1
$root = $PSScriptRoot

# Backend in a new visible terminal on port 8099 (avoid Windows-reserved ports).
# OPENMEMO_DISABLE_TELEGRAM: a dev backend must not poll the bot. Telegram hands
# each message to one caller only, so a second poller silently splits the user's
# phone captures between two databases instead of duplicating them.
Start-Process powershell -ArgumentList "-NoExit", "-Command",
  "Set-Location '$root'; `$env:OPENMEMO_DISABLE_TELEGRAM = '1'; uvicorn backend.main:app --reload --port 8099"

Start-Sleep -Seconds 1

# Frontend — proxy points to local uvicorn instead of Docker nginx
Set-Location "$root\frontend"
$env:VITE_API_TARGET = "http://localhost:8099"
npm run dev
