import { useCallback, useEffect, useRef, useState } from 'react';

// Branded color picker (replaces the native <input type="color">, which pops the
// browser's default OS picker and breaks the app's look). A swatch trigger opens
// an in-app popover: SV square + hue bar + hex field, styled with the app tokens.
// Controlled by `value` (hex) / `onChange`; the trigger is whatever you pass as
// children, so it fits both the accent slots and the background-color row.

// ── color math ──────────────────────────────────────────────────────────────
function clamp01(n: number) { return Math.min(1, Math.max(0, n)); }

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function ColorPicker({
  value,
  onChange,
  children,
  ariaLabel = 'Pick a color',
}: {
  value: string;
  onChange: (hex: string) => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="om-cpick" ref={wrapRef}>
      <button
        type="button"
        className="om-cpick-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        {children}
      </button>
      {open && <ColorPopover value={value} onChange={onChange} />}
    </div>
  );
}

function ColorPopover({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [r, g, b] = hexToRgb(value || '#888888');
  const [h0, s0, v0] = rgbToHsv(r, g, b);
  // Hue is kept in its own state so dragging to pure black/white doesn't reset it.
  const [hue, setHue] = useState(h0);
  const [sat, setSat] = useState(s0);
  const [val, setVal] = useState(v0);
  const [hex, setHex] = useState((value || '#888888').toUpperCase());
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'sv' | 'hue' | null>(null);

  // Push an hsv change up as hex (and sync the hex field).
  const emit = useCallback((nh: number, ns: number, nv: number) => {
    const [rr, gg, bb] = hsvToRgb(nh, ns, nv);
    const out = rgbToHex(rr, gg, bb);
    setHex(out.toUpperCase());
    onChange(out);
  }, [onChange]);

  const onSv = useCallback((clientX: number, clientY: number) => {
    const el = svRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const ns = clamp01((clientX - rect.left) / rect.width);
    const nv = clamp01(1 - (clientY - rect.top) / rect.height);
    setSat(ns); setVal(nv); emit(hue, ns, nv);
  }, [hue, emit]);

  const onHue = useCallback((clientX: number) => {
    const el = hueRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const nh = clamp01((clientX - rect.left) / rect.width) * 360;
    setHue(nh); emit(nh, sat, val);
  }, [sat, val, emit]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current === 'sv') onSv(e.clientX, e.clientY);
      else if (dragging.current === 'hue') onHue(e.clientX);
    };
    const up = () => { dragging.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [onSv, onHue]);

  const commitHex = (raw: string) => {
    let v = raw.trim().replace(/^#?/, '');
    if (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      if (v.length === 3) v = v.split('').map((c) => c + c).join('');
      const full = '#' + v;
      const [rr, gg, bb] = hexToRgb(full);
      const [nh, ns, nv] = rgbToHsv(rr, gg, bb);
      // Keep hue stable for greys (rgbToHsv returns 0); otherwise adopt it.
      if (ns > 0 && nv > 0) setHue(nh);
      setSat(ns); setVal(nv);
      setHex(full.toUpperCase());
      onChange(full);
    } else {
      setHex(raw.toUpperCase());
    }
  };

  const swatch = rgbToHex(...hsvToRgb(hue, sat, val));

  return (
    <div className="om-cpick-pop" data-lenis-prevent onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="om-cpick-sv"
        ref={svRef}
        style={{ background: `hsl(${hue}, 100%, 50%)` }}
        onPointerDown={(e) => { dragging.current = 'sv'; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); onSv(e.clientX, e.clientY); }}
      >
        <div className="om-cpick-sv-white" />
        <div className="om-cpick-sv-black" />
        <span className="om-cpick-sv-handle" style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%`, background: swatch }} />
      </div>

      <div className="om-cpick-controls">
        <span className="om-cpick-preview" style={{ background: swatch }} aria-hidden />
        <div
          className="om-cpick-hue"
          ref={hueRef}
          onPointerDown={(e) => { dragging.current = 'hue'; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); onHue(e.clientX); }}
        >
          <span className="om-cpick-hue-handle" style={{ left: `${(hue / 360) * 100}%` }} />
        </div>
      </div>

      <div className="om-cpick-hexrow">
        <span className="om-cpick-hex-ico mono" aria-hidden>#</span>
        <input
          className="om-cpick-hex"
          value={hex.replace(/^#/, '')}
          onChange={(e) => commitHex(e.target.value)}
          spellCheck={false}
          maxLength={6}
          aria-label="Hex color"
        />
      </div>
    </div>
  );
}
