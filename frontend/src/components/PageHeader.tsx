import React from 'react';
import { Icon } from './Icon';

// The one page header. Every page calls this instead of hand-rolling its own
// om-header markup, so eyebrow/title/sub geometry and the sticky blur stay
// identical everywhere. `children` lands in the rail below the title — filter
// tabs on the dashboard, action buttons elsewhere. `back` renders the pill
// button above the title (same affordance as the playlist view's Back).
export function PageHeader({
  eyebrow,
  title,
  sub,
  back,
  children,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  back?: { label: string; onClick: () => void };
  children?: React.ReactNode;
}) {
  return (
    <header className="om-header">
      {back && (
        <button className="om-music-back" onClick={back.onClick} title={back.label}>
          <Icon name="chevronLeft" size={13} />
          <span>{back.label}</span>
        </button>
      )}
      <div className="om-greet">
        <span className="om-greet-eyebrow mono">{eyebrow}</span>
        <h1 className="om-greet-title">{title}</h1>
        {sub && <p className="om-greet-sub">{sub}</p>}
      </div>
      {children && <div className="om-filter-rail">{children}</div>}
    </header>
  );
}
