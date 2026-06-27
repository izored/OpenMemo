/**
 * Tiny JSON settings store in userData. Holds the two things the shell itself
 * remembers: where the user's Ollama lives, and (optionally) an app-lock PIN.
 * Ollama is never bundled or managed here — we only record the host:port.
 *
 * The PIN is stored as a salted SHA-256 hash, and that blob is encrypted with
 * Electron safeStorage (tied to the macOS login keychain) when available, so the
 * settings file never holds anything directly reversible. A 4-digit PIN is a
 * casual privacy lock, not a defense against a determined local attacker.
 */
import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
  /** Encrypted {salt,hash} blob — see encryptBlob/decryptBlob. */
  lockBlob?: string;
  /** Last window size/position, restored on next launch. */
  windowState?: WindowState;
  /** A release version the user chose to skip in the update notifier. */
  updateSkipVersion?: string;
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
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

// --- app-lock PIN ------------------------------------------------------------

function encryptBlob(obj: unknown): string {
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) {
    return 'v1:' + safeStorage.encryptString(json).toString('base64');
  }
  // Fallback when the OS keychain is unavailable — still not plaintext PIN, but
  // weaker. Better than nothing for a casual lock.
  return 'raw:' + Buffer.from(json, 'utf-8').toString('base64');
}

function decryptBlob(blob: string): { salt: string; hash: string } | null {
  try {
    if (blob.startsWith('v1:')) {
      const json = safeStorage.decryptString(Buffer.from(blob.slice(3), 'base64'));
      return JSON.parse(json);
    }
    if (blob.startsWith('raw:')) {
      return JSON.parse(Buffer.from(blob.slice(4), 'base64').toString('utf-8'));
    }
  } catch {
    /* corrupt / wrong keychain */
  }
  return null;
}

function hashPin(salt: string, pin: string): string {
  return crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

/** True when an app-lock PIN is set. Cheap (no crypto). */
export function isLockEnabled(): boolean {
  const s = loadSettings();
  return s.lockEnabled === true && !!s.lockBlob;
}

/** Set (or replace) the PIN and turn the lock on. */
export function setPin(pin: string): void {
  const salt = crypto.randomBytes(16).toString('hex');
  const blob = encryptBlob({ salt, hash: hashPin(salt, pin) });
  saveSettings({ lockEnabled: true, lockBlob: blob });
}

/** Verify a PIN. Returns true if no lock is set. */
export function verifyPin(pin: string): boolean {
  const s = loadSettings();
  if (!s.lockEnabled || !s.lockBlob) return true;
  const dec = decryptBlob(s.lockBlob);
  if (!dec) return false;
  return hashPin(dec.salt, pin) === dec.hash;
}

/** Turn the lock off and forget the PIN. */
export function disableLock(): void {
  saveSettings({ lockEnabled: false, lockBlob: '' });
}
