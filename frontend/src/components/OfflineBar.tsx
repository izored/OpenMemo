import { Icon } from './Icon';
import { useOnline } from '@/lib/useOnline';

/**
 * A quiet strip that appears only when the machine is offline.
 *
 * The message matters as much as the fact. "You are offline" on its own reads
 * as an error and openMemo is not in one: your library is on this disk and
 * every part of it still works. The only things that stop are the ones that
 * were always going to need the network. So the bar says what still works,
 * not what broke.
 *
 * It renders nothing at all when online, so there is no reserved space and no
 * layout shift on either transition.
 */
export function OfflineBar() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="om-offline-bar" role="status" aria-live="polite">
      <Icon name="cloudOff" size={13} />
      <span>
        You are offline. Your library still works. Saving new links and playing
        media kept at its source do not.
      </span>
    </div>
  );
}
