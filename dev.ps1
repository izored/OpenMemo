# dev.ps1 — start backend + frontend for local dev (no Docker required)
# Usage: .\dev.ps1
$root = $PSScriptRoot

# Backend in a new visible terminal on port 8099 (avoid Windows-reserved ports)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
  "Set-Location '$root'; uvicorn backend.main:app --reload --port 8099"

Start-Sleep -Seconds 1

# Frontend — proxy points to local uvicorn instead of Docker nginx
Set-Location "$root\frontend"
$env:VITE_API_TARGET = "http://localhost:8099"
npm run dev
