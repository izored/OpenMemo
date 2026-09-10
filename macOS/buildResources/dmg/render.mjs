/**
 * Render the .dmg artwork from its HTML sources.
 *
 *   node macOS/buildResources/dmg/render.mjs
 *
 * Writes three committed files:
 *   ../background.png      620x480, the Finder window backdrop
 *   ../background@2x.png   1240x960, the Retina half of the same pair
 *   ../Read Me First.pdf       the leaflet that ships inside the .dmg
 *
 * Why a script and not a build step: electron-builder wants finished files, and
 * the .dmg is built on a GitHub macOS runner where adding a Chromium download
 * would cost minutes and a failure mode for artwork that changes twice a year.
 * So the outputs are committed and this only runs when the art changes.
 *
 * Needs Chrome (or Edge) locally. Set CHROME to override the search.
 * The HTML pulls Satoshi from frontend/public/fonts, which is gitignored and
 * fetched by `node frontend/scripts/fetch-fonts.mjs` — run that first or the
 * type falls back to the system sans and the render is wrong.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..');
const FONTS = resolve(HERE, '..', '..', '..', 'frontend', 'public', 'fonts', 'satoshi-500.woff2');

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error(`No Chrome found. Tried:\n  ${CANDIDATES.join('\n  ')}`);
if (!existsSync(FONTS)) {
  console.warn('WARNING: Satoshi is missing. Run `node frontend/scripts/fetch-fonts.mjs` first,');
  console.warn('otherwise this renders in the fallback sans and the art is wrong.');
}

/** Chrome writes its profile somewhere; keep it out of the user's real one. */
function run(args) {
  const profile = mkdtempSync(join(tmpdir(), 'openmemo-dmg-'));
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
      `--user-data-dir=${profile}`, ...args], { stdio: 'inherit' });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

const url = (name) => pathToFileURL(join(HERE, name)).href;

function shot(html, out, scale) {
  run([`--screenshot=${join(OUT, out)}`, '--window-size=620,480',
    `--force-device-scale-factor=${scale}`, url(html)]);
  console.log(`  ${out}`);
}

shot('background.html', 'background.png', 1);
shot('background.html', 'background@2x.png', 2);

run([`--print-to-pdf=${join(OUT, 'Read Me First.pdf')}`, '--no-pdf-header-footer', url('read-me.html')]);
console.log('  Read Me First.pdf');
