/**
 * Pin the writable data directory, once, for the life of the app.
 *
 * Every byte the user owns — openmemo.db, chroma/, files/, backups/, the PIN
 * blob — lives under Electron's `userData`, outside the read-only .app bundle.
 * That is the whole reason dropping a new build into /Applications is a
 * code-only swap: the new bundle replaces the old one and the library is not
 * inside either of them.
 *
 * The catch is where Electron puts that folder. It derives it from
 * `app.getName()`, which reads `productName` in package.json — so the location
 * of somebody's entire library is a function of a display string. Rename the
 * product, change its casing, add a suffix, and Electron quietly starts a brand
 * new empty folder. The app opens with no memos, no settings, no PIN, and
 * nothing anywhere reports an error. The old library is still on disk; the app
 * simply cannot see it any more.
 *
 * So the folder name is stated once, here, and never derived again.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The literal directory name under ~/Library/Application Support.
 *
 * This is not a label, it is an address: it is where existing installs already
 * keep their library, because it is what `productName` happened to be when they
 * were created. Changing it orphans every one of them. Anything that wants a
 * different name has to migrate the folder first.
 */
export const USER_DATA_DIR_NAME = 'OpenMemo';

/**
 * Point `userData` at that fixed name. Call before `app.whenReady()` — Chromium
 * reads the path when the session is created, and after that it is too late.
 *
 * Returns the path in force, which is the pinned one unless pinning failed.
 */
let pinFailure: string | null = null;

/** Why pinning failed, if it did. main.ts logs this once the boot log exists. */
export function userDataPinFailure(): string | null {
  return pinFailure;
}

export function pinUserDataPath(): string {
  const dir = path.join(app.getPath('appData'), USER_DATA_DIR_NAME);
  try {
    // setPath does not create anything; a missing directory is an error.
    fs.mkdirSync(dir, { recursive: true });
    app.setPath('userData', dir);
    // sessionData (Chromium's cache, cookies, local storage) defaults to
    // userData, but it takes that default once. Set it explicitly so the two
    // can never end up in different folders.
    app.setPath('sessionData', dir);
  } catch (e) {
    // Never fatal. An unpinned app still runs, it just goes back to deriving the
    // folder from productName, which is where it was before this existed. But
    // it must not be silent: the fallback IS the failure mode this exists to
    // prevent, and mkdirSync throws EEXIST if something has left a plain FILE
    // at that path, which would be a very confusing way to lose a library.
    pinFailure = e instanceof Error ? e.message : String(e);
  }
  return app.getPath('userData');
}
