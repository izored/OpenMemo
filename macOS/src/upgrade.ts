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
import { resolvePaths } from './paths';
import {
  SNAPSHOT_KEEP,
  SwitchKind,
  hasSnapshotFor,
  isSnapshotName,
  isSnapshotPartName,
  selectForPruning,
  snapshotFileName,
} from './snapshot-names';
import { loadSettings, saveSettings } from './settings-store';
import { cmpVersion } from './update-notifier';

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
 * The release part of a version, with any pre-release tag dropped.
 *
 * cmpVersion parses dot-separated integers, so "3.13.0-beta.1" becomes
 * [3,13,0,1] and compares as NEWER than the "3.13.0" that supersedes it. As an
 * update notification that was a shrug. Here it decides whether to put a
 * blocking "you have gone backwards" dialog in front of somebody moving from a
 * beta to the release it became, which is exactly backwards.
 */
function release(v: string): string {
  return v.split('-', 1)[0];
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
  // The stamp is read back off a JSON file that a person can edit and a full
  // disk can truncate. Anything that is not a string is treated as no stamp at
  // all, which routes to the snapshot path rather than throwing past it: the
  // failure mode of a bad stamp must not be silently skipping the backup.
  const raw = loadSettings().lastRunVersion;
  const previous = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (!previous) {
    const hasLibrary = fs.existsSync(dbPath());
    return { kind: hasLibrary ? 'upgrade' : 'first-run', previous, current };
  }
  const delta = cmpVersion(release(current), release(previous));
  return { kind: delta === 0 ? 'same' : delta > 0 ? 'upgrade' : 'downgrade', previous, current };
}

/**
 * Where a switch snapshot goes. Naming rules live in snapshot-names.ts.
 *
 * The resolved path is re-checked against the backups directory even though the
 * sanitiser already strips separators. The version this is partly built from
 * comes out of a JSON file on disk that a person can edit, and a write into the
 * user's library is not the place to rely on one layer of defence.
 */
function snapshotPath(kind: SwitchKind, state: VersionState, now = new Date()): string | null {
  const name = snapshotFileName(kind, state.previous, state.current, now);
  const dir = path.resolve(backupDir());
  const full = path.resolve(path.join(dir, name));
  if (path.dirname(full) !== dir) return null;
  return full;
}

/**
 * Run a command, resolving false on failure, non-zero exit, or timeout.
 *
 * stderr is captured rather than discarded. When somebody reports "it said it
 * could not back up", the difference between a full disk and a week of guessing
 * is one line of python traceback, and it costs nothing to keep.
 */
function run(bin: string, args: string[], log: (line: string) => void, cwd?: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let err = '';
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok && err.trim()) log(`[shell] ${path.basename(bin)}: ${err.trim().slice(-500)}\n`);
      resolve(ok);
    };
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], cwd });
    child.stderr?.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      log(`[shell] ${path.basename(bin)} took longer than ${TIMEOUT_MS / 1000}s; gave up.\n`);
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
 * The source is opened `mode=ro` deliberately. A normal read-write connection
 * checkpoints the WAL when the last handle closes, which rewrites the live
 * openmemo.db and unlinks its -wal, before the snapshot has landed. That is
 * safe in itself, SQLite is careful about it, but it means a routine described
 * as "take a copy" would modify the original, and on a failure the user would
 * be told the backup failed over a database it had already touched. Read-only
 * keeps the live file byte for byte identical.
 *
 * What comes out is openMemo's own backup archive: a zip holding
 * backup_meta.json and openmemo.db, exactly what Settings > Backup > Restore
 * accepts. A snapshot the product cannot restore is not a safety net.
 *
 * Python is bundled with the app and always has sqlite3 and zipfile, so it goes
 * first. macOS ships its own sqlite3 and zip, which cover the case where the
 * bundled runtime is missing or broken, and that is a plausible reason somebody
 * is reinstalling in the first place.
 */
