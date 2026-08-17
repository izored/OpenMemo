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
  powerMonitor,
  powerSaveBlocker,
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
 * True only for the app's own local origins. Exact hostname match — a naive
 * startsWith('http://localhost') would also pass http://localhost.evil.com.
 */
function isLocalAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true;
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
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
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
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
    const unlocked = await showLockGate();
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

// ── Telegram relay: wake it, and keep it awake ────────────────────────────
// Telegram holds an undelivered share for 24 hours and then drops it, so the
// whole job on a laptop is being reachable at least once a day. Two things
// fight that. macOS stops the monotonic clock during system sleep, so the
// backend's 15 minute timer comes out of an eight hour nap with 15 minutes
// still to run. And App Nap stretches timers in a backgrounded app. Wake,
// unlock and focus nudge the backend to drain now; App Nap is held off only
// while phone capture is actually on, because a power blocker on a laptop is
// not free.
let lastNudge = 0;
let suspendBlockerId: number | null = null;

/** Hold off App Nap while phone capture is on, and only then. */
function syncSuspendBlocker(relayOn: boolean): void {
  if (relayOn && suspendBlockerId === null) {
    suspendBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    appendLog('[shell] App Nap held off (phone capture is on).\n');
  } else if (!relayOn && suspendBlockerId !== null) {
    powerSaveBlocker.stop(suspendBlockerId);
    suspendBlockerId = null;
    appendLog('[shell] App Nap released.\n');
  }
}

async function nudgeRelay(reason: string): Promise<void> {
  if (!backend || !isBackendRunning()) return;
  const now = Date.now();
  if (now - lastNudge < 30_000) return; // focus fires constantly; once is enough
  lastNudge = now;
  try {
    const res = await fetch(`${backend.url}api/settings/telegram/poll-now`, { method: 'POST' });
    const body = (await res.json()) as { kicked?: boolean; telegram_enabled?: boolean };
    appendLog(`[shell] relay nudge (${reason}) → kicked=${!!body.kicked}\n`);
    syncSuspendBlocker(!!body.telegram_enabled);
  } catch (e) {
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

/** Modal to set / change / turn off the 4-digit app-lock PIN. */
function openPinConfigDialog(): void {
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
  win.loadFile(path.join(staticDir(), 'pin-config.html'));
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
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
              {
                label: 'Ollama Host…',
                accelerator: 'Cmd+,',
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

function registerIpc(): void {
  ipcMain.handle('ollama:get', () => loadSettings().ollamaHost);
  ipcMain.handle('ollama:save', async (_evt, host: string) => {
    const clean = (host || '').trim();
    if (!clean) return { ok: false, error: 'Host is empty' };
    saveSettings({ ollamaHost: clean });
    // Restart the backend so it picks up the new OLLAMA_HOST, then reload.
    try {
      await mainWindow?.loadFile(path.join(staticDir(), 'loading.html'));
      backend = await restartBackend(appendLog);
      await loadAppUrl(process.env.OPENMEMO_RENDERER_URL ?? backend.url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    powerMonitor.on('resume', () => void nudgeRelay('resume'));
    powerMonitor.on('unlock-screen', () => void nudgeRelay('unlock'));
    app.on('browser-window-focus', () => void nudgeRelay('focus'));
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  syncSuspendBlocker(false);
});

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
