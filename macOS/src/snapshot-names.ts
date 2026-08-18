/**
 * Naming and rotation rules for version-switch snapshots.
 *
 * Split out from upgrade.ts because everything here is pure: no electron, no
 * filesystem, no clock it does not receive. That is what makes it testable, and
 * this is the part that most needs testing. The rotation rule below already had
 * a bug that deleted the exact file the feature exists to create, and it was
 * found by reasoning rather than by a test, which is the wrong way round.
 *
 * See snapshot-names.test.ts.
 */

export type SwitchKind = 'upgrade' | 'downgrade';

/**
 * How many snapshots to keep, PER PREFIX.
 *
 * Per prefix, not overall, and that distinction is the whole point. One shared
 * pool meant a nervous user could delete their own pre-upgrade copy just by
 * hesitating: the downgrade dialog does not stamp the version when they back
 * out, so every relaunch of the older build wrote another predowngrade, and
 * three of those evicted the preupgrade snapshot they were trying to get back
 * to. Separate pools mean downgrade churn can only ever evict downgrade
 * snapshots.
 */
export const SNAPSHOT_KEEP = 3;

/** openMemo's own backup archive format, so Settings can restore it directly. */
export const SNAPSHOT_EXT = '.zip';

const PREFIXES: Record<SwitchKind, string> = {
  upgrade: 'preupgrade',
  downgrade: 'predowngrade',
};

/** Strip anything that is not plausibly part of a version. Never empty. */
export function safeVersion(v: string | null | undefined): string {
  if (typeof v !== 'string') return 'unknown';
  return v.replace(/[^0-9A-Za-z.-]/g, '').slice(0, 32) || 'unknown';
}

/** UTC, to the second, matching the backend's own snapshot naming. */
export function stampFor(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export function snapshotFileName(
  kind: SwitchKind,
  previous: string | null,
  current: string,
  now: Date,
): string {
  return `${PREFIXES[kind]}-${safeVersion(previous)}-to-${safeVersion(current)}-${stampFor(now)}${SNAPSHOT_EXT}`;
}

/** Does this name belong to us? Deliberately not openmemo-*, which is the backend's. */
export function isSnapshotName(name: string): boolean {
  return /^pre(upgrade|downgrade)-.*\.zip$/.test(name);
}

/** A half-written snapshot, left by a killed process. Nothing else sweeps these. */
export function isSnapshotPartName(name: string): boolean {
  return /^pre(upgrade|downgrade)-.*\.zip\.part$/.test(name);
}

/**
 * Has this exact switch already been captured?
 *
 * Used on the downgrade path only. Backing out of the warning leaves the
 * version unstamped on purpose, so the next launch of the same old build is
 * another switch and would snapshot again. Nothing has changed between those
 * launches: the backend never started, so the database is byte for byte what
 * the first snapshot already holds. Writing it again is pure churn.
 */
export function hasSnapshotFor(
  names: string[],
  kind: SwitchKind,
  previous: string | null,
  current: string,
): boolean {
  const head = `${PREFIXES[kind]}-${safeVersion(previous)}-to-${safeVersion(current)}-`;
  return names.some((n) => n.startsWith(head) && n.endsWith(SNAPSHOT_EXT));
}

/**
 * Which snapshots to delete, keeping the newest `keep` of EACH prefix.
 *
 * Takes and returns plain names so it can be tested without touching a disk.
 */
export function selectForPruning(
  entries: { name: string; at: number }[],
  keep = SNAPSHOT_KEEP,
): string[] {
  const doomed: string[] = [];
  for (const prefix of Object.values(PREFIXES)) {
    const pool = entries
      .filter((e) => isSnapshotName(e.name) && e.name.startsWith(`${prefix}-`))
      // Newest first, by the UTC stamp in the name rather than by mtime. A Mac
      // that boots with a stale clock and gets corrected by NTP mid-session can
      // write its newest snapshot with the oldest mtime, and sorting by that
      // would delete the newest first. The name is the app's own record of when
      // it did the work, and it sorts lexicographically. mtime only breaks ties.
      .sort((a, b) => (a.name === b.name ? b.at - a.at : a.name < b.name ? 1 : -1));
    for (const e of pool.slice(keep)) doomed.push(e.name);
  }
  return doomed;
}
