# OpenMemo on macOS (Apple Silicon)

OpenMemo ships as a native **double-click Mac app** for Apple-Silicon Macs
(M1/M2/M3/M4). The whole UI runs in its own window — no browser, no Docker — and
a bundled Python backend boots behind it. **Ollama is yours**: the app never
ships, installs, or launches it. You run your own Ollama and point OpenMemo at
its `host:port`.

> Built without a paid Apple Developer account, so the app is **not notarized**.
> It still runs fine — macOS just needs a one-time Gatekeeper nudge on first
> launch (below).

---

## 1. Requirements

- An **Apple-Silicon** Mac (arm64). Intel Macs are out of scope.
- Your own **Ollama**, running and reachable (default `http://localhost:11434`).
  - Embeddings model: `nomic-embed-text`
  - Chat / vision: **Gemma 4** recommended (e.g. `gemma4:e4b`)
- macOS 12 (Monterey) or newer.

Everything else (Python, ffmpeg, the link-scraper's Chromium, the speech model)
is bundled or fetched by the app — you don't install it yourself.

---

## 2. Install a prebuilt `.dmg`

1. Open the `.dmg` and drag **OpenMemo** to **Applications**.
2. **First launch (Gatekeeper):** because the app isn't notarized, double-click
   will say it "cannot be opened." Do one of:
   - **Right-click → Open**, then **Open** in the dialog (only needed once), or
   - run once in Terminal:
     ```bash
     xattr -dr com.apple.quarantine /Applications/OpenMemo.app
     ```
3. The app opens to the loading screen, boots its backend, and shows the UI.

On first run it quietly fetches two optional pieces into your data folder (it
works without them, and never blocks startup):
- the **speech-to-text model** (the first time you transcribe audio), and
- the **Chromium** the link-scraper uses for antibot pages.

---

## 3. Point it at your Ollama

Default is `http://localhost:11434`. To change it: **menu bar → OpenMemo →
Ollama Host…**, type your address, **Save & Restart**. That's the only thing the
app needs to know about Ollama — it never manages models for you.

You can confirm the connection any time in **Settings → Local AI**.

---

## 4. Where your data lives

Everything writable lives outside the (read-only) app bundle, in:

```
~/Library/Application Support/OpenMemo/
  openmemo.db        SQLite (memos, collections, spaces)
  chroma/            vector store
  files/             uploaded images, audio, video, thumbnails
  hf-cache/          speech-to-text model
  ms-playwright/     link-scraper Chromium
```

Delete that folder to reset the app completely. Back it up to keep your library.

---

## 5. Build the `.dmg` from source (on a Mac)

The build **must** run on an Apple-Silicon Mac — it downloads a relocatable
arm64 Python, installs the backend's native wheels, and bundles an arm64 ffmpeg.

### Prerequisites

```bash
xcode-select --install        # Command Line Tools
# Homebrew from https://brew.sh, then:
brew install node ffmpeg
```

### Build

```bash
git clone <repo> openmemo && cd openmemo

# 1. frontend deps (the build step compiles the SPA)
npm --prefix frontend ci

# 2. macOS desktop shell deps
npm --prefix macOS install

# 3. build the .dmg (ad-hoc signed — see note)
cd macOS
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

`npm run dist` runs, in order: compile the shell TypeScript → build the SPA →
`macOS/scripts/bundle-backend.mjs` (download Python, `pip install`, copy backend
+ SPA, fetch ffmpeg) → `electron-builder`. The result is in `macOS/release/`.

> **`CSC_IDENTITY_AUTO_DISCOVERY=false`** stops electron-builder from hunting for
> a real Developer ID certificate; it falls back to an **ad-hoc** signature
> (`-`), the minimum macOS needs to launch an arm64 app. Without a paid account
> we can't notarize, so end users still do the Gatekeeper step in §2.

### Build overrides (env)

| Var | Purpose |
|-----|---------|
| `PBS_ASSET_URL` | Pin an exact [python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases) `install_only` arm64 macOS `.tar.gz` (otherwise the latest is auto-resolved). |
| `FFMPEG_SRC` | Path to a local static arm64 `ffmpeg` to bundle (skips download). |
| `FFMPEG_URL` | Alternate URL for a static arm64 `ffmpeg` (`.zip` or raw binary). |

---

## 6. Dev mode (fast iteration, no packaging)

Run the shell against your checked-out source and the `backend/.venv`:

```bash
bash macOS/setup-mac.sh            # once: venv + deps + frontend + chromium + shell
npm --prefix frontend run build    # the shell loads the built SPA
npm --prefix macOS run dev        # launches the native window
```

For live frontend HMR, run Vite separately and point the shell at it:

```bash
# terminal A
bash macOS/dev-mac.sh
# terminal B
OPENMEMO_RENDERER_URL=http://localhost:3000 npm --prefix macOS run dev
```

---

## Lock the app with a 4-digit PIN (optional)

Set a PIN from the menu: **OpenMemo → App Lock (PIN)…**. Once set, every launch
shows a lock screen and **the backend doesn't even start until you unlock** — so
a locked app exposes nothing, not even on localhost. Change or turn it off from
the same menu (it asks for the current PIN first).

The PIN is stored as a salted hash, encrypted with Electron `safeStorage` (tied
to your macOS login keychain), in `~/Library/Application Support/OpenMemo`. It's
a casual privacy lock — good against someone opening your laptop, not a vault
against a determined attacker with full disk access.

> Note: this is the **app-launch** lock. OpenMemo also has a separate, built-in
> **hidden-section passcode** (Settings → for hiding individual memos) — the two
> are independent.

---

## Security model

- The backend binds **127.0.0.1 only** — never your network. Nothing is exposed
  to other machines.
- The window runs with `contextIsolation` on and `nodeIntegration` off; it only
  ever loads the local app, and any external link opens in your system browser
  (in-window navigation away from the app is blocked).
- **Single-instance**: a second launch focuses the existing window instead of
  starting a second backend.
- **Ollama** is yours and local; no API keys or cloud calls are involved.
- The app is **ad-hoc signed, not notarized** (no paid Apple account) — hence the
  one-time Gatekeeper step. It is not sandboxed (it needs to read your media
  files and spawn ffmpeg / the Python backend).

---

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "App can't be opened" on first launch | Gatekeeper — right-click → Open, or `xattr -dr com.apple.quarantine /Applications/OpenMemo.app` (§2). |
| App dies instantly ("Killed: 9" in Console) | arm64 requires a valid signature on every binary. The build ad-hoc signs automatically (`scripts/afterPack.cjs`); if you assembled the app manually, run `codesign --force --deep --sign - /Applications/OpenMemo.app`. |
| Window stuck on the loading screen | Backend failed to boot. The error dialog shows the last log lines; usually a missing bundled resource — rebuild. In dev, make sure `frontend/dist` exists and `backend/.venv` is set up. |
| "Local AI: Offline" in Settings | Ollama isn't reachable. Start it, or set the right host via **OpenMemo → Ollama Host…**. |
| Link previews for antibot sites don't enrich | The first-run Chromium fetch hasn't finished (or failed). It degrades gracefully to plain HTTP; relaunch to retry. |
| Video thumbnails / "Make it local" muxing fail | The bundled ffmpeg isn't arm64. Rebuild with `FFMPEG_SRC` pointing at a known static arm64 binary. |

---

## 8. What's NOT here

- **Intel / universal builds** — Apple-Silicon only by design.
- **Notarization / App Store** — needs a paid Apple Developer account.
- **A bundled Ollama** — always your own; the app only talks to it.

Docker and the Windows dev flow are unchanged — see [INSTALL.md](INSTALL.md).
