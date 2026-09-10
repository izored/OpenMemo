import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { parentPath, routeLabel, useNavHistory } from '@/lib/navHistory';

interface BackButtonProps {
  /** Force a destination. Omit to go back to the page you actually came from. */
  to?: string;
  className?: string;
}

/**
 * The one back control. Pops to the previous page in this session; on an entry
 * with nothing behind it (deep link, reload, fresh window) it falls back to the
 * route one level up instead of throwing the user out of openMemo.
 *
 * Renders nothing when both would be no-ops — sitting on the dashboard with no
 * history — so the corner stays empty rather than offering a dead button.
 */
export function BackButton({ to, className }: BackButtonProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { canGoBack, previousPath } = useNavHistory();

  const fallback = to ?? parentPath(pathname);
  if (!canGoBack && fallback === pathname) return null;

  // After a reload the map is empty but the entry still has somewhere to go, so
  // the label degrades to a plain "Go back" rather than guessing.
  const target = to ?? (canGoBack ? previousPath : fallback);

  return (
    <button
      className={cn('om-back-btn', className)}
      onClick={() => (canGoBack && !to ? navigate(-1) : navigate(fallback))}
      title={target ? `Back to ${routeLabel(target)}` : 'Go back'}
      aria-label="Go back"
    >
      <Icon name="arrowLeft" size={18} />
    </button>
  );
}
