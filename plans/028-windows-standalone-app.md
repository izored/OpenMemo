# 028 — Windows standalone app, no Docker

Written 2026-09-05 against commit `0b1147d` (`main`, v3.19.0).

**Drift check before you start.** This repo has parallel agent threads and HEAD
moves. Run this first and reconcile against live code if anything in scope has
changed:

```bash
git log --oneline 0b1147d..HEAD -- macOS/ backend/config.py backend/Dockerfile
```

## Goal

A Windows user downloads one installer, runs it, and openMemo works. No Docker
Desktop, no WSL, no terminal. The same deal the macOS `.dmg` already offers.

**This is a port, not an invention.** `macOS/` is a working, shipped
implementation of exactly this problem. Read it before designing anything. The
honest shape of this work is "make the macOS app cross-platform", and most of the
decisions were made there already.

## What already exists (verified, do not re-derive)

The macOS app is an Electron shell that starts the real backend as a child
process. Nothing is rewritten for the desktop.

| Piece | Where | Note |
|---|---|---|
| Shell lifecycle, window, menu | `macOS/src/main.ts` | also does the first-run Chromium fetch |
| Backend spawn and env | `macOS/src/backend.ts` | sets `DATA_DIR`, `HF_HOME`, `PLAYWRIGHT_BROWSERS_PATH` |
| Path resolution | `macOS/src/paths.ts` | maps bundled resources to runtime paths |
| Resource assembly | `macOS/scripts/bundle-backend.mjs` | builds `resources-stage/` |
| Packaging config | `macOS/electron-builder.yml` | arm64 dmg, ad-hoc signed |
| Build entry | `macOS/package.json` → `npm run dist` | ts, frontend, bundle, electron-builder |

`bundle-backend.mjs` stages four things, and they are what the Windows build must
also produce:

- `python/` a relocatable CPython (python-build-standalone) with
  `backend/requirements.txt` pip-installed into it
- `app-backend/` the backend package, cwd for `python -m uvicorn backend.main:app`
- `frontend-dist/` the built SPA
- `ffmpeg/` a static ffmpeg binary

**Chromium is NOT bundled.** It is fetched on first run in the background
(`maybeInstallChromium()`, `macOS/src/main.ts:390`) into userData, with
`PLAYWRIGHT_BROWSERS_PATH` pointed at it. That keeps the installer far smaller.
Keep this design. Without it the scoped-read path degrades to plain fetch and
Facebook, Threads, Reddit and X posts lose their galleries (see
`backend/core/headless.py:877`).

## The Windows-specific work

Everything below is what genuinely differs. Anything not listed here should be
shared with macOS rather than duplicated.

### 1. Make the shell cross-platform rather than forking it

`macOS/src/*.ts` is mostly portable TypeScript. Decide early, and write the
decision into the plan's Status section:

- **Option A (preferred): rename `macOS/` to `desktop/`** and branch per platform
  inside it. One shell, two electron-builder targets. Avoids two copies of
  lifecycle code drifting apart, which is the failure mode that matters over time.
- **Option B: a parallel `windows/` directory.** Faster to start, and it will
  drift. Only pick this if Option A turns out to need surgery on `paths.ts`.

If Option A, `npm run dist` becomes `dist:mac` and `dist:win`, and the macOS
release workflow needs its path updated. Grep for `macOS/` across
`.github/workflows/` and `bump-version.ps1` before renaming: **the version
bumper writes `macOS/package.json` and `macOS/package-lock.json`, and it will
fail silently or loudly if that path moves.** This is the single highest-risk
edit in the plan.

### 2. Python runtime

python-build-standalone publishes Windows x64 `install_only` archives, but the
asset naming and archive format differ from the macOS arm64 ones, and the layout
inside is different: on Windows the interpreter is `python.exe` at the root, not
`bin/python3`. `bundle-backend.mjs` hardcodes the POSIX layout in several places.
Parameterise it rather than branching at every use.

Native wheels to watch, all of which must resolve for `cp312` on `win_amd64`:
`chromadb`, `lxml`, `pillow`, `faster-whisper` (pulls `onnxruntime`), `numpy`.
If any has no Windows wheel, `pip` will try to build from source and fail without
MSVC. Verify the whole install in a clean container before wiring the UI.

### 3. ffmpeg AND ffprobe

macOS stages a single `ffmpeg` binary. **Windows must stage `ffprobe.exe` too.**
`backend/config.py` derives the ffprobe path from `FFMPEG_BIN` by string
replacement, and three separate checks depend on it: `_has_audio_stream`,
`_has_video_stream`, and the hourly integrity scan. Without ffprobe they all
return `None`, which is handled safely (nothing is reported or rejected) but
silently disables the wrong-pull detection shipped in 3.19.0.

