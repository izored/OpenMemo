/**
 * Picking the .dmg out of a GitHub release.
 *
 * Kept apart from update-notifier.ts so it can be tested without importing
 * electron, and because the choice has two traps in it:
 *
 *  - electron-builder publishes `<name>.dmg.blockmap` next to the disk image.
 *    It ends in ".blockmap", but a naive `includes('.dmg')` picks it, and the
 *    user downloads a 200KB file that opens nothing.
 *  - the release page also carries source archives, and one day may carry a
 *    second architecture. arm64 wins when it is named, since the app is
 *    Apple-Silicon only (see electron-builder.yml).
 */
export interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

const isDmg = (a: ReleaseAsset): boolean =>
  typeof a.name === 'string' &&
  a.name.toLowerCase().endsWith('.dmg') &&
  typeof a.browser_download_url === 'string' &&
  a.browser_download_url.length > 0;

/**
 * The direct download URL for the release's disk image, or undefined when the
 * release has none — a build that failed or has not finished attaching it. The
 * caller falls back to the release page in that case.
 */
export function pickDmgUrl(assets: ReleaseAsset[] | undefined): string | undefined {
  const dmgs = (assets ?? []).filter(isDmg);
  const arm = dmgs.find((a) => /arm64|aarch64|apple[-_]?silicon/i.test(a.name as string));
  return (arm ?? dmgs[0])?.browser_download_url;
}
