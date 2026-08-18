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
   will say it "cannot be opened." Clear the quarantine flag in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/OpenMemo.app
   ```
   This works on every macOS version. If you would rather click:
   - **macOS 14 and earlier:** right-click the app, choose **Open**, then
     **Open** in the dialog.
   - **macOS 15 (Sequoia) and later:** right-click no longer offers the
     override. Try to open the app once, then go to **System Settings →
     Privacy & Security**, scroll to the bottom, and press **Open Anyway**.
3. The app opens to the loading screen, boots its backend, and shows the UI.

On first run it quietly fetches two optional pieces into your data folder (it
works without them, and never blocks startup):
- the **speech-to-text model** (the first time you transcribe audio), and
- the **Chromium** the link-scraper uses for antibot pages.

---

## 3. Update to a new version

**Your library is not inside the app.** It lives in
`~/Library/Application Support/OpenMemo/`, and dropping a new `OpenMemo.app`
into `/Applications` replaces the program and nothing else. Memos, collections,
media, settings, your PIN, the downloaded speech model: all of it stays exactly
where it was, and the new build picks it up on first launch.

So updating is:

1. **Quit OpenMemo** (Cmd-Q, not just closing the window). The backend holds
   the database open, and swapping the app out from under a running one is
   asking for trouble.
2. Open the new `.dmg` and drag **OpenMemo** to **Applications**. Finder asks
   whether to replace. Say yes.
3. **Gatekeeper again.** A fresh download carries a fresh quarantine flag, so
   the step from section 2 applies to every update, not just the first install:
   ```bash
   xattr -dr com.apple.quarantine /Applications/OpenMemo.app
   ```
4. Launch it. Before the backend starts, the app notices the version changed
   and saves a copy of your library to
   `~/Library/Application Support/OpenMemo/backups/`, named
   `preupgrade-<old>-to-<new>-<date>-<time>.zip`. Then it opens the library
   and applies whatever schema changes the new version needs.

   That `.zip` is an ordinary openMemo backup, the same thing Settings makes,
   so you can put it back through the app. See below.

   Updating from a build that predates this feature gives you
   `preupgrade-unknown-to-<new>-...`: those builds did not record their own
   version, so there is nothing to name the old side after.

   If the copy cannot be written, usually a full disk, the app says so and
   carries on rather than refusing to open. So it is a strong safety net, not
   a guarantee. Settings, under Backup, takes one on demand any time.

The three most recent pre-update copies are kept, and going backwards keeps its
own three, so retreating from a bad update cannot rotate away the copy you are
retreating to. The daily automatic backups are a separate set and neither
rotation touches the other.

> **Do not delete `~/Library/Application Support/OpenMemo/` to "reinstall
> clean".** That folder *is* your library. Throwing away the app is harmless.
> Throwing away that folder is the one irreversible thing on this page.

### Putting a pre-update copy back

The file is a normal openMemo backup, so:

1. **Settings → Backup & Restore → Restore.**
2. Pick the `preupgrade-...zip` from
   `~/Library/Application Support/OpenMemo/backups/`. The Backup card has an
   **Open folder** button that takes you straight there.
3. Confirm. Everything in openMemo is replaced by what is in that file, and
   the app reloads.

It holds your memos, collections, spaces, tags and notes. It does **not** hold
your uploaded images, audio and video: those are far larger, they are not what
a schema migration can damage, and they stay untouched on disk through all of
this. For a copy that includes them, use **Backup** in that same card and pick
the full scope.

### Going back to an older version

Supported, with a warning. The database only migrates forwards, so a library
that has been opened by a newer build carries columns an older one has never
seen. Launch an older `.dmg` over a newer library and the app saves a
`predowngrade-...zip` copy, then says what it found and offers to quit before
anything starts. Backing out is free, and doing it twice does not pile up
copies: the same switch is only ever captured once. Reinstalling the newer
version is the safer move.

### If you use the PIN lock

The app lock stores its PIN in your macOS login keychain, and the keychain
identifies apps by their signature. openMemo is signed ad-hoc rather than by a
paid Apple developer account (see section 6), so each build has a different
signature and macOS treats an updated app as a new one. **The first launch
after an update may ask for your login password.** Allow it, and the PIN keeps
working.

If you deny it, the lock screen will refuse the correct PIN, because the app
can no longer read what it stored. To recover, quit openMemo and delete the
`lockEnabled` and `lockBlob` lines from
`~/Library/Application Support/OpenMemo/openmemo-desktop.json`. That turns the
lock off and leaves everything else alone. Set a new PIN from Settings.

---

## 4. Point it at your Ollama

Default is `http://localhost:11434`. To change it: **Settings → Local AI →
Host**, or **menu bar → OpenMemo → Ollama Host…**. Both save, restart the
backend and reload. That's the only thing the app needs to know about Ollama:
it never manages models for you. If your host doesn't answer, openMemo also
tries a small built-in fallback list before giving up.

