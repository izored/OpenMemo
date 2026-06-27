/**
 * Main-window preload. The SPA itself needs nothing from Electron (it talks to
 * the backend over http like any web app); we only expose a boot-log feed so
 * the loading screen can show backend startup progress.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openmemoBoot', {
  onLog: (cb: (line: string) => void) => {
    ipcRenderer.on('boot:log', (_e, line: string) => cb(line));
  },
});

// App-lock: the lock screen (lock.html) loads in this same window and verifies
// the PIN. On success the main process takes over and loads the app.
contextBridge.exposeInMainWorld('openmemoLock', {
  verify: (pin: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('lock:verify', pin),
});
