/**
 * Tiny JSON settings store in userData. Holds the two things the shell itself
 * remembers: where the user's Ollama lives, and (optionally) an app-lock PIN.
 * Ollama is never bundled or managed here — we only record the host:port.
 *
 * The PIN is stored as a scrypt hash and NOTHING here touches the macOS
 * keychain: see pin-hash.ts for why that changed. A 4-digit PIN is a casual
 * privacy lock, not a defense against a determined local attacker.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { isKeychainBlob, makePinBlob, verifyPinBlob } from './pin-hash';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface ShellSettings {
  /** Ollama base URL the backend is told to use (OLLAMA_HOST). */
  ollamaHost: string;
  /** App-lock on (a PIN is set). */
  lockEnabled?: boolean;
  /** Hashed PIN — see pin-hash.ts. Never the PIN itself, never reversible. */
  lockBlob?: string;
  /** Last window size/position, restored on next launch. */
  windowState?: WindowState;
  /** A release version the user chose to skip in the update notifier. */
  updateSkipVersion?: string;
  /** The app version that last opened this library. Absent on a fresh install,
   *  and on any library last touched by a build from before this existed. See
   *  upgrade.ts: it is what makes a version switch detectable at all, and so
   *  what triggers the snapshot taken before the backend migrates the schema. */
  lastRunVersion?: string;
  /** Whether the build named by lastRunVersion actually got its backend up.
   *  The version is stamped before the backend is spawned, deliberately, so a
   *  boot that dies later cannot re-snapshot on a loop. The cost is that a
   *  build which never started still looks like it opened the library, and
   *  going back to the previous one would then be reported as a downgrade over
   *  changes that were never made. This records whether that actually
   *  happened. */
  lastRunHealthy?: boolean;
  /** When the "we have not reached Telegram" notification last appeared, as an
   *  epoch ms. Persisted rather than kept in memory so quitting and relaunching
   *  does not re-show the same warning on every single launch. */
  staleWarnedAt?: number;
}

const DEFAULTS: ShellSettings = {
  ollamaHost: 'http://localhost:11434',
  lockEnabled: false,
  lockBlob: '',
};

function file(): string {
  return path.join(app.getPath('userData'), 'openmemo-desktop.json');
}

export function loadSettings(): ShellSettings {
  try {
    const raw = fs.readFileSync(file(), 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<ShellSettings>): ShellSettings {
  const next = { ...loadSettings(), ...patch };
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // Atomic write (tmp + rename) so a crash mid-write can't corrupt settings —
  // this file holds the PIN blob; a torn write would lock the user out.
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, f);
  return next;
}

// --- app-lock PIN ------------------------------------------------------------

/** True when an app-lock PIN is set. Cheap (no crypto). */
export function isLockEnabled(): boolean {
  const s = loadSettings();
  return s.lockEnabled === true && !!s.lockBlob;
}

/** Set (or replace) the PIN and turn the lock on. */
export function setPin(pin: string): void {
  saveSettings({ lockEnabled: true, lockBlob: makePinBlob(pin) });
}

/** Verify a PIN. Returns true if no lock is set. */
export function verifyPin(pin: string): boolean {
  const s = loadSettings();
  if (!s.lockEnabled || !s.lockBlob) return true;
  const { ok, upgraded } = verifyPinBlob(s.lockBlob, pin);
  // An old-format blob is rewritten the moment its PIN is proven, so the
  // upgrade costs the user nothing and happens exactly once.
  if (ok && upgraded) saveSettings({ lockBlob: upgraded });
  return ok;
}

/** Turn the lock off and forget the PIN. */
export function disableLock(): void {
  saveSettings({ lockEnabled: false, lockBlob: '' });
}

/**
 * Retire a PIN that an older build stored in the keychain.
 *
 * Those blobs can only be read back through safeStorage, which is the panel
 * this change exists to remove, so they are not read: the lock is switched off
 * and the blob dropped. The alternative was one last keychain prompt to
 * migrate, which is the exact thing the user is being spared.
 *
 * Returns true when that happened, so the caller can say so. Nothing else is
 * touched: the library, the Ollama host and the window state stay as they are.
 */
export function retireKeychainPin(): boolean {
  const s = loadSettings();
  if (!isKeychainBlob(s.lockBlob)) return false;
  saveSettings({ lockEnabled: false, lockBlob: '' });
  return true;
}
