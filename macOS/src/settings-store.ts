/**
 * Tiny JSON settings store in userData. The only thing the shell itself needs
 * to remember is where the user's Ollama lives — everything else is the
 * backend's own (server-side) settings. Ollama is never bundled or managed
 * here; we only record the host:port to point at.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface ShellSettings {
  /** Ollama base URL the backend is told to use (OLLAMA_HOST). */
  ollamaHost: string;
}

const DEFAULTS: ShellSettings = {
  ollamaHost: 'http://localhost:11434',
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
