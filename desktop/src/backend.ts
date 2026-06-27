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
    // Keep the link-scraper's Chromium under userData (fetched on first run by
    // main.ts) so install + runtime agree and it's removable with the app data.
    PLAYWRIGHT_BROWSERS_PATH: path.join(userData, 'ms-playwright'),
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

/** Stop the backend and its children. Safe to call multiple times. */
export function stopBackend(): void {
  if (!child || child.killed) {
    child = null;
    return;
  }
  try {
    if (process.platform !== 'win32' && child.pid) {
      // Negative pid → signal the whole process group (uvicorn + workers).
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* already gone */
  }
  child = null;
}

/** Restart the backend (e.g. after the user changes the Ollama host). */
export async function restartBackend(onLog?: (line: string) => void): Promise<StartedBackend> {
  stopBackend();
  return startBackend(onLog);
}
