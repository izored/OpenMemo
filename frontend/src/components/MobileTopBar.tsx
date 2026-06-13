import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';

// Slim top bar shown only below the lg breakpoint (CSS hides it on desktop).
// Hamburger opens the off-canvas drawer; the wordmark goes home (ADR-009 #3).
export function MobileTopBar() {
  const navigate = useNavigate();
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  return (
    <header className="om-mobile-topbar">
      <button
        className="om-mtb-burger"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
        title="Menu"
      >
        <Icon name="menu" size={20} />
      </button>
      <button
        className="om-mtb-brand"
        onClick={() => {
          setSidebarOpen(false);
          navigate('/');
        }}
        aria-label="Go home"
      >
        <span className="om-brand-name">openMemo</span>
      </button>
    </header>
  );
}
