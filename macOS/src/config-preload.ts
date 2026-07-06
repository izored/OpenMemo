/**
 * Preload for the "Ollama Host" modal. Bridges the host get/save IPC so the
 * tiny config page never needs node integration.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openmemo', {
  getHost: (): Promise<string> => ipcRenderer.invoke('ollama:get'),
  saveHost: (host: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:save', host),
  // App-lock management (the PIN config modal).
  lockStatus: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke('lock:status'),
  lockSet: (current: string, next: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('lock:set', { current, next }),
  lockDisable: (current: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('lock:disable', current),
  // Renderer global; not in the node lib types, so reach it via globalThis.
  close: () => (globalThis as unknown as { close(): void }).close(),
});
