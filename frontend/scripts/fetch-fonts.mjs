/**
 * Pull Satoshi into public/fonts so the app never asks the network for a face.
 *
 * Satoshi is openMemo's own type, set in styles/openmemo.css, but until now it
 * arrived from api.fontshare.com on every page load. A local-first app that
 * cannot draw its own interface offline is not local-first, and every launch
 * announced itself to a CDN.
 *
 * The files are fetched at build time and gitignored rather than committed:
 * self-hosting is fine under Fontshare's licence, redistributing the binaries
 * from a public repo is a separate question and not one a build script should
 * decide. Runtime is fully offline either way.
 *
 * Idempotent. Already-present weights are left alone, so this costs nothing on
 * a warm checkout. A failure is a warning, not a build break: the CSS falls
 * back to the system sans stack and the app still runs.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'fonts');
const WEIGHTS = [300, 400, 500, 700];
const CSS_URL = `https://api.fontshare.com/v2/css?f[]=satoshi@${WEIGHTS.join(',')}&display=swap`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const present = async (p) => access(p).then(() => true).catch(() => false);

async function main() {
  await mkdir(OUT, { recursive: true });

  const need = [];
  for (const w of WEIGHTS) {
    if (!(await present(join(OUT, `satoshi-${w}.woff2`)))) need.push(w);
  }
  if (need.length === 0) {
    console.log('fonts: all weights already present');
    return;
  }

  const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

  let written = 0;
  for (const block of css.match(/@font-face\s*\{[\s\S]*?\}/g) ?? []) {
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1]);
    // Protocol-relative in Fontshare's CSS (`//cdn.fontshare.com/...`).
    const href = block.match(/url\('(\/\/[^']+\.woff2)'\)/)?.[1];
    if (!need.includes(weight) || !href) continue;

    const body = Buffer.from(await (await fetch(`https:${href}`, { headers: { 'User-Agent': UA } })).arrayBuffer());
    await writeFile(join(OUT, `satoshi-${weight}.woff2`), body);
    console.log(`fonts: satoshi-${weight}.woff2 (${(body.length / 1024).toFixed(1)} KB)`);
    written++;
  }

  if (written < need.length) {
    console.warn(`fonts: expected ${need.length} weights, wrote ${written}`);
  }
}

main().catch((e) => {
  console.warn(`fonts: could not fetch Satoshi (${e.message}). Falling back to the system stack.`);
});
