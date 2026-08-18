# OpenMemo Desktop (macOS shell)

Electron shell that wraps OpenMemo as a native Apple-Silicon `.app`. It boots the
Python backend (which also serves the built SPA) and loads it in one window — the
window is the whole product, no browser.

Full guide: **[../docs/MACOS.md](../docs/MACOS.md)**.

## Layout

| Path | What |
|------|------|
| `src/main.ts` | App lifecycle, window, menu, first-run Chromium fetch |
| `src/backend.ts` | Spawn uvicorn on a fixed loopback port, health-gate, stop |
| `src/paths.ts` | Resolve dev vs packaged paths (Python, backend, SPA, ffmpeg) |
| `src/settings-store.ts` | Persist the user's Ollama host |
| `src/preload.ts`, `src/config-preload.ts` | contextBridge for boot log + Ollama modal |
| `static/` | `loading.html`, `ollama-config.html` |
| `scripts/bundle-backend.mjs` | Assemble `resources-stage/` (Python + deps + SPA + ffmpeg) |
| `electron-builder.yml` | arm64 `.dmg`, unsigned/ad-hoc |

## Commands

```bash
npm install              # deps
npm run build:ts         # compile shell TS → dist-electron/
npm run dev              # build TS + launch (uses repo source + backend/.venv)
npm run dist             # build TS + SPA + bundle backend + electron-builder .dmg
```

`npm run dist` must run on an Apple-Silicon Mac. See MACOS.md §6 for the
`CSC_IDENTITY_AUTO_DISCOVERY=false` note and build env overrides.

## Notes

- Backend env is set by the shell: `DATA_DIR`, `HF_HOME`, `PLAYWRIGHT_BROWSERS_PATH`,
  `FRONTEND_DIST`, `FFMPEG_BIN`, `OLLAMA_HOST` — all under `app.getPath('userData')`.
- Ollama is **never** bundled. Default `http://localhost:11434`, editable from
  the app menu (**Ollama Host…**).
