/**
 * Copy pdf.js's side data into public/pdfjs so a PDF renders with no network.
 *
 * pdf.js ships its engine in the bundle but leaves four data sets outside it,
 * because most documents never touch them: CMaps (CJK and other non-Latin
 * encodings), the 14 standard PDF fonts (used when a document does not embed
 * its own), wasm decoders (JPEG 2000, JBIG2) and ICC colour profiles. Left
 * unconfigured, pdf.js fetches all four from a CDN at the moment a document
 * needs them, which is a network call openMemo did not make, for a file it
 * already owns, in an app whose whole premise is that a saved thing outlives
 * its source (ADR-025). A Japanese PDF would render blank glyphs offline.
 *
 * So they are copied out of node_modules at build time and served from our own
 * origin. Same shape as fetch-fonts.mjs: idempotent, output gitignored rather
 * than committed, and a failure is a warning instead of a build break: a
 * missing CMap costs one document its non-Latin glyphs, and nothing else.
 */
import { cp, mkdir, access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'node_modules', 'pdfjs-dist');
const OUT = join(HERE, '..', 'public', 'pdfjs');

// Kept in step with the URLs passed to getDocument() in PdfViewer.tsx.
const SETS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

const present = async (p) => access(p).then(() => true).catch(() => false);

async function main() {
  if (!(await present(SRC))) {
    console.warn('pdfjs: pdfjs-dist not installed, skipping asset copy');
    return;
  }
  await mkdir(OUT, { recursive: true });

  for (const set of SETS) {
    const from = join(SRC, set);
    const to = join(OUT, set);
    if (!(await present(from))) {
      console.warn(`pdfjs: ${set} not in this pdfjs-dist build, skipping`);
      continue;
    }
    // Already populated → leave it. Costs nothing on a warm checkout, and the
    // contents only change when pdfjs-dist itself does.
    if (await present(to)) {
      const existing = await readdir(to).catch(() => []);
      if (existing.length) continue;
    }
    await cp(from, to, { recursive: true });
    console.log(`pdfjs: copied ${set}`);
  }
}

main().catch((e) => {
  console.warn('pdfjs: asset copy failed, PDFs will still render:', e.message);
});
