import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '@/lib/audioPlayer';

// Canvas waveform for audio cards. When this memo is the active track AND
// playing, it animates the real frequency spectrum from the shared player's
// WebAudio analyser. Otherwise it paints a calm static bar pattern so the tile
// never looks empty. Color is read from CSS (`color` → currentColor) so it
// follows the theme + the accent-tint when active, matching the old CSS mask.
const BAR_COUNT = 34;

export function LiveWaveform({ memoId, active }: { memoId: string; active: boolean }) {
  const { getLevels, playing, isActive } = useAudioPlayer();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  // Static heights — deterministic per card so it doesn't reshuffle on rerender.
  const staticHeights = useRef<number[]>(
    Array.from({ length: BAR_COUNT }, (_, i) => 0.25 + Math.abs(Math.sin(i * 1.3) * 0.6)),
  );
  const levels = useRef<number[]>(new Array(BAR_COUNT).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      const live = isActive(memoId) && playing && getLevels(levels.current);
      const color = getComputedStyle(canvas).color || '#000';
      ctx.fillStyle = color;

      const gap = w * 0.012;
      const bw = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const amp = live
          ? Math.max(0.06, levels.current[i])
          : staticHeights.current[i] * 0.5;
        const bh = Math.max(2 * dpr, amp * h * 0.9);
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        const r = Math.min(bw / 2, 2 * dpr);
        // Rounded bar
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, r);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [memoId, getLevels, playing, isActive]);

  return <canvas ref={canvasRef} className="om-wave-canvas" data-active={active ? '1' : undefined} aria-hidden />;
}
