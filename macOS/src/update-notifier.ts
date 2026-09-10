/**
 * Update notifier — NOT auto-apply.
 *
 * macOS auto-update (Squirrel.Mac / electron-updater) requires the app to be
 * code-signed with a Developer ID; an ad-hoc / unsigned build can't apply
 * updates, the patch just fails. Since this app ships unsigned (no paid Apple
 * account), we do the next best thing: check GitHub Releases for a newer
 * version and offer the .dmg. The download link is the release asset itself,
 * not the release page: the .dmg hangs at the very bottom of that page under
 * Assets, below the entire changelog, and people were not finding it. If a
 * Developer ID is added later, swap this for electron-updater's
 * `autoUpdater.checkForUpdatesAndNotify`.
 */
import { app, dialog, shell } from 'electron';
import { pickDmgUrl, type ReleaseAsset } from './release-assets';
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
    const rel = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: ReleaseAsset[];
    };
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

    const page = rel.html_url || `https://github.com/${REPO}/releases/latest`;
    const dmg = pickDmgUrl(rel.assets);

    // Where the download lands, and what happens next, before the browser
    // steals the screen. Two things bit users here: the .dmg is at the very
    // bottom of the release page under Assets, below the whole changelog, and
    // the replaced app is blocked by macOS again on its first launch because a
    // fresh download carries a fresh quarantine flag.
    const detail = dmg
      ? [
          `You have ${current}. Download replaces openMemo and nothing else: your memos, media and settings live outside the app.`,
          '',
          'Quit openMemo before you install it.',
        ].join('\n')
      : [
          `You have ${current}. This release has no .dmg attached yet, so this opens the release page.`,
          '',
          'The .dmg sits at the bottom of that page, under Assets, below the release notes.',
        ].join('\n');

    const choice = dialog.showMessageBoxSync({
      type: 'info',
      message: `Update available: ${latest}`,
      detail,
      buttons: [dmg ? 'Download .dmg' : 'Open release page', 'Later', 'Skip This Version'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      void shell.openExternal(dmg || page);
      // Stays on screen behind the browser, so the steps are still there when
      // the download finishes and the .dmg opens.
      info(
        'Installing the update',
        [
          '1. Quit openMemo (Command-Q).',
          '2. Open the .dmg and drag openMemo onto Applications. Say yes to replacing it.',
          '3. macOS blocks the first launch, because the new download is not notarised.',
          '   One line in Terminal clears it:',
          '',
          '   xattr -dr com.apple.quarantine /Applications/OpenMemo.app',
          '',
          'Read Me First, inside the .dmg, has that line to copy and the',
          'click-only way through System Settings.',
        ].join('\n'),
      );
    } else if (choice === 2) {
      saveSettings({ updateSkipVersion: latest });
    }
  } catch (e) {
    if (!silent) info('Update check failed.', e instanceof Error ? e.message : String(e));
  }
}