Static Windows builds: gyan.dev or BtbN. Pin a version and record a SHA256, the
way `FFMPEG_SHA256` already does for macOS.

### 4. yt-dlp

Not bundled on macOS either; it comes from `requirements.txt` as a Python
package, so it should work unchanged. Confirm the console-script shim
(`Scripts/yt-dlp.exe`) resolves from the staged Python, since `_have("yt-dlp")`
in `backend/core/localize_media.py` looks it up on PATH.

### 5. Paths and data location

macOS uses `app.getPath('userData')`. On Windows that is
`%APPDATA%\OpenMemo`. Two Windows-only hazards:

- **MAX_PATH.** Staged Python plus nested site-packages plus a deep install
  directory can exceed 260 characters and fail at install or import time. Either
  enable long paths in the NSIS installer, or keep the staged tree shallow.
- **SQLite WAL.** `docs/` and this repo's memory both record that WAL's shared
  memory file does not survive being opened across a Docker bind mount. A native
  Windows app has no bind mount and should be fine, but confirm `busy_timeout`
  and WAL are actually applied on the packaged build.

### 6. Signing and the first-run experience

There is no code-signing certificate (same constraint as macOS, which ships
ad-hoc signed and documents the Gatekeeper workaround in `docs/MACOS.md`).
Unsigned Windows installers get a SmartScreen "unrecognised app" interstitial,
and bundled Python plus Electron is a common antivirus false-positive shape.

Write `docs/WINDOWS.md` as the sibling of `docs/MACOS.md`, covering the
SmartScreen click-through honestly. Do not pretend it will not appear.

### 7. Release wiring

`.github/workflows/release.yml` builds the macOS dmg on a mac runner. Windows
needs a `windows-latest` job producing an NSIS installer, attached to the same
release. `bump-version.ps1` already stamps six version locations; if a Windows
`package.json` is added, it becomes a seventh and the bumper must learn it, or
releases will ship a Windows app claiming the wrong version.

## Suggested phases

Each phase ends somewhere testable. Do not start the next until the current one
runs.

- [ ] **Phase 0.** Decide Option A or B above. Write the decision and the reason
      into this file before writing code.
- [ ] **Phase 1.** Get the staged backend running by hand on Windows: staged
      Python, `pip install -r backend/requirements.txt`, ffmpeg and ffprobe on
      PATH, then `python -m uvicorn backend.main:app` and load the API in a
      browser. **No Electron yet.** This is where the wheel problems surface, and
      finding them here costs an hour instead of a day.
- [ ] **Phase 2.** Port `bundle-backend.mjs` to produce a Windows
      `resources-stage/`. Verify by running the staged Python from the stage
      directory, not from a dev environment.
- [ ] **Phase 3.** Electron shell boots, spawns the backend, serves the SPA.
- [ ] **Phase 4.** First-run Chromium fetch, mirroring `maybeInstallChromium`.
      Verify a Facebook or Threads post saves **with its gallery**, which is the
      proof the scoped read works. A post that saves as a bare link means
      Chromium is not being found.
- [ ] **Phase 5.** electron-builder NSIS installer, installed and launched on a
      clean Windows machine or VM with no Python, no Docker, no dev tools.
- [ ] **Phase 6.** CI job, release asset, `docs/WINDOWS.md`, README install
      section, and the version bumper taught about any new version location.

## STOP conditions

Stop and ask rather than working around any of these:

- A required wheel has no Windows build and would need compiling from source.
- Making the shell cross-platform requires changing macOS runtime behaviour.
  Shipping a Windows app that breaks the working macOS one is not a trade worth
  making silently.
- The installer needs administrator rights to work. Per-user install is the
  intent; if that turns out to be impossible, say so before building around it.

## Verification

Run the backend suite with the repo's venv python from the repo root, and run
`backend/tests/test_test_isolation.py` FIRST: an unisolated suite run against a
real checkout once destroyed 435 media files.

```bash
./backend/.venv/Scripts/python.exe -m pytest backend/tests/test_test_isolation.py -q
./backend/.venv/Scripts/python.exe -m pytest backend/tests -q
```

The real acceptance test is a clean Windows machine with no developer tools:
install, launch, save a link, save a Facebook album and confirm it arrives with
its photos, play a video, and restart the app to confirm data persisted.

## Conventions this must follow

- Changelog entry under the literal `## [Unreleased]` heading in the same session
  the work lands, never batched to release time.
- No em dashes in user-facing text, including the changelog and `docs/WINDOWS.md`.
- No `Co-Authored-By: Claude` trailer on commits.
- Branch, PR, then merge. Do not push to `main`.
