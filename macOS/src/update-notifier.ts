/**
 * Update notifier — NOT auto-apply.
 *
 * macOS auto-update (Squirrel.Mac / electron-updater) requires the app to be
 * code-signed with a Developer ID; an ad-hoc / unsigned build can't apply
 * updates, the patch just fails. Since this app ships unsigned (no paid Apple
 * account), we do the next best thing: check GitHub Releases for a newer
 * version and offer to open the download page. If a Developer ID is added
 * later, swap this for electron-updater's `autoUpdater.checkForUpdatesAndNotify`.
 */
import { app, dialog, shell } from 'electron';
import { loadSettings, saveSettings } from './settings-store';

const REPO = 'izored/OpenMemo';

/** Semver-ish compare: >0 if a is newer than b. Ignores pre-release tags. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function info(message: string, detail?: string): void {
  void dialog.showMessageBox({ type: 'info', message, detail });
}

/**
 * Check GitHub for a newer release.
 * @param silent true on the automatic launch check (stay quiet unless there's an
 *   update); false when the user clicks "Check for Updates…" (always report).
 */
export async function checkForUpdates({ silent }: { silent: boolean }): Promise<void> {
  const current = app.getVersion();
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'openmemo-desktop', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      if (!silent) info('Could not check for updates.', `GitHub returned ${res.status}.`);
      return;
    }
    const rel = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = (rel.tag_name || '').trim();
    if (!latest) {
      if (!silent) info('No releases found yet.');
      return;
    }
    if (cmpVersion(latest, current) <= 0) {
      if (!silent) info("You're up to date.", `OpenMemo ${current} is the latest version.`);
      return;
    }
    // Newer version exists.
    if (silent && loadSettings().updateSkipVersion === latest) return; // user skipped it

    const choice = dialog.showMessageBoxSync({
      type: 'info',
      message: `Update available: ${latest}`,
      detail: `You have ${current}. Download the new .dmg from GitHub?`,
      buttons: ['Download', 'Later', 'Skip This Version'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      void shell.openExternal(rel.html_url || `https://github.com/${REPO}/releases/latest`);
    } else if (choice === 2) {
      saveSettings({ updateSkipVersion: latest });
    }
  } catch (e) {
    if (!silent) info('Update check failed.', e instanceof Error ? e.message : String(e));
  }
}
