/**
 * What happens the first time a new build opens an existing library.
 *
 * Updating on macOS is a drag-and-drop: the new OpenMemo.app replaces the old
 * one in /Applications, and the library, which lives in userData, is not touched
 * at all. That part already worked. What did not exist was any protection for
 * the moment right after, when the new backend opens the old database and runs
 * its migrations (backend/db/database.py, backend/main.py: additive ALTER TABLE,
 * forward only, no rollback).
 *
 * The automatic backups do not cover that moment. They start five minutes into
 * a run and then repeat daily, so on the boot where a migration actually
 * happens, the newest snapshot on disk is from the previous day at best, and on
 * a young library there is none at all.
 *
 * So: stamp the version that last ran, and when it differs from this one, take
 * one snapshot of the database *before* the backend is allowed to start.
 *
 * These snapshots are named preupgrade-... / predowngrade-..., which keeps them
 * clear of the backend's own rotation. That prunes openmemo-*.db.gz and will
 * never see these. They rotate on their own terms instead, because a snapshot
 * that a routine can delete is not a safety net.
 */
import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { resolvePaths } from './paths';
import { loadSettings, saveSettings } from './settings-store';
import { cmpVersion } from './update-notifier';

/** How many version-switch snapshots to keep. Independent of the daily ones. */
const KEEP = 3;

/** Give up rather than hold a launch open forever on a huge or wedged file. */
const TIMEOUT_MS = 120_000;

export type VersionChange = 'first-run' | 'same' | 'upgrade' | 'downgrade';

export interface VersionState {
  kind: VersionChange;
  /** Version recorded on the previous run, or null when there is no stamp yet. */
  previous: string | null;
  current: string;
}

function dataDir(): string {
  return app.getPath('userData');
}

function dbPath(): string {
  return path.join(dataDir(), 'openmemo.db');
}

function backupDir(): string {
  return path.join(dataDir(), 'backups');
}

/**
 * Compare this build against the one that last ran here.
 *
 * A library with no stamp is the interesting case: it is either a genuinely new
 * install, or an install from before stamping existed, which is exactly the
 * upgrade most worth protecting. The database on disk tells them apart.
 */
export function detectVersionChange(): VersionState {
  const current = app.getVersion();
  const previous = loadSettings().lastRunVersion || null;
  if (!previous) {
    const hasLibrary = fs.existsSync(dbPath());
    return { kind: hasLibrary ? 'upgrade' : 'first-run', previous, current };
  }
  const delta = cmpVersion(current, previous);
  return { kind: delta === 0 ? 'same' : delta > 0 ? 'upgrade' : 'downgrade', previous, current };
}

/**
 * Filename for a switch snapshot.
 *
 * The previous version comes out of a JSON file on disk, so it is sanitised and
 * the result is re-checked against the backups directory before anything is
 * written. A hand-edited stamp must not be able to steer a write elsewhere.
 *
 * The timestamp is not decoration. Names built only from the two versions
 * collide the second time somebody makes the same jump — install 3.13, drop
 * back to 3.12 to check something, go forward again — and whichever way that
 * collision is resolved is wrong: overwrite and the older snapshot is gone,
 * skip and the file labelled "before you updated" is actually months stale.
 * Distinct names sidestep it, and the rotation below bounds the count.
 */
function snapshotPath(state: VersionState, now = new Date()): string | null {
  const safe = (v: string) => v.replace(/[^0-9A-Za-z.-]/g, '').slice(0, 32) || 'unknown';
  const prefix = state.kind === 'downgrade' ? 'predowngrade' : 'preupgrade';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `${prefix}-${safe(state.previous ?? 'unknown')}-to-${safe(state.current)}-${stamp}.db.gz`;
  const dir = path.resolve(backupDir());
  const full = path.resolve(path.join(dir, name));
  if (path.dirname(full) !== dir) return null;
  return full;
}

/** Run a command, resolving false on failure, non-zero exit, or timeout. */
function run(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child = spawn(bin, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, TIMEOUT_MS);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

/**
 * The copy has to go through SQLite's backup API, not the filesystem.
 *
 * The database runs in WAL mode, so openmemo.db on its own is not the library:
 * recent commits can still be sitting in the -wal sidecar. Copying only that one
 * file produces a snapshot that restores to an older state than the user had,
 * silently, which is worse than having no snapshot at all.
 *
 * Python is bundled with the app and always has sqlite3, so it goes first.
 * /usr/bin/sqlite3 ships with macOS and covers the case where the bundled
 * runtime is missing or broken, which is a plausible reason somebody is
 * reinstalling in the first place.
 */
const PY_BACKUP = `
import gzip, os, shutil, sqlite3, sys, tempfile
src, dest = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
try:
    staged = os.path.join(tmp, "openmemo.db")
    con = sqlite3.connect(src)
    try:
        target = sqlite3.connect(staged)
        try:
            con.backup(target)
        finally:
            target.close()
    finally:
        con.close()
    part = dest + ".part"
    with open(staged, "rb") as fh, gzip.open(part, "wb", compresslevel=6) as gz:
        shutil.copyfileobj(fh, gz)
    os.replace(part, dest)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`.trim();

/** Gzip one file into place, via a .part so a crash cannot leave a half file. */
async function gzipFile(src: string, dest: string): Promise<boolean> {
  const part = `${dest}.part`;
  try {
    await new Promise<void>((resolve, reject) => {
      const rd = fs.createReadStream(src);
      const wr = fs.createWriteStream(part);
      rd.on('error', reject);
      wr.on('error', reject);
      wr.on('finish', () => resolve());
      rd.pipe(zlib.createGzip({ level: 6 })).pipe(wr);
    });
    fs.renameSync(part, dest);
    return true;
  } catch {
    try {
      fs.rmSync(part, { force: true });
    } catch {
      /* nothing left to clean up */
    }
    return false;
  }
}

/** Write one gzipped snapshot at dest. Never throws. */
async function snapshot(dest: string): Promise<boolean> {
  const src = dbPath();
  if (!fs.existsSync(src)) return false;
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
  } catch {
    return false;
  }

  const python = resolvePaths().pythonBin;
  if (fs.existsSync(python) && (await run(python, ['-c', PY_BACKUP, src, dest]))) return true;

  // Fallback: macOS's own sqlite3 stages an intact copy, node gzips it.
  const staged = path.join(os.tmpdir(), `openmemo-switch-${process.pid}.db`);
  try {
    if (await run('/usr/bin/sqlite3', [src, `.backup '${staged}'`])) {
      if (await gzipFile(staged, dest)) return true;
    }
  } finally {
    try {
      fs.rmSync(staged, { force: true });
    } catch {
      /* best effort */
    }
  }
  return false;
}