const PY_BACKUP = `
import json, os, sqlite3, sys, zipfile
from datetime import datetime, timezone
src, dest, version, tmp = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    staged = os.path.join(tmp, "openmemo.db")
    con = sqlite3.connect("file:" + src + "?mode=ro", uri=True)
    try:
        target = sqlite3.connect(staged)
        try:
            con.backup(target)
        finally:
            target.close()
    finally:
        con.close()
    meta = {
        "scope": "structure",
        "archive_scope": "structure",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z",
        "app_version": version,
    }
    part = dest + ".part"
    with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("backup_meta.json", json.dumps(meta, indent=2))
        zf.write(staged, "openmemo.db")
    os.replace(part, dest)
finally:
    # Only the file we staged. The directory belongs to the caller, which
    # cleans it up either way, and removing it here would pull the ground out
    # from under the fallback that runs when this script fails.
    try:
        os.remove(staged)
    except OSError:
        pass
`.trim();

/**
 * Is this file actually a SQLite database?
 *
 * The python path raises and exits non-zero on a bad copy, so it polices
 * itself. The sqlite3 CLI is trusted on exit code alone, and a truncated or
 * empty staged file gzips perfectly happily: the log would then claim a
 * snapshot was saved and the file would restore to nothing. A safety net
 * reported as present but hollow is worse than one reported as missing.
 * Same 16-byte header check the backend's restore endpoint does.
 */