You can confirm the connection any time in **Settings → Local AI**.

---

## 5. Where your data lives

Everything writable lives outside the (read-only) app bundle, in:

```
~/Library/Application Support/OpenMemo/
  openmemo.db        SQLite (memos, collections, spaces)
  app_settings.json  your Settings-page preferences
  chroma/            vector store
  files/             uploaded images, audio, video, thumbnails
  backups/           library snapshots: daily `openmemo-*.db.gz`, plus
                     `preupgrade-*.zip` / `predowngrade-*.zip` written before
                     a version change (restorable from Settings)
  openmemo-desktop.json  app-lock PIN, Ollama host, window size, last version
  logs/              boot log (Settings → Security → Logs opens this)
  hf-cache/          speech-to-text model
  ms-playwright/     link-scraper Chromium
  yt_cookies.txt     only if you uploaded a cookie jar
```

That folder is your library. Copy it somewhere to keep a spare, and leave it
alone when you update: replacing the app never touches it (section 3).

Deleting it does reset the app completely, and it is the only way to lose
everything at once. It is not a troubleshooting step. Reinstalling the app does
not require it, and nothing else on this page does either.

---

## 6. Build the `.dmg` from source (on a Mac)

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

## 7. Dev mode (fast iteration, no packaging)

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

## It behaves like a Mac app

- **Closing the window doesn't quit.** The app (and its warm backend) stays in
  the Dock; click the Dock icon to reopen instantly. ⌘Q quits for real. If the
  PIN lock is on, reopening asks for the PIN again.
- **⌘N — New Memo** from the File menu, and **⌘⇧M from anywhere** (global
  shortcut) fronts the app with the add-memo island open.
- **⌘, — Settings** opens the app's own Settings page, like any other Mac app.
- **Phone capture catches up on wake.** Opening the lid, unlocking, or bringing
  the window forward nudges the Telegram relay instead of waiting out its poll
  interval. Telegram only holds a share for 24 hours, so if openMemo has not got
  through in 20, it says so on the Settings card and in a notification.
- **Drop files on the Dock icon** (or Finder → Open With → OpenMemo) and
  they're ingested as memos directly.
- **`openmemo://` links** open the app — e.g. `openmemo://memo/<id>` jumps to a
  memo, `openmemo://settings` to Settings.
- **Open at Login** — in the OpenMemo menu, or Settings → Security.
- Window size/position persist; About shows the real version; update checks on
  launch (menu → Check for Updates…).

---

## Lock the app with a 4-digit PIN (optional)

Set a PIN from **Settings → Security → App lock**, or the menu:
**OpenMemo → App Lock (PIN)…**. Once set, every launch
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

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "App can't be opened" on first launch | Gatekeeper — right-click → Open, or `xattr -dr com.apple.quarantine /Applications/OpenMemo.app` (§2). |
| App dies instantly ("Killed: 9" in Console) | arm64 requires a valid signature on every binary. The build ad-hoc signs automatically (`scripts/afterPack.cjs`); if you assembled the app manually, run `codesign --force --deep --sign - /Applications/OpenMemo.app`. |
| Window stuck on the loading screen | Backend failed to boot. The error dialog shows the last log lines; usually a missing bundled resource — rebuild. In dev, make sure `frontend/dist` exists and `backend/.venv` is set up. |
| "Local AI: Offline" in Settings | Ollama isn't reachable. Start it, or set the right host in **Settings → Local AI → Host** (or **OpenMemo → Ollama Host…**). |
| Link previews for antibot sites don't enrich | The first-run Chromium fetch hasn't finished (or failed). It degrades gracefully to plain HTTP; relaunch to retry. |
| Video thumbnails / "Make it local" muxing fail | The bundled ffmpeg isn't arm64. Rebuild with `FFMPEG_SRC` pointing at a known static arm64 binary. |

---

## 9. What's NOT here

- **Intel / universal builds** — Apple-Silicon only by design.
- **Notarization / App Store** — needs a paid Apple Developer account.
- **A bundled Ollama** — always your own; the app only talks to it.

Docker and the Windows dev flow are unchanged — see [INSTALL.md](INSTALL.md).
