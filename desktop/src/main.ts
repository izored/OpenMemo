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
import { loadSettings, saveSettings } from './settings-store';

let mainWindow: BrowserWindow | null = null;
let backend: StartedBackend | null = null;
const bootLog: string[] = [];

function appendLog(line: string): void {
  bootLog.push(line);
  if (bootLog.length > 400) bootLog.shift();
  // Mirror to the loading screen if it's still showing.
  mainWindow?.webContents.send('boot:log', line);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
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

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open target=_blank / external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot(): Promise<void> {
  // Show the loading screen immediately so launch never looks frozen.
  await mainWindow?.loadFile(path.join(staticDir(), 'loading.html'));

  // In dev, the built SPA must exist (the backend serves it). Tell the user how.
  const { frontendDist } = resolvePaths();
  const rendererOverride = process.env.OPENMEMO_RENDERER_URL; // e.g. Vite for HMR
  if (!rendererOverride && !fs.existsSync(path.join(frontendDist, 'index.html'))) {
    if (!app.isPackaged) {
      appendLog(`[shell] No built frontend at ${frontendDist}\n`);
      appendLog('[shell] Run:  npm run build:frontend   (in desktop/)\n');
    }
  }

  try {
    backend = await startBackend(appendLog);
    appendLog(`[shell] Backend up at ${backend.url}\n`);
    maybeInstallChromium(); // first-run, background, non-blocking
    const target = rendererOverride ?? backend.url;
    await mainWindow?.loadURL(target);
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

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Ollama Host…',
                accelerator: 'Cmd+,',
                click: () => openOllamaHostDialog(),
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
}

app.whenReady().then(() => {
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

// Backend is a child process — always tear it down with the app.
app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});
app.on('before-quit', () => stopBackend());
process.on('exit', () => stopBackend());
