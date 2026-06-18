import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Animates its own height as the child content changes, the same gesture the
// New Memo panel uses. Pass a `tabKey` that changes whenever the content swaps
// (so the measure re-runs); a ResizeObserver also catches in-place growth.
export function AnimatedHeight({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setH(el.offsetHeight);
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.height;
      if (typeof next === 'number') setH(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabKey]);
  return (
    <div className="om-add-anim-h" style={{ height: typeof h === 'number' ? `${h}px` : h }}>
      <div ref={innerRef} className="om-add-anim-inner" key={tabKey}>
        {children}
      </div>
    </div>
  );
}
