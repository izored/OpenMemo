/**
 * Resolve every filesystem path the shell needs, for both layouts:
 *
 *   dev        — running `electron .` from the repo; backend runs from the
 *                checked-out source against backend/.venv.
 *   packaged   — inside OpenMemo.app; the Python runtime, backend source,
 *                built frontend, and ffmpeg are all under Contents/Resources
 *                (assembled by scripts/bundle-backend.mjs at build time).
 *
 * __dirname is <appRoot>/dist-electron in both layouts (dev: desktop/, packaged:
 * app.asar/), so anything sibling to dist-electron is reached the same way.
 */
import { app } from 'electron';
import path from 'node:path';

export interface ResolvedPaths {
  /** Python interpreter that has the backend deps installed. */
  pythonBin: string;
  /** CWD / import root so `python -m uvicorn backend.main:app` resolves. */
  backendCwd: string;
  /** Built SPA dir handed to the backend as FRONTEND_DIST. */
  frontendDist: string;
  /** ffmpeg binary (bundled in packaged builds, `ffmpeg` on PATH in dev). */
  ffmpegBin: string;
  /** Dirs prepended to PATH so bare `yt-dlp` / `ffmpeg` resolve. */
  extraPath: string[];
}

export function resolvePaths(): ResolvedPaths {
  if (app.isPackaged) {
    const res = process.resourcesPath; // …/OpenMemo.app/Contents/Resources
    const pyDir = path.join(res, 'python', 'bin');
    const ffmpegDir = path.join(res, 'ffmpeg');
    return {
      pythonBin: path.join(pyDir, 'python3'),
      backendCwd: path.join(res, 'app-backend'),
      frontendDist: path.join(res, 'frontend-dist'),
      ffmpegBin: path.join(ffmpegDir, 'ffmpeg'),
      extraPath: [ffmpegDir, pyDir],
    };
  }

  // dev: dist-electron → desktop → repo root
  const repoRoot = path.resolve(__dirname, '..', '..');
  const venvBin = path.join(repoRoot, 'backend', '.venv', 'bin');
  return {
    pythonBin: path.join(venvBin, 'python'),
    backendCwd: repoRoot,
    frontendDist: path.join(repoRoot, 'frontend', 'dist'),
    ffmpegBin: 'ffmpeg',
    extraPath: [venvBin],
  };
}

/** Directory holding loading.html / ollama-config.html — sibling of dist-electron. */
export function staticDir(): string {
  return path.join(__dirname, '..', 'static');
}
