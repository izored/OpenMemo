/**
 * Backend lifecycle: pick a port, spawn uvicorn with the right env, wait until
 * it answers /api/ping, and stop it cleanly on quit.
 *
 * The backend is told to serve the built SPA itself (FRONTEND_DIST), so the
 * window just loads http://127.0.0.1:<port>/ — same origin, so every relative
 * /api call, /api/files asset, upload, and SSE stream works with no CORS.
 */
import { app } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { resolvePaths } from './paths';
import { loadSettings } from './settings-store';

const PREFERRED_PORT = 8099;

let child: ChildProcess | null = null;

/** Resolve the preferred port, or the next free one if it's taken. */
function findPort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const probe = (p: number) => {
      const srv = net.createServer();
      srv.once('error', () => srv.close(() => probe(p + 1)));
      srv.once('listening', () => srv.close(() => resolve(p)));
      srv.listen(p, '127.0.0.1');
    };
    probe(preferred);
  });
}

function pingOnce(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/ping', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingOnce(port)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Backend did not answer /api/ping within ${timeoutMs / 1000}s`);
}

export interface StartedBackend {
  port: number;
  url: string;
}

/** Spawn the backend and resolve once it is serving. `onLog` streams stdout/stderr. */
export async function startBackend(onLog?: (line: string) => void): Promise<StartedBackend> {
  const paths = resolvePaths();
  const settings = loadSettings();
  const port = await findPort(PREFERRED_PORT);

  const userData = app.getPath('userData');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // All writable state under userData — the .app bundle is read-only.
    DATA_DIR: userData,
    HF_HOME: path.join(userData, 'hf-cache'), // whisper model cache
    // Packaged only: keep the link-scraper's Chromium under userData (fetched
    // on first run by main.ts) so install + runtime agree. In dev the browser
    // was installed by setup-mac.sh into playwright's DEFAULT cache — forcing
    // this path there would make the dev backend miss it silently.
    ...(app.isPackaged
      ? { PLAYWRIGHT_BROWSERS_PATH: path.join(userData, 'ms-playwright') }
      : {}),
    FRONTEND_DIST: paths.frontendDist,
    FFMPEG_BIN: paths.ffmpegBin,
    OLLAMA_HOST: settings.ollamaHost,
    PYTHONUNBUFFERED: '1',
    // Bundled ffmpeg + venv bin first, so bare `ffmpeg` (yt-dlp internal) and
    // `yt-dlp` resolve without a system install.
    PATH: [...paths.extraPath, process.env.PATH ?? ''].join(path.delimiter),
  };

  child = spawn(
    paths.pythonBin,
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: paths.backendCwd,
      env,
      // Own process group so we can kill the whole tree on quit.
      detached: process.platform !== 'win32',
    },
  );

  child.stdout?.on('data', (b) => onLog?.(b.toString()));
  child.stderr?.on('data', (b) => onLog?.(b.toString()));
  child.on('exit', (code, signal) => onLog?.(`[backend] exited code=${code} signal=${signal}\n`));

  await waitForHealth(port);
  return { port, url: `http://127.0.0.1:${port}/` };
}

/** True while the spawned backend process is alive. */
export function isBackendRunning(): boolean {
  return !!child && child.exitCode === null && !child.killed;
}

function signalTree(c: ChildProcess, sig: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && c.pid) {
      // Negative pid → signal the whole process group (uvicorn + workers).
      process.kill(-c.pid, sig);
    } else {
      c.kill(sig);
    }
  } catch {
    /* already gone */
  }
}

function waitExit(c: ChildProcess, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (c.exitCode !== null) return resolve(true);
    const timer = setTimeout(() => {
      c.off('exit', onExit);
      resolve(false);
    }, ms);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    c.once('exit', onExit);
  });
}

/** Stop the backend (fire-and-forget). Safe to call multiple times. */
export function stopBackend(): void {
  if (!child || child.killed) {
    child = null;
    return;
  }
  signalTree(child, 'SIGTERM');
  child = null;
}

/**
 * Stop and WAIT for the process to actually exit (SIGKILL after the grace
 * period). Used before a restart so the port is really free — otherwise the
 * respawn races the dying uvicorn and findPort migrates to :8100, silently
 * breaking the Chrome extension's fixed :8099 target.
 */
export async function stopBackendAndWait(graceMs = 5000): Promise<void> {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null) return;
  signalTree(c, 'SIGTERM');
  if (await waitExit(c, graceMs)) return;
  signalTree(c, 'SIGKILL');
  await waitExit(c, 2000);
}

/** Restart the backend (e.g. after the user changes the Ollama host). */
export async function restartBackend(onLog?: (line: string) => void): Promise<StartedBackend> {
  await stopBackendAndWait();
  return startBackend(onLog);
}