function looksLikeSqlite(file: string): boolean {
  const MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(MAGIC.length);
    const read = fs.readSync(fd, head, 0, MAGIC.length, 0);
    return read === MAGIC.length && head.equals(MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Write one snapshot archive at dest. Never throws.
 *
 * dest is written atomically by both paths, via a .part that is only renamed
 * once the archive is complete, so a killed process can never leave something
 * that looks like a finished backup.
 */
async function snapshot(dest: string, log: (line: string) => void): Promise<boolean> {
  const src = dbPath();
  if (!fs.existsSync(src)) return false;
  // A zero-byte or truncated openmemo.db backs up "successfully" into a valid,
  // empty database: exit 0, correct header, and a log line saying the library
  // was saved. Refusing here is the honest answer, and it is also the moment
  // the user most needs to know something is wrong with the original.
  if (!looksLikeSqlite(src)) {
    log('[shell] openmemo.db is not a readable database; not claiming a snapshot.\n');
    return false;
  }
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
  } catch {
    return false;
  }

  const version = app.getVersion();
  // The scratch directory belongs to us, not to python's tempfile, so that a
  // timeout kill still leaves someone to clean it up. Python's own finally
  // never runs under SIGKILL, and what it would have removed is a full
  // uncompressed copy of the library sitting in /var/folders forever.
  let scratch: string | null = null;
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'openmemo-switch-'));

    const python = resolvePaths().pythonBin;
    if (
      fs.existsSync(python) &&
      (await run(python, ['-c', PY_BACKUP, src, dest, version, scratch], log))
    ) {
      return true;
    }

    // Fallback: macOS's own sqlite3 stages an intact copy, macOS's own zip packs
    // it. zip runs with cwd set to the scratch dir so the archive members are
    // named openmemo.db and backup_meta.json with no path in front of them,
    // which is what the restore endpoint looks for.
    log('[shell] Bundled python could not write the copy; trying the macOS tools.\n');
    const staged = path.join(scratch, 'openmemo.db');
    if (!(await run('/usr/bin/sqlite3', [src, `.backup '${staged}'`], log))) return false;
    if (!looksLikeSqlite(staged)) {
      log('[shell] The staged copy was not a database; discarding it.\n');
      return false;
    }
    fs.writeFileSync(
      path.join(scratch, 'backup_meta.json'),
      JSON.stringify(
        {
          scope: 'structure',
          archive_scope: 'structure',
          created_at: new Date().toISOString(),
          app_version: version,
        },
        null,
        2,
      ),
    );
    const part = `${dest}.part`;
    if (!(await run('/usr/bin/zip', ['-q', '-X', part, 'backup_meta.json', 'openmemo.db'], log, scratch))) {
      try {
        fs.rmSync(part, { force: true });
      } catch {
        /* best effort */
      }
      return false;
    }
    fs.renameSync(part, dest);
    return true;
  } catch (e) {
    log(`[shell] Snapshot fallback failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return false;
  } finally {
    if (scratch) {
      try {
        fs.rmSync(scratch, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Keep the newest few switch snapshots, per direction.
 *
 * The selection rule lives in snapshot-names.ts and is tested there. This part
 * only does the filesystem: read the directory, hand over names and mtimes, act
 * on what comes back. Nothing here matches the backend's openmemo-*.db.gz, and
 * nothing here removes a file it was not asked about.
 */
function prune(log: (line: string) => void): void {
  const drop = (full: string) => {
    try {
      // Only ever files, and named by readdir, so no traversal is possible.
      fs.rmSync(full, { force: true });
    } catch {
      /* leave it; disk space is not worth a failed launch */
    }
  };
  try {
    const dir = backupDir();
    const names = fs.readdirSync(dir);
    // A snapshot killed part-written leaves a .part behind. Nothing else sweeps
    // those, and they are as big as the real thing.
    for (const orphan of names.filter(isSnapshotPartName)) drop(path.join(dir, orphan));

    const entries = names
      .filter(isSnapshotName)
      .map((name) => {
        try {
          return { name, at: fs.statSync(path.join(dir, name)).mtimeMs };
        } catch {
          return null; // vanished between readdir and stat
        }
      })
      .filter((e): e is { name: string; at: number } => e !== null);

    for (const doomed of selectForPruning(entries, SNAPSHOT_KEEP)) {
      drop(path.join(dir, doomed));
    }
  } catch (e) {
    log(`[shell] Could not tidy old snapshots: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

/**
 * Did the version recorded in the stamp actually manage to open the library?
 *
 * Absent means yes: libraries stamped before this note existed were stamped by
 * builds that were running fine, and assuming the alarming answer on missing
 * data would fire the downgrade warning at everybody once.
 */
function newerVersionEverRan(): boolean {
  try {
    return loadSettings().lastRunHealthy !== false;
  } catch {
    return true;
  }
}

/**
 * Name of an existing snapshot for this exact switch, if there is one.
 *
 * Only the downgrade path can reach the same switch twice, but the check is
 * cheap and the answer is right for both.
 */
function existingSnapshotFor(kind: SwitchKind, state: VersionState): string | null {
  try {
    const names = fs.readdirSync(backupDir());
    if (!hasSnapshotFor(names, kind, state.previous, state.current)) return null;
    return (
      names
        .filter(isSnapshotName)
        .filter((n) => n.startsWith(`${kind === 'downgrade' ? 'predowngrade' : 'preupgrade'}-`))
        .sort()
        .pop() ?? null
    );
  } catch {
    return null; // no backups directory yet, which means no snapshot yet
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
        ? `A copy of your library as it stands right now is in your backups folder, as ${saved}. ` +
          'You can put it back at any time from Settings, under Backup and Restore.'
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
let inFlight: Promise<boolean> | null = null;

/**
 * Public entry point. Collapses concurrent calls onto one run.
 *
 * The guard occupies the only stretch of a launch where the backend is not yet
 * running, and openAppWindow can be entered again during it: closing the window
 * mid-snapshot nulls mainWindow, and a Dock click or a second launch then walks
 * straight back in past the `isBackendRunning()` check. Two guards would race
 * for the same destination path and the same scratch directory, and one would
 * delete the other's half-written file. Everything downstream assumes it is
 * alone, so this is where that is made true.
 */
export function guardVersionSwitch(log: (line: string) => void): Promise<boolean> {
  if (inFlight) {
    log('[shell] A version check is already running; waiting for it.\n');
    return inFlight;
  }
  inFlight = runGuard(log).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Record that this build actually got its backend up.
 *
 * Called from main.ts once the backend answers. Until it does, the stamp
 * written below is a claim about what was attempted, not about what ran.
 */
export function markLaunchHealthy(): void {
  try {
    if (loadSettings().lastRunHealthy !== true) saveSettings({ lastRunHealthy: true });
  } catch {
    /* a missing note is not worth failing a launch that just succeeded */
  }
}

async function runGuard(log: (line: string) => void): Promise<boolean> {
  /**
   * Record the version, and swallow a failure to do so.
   *
   * saveSettings does a plain writeFileSync. Let that throw from in here and it
   * lands in openAppWindow's catch, which puts up "OpenMemo could not start /
   * The backend did not start" over a backend that was never even reached.
   * A stamp that could not be written is not a reason to fail the launch: the
   * cost is re-taking the snapshot next time, which is the safe direction.
   */
  const stamp = (version: string): void => {
    try {
      // healthy:false until the backend answers. See markLaunchHealthy.
      saveSettings({ lastRunVersion: version, lastRunHealthy: false });
    } catch (e) {
      log(`[shell] Could not record the version stamp: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  };

  let state: VersionState;
  try {
    state = detectVersionChange();
  } catch (e) {
    // An unreadable stamp must never block a launch, but it must not vanish
    // either: this is the branch where no snapshot gets taken, so it is the one
    // worth finding in the log afterwards.
    log(`[shell] Could not work out the previous version: ${e instanceof Error ? e.message : String(e)}\n`);
    return true;
  }

  if (state.kind === 'same') return true;

  if (state.kind === 'first-run') {
    stamp(state.current);
    log(`[shell] First run of OpenMemo ${state.current}.\n`);
    return true;
  }

  // A crash loop cannot fill the disk with these: the stamp is written below
  // before the backend is ever spawned, so a launch that dies later comes back
  // as 'same' and does nothing at all.
  const kind: SwitchKind = state.kind === 'downgrade' ? 'downgrade' : 'upgrade';
  let saved: string | null = existingSnapshotFor(kind, state);
  if (saved) {
    // Backing out of the downgrade warning leaves the version unstamped on
    // purpose, so the next launch of that same old build is another switch.
    // Nothing changed in between, because the backend never started, so the
    // copy already on disk is byte for byte what a second one would be.
    log(`[shell] This version switch is already captured in ${saved}.\n`);
  } else {
    const dest = snapshotPath(kind, state);
    if (dest) {
      // Said before the work starts, not after. On a large library the copy is
      // the longest thing between double-clicking the icon and seeing the app,
      // and a loading screen that says nothing for a minute reads as a hang.
      // [status] routes to the loading screen's headline rather than its log
      // ticker, because on a large library this is the longest thing between
      // double-clicking the icon and seeing the app, and the ticker is an 11px
      // line at the bottom of the window.
      log(`[status] Backing up your memos before updating to ${state.current}...\n`);
      if (await snapshot(dest, log)) {
        saved = path.basename(dest);
        log(`[shell] Saved ${saved} before starting ${state.current}.\n`);
      } else {
        log(`[shell] Could not snapshot the database before ${state.current}.\n`);
      }
    }
  }
  prune(log);

  if (state.kind === 'downgrade') {
    if (!newerVersionEverRan()) {
      // The newer build stamped itself and then failed to start, and the user
      // has come back to the one that works. Nothing ever migrated their
      // library, so warning them about columns it does not understand would be
      // both false and frightening at the worst possible moment.
      log(`[shell] ${state.previous} never got its backend up; treating this as a repair.\n`);
      stamp(state.current);
      return true;
    }
    if (!confirmDowngrade(state, saved)) {
      // Not stamped: they have not accepted this build, so ask again next time.
      // The snapshot is already on disk, so the retry costs nothing.
      log(`[shell] Quit rather than open ${state.current} over ${state.previous}.\n`);
      return false;
    }
    stamp(state.current);
    return true;
  }

  if (!saved) {
    // Say so, but do not block. The migration runs on this boot either way, so
    // withholding the stamp would only mean failing the same way every launch.
    void dialog
      .showMessageBox({
        type: 'warning',
        title: 'Could not back up before updating',
        message: `OpenMemo could not save a copy of your database before updating to ${state.current}.`,
        detail:
          'Your library is untouched and the app will carry on. This is usually a full disk. ' +
          'You can take a backup at any time from Settings, under Backup.',
        buttons: ['OK'],
      })
      .catch(() => {
        /* a warning that cannot be shown is not worth an unhandled rejection */
      });
  }
  stamp(state.current);
  return true;
}