/**
 * Keep the newest few switch snapshots.
 *
 * Deliberately matches only our own two prefixes: the backend's rotation owns
 * openmemo-*.db.gz, and a manual restore may have left other things here.
 */
function prune(): void {
  try {
    const dir = backupDir();
    const names = fs.readdirSync(dir);
    // A snapshot killed part-written leaves its .part behind. Nothing else ever
    // removes those, and they are the same size as the real thing.
    for (const orphan of names.filter((n) => /^pre(upgrade|downgrade)-.*\.db\.gz\.part$/.test(n))) {
      fs.rmSync(path.join(dir, orphan), { force: true });
    }
    const mine = names
      .filter((n) => /^pre(upgrade|downgrade)-.*\.db\.gz$/.test(n))
      .map((n) => {
        const full = path.join(dir, n);
        return { full, at: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
    for (const doomed of mine.slice(KEEP)) fs.rmSync(doomed.full, { force: true });
  } catch {
    /* pruning is housekeeping; never let it affect a launch */
  }
}

/**
 * Tell somebody they have gone backwards, before the older build touches
 * anything. Returns false when they choose to quit.
 *
 * Worth interrupting for: migrations only run forwards, so a library that has
 * been through a newer version carries columns this build has never heard of.
 * In practice that survives, because they are additive, but it is not something
 * to find out silently.
 */
function confirmDowngrade(state: VersionState, saved: string | null): boolean {
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Older version of OpenMemo',
    message: `This is OpenMemo ${state.current}, and your library was last opened by ${state.previous}.`,
    detail:
      'Your memos are not going anywhere. They live in your Application Support folder, not inside the app. ' +
      'But a newer version may have added things to the database that this one does not know about.\n\n' +
      (saved
        ? `A copy of the database as it stands right now is in your backups folder, as ${saved}.`
        : 'A copy of the database could not be saved first, so there is nothing to fall back to.') +
      '\n\nThe safe move is to install the newer version again instead.',
    buttons: ['Open Backups Folder', 'Open Anyway', 'Quit'],
    defaultId: 2,
    cancelId: 2,
  });
  if (choice === 0) {
    void shell.openPath(backupDir());
    return confirmDowngrade(state, saved);
  }
  return choice === 1;
}

/**
 * Run once per launch, before the backend starts. Returns false when the user
 * asked to quit instead of continuing.
 *
 * Ordering matters: the snapshot has to happen before uvicorn is spawned,
 * because the backend migrates the schema during its own startup. By the time
 * the window is showing anything it is already too late to capture "before".
 */
export async function guardVersionSwitch(log: (line: string) => void): Promise<boolean> {
  let state: VersionState;
  try {
    state = detectVersionChange();
  } catch {
    return true; // an unreadable stamp must never be able to block a launch
  }

  if (state.kind === 'same') return true;

  if (state.kind === 'first-run') {
    saveSettings({ lastRunVersion: state.current });
    log(`[shell] First run of OpenMemo ${state.current}.\n`);
    return true;
  }

  // One snapshot per genuine switch, and no risk of a crash loop filling the
  // disk with them: the stamp is written below before the backend is ever
  // spawned, so a launch that dies later comes back as 'same' and does nothing.
  const dest = snapshotPath(state);
  let saved: string | null = null;
  if (dest) {
    if (await snapshot(dest)) {
      saved = path.basename(dest);
      log(`[shell] Saved ${saved} before starting ${state.current}.\n`);
    } else {
      log(`[shell] Could not snapshot the database before ${state.current}.\n`);
    }
    prune();
  }

  if (state.kind === 'downgrade') {
    if (!confirmDowngrade(state, saved)) {
      // Not stamped: they have not accepted this build, so ask again next time.
      // The snapshot is already on disk, so the retry costs nothing.
      log(`[shell] Quit rather than open ${state.current} over ${state.previous}.\n`);
      return false;
    }
    saveSettings({ lastRunVersion: state.current });
    return true;
  }

  if (!saved) {
    // Say so, but do not block. The migration runs on this boot either way, so
    // withholding the stamp would only mean failing the same way every launch.
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Could not back up before updating',
      message: `OpenMemo could not save a copy of your database before updating to ${state.current}.`,
      detail:
        'Your library is untouched and the app will carry on. This is usually a full disk. ' +
        'You can take a backup at any time from Settings, under Backup.',
      buttons: ['OK'],
    });
  }
  saveSettings({ lastRunVersion: state.current });
  return true;
}
