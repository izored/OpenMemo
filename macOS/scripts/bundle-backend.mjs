/**
 * bundle-backend.mjs — assemble macOS/resources-stage/ for electron-builder.
 *
 * Produces, under macOS/resources-stage/ (matches resolvePaths() in
 * src/paths.ts → these land in Contents/Resources):
 *
 *   python/        relocatable arm64 CPython (python-build-standalone) with the
 *                  backend's deps pip-installed into it
 *   app-backend/   the backend package (cwd for `python -m uvicorn backend.main:app`)
 *   frontend-dist/ the built SPA (FRONTEND_DIST)
 *   ffmpeg/ffmpeg  static arm64 ffmpeg (FFMPEG_BIN)
 *
 * MUST run on an Apple-Silicon Mac — pip pulls native arm64 wheels and the
 * Python/ffmpeg binaries are mach-o arm64.
 *
 * Overridable via env:
 *   PBS_ASSET_URL   explicit python-build-standalone install_only .tar.gz URL
 *   FFMPEG_SRC      path to a local static arm64 ffmpeg to copy (skips download)
 *   FFMPEG_URL      URL of a static arm64 ffmpeg (.zip or raw binary)
 *   FFMPEG_SHA256   expected hex digest of the FFMPEG_URL download (integrity)
 *   GITHUB_TOKEN    used for the GitHub API call when present (CI rate limits)
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.resolve(DESKTOP, '..');
const STAGE = path.join(DESKTOP, 'resources-stage');

const log = (m) => console.log(`\x1b[36m[bundle]\x1b[0m ${m}`);
const die = (m) => {
  console.error(`\x1b[31m[bundle] ${m}\x1b[0m`);
  process.exit(1);
};
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

// --- 0. guardrails -----------------------------------------------------------
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  die(`Must run on an Apple-Silicon Mac (got ${process.platform}/${process.arch}).`);
}

log(`repo:  ${ROOT}`);
log(`stage: ${STAGE}`);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// --- 1. python-build-standalone arm64 CPython --------------------------------
async function resolvePbsUrl() {
  if (process.env.PBS_ASSET_URL) return process.env.PBS_ASSET_URL;
  log('Resolving latest python-build-standalone release…');
  const ghHeaders = { 'User-Agent': 'openmemo-bundler', Accept: 'application/vnd.github+json' };
  // CI runners share IPs — authenticate when a token is available to dodge
  // the unauthenticated rate limit.
  if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(
    'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest',
    { headers: ghHeaders },
  );
  if (!res.ok) die(`GitHub API ${res.status}. Set PBS_ASSET_URL to pin a release.`);
  const rel = await res.json();
  // Prefer 3.12 install_only for arm64 macOS; fall back to any cpython-3.* match.
  const match = (re) => rel.assets.find((a) => re.test(a.name));
  const asset =
    match(/^cpython-3\.12\.\d+\+.*-aarch64-apple-darwin-install_only\.tar\.gz$/) ||
    match(/^cpython-3\.\d+\.\d+\+.*-aarch64-apple-darwin-install_only\.tar\.gz$/);
  if (!asset) die('No aarch64-apple-darwin install_only asset found. Set PBS_ASSET_URL.');
  return asset.browser_download_url;
}

async function download(url, dest) {
  log(`↓ ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'openmemo-bundler' } });
  if (!res.ok) die(`Download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

const pbsUrl = await resolvePbsUrl();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openmemo-pbs-'));
const tarPath = path.join(tmp, 'python.tar.gz');
await download(pbsUrl, tarPath);
log('Extracting CPython…');
// install_only archives contain a top-level `python/` dir → STAGE/python.
run(`tar -xzf "${tarPath}" -C "${STAGE}"`);
const pythonBin = path.join(STAGE, 'python', 'bin', 'python3');
if (!fs.existsSync(pythonBin)) die(`Expected interpreter missing at ${pythonBin}`);

// --- 2. backend deps into the standalone interpreter -------------------------
log('Installing backend requirements (arm64 wheels)…');
run(`"${pythonBin}" -m pip install --upgrade pip wheel`);
run(`"${pythonBin}" -m pip install --no-cache-dir -r "${path.join(ROOT, 'backend', 'requirements.txt')}"`);

// --- 3. backend source -------------------------------------------------------
log('Copying backend package…');
const SKIP = new Set(['.venv', '__pycache__', 'tests', 'data', 'files', '.pytest_cache']);
fs.cpSync(path.join(ROOT, 'backend'), path.join(STAGE, 'app-backend', 'backend'), {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    if (SKIP.has(base)) return false;
    if (base.endsWith('.pyc')) return false;
    // NEVER ship the developer's local env files — backend/.env holds personal
    // config and backend/config.py loads it on whatever machine the .dmg lands
    // on. .env.example (documentation) is fine to keep.
    if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return false;
    return true;
  },
});

// --- 4. built frontend -------------------------------------------------------
const dist = path.join(ROOT, 'frontend', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  die('frontend/dist missing. Run `npm run build:frontend` first.');
}
log('Copying frontend dist…');
fs.cpSync(dist, path.join(STAGE, 'frontend-dist'), { recursive: true });

// --- 5. static arm64 ffmpeg --------------------------------------------------
const ffmpegDir = path.join(STAGE, 'ffmpeg');
fs.mkdirSync(ffmpegDir, { recursive: true });
const ffmpegOut = path.join(ffmpegDir, 'ffmpeg');

if (process.env.FFMPEG_SRC) {
  log(`Copying ffmpeg from FFMPEG_SRC=${process.env.FFMPEG_SRC}`);
  fs.copyFileSync(process.env.FFMPEG_SRC, ffmpegOut);
} else {
  // Default arm64 static build. Override with FFMPEG_URL if this 404s.
  const url =
    process.env.FFMPEG_URL ||
    'https://www.osxexperts.net/ffmpeg711arm.zip'; // arm64 static ffmpeg
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'openmemo-ff-'));
  const dl = path.join(tmp2, path.basename(url));
  await download(url, dl);
  // Integrity check — the default source is a third-party site, so allow (and
  // in CI, encourage) pinning the exact artifact by digest.
  if (process.env.FFMPEG_SHA256) {
    const got = crypto.createHash('sha256').update(fs.readFileSync(dl)).digest('hex');
    if (got !== process.env.FFMPEG_SHA256.toLowerCase()) {
      die(`ffmpeg SHA-256 mismatch: expected ${process.env.FFMPEG_SHA256}, got ${got}`);
    }
    log('ffmpeg SHA-256 verified.');
  }
  if (dl.endsWith('.zip')) {
    run(`unzip -o "${dl}" -d "${tmp2}"`);
    const found = fs
      .readdirSync(tmp2)
      .find((f) => f === 'ffmpeg' || f.toLowerCase() === 'ffmpeg');
    if (!found) die(`No 'ffmpeg' binary inside ${url}. Use FFMPEG_SRC to supply one.`);
    fs.copyFileSync(path.join(tmp2, found), ffmpegOut);
  } else {
    fs.copyFileSync(dl, ffmpegOut);
  }
}
fs.chmodSync(ffmpegOut, 0o755);

// quick sanity: the binary should be mach-o arm64
try {
  const fileOut = execSync(`file "${ffmpegOut}"`).toString();
  if (!/arm64/.test(fileOut)) log(`⚠ ffmpeg may not be arm64: ${fileOut.trim()}`);
} catch {
  /* `file` not critical */
}

log('Done. resources-stage/ is ready for electron-builder.');
