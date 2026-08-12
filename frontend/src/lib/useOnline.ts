import { useEffect, useState } from 'react';

/**
 * Is the browser online?
 *
 * openMemo works offline by design: everything it shows is on this machine
 * (ADR-025). But three things genuinely need the network, and all three fail
 * silently without this: saving a new link, re-pulling, and pressing play on
 * heavy media that was deliberately left at its source.
 *
 * Silently is the problem. There was no offline state anywhere in the app, so
 * pressing play with no connection mounted an iframe and handed you the
 * browser's error page inside your own memo, with nothing to explain it.
 *
 * `navigator.onLine` reports whether the machine has a network interface up,
 * not whether the internet is reachable, so it can say true on a captive
 * portal. That is fine for this: a false negative is what we care about
 * (nothing works, say so), and a false positive lands you on the same failure
 * you would have had anyway.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
