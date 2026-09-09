/** How long is left on a music-relay session, in the largest unit that is not zero.
 *
 *  The relay hands out TWELVE HOUR sessions (measured against the live service
 *  on 2026-09-09: granted 12:59 UTC, expiring 01:00 UTC). The old label was
 *  built from whole days, so a session minted one second earlier read
 *  "0 days left" and a working feature looked broken.
 *
 *  Days once there is more than a day, hours down to the last hour, then
 *  minutes. Anything already gone, or unknown, has nothing to say.
 */
export function relayTimeLeft(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} left`;
  if (seconds >= 86400) return plural(Math.floor(seconds / 86400), 'day');
  if (seconds >= 3600) return plural(Math.floor(seconds / 3600), 'hour');
  // Under a minute still reads "1 minute left" rather than "0 minutes left":
  // the point of the label is that there IS time left, however little.
  return plural(Math.max(1, Math.floor(seconds / 60)), 'minute');
}
