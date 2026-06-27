/**
 * Preload for the "Ollama Host" modal. Bridges the host get/save IPC so the
 * tiny config page never needs node integration.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openmemo', {
  getHost: (): Promise<string> => ipcRenderer.invoke('ollama:get'),
  saveHost: (host: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:save', host),
  // Renderer global; not in the node lib types, so reach it via globalThis.
  close: () => (globalThis as unknown as { close(): void }).close(),
});
