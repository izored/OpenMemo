/**
 * Two questions the UI keeps getting wrong, and their two different answers.
 *
 *   "Which modifier key do I print?"  The machine holding the keyboard, so
 *   `navigator`. A Mac browsing the Docker install still wants ⌘.
 *
 *   "Where does my data live, how do I update?"  The machine running the
 *   backend, so the API (`install_kind`, from backend/core/install.py).
 *
 * Getting these two crossed is how the page ended up telling Mac users their
 * cookie jar sat in "a Docker volume" while telling Docker users their library
 * "lives on your Mac".
 */
import { useQuery } from '@tanstack/react-query';
import { settingsApi, type InstallKind } from './api';

// ── The viewer's keyboard ────────────────────────────────────────────────────
// Static: nobody swaps a Mac for a PC mid-session, so this is read once.
export const APPLE_KEYBOARD = /Mac|iPhone|iPad|iPod/.test(
  navigator.userAgent || '',
);
/** Print in shortcut hints: `⌘K` / `Ctrl K`. */
export const MOD = APPLE_KEYBOARD ? '⌘' : 'Ctrl';
/** Submit chord for the writer and composers. */
export const MOD_ENTER = APPLE_KEYBOARD ? '⌘⏎' : 'Ctrl ⏎';

/** Swap the hardcoded ⌘ in stored copy for whatever this keyboard uses. */
export function modKeys(text: string): string {
  return APPLE_KEYBOARD ? text : text.replace(/⌘/g, 'Ctrl ');
}

// ── The backend's install ────────────────────────────────────────────────────

export interface Install {
  kind: InstallKind;
  /** The packaged Mac app. NOT "the viewer is on a Mac". */
  isMac: boolean;
  isDocker: boolean;
  /** False until the settings request lands. Copy stays neutral until then. */
  known: boolean;
  /** Where writable state lives, phrased for a person. */
  dataHome: string;
}

const DATA_HOME: Record<InstallKind, string> = {
  macos: '~/Library/Application Support/OpenMemo',
  docker: "openMemo's own Docker volume",
  dev: "openMemo's data folder",
};

// True for all three, so the first paint before the fetch lands is never wrong,
// only vaguer.
const DATA_HOME_UNKNOWN = "openMemo's own data store on this machine";

export function useInstall(): Install {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  });
  const kind = data?.install_kind;
  return {
    kind: kind ?? 'dev',
    isMac: kind === 'macos',
    isDocker: kind === 'docker',
    known: !!kind,
    dataHome: kind ? DATA_HOME[kind] : DATA_HOME_UNKNOWN,
  };
}
