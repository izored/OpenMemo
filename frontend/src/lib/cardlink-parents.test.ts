import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CardLink is `position: absolute; inset: 0`, so every element that hosts one
 * MUST be positioned. A parent left at `position: static` does not look wrong:
 * the overlay resolves against the nearest positioned ancestor instead and
 * becomes an invisible, page-sized link. `.om-pl-card` shipped that way, and
 * every click anywhere on the Music page opened a playlist.
 *
 * CardLink warns about this in dev, but only for whoever happens to have the
 * console open. This is the part that fails the build.
 *
 * ADD TO THIS LIST whenever you put a <CardLink> inside a new class.
 */
const CARDLINK_PARENTS = [
  'om-card', // MemoCard
  'om-pl-card', // MusicPage, playlist tile
  'om-hero-card', // MusicPage, hero tile
  'om-coll-card', // SpacesPage
  'om-card-player', // MemoCard, now-playing overlay
];

// Resolved from cwd, not import.meta.url: under the jsdom environment that is
// not a file: URL and fileURLToPath throws before any test runs.
const CSS_PATH = ['src/styles/openmemo.css', 'frontend/src/styles/openmemo.css']
  .map((rel) => resolve(process.cwd(), rel))
  .find(existsSync);
const css = readFileSync(CSS_PATH as string, 'utf-8');

/**
 * The declarations of the first `.cls { ... }` rule, or null.
 *
 * Line based on purpose. A regex over a 7000 line stylesheet is exactly the
 * kind of thing that silently matches nothing and leaves a test that always
 * passes, which is worse than not having one.
 */
function ruleBody(cls: string): string | null {
  const lines = css.split('\n').map((l) => l.replace('\r', ''));
  const at = lines.findIndex((l) => l.trim() === '.' + cls + ' {');
  if (at === -1) return null;
  const out: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('}')) break;
    out.push(lines[i]);
  }
  // Comments stripped, and that is not fussiness. The very rule this test
  // exists for carries a comment explaining why it needs position: relative,
  // so matching the raw body made the test pass with the declaration deleted.
  // Confirmed by deleting it: the test has to go red.
  return out.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

const POSITIONED = /position:\s*(relative|absolute|fixed|sticky)/;

describe('every CardLink parent is positioned', () => {
  it.each(CARDLINK_PARENTS)('.%s declares a non-static position', (cls) => {
    const body = ruleBody(cls);
    expect(body, `.${cls} has no rule in openmemo.css`).not.toBeNull();
    expect(
      POSITIONED.test(body as string),
      `.${cls} hosts a CardLink but is position: static, so the link overlay ` +
        `escapes it and turns a whole region of the page into one link`,
    ).toBe(true);
  });

  it('the helper actually finds rules, so a green run means something', () => {
    // Guards the test itself: if ruleBody ever stops matching, every case above
    // would fail loudly rather than pass vacuously, but this says why faster.
    expect(ruleBody('om-pl-card')).toContain('position: relative');
    expect(ruleBody('this-class-does-not-exist')).toBeNull();
  });
});
