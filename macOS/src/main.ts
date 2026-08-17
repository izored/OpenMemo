/**
 * OpenMemo macOS shell — main process.
 *
 * Boots the Python backend (which also serves the built SPA), then loads it
 * into a single native window. The window IS the whole product; no external
 * browser is ever opened. Ollama is user-provided — we only pass it the
 * host:port to talk to.
 */
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  globalShortcut,
  ipcMain,
  Notification,
  powerMonitor,
  shell,
} from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  startBackend,
  stopBackend,
  restartBackend,
  isBackendRunning,
  StartedBackend,
} from './backend';
import { resolvePaths, staticDir } from './paths';
import {
  loadSettings,
  saveSettings,
  isLockEnabled,
  verifyPin,
  setPin,
  disableLock,
  WindowState,
} from './settings-store';
import { checkForUpdates } from './update-notifier';

let mainWindow: BrowserWindow | null = null;
let backend: StartedBackend | null = null;
const bootLog: string[] = [];
// Resolver for the app-lock gate — fulfilled when the correct PIN is entered.
let lockResolve: ((ok: boolean) => void) | null = null;
// One silent update check per app run (not per window reopen).
let updateChecked = false;
// Files dropped on the Dock icon before the backend was up.
const pendingOpenFiles: string[] = [];

/** Persisted shell log, for diagnosing a failed launch after the fact. */
function logFile(): string {
  return path.join(app.getPath('userData'), 'logs', 'openmemo.log');
}

/**
 * True only for THIS app's own pages.
 *
 * "Local" is not the same as "ours". Accepting any loopback port meant any other
 * listener on the machine counted as the app: a dev server, a helper process,
 * something already compromised. Accepting any `file:` URL meant any HTML file
 * anywhere on disk did too. That was survivable while the renderer had almost no
 * privileges, and stopped being survivable the moment the preload started
 * exposing the shell's own settings, because an allowed window inherits it.
 *
 * So: exact origin match against the backend we started (host AND port), plus
 * the Vite origin in dev, plus files under our own static directory. Hostname is
 * compared exactly, since startsWith('http://localhost') also passes
 * http://localhost.evil.com.
 */
function isLocalAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const p = path.resolve(decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
      return p.startsWith(path.resolve(staticDir()));
    }
    if (u.protocol !== 'http:') return false;
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false;
    const allowed = [backend?.url, process.env.OPENMEMO_RENDERER_URL].filter(Boolean) as string[];
    // Before the backend is up there is no origin of ours to match, so nothing
    // qualifies. Nothing legitimately navigates in that window at that point.
    return allowed.some((base) => {
      try {
        return new URL(base).port === u.port;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Only the main window may call the shell bridge.
 *
 * `openmemoShell` can persist settings, restart the backend and set a login
 * item, and the window it lives in renders remote content: scraped article HTML,
 * memo descriptions, markdown from the web. A child window inherits the parent's
 * preload, and the lock screen loads the same one, so "the bridge exists" is not
 * the same as "this caller is allowed to use it". Every handler checks.
 */
function fromMainWindow(evt: Electron.IpcMainInvokeEvent): boolean {
  return !!mainWindow && evt.sender === mainWindow.webContents;
}

/** True while the PIN gate is up and waiting. The bridge is dead until it clears. */
function isLocked(): boolean {
  return lockResolve !== null;
}

/** Guard for every `openmemoShell` handler. Throws, so the renderer sees a rejection. */
function requireUnlockedMainWindow(evt: Electron.IpcMainInvokeEvent): void {
  if (!fromMainWindow(evt) || isLocked()) {
    throw new Error('not available from this window');
  }
}

/**
 * Load the SPA into the main window and install the window-drag region.
 *
 * The window is frameless (`titleBarStyle: 'hiddenInset'`), so there is no OS
 * title bar to grab — the web content must declare its own drag region or the
 * window can't be moved at all. A blanket `no-drag` (added earlier to stop the
 * loading/lock pages from hijacking every click) had removed the LAST drag
 * region too, leaving the window stuck in place, AND the traffic-light buttons
 * overlapped the sidebar's top (the "openMemo" logo / the hamburger).
 *
 * Fix (macOS shell only, injected here so the web app is untouched):
 *  1. Inset the sidebar head below the traffic lights so nothing collides.
 *  2. Make the sidebar head a drag region, with its buttons no-drag. Children
 *     paint above their parent, so the header's now-empty top band drags the
 *     window while the logo / collapse / search buttons stay fully clickable.
 *     Scoping the region to a real container (not a full-width overlay) means it
 *     can never swallow a click anywhere else in the UI.
 */
async function loadAppUrl(url: string): Promise<void> {
  if (!mainWindow) return;
  await mainWindow.loadURL(url);
  await mainWindow.webContents.insertCSS(`
    html, body { -webkit-app-region: no-drag; }
    /* Clear the macOS traffic lights, then let the header band move the window. */
    .om-sidebar-head { padding-top: 26px; -webkit-app-region: drag; }
    .om-sidebar.collapsed .om-sidebar-head { padding-top: 26px; }
    .om-sidebar-head button,
    .om-sidebar-head a,
    .om-sidebar-head input,
    .om-sidebar-head [role="button"] { -webkit-app-region: no-drag; }
  `);
}

function appendLog(line: string): void {
  bootLog.push(line);
  if (bootLog.length > 400) bootLog.shift();
  // Mirror to the loading screen if it's still showing.
  mainWindow?.webContents.send('boot:log', line);
  // Persist (best-effort) so a failed boot can be inspected later.
  try {
    const f = logFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, line.endsWith('\n') ? line : line + '\n');
  } catch {
    /* logging must never throw */
  }
}

function createWindow(): void {
  const saved = loadSettings().windowState;
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 860,
    x: saved?.x,
    y: saved?.y,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#0b0b0f',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (saved?.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Remember size/position for next launch (store the normal bounds, not the
  // maximized ones, plus the maximized flag).
  const persistBounds = () => {
    if (!mainWindow) return;
    const maximized = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
    saveSettings({ windowState: state });
  };
  mainWindow.on('close', persistBounds);

  // Open target=_blank / external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) {
      // Our own export and backup endpoints serve a file, not a page. "Export
      // all Memos" is an <a target="_blank"> to /api/export/markdown, and
      // allowing it opened a second frameless window with no menu, started the
      // download inside it, and left the empty window on screen. Hand those to
      // the downloader and open nothing.
      //
      // Named prefixes, not all of /api/: a memo's markdown can contain any
      // link, and a blanket rule turned "/api/anything" inside saved content
      // into a silent download.
      try {
        const p = new URL(url).pathname;
        if (p.startsWith('/api/export/') || p.startsWith('/api/backup')) {
          mainWindow?.webContents.downloadURL(url);
          return { action: 'deny' };
        }
      } catch {
        /* unparseable local URL: fall through to the normal window */
      }
      // Any window we do open renders app content but must NOT inherit the
      // shell bridge: the preload is the main window's privilege, not the
      // origin's.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: { preload: undefined, contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // A download that fails does so silently otherwise: no window, no error, the
  // user clicks Export and nothing ever happens.
  mainWindow.webContents.session.on('will-download', (_e, item) => {
    item.once('done', (_evt, state) => {
      if (state === 'completed') {
        appendLog(`[shell] Saved ${item.getFilename()}\n`);
        return;
      }
      appendLog(`[shell] Download ${state}: ${item.getFilename()}\n`);
      if (state === 'interrupted') {
        void dialog.showMessageBox({
          type: 'error',
          message: 'The download did not finish.',
          detail: `${item.getFilename()} was interrupted. Try again from Settings.`,
        });
      }
    });
  });

  // Never let the window itself navigate away from the local app (a stray link
  // click shouldn't replace the UI with a remote page). External URLs open in
  // the system browser instead.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isLocalAppUrl(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Show the PIN lock screen and resolve once the correct PIN is entered. */
function showLockGate(): Promise<boolean> {
  return new Promise((resolve) => {
    lockResolve = resolve;
    void mainWindow?.loadFile(path.join(staticDir(), 'lock.html'));
  });
}

/**
 * Open (or reopen) the app window: PIN gate → loading screen → backend
 * (started once, reused on window reopens — macOS keeps the app alive in the
 * Dock after the window closes) → load the UI.
 */
async function openAppWindow(): Promise<void> {
  if (!mainWindow) createWindow();

  // App lock: gate every window open behind the PIN. On first launch the
  // backend isn't even started until the user unlocks, so a locked app
  // exposes nothing on localhost. On reopen (backend already warm) the gate
  // still covers the UI.
  if (isLockEnabled()) {
    buildMenu(true); // no DevTools, no backend restart, while the gate is up
    const unlocked = await showLockGate();
    buildMenu();
    if (!unlocked) return;
  }

  // Show the loading screen immediately so launch never looks frozen.
  await mainWindow?.loadFile(path.join(staticDir(), 'loading.html'));

  // In dev, the built SPA must exist (the backend serves it). Tell the user how.
  const { frontendDist } = resolvePaths();
  const rendererOverride = process.env.OPENMEMO_RENDERER_URL; // e.g. Vite for HMR
  if (!rendererOverride && !fs.existsSync(path.join(frontendDist, 'index.html'))) {
    if (!app.isPackaged) {
      appendLog(`[shell] No built frontend at ${frontendDist}\n`);
      appendLog('[shell] Run:  npm run build:frontend   (in macOS/)\n');
    }
  }

  try {
    // Reuse the running backend on window reopen; never double-spawn.
    if (!isBackendRunning()) {
      backend = await startBackend(appendLog);
      appendLog(`[shell] Backend up at ${backend.url}\n`);
      maybeInstallChromium(); // first-run, background, non-blocking
      flushPendingOpenFiles();
      void nudgeRelay('boot');
      // Say it out loud when the port moved. The app itself is fine, but the
      // browser extension stores one fixed address, so the only symptom
      // otherwise is clipping a page and having nothing arrive.
      if (backend.driftedFrom) {
        const moved = backend.port;
        void dialog.showMessageBox({
          type: 'warning',
          title: 'openMemo is on a different port',
          message: `Port ${backend.driftedFrom} was busy, so openMemo started on ${moved}.`,
          detail:
            'The app works normally. If you use the browser extension, point it at ' +
            `http://localhost:${moved}/api, or quit whatever is holding ${backend.driftedFrom} and relaunch.`,
          buttons: ['OK'],
        });
      }
    }
    const target = rendererOverride ?? backend!.url;
    await loadAppUrl(target);
    // Quietly check GitHub for a newer release, once per app run (packaged only).
    if (app.isPackaged && !updateChecked) {
      updateChecked = true;
      void checkForUpdates({ silent: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[shell] FAILED: ${msg}\n`);
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'OpenMemo could not start',
      message: 'The backend did not start.',
      detail: `${msg}\n\nLast log lines:\n${bootLog.slice(-12).join('')}`,
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      await openAppWindow();
    } else {
      app.quit();
    }
  }
}

/**
 * Native "New Memo" (File menu / ⌘N / global shortcut): make sure the window
 * exists and is front, then ask the SPA to open the add-memo island. The SPA
 * listens for this event in Layout.tsx.
 */
async function triggerQuickAdd(): Promise<void> {
  if (!mainWindow) await openAppWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  void mainWindow.webContents.executeJavaScript(
    "window.dispatchEvent(new CustomEvent('openmemo:quick-add'))",
    true,
  );
}

/**
 * Front the window and take the SPA to Settings (menu → Settings…, Cmd+,).
 * A client-side route change, not a reload, so nothing is refetched.
 */
async function openSettingsPage(): Promise<void> {
  if (!mainWindow) await openAppWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // The window may be showing lock.html or loading.html. Both are ours, so
  // isLocalAppUrl says yes, but neither listens for this. Match the SPA's own
  // origin instead: dispatching into the other two is a silent no-op.
  const spa = process.env.OPENMEMO_RENDERER_URL ?? backend?.url;
  if (!spa || !mainWindow.webContents.getURL().startsWith(spa)) return;
  // The SPA registers its listener in an effect, so a dispatch that arrives in
  // the same tick as first paint lands on nobody. Retry a few times, cheaply,
  // and stop as soon as the app confirms it handled one.
  for (let i = 0; i < 10; i++) {
    const handled = await mainWindow.webContents
      .executeJavaScript(
        "!!window.__openmemoSettingsListener && (window.dispatchEvent(new CustomEvent('openmemo:open-settings')), true)",
        true,
      )
      .catch(() => false);
    if (handled) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Ingest files dropped on the Dock icon (or opened via Finder "Open With").
 * Posted straight to the backend's multipart endpoint; the SPA refetches on
 * window focus, so new memos appear without a manual reload.
 */
async function ingestFiles(filePaths: string[]): Promise<void> {
  if (!backend) return;
  for (const p of filePaths) {
    try {
      const buf = await fs.promises.readFile(p);
      const form = new FormData();
      form.append('file', new Blob([buf]), path.basename(p));
      const res = await fetch(`${backend.url}api/ingest/file`, { method: 'POST', body: form });
      appendLog(`[shell] Dock ingest ${path.basename(p)} → HTTP ${res.status}\n`);
    } catch (e) {
      appendLog(`[shell] Dock ingest failed for ${p}: ${e instanceof Error ? e.message : e}\n`);
    }
  }
  if (!mainWindow) await openAppWindow();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function flushPendingOpenFiles(): void {
  if (pendingOpenFiles.length === 0) return;
  const batch = pendingOpenFiles.splice(0, pendingOpenFiles.length);
  void ingestFiles(batch);
}

// ── Telegram relay: wake it up ────────────────────────────────────────────
// Telegram holds an undelivered share for 24 hours and then drops it, so the
// whole job on a laptop is being reachable at least once a day. macOS stops the
// monotonic clock during system sleep, so the backend's 15 minute timer comes
// out of an eight hour nap with 15 minutes still to run. Wake, unlock, focus and
// an hourly tick all nudge it to drain now.
//
// There is deliberately NO powerSaveBlocker here. `prevent-app-suspension` reads
// like "hold off App Nap" and is not: on macOS it asserts
// PreventUserIdleSystemSleep, so the whole Mac stops idle-sleeping for as long
// as phone capture is on. That is a battery bug on a laptop, and it would also
// remove the `resume` event this code depends on.
//
// Two debounce buckets, not one. A lid opening emits `resume` while Wi-Fi is
// still reassociating, then `unlock-screen` seconds later once the user has
// authenticated and the network is actually up. Sharing one bucket meant the
// early, useless nudge won and the good one was dropped.
let lastCasualNudge = 0;
const CASUAL_NUDGE_MS = 30_000;

/** Persisted so relaunching does not re-show a warning the user just dismissed. */
function staleWarnedAt(): number {
  return loadSettings().staleWarnedAt ?? 0;
}

/**
 * @param reason  free text for the log
 * @param force   wake events skip the debounce; `focus` and the hourly tick do not
 */
async function nudgeRelay(reason: string, force = false): Promise<void> {
  if (!backend || !isBackendRunning()) return;
  const now = Date.now();
  if (!force && now - lastCasualNudge < CASUAL_NUDGE_MS) return;
  if (!force) lastCasualNudge = now;
  try {
    const res = await fetch(`${backend.url}api/settings/telegram/poll-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      // Parsing an error body would read `telegram_enabled: undefined` as "off".
      appendLog(`[shell] relay nudge (${reason}) → HTTP ${res.status}\n`);
      return;
    }
    const body = (await res.json()) as {
      kicked?: boolean;
      stale?: boolean;
      hours_since_success?: number | null;
    };
    appendLog(`[shell] relay nudge (${reason}) → kicked=${!!body.kicked}\n`);
    // Past the warning line, the 24 hour cliff is close. Say it on screen rather
    // than only on a Settings page nobody has open: the whole failure mode is
    // the app being closed or asleep for too long.
    if (body.stale && Notification.isSupported() && now - staleWarnedAt() > 6 * 60 * 60 * 1000) {
      const hours = body.hours_since_success;
      const n = new Notification({
        title: 'openMemo has not reached Telegram',
        body:
          hours === null || hours === undefined
            ? 'It has never got through since phone capture was turned on. Check the bot token in Settings.'
            : `Last answer was ${Math.round(hours)} hours ago. Telegram drops shares after 24.`,
      });
      // Only burn the six hour window once the notification is actually on
      // screen. If macOS refuses it (authorization denied, or an unsigned build
      // failing the bundle-proxy check) we want to try again on the next wake.
      n.once('show', () => saveSettings({ staleWarnedAt: Date.now() }));
      n.once('click', () => void openSettingsPage());
      n.show();
    }
  } catch (e) {
    // Do not keep the debounce for an attempt that never landed: the wifi was
    // probably still coming up, and the next event is the retry.
    if (!force) lastCasualNudge = 0;
    appendLog(`[shell] relay nudge (${reason}) failed: ${e instanceof Error ? e.message : e}\n`);
  }
}

/**
 * First-run only: fetch the link-scraper's Chromium into userData, in the
 * background. Packaged builds ship lean (no browser); the scraper degrades
 * gracefully until this lands, so it never blocks startup. Dev uses the venv's
 * own `patchright install chromium` from setup-mac.sh.
 */
function maybeInstallChromium(): void {
  if (!app.isPackaged) return;
  const userData = app.getPath('userData');
  const marker = path.join(userData, '.chromium-installed');
  if (fs.existsSync(marker)) return;

  const paths = resolvePaths();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: path.join(userData, 'ms-playwright'),
    PATH: [...paths.extraPath, process.env.PATH ?? ''].join(path.delimiter),
  };
  appendLog('[shell] Fetching link-scraper browser (first run, background)…\n');
  const child = spawn(paths.pythonBin, ['-m', 'patchright', 'install', 'chromium'], {
    cwd: paths.backendCwd,
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (e) => appendLog(`[shell] Browser fetch error: ${e.message}\n`));
  child.on('exit', (code) => {
    if (code === 0) {
      try {
        fs.writeFileSync(marker, String(Date.now()));
      } catch {
        /* ignore */
      }
      appendLog('[shell] Link-scraper browser ready.\n');
    } else {
      appendLog(`[shell] Browser fetch exited ${code} (scraping degrades gracefully).\n`);
    }
  });
  child.unref();
}

/** Small modal to point OpenMemo at the user's Ollama. Never installs anything. */
function openOllamaHostDialog(): void {
  const win = new BrowserWindow({
    width: 460,
    height: 240,
    parent: mainWindow ?? undefined,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Ollama Host',
    backgroundColor: '#14141a',
    webPreferences: {
      preload: path.join(__dirname, 'config-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(staticDir(), 'ollama-config.html'));
}

/** One PIN sheet at a time: the renderer can ask for it, so it must not stack. */
let pinDialogOpen = false;

/** Modal to set / change / turn off the 4-digit app-lock PIN. */
function openPinConfigDialog(): void {
  if (pinDialogOpen) return;
  pinDialogOpen = true;
  const win = new BrowserWindow({
    width: 440,
    height: 300,
    parent: mainWindow ?? undefined,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'App Lock',
    backgroundColor: '#14141a',
    webPreferences: {
      preload: path.join(__dirname, 'config-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.on('closed', () => { pinDialogOpen = false; });
  win.loadFile(path.join(staticDir(), 'pin-config.html'));
}

/**
 * @param locked  the PIN gate is up. The full menu is a way around it: View →
 *   Toggle DevTools reaches the lock renderer, and Ollama Host… restarts the
 *   backend and loads the unlocked app, abandoning the gate. While locked the
 *   menu is About and Quit and nothing else.
 */
function buildMenu(locked = false): void {
  const isMac = process.platform === 'darwin';
  if (locked) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }],
        },
      ]),
    );
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Check for Updates…',
                click: () => void checkForUpdates({ silent: false }),
              },
              { type: 'separator' as const },
              // Cmd+, means Settings on every Mac, so it opens Settings. It
              // used to open the Ollama host sheet, which is one row inside
              // that page now (and still reachable here for muscle memory).
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: () => void openSettingsPage(),
              },
              {
                label: 'Ollama Host…',
                click: () => openOllamaHostDialog(),
              },
              {
                label: 'App Lock (PIN)…',
                click: () => openPinConfigDialog(),
              },
              {
                label: 'Open Logs Folder',
                click: () => void shell.openPath(path.dirname(logFile())),
              },
              {
                label: 'Open at Login',
                type: 'checkbox' as const,
                checked: app.getLoginItemSettings().openAtLogin,
                click: (item: Electron.MenuItem) =>
                  app.setLoginItemSettings({ openAtLogin: item.checked }),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Memo',
          accelerator: 'CmdOrCtrl+N',
          click: () => void triggerQuickAdd(),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * A host string safe to hand the backend, or null.
 *
 * The value ends up as OLLAMA_HOST, which the backend turns into outbound
 * request URLs carrying chat prompts and memo excerpts. It arrives from a
 * renderer that also displays scraped web content, so "non-empty" is not
 * enough of a check: an http(s) URL, no credentials in it, nothing else.
 */
function cleanOllamaHost(raw: string): string | null {
  const clean = (raw || '').trim();
  if (!clean) return null;
  try {
    const u = new URL(clean);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function registerIpc(): void {
  ipcMain.handle('ollama:get', (evt) => {
    requireUnlockedMainWindow(evt);
    return loadSettings().ollamaHost;
  });
  ipcMain.handle('ollama:save', async (evt, host: string) => {
    // The menu sheet has its own window and its own preload, so it is allowed
    // through; everything else must be the unlocked main window.
    if (evt.sender === mainWindow?.webContents && isLocked()) {
      return { ok: false, error: 'not available while locked' };
    }
    const clean = cleanOllamaHost(host);
    if (!clean) return { ok: false, error: 'Enter a full http address, e.g. http://localhost:11434' };
    const previous = loadSettings().ollamaHost;
    saveSettings({ ollamaHost: clean });
    // Restart the backend so it picks up the new OLLAMA_HOST, then reload.
    try {
      await mainWindow?.loadFile(path.join(staticDir(), 'loading.html'));
      backend = await restartBackend(appendLog);
      await loadAppUrl(process.env.OPENMEMO_RENDERER_URL ?? backend.url);
      // Land back where the change was made, not on the dashboard.
      void openSettingsPage();
      return { ok: true };
    } catch (err) {
      // The caller was destroyed by the loadFile above, so an error returned to
      // it reaches nobody: the window would sit on the loading screen forever
      // with no explanation and no way back. Say it natively, and put the old
      // host back, because a bad one leaves the app unable to start at all.
      const detail = err instanceof Error ? err.message : String(err);
      appendLog(`[shell] Ollama host ${clean} failed: ${detail}\n`);
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Could not start with that Ollama host',
        message: 'The backend did not come back up.',
        detail: `${detail}\n\nGoing back to ${previous}.`,
        buttons: ['OK'],
      });
      saveSettings({ ollamaHost: previous });
      try {
        backend = await restartBackend(appendLog);
        await loadAppUrl(process.env.OPENMEMO_RENDERER_URL ?? backend.url);
      } catch {
        // Even the old host will not come up, so this is not about Ollama.
        // openAppWindow's own Retry/Quit dialog is the right owner of that.
        await openAppWindow();
      }
      return { ok: false, error: detail };
    }
  });

  // --- app-lock PIN ---------------------------------------------------------
  // Linear backoff on failed attempts so the IPC can't be used as a fast PIN
  // oracle (4 digits = only 10k combos without this).
  let lockFails = 0;
  ipcMain.handle('lock:verify', async (_evt, pin: string) => {
    if (lockFails > 0) {
      await new Promise((r) => setTimeout(r, Math.min(lockFails * 400, 4000)));
    }
    if (verifyPin(pin)) {
      lockFails = 0;
      lockResolve?.(true);
      lockResolve = null;
      return { ok: true };
    }
    lockFails += 1;
    return { ok: false };
  });
  ipcMain.handle('lock:status', () => ({ enabled: isLockEnabled() }));
  // The Settings page asks for the sheet rather than building its own PIN form:
  // the current-PIN check and the safeStorage write stay in one place. One at a
  // time, so nothing can stack native modals over the app.
  ipcMain.handle('lock:configure', (evt) => {
    requireUnlockedMainWindow(evt);
    if (pinDialogOpen) return;
    openPinConfigDialog();
  });
  ipcMain.handle('login-item:get', (evt) => {
    requireUnlockedMainWindow(evt);
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('login-item:set', (evt, on: boolean) => {
    requireUnlockedMainWindow(evt);
    app.setLoginItemSettings({ openAtLogin: !!on });
    buildMenu(); // the menu carries the same checkbox; keep the two in step
    // setLoginItemSettings returns void and macOS can refuse the registration
    // (SMAppService rejects some unsigned or non-/Applications builds), so read
    // it back: the caller shows what actually happened, not what was asked for.
    const actual = app.getLoginItemSettings().openAtLogin;
    if (actual !== !!on) {
      appendLog(`[shell] macOS refused Open at Login = ${!!on}\n`);
    }
    return actual;
  });
  ipcMain.handle('logs:open', (evt) => {
    requireUnlockedMainWindow(evt);
    void shell.openPath(path.dirname(logFile()));
  });
  ipcMain.handle('backups:open', (evt) => {
    requireUnlockedMainWindow(evt);
    // Created lazily by the backend's scheduler, so it may not exist on a
    // brand new install. Opening userData is more useful than doing nothing.
    const dir = path.join(app.getPath('userData'), 'backups');
    void shell.openPath(fs.existsSync(dir) ? dir : app.getPath('userData'));
  });
  ipcMain.handle('update:check', (evt) => {
    requireUnlockedMainWindow(evt);
    void checkForUpdates({ silent: false });
  });
  ipcMain.handle('lock:set', (_evt, { current, next }: { current: string; next: string }) => {
    if (isLockEnabled() && !verifyPin(current)) {
      return { ok: false, error: 'Current PIN is incorrect' };
    }
    const pin = (next || '').trim();
    if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN must be exactly 4 digits' };
    setPin(pin);
    return { ok: true };
  });
  ipcMain.handle('lock:disable', (_evt, current: string) => {
    if (!isLockEnabled()) return { ok: true };
    if (!verifyPin(current)) return { ok: false, error: 'Current PIN is incorrect' };
    disableLock();
    return { ok: true };
  });
}

// Dock drop / Finder "Open With" → ingest. Must be registered before 'ready';
// files arriving before the backend is up are queued and flushed after boot.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (backend && isBackendRunning()) {
    void ingestFiles([filePath]);
  } else {
    pendingOpenFiles.push(filePath);
  }
});

// openmemo:// deep link (registered below + `protocols` in electron-builder.yml).
// openmemo://memo/<id> etc. maps onto the SPA's client routes; a bare
// openmemo:// just focuses/reopens the app.
app.on('open-url', (event, url) => {
  event.preventDefault();
  void (async () => {
    if (!mainWindow) await openAppWindow();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (!backend || !isBackendRunning()) return;
    try {
      const u = new URL(url);
      // host + pathname → SPA route ("memo/abc", "settings", …). Sanitized:
      // only ever appended to our own local origin.
      const route = `${u.host}${u.pathname}`.replace(/^\/+|\/+$/g, '');
      if (route) await loadAppUrl(`${backend.url}${route}`);
    } catch {
      /* malformed link — focusing the app is enough */
    }
  })();
});

// Single-instance: a second launch would spawn a second backend fighting for the
// same port. Bounce it and focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      void openAppWindow();
    }
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'OpenMemo',
      applicationVersion: app.getVersion(),
      copyright: '© izo.studio',
      credits: 'Your local AI knowledge OS. Bring your own Ollama.',
    });
    // Claim the openmemo:// scheme (Info.plist side is `protocols` in
    // electron-builder.yml; this covers dev runs too).
    app.setAsDefaultProtocolClient('openmemo');
    // Global quick-capture: ⌘⇧M from anywhere → front the app + open the
    // add-memo island. Deliberately not ⌘⇧N (Finder's new-folder).
    const ok = globalShortcut.register('CommandOrControl+Shift+M', () => void triggerQuickAdd());
    if (!ok) appendLog('[shell] Global shortcut ⌘⇧M unavailable (taken by another app).\n');
    buildMenu();
    registerIpc();
    void openAppWindow();

    // macOS: Dock click with no window → reopen (backend already warm).
    app.on('activate', () => {
      if (!mainWindow) void openAppWindow();
    });

    // Coming back from sleep, the lock screen, or another app: drain Telegram
    // now rather than serving out a timer that did not advance while asleep.
    // Wake events force past the debounce (see nudgeRelay); focus does not.
    powerMonitor.on('resume', () => void nudgeRelay('resume', true));
    powerMonitor.on('unlock-screen', () => void nudgeRelay('unlock', true));
    app.on('browser-window-focus', () => void nudgeRelay('focus'));
    // A Mac that never sleeps (a desktop, or a laptop on a desk) fires none of
    // the above. Without this the 20 hour warning and the 24 hour cliff can both
    // pass in total silence while the app sits there open.
    setInterval(() => void nudgeRelay('hourly'), 60 * 60 * 1000).unref?.();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());

// macOS convention: closing the window keeps the app (and the warm backend)
// alive in the Dock — reopening is instant. Everywhere else, close = quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend();
    app.quit();
  }
});
// ⌘Q / real quit: always tear the backend down with the app.
app.on('before-quit', () => stopBackend());
process.on('exit', () => stopBackend());
