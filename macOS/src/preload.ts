/**
 * Main-window preload. The SPA talks to the backend over http like any web app,
 * so almost nothing belongs here. The exceptions are the things only the shell
 * can do: stream the boot log, take the launch PIN, and reach the handful of
 * native settings that used to live exclusively in the menu bar.
 *
 * That last group is why `openmemoShell` exists. Ollama's host, the launch PIN
 * and Open at Login were menu-only, and a Mac user opens Settings first. The
 * page now shows them, and reaching them means crossing into the main process.
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

// Native settings surfaced inside the Settings page. Its presence is also how
// the SPA knows it is running in the Mac shell rather than a browser tab.
contextBridge.exposeInMainWorld('openmemoShell', {
  platform: process.platform,
  /** Save the Ollama host, restart the backend, reload the window. */
  setOllamaHost: (host: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:save', host),
  getOllamaHost: (): Promise<string> => ipcRenderer.invoke('ollama:get'),
  /** Is a launch PIN set? Setting or clearing it opens the native sheet, which
   *  owns the current-PIN check; the page never handles the secret itself. */
  lockStatus: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke('lock:status'),
  configureLock: (): Promise<void> => ipcRenderer.invoke('lock:configure'),
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('login-item:get'),
  setOpenAtLogin: (on: boolean): Promise<boolean> => ipcRenderer.invoke('login-item:set', on),
  openLogsFolder: (): Promise<void> => ipcRenderer.invoke('logs:open'),
});
