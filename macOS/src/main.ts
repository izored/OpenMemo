/**
 * OpenMemo macOS shell — main process.
 *
 * Boots the Python backend (which also serves the built SPA), then loads it
 * into a single native window. The window IS the whole product; no external
 * browser is ever opened. Ollama is user-provided — we only pass it the
 * host:port to talk to.
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { startBackend, stopBackend, restartBackend, StartedBackend } from './backend';
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

/** Persisted shell log, for diagnosing a failed launch after the fact. */
function logFile(): string {
  return path.join(app.getPath('userData'), 'logs', 'openmemo.log');
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
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Never let the window itself navigate away from the local app (a stray link
  // click shouldn't replace the UI with a remote page). External URLs open in
  // the system browser instead.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const local =
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('http://localhost') ||
      url.startsWith('file://');
    if (!local) {
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

async function boot(): Promise<void> {
  // App lock: gate everything behind the PIN. The backend isn't even started
  // until the user unlocks, so a locked app exposes nothing on localhost.
  if (isLockEnabled()) {
    const unlocked = await showLockGate();
    if (!unlocked) {
      app.quit();
      return;
    }
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
    backend = await startBackend(appendLog);
    appendLog(`[shell] Backend up at ${backend.url}\n`);
    maybeInstallChromium(); // first-run, background, non-blocking
    const target = rendererOverride ?? backend.url;
    await mainWindow?.loadURL(target);
    // Quietly check GitHub for a newer release once the app is up (packaged only).
    if (app.isPackaged) void checkForUpdates({ silent: true });
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
      await boot();
    } else {
      app.quit();
    }
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
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
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
      await mainWindow?.loadURL(process.env.OPENMEMO_RENDERER_URL ?? backend.url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- app-lock PIN ---------------------------------------------------------
  ipcMain.handle('lock:verify', (_evt, pin: string) => {
    if (verifyPin(pin)) {
      lockResolve?.(true);
      lockResolve = null;
      return { ok: true };
    }
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

// Single-instance: a second launch would spawn a second backend fighting for the
// same port. Bounce it and focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'OpenMemo',
      applicationVersion: app.getVersion(),
      copyright: '© izo.studio',
      credits: 'Your local AI knowledge OS. Bring your own Ollama.',
    });
    buildMenu();
    registerIpc();
    createWindow();
    void boot();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        void boot();
      }
    });
  });
}

// Backend is a child process — always tear it down with the app.
app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});
app.on('before-quit', () => stopBackend());
process.on('exit', () => stopBackend());
