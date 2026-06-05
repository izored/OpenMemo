import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// One-line title: truncates with an ellipsis at rest. Two reveal modes:
//   • default — on hover, if the text overflows, it slides left to reveal the
//     end, pauses, then slides back (a single pass).
//   • auto — when `auto` is set (e.g. the now-playing track), it slides on a
//     gentle loop without needing hover, so the active card announces its full
//     title on its own.
// Pure CSS motion driven by a measured shift distance; honors
// prefers-reduced-motion. The full text is always a native tooltip.
export function Marquee({ text, className, auto = false }: { text: string; className?: string; auto?: boolean }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  // Overflow = full text width − visible width. scrollWidth reports the full
  // content even when clipped, so this is valid at rest or mid-animation.
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const over = inner.scrollWidth - wrap.clientWidth;
    setShift(over > 2 ? over : 0);
  }, []);

  // Auto mode measures up-front (and on text change) since there's no hover to
  // trigger it; a second pass on the next frame catches late font layout.
  useEffect(() => {
    if (!auto) return;
    measure();
    const r = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(r);
  }, [text, auto, measure]);

  // Constant (slow, readable) speed: longer titles scroll proportionally longer.
  const dur = shift > 0 ? Math.min(26, 6 + shift / 22) : 0;
  const mode = shift > 0 ? (auto ? 'is-auto' : 'can-scroll') : false;

  return (
    <span
      ref={wrapRef}
      className={cn('om-marquee', mode, className)}
      onMouseEnter={auto ? undefined : measure}
      style={{ ['--marq-shift']: `${shift}px`, ['--marq-dur']: `${dur}s` } as React.CSSProperties}
      title={text}
    >
      <span ref={innerRef} className="om-marquee-inner">
        {text}
      </span>
    </span>
  );
}
