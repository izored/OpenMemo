import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Animates its own height as the child content changes, the same gesture the
// New Memo panel uses. Pass a `tabKey` that changes whenever the content swaps
// (so the measure re-runs); a ResizeObserver also catches in-place growth.
//
// The observer feeds its own input, so it needs two guards. `contentRect` is
// fractional, and writing a fractional height back can re-measure a hair
// different forever, so the height is rounded and a sub-pixel delta is ignored.
// The write is also deferred to the next frame: setting state straight out of
// the callback is what produces "ResizeObserver loop completed with undelivered
// notifications" and, in the Appearance panel, a visible judder as the body's
// scrollbar crossed its threshold on every pass.
export function AnimatedHeight({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    let raf = 0;
    let last = Math.round(el.offsetHeight);
    setH(last);
    const ro = new ResizeObserver((entries) => {
      const raw = entries[0]?.contentRect?.height;
      if (typeof raw !== 'number') return;
      const next = Math.round(raw);
      if (Math.abs(next - last) < 1) return;
      last = next;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setH(next));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [tabKey]);
  return (
    <div className="om-add-anim-h" style={{ height: typeof h === 'number' ? `${h}px` : h }}>
      <div ref={innerRef} className="om-add-anim-inner" key={tabKey}>
        {children}
      </div>
    </div>
  );
}
