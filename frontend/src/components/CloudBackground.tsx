import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { CloudRenderer, type CloudParams } from '@/lib/cloudShader';
import { resolveSky } from '@/lib/skyPalette';

// The WebGPU cloud backdrop (OPNMMO-0048). Mounted once in the app shell. It only
// paints in the cloud/live background modes; otherwise it renders nothing.
//
// Graceful fallback is mandatory: if WebGPU is missing or the shader fails to
// init, the canvas is never shown. A static sky (CSS gradient on .om-cloud-bg
// via --sky-bottom/--sky-top, written by applyTweaks) shows underneath instead,
// so the background is never blank or broken.
export function CloudBackground() {
  const tweaks = useAppStore((s) => s.tweaks);
  const active = tweaks.bgMode === 'cloud';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CloudRenderer | null>(null);
  // WebGPU support is a static capability check (render-time const, no setState).
  // initFailed flips only when an actual init attempt fails at runtime. The
  // canvas shows only when both are good; otherwise the static sky carries it.
  const supported = CloudRenderer.supported();
  const [initFailed, setInitFailed] = useState(false);
  const gpuOk = supported && !initFailed;
  // Live mode re-derives the sky on a slow tick; this counter forces a re-read.
  const [, setLiveTick] = useState(0);

  const dark = tweaks.theme === 'dark';
  // 'auto' sky band tracks the local clock (the old "Live"); any other band pins
  // a fixed sky.
  const band = tweaks.skyBand || 'auto';

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Build the current shader params from tweaks + resolved sky.
  const params: CloudParams = {
    speed: tweaks.cloudSpeed ?? 0.1,
    fullness: tweaks.cloudFullness ?? 0.5,
    // Intensity retired as a control — always 0 regardless of any saved value.
    intensity: 0,
    size: tweaks.cloudSize ?? 1,
    gradient: tweaks.skyGradient ?? 0.8,
    sky: resolveSky(band, dark),
    paused: !!reduceMotion,
  };

  // Start / stop the renderer when cloud mode toggles. Init is async and can
  // fail (no navigator.gpu, adapter refused, pipeline error) — on any failure we
  // flip gpuOk=false and the static sky carries the background.
  useEffect(() => {
    if (!active || !supported) {
      rendererRef.current?.stop();
      rendererRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const renderer = new CloudRenderer(canvas, params);
    rendererRef.current = renderer;
    renderer
      .start()
      .then((ok) => {
        if (cancelled) return;
        setInitFailed(!ok);
        if (!ok) {
          renderer.stop();
          rendererRef.current = null;
        }
      })
      .catch(() => {
        if (cancelled) return;
        setInitFailed(true);
        renderer.stop();
        rendererRef.current = null;
      });
    return () => {
      cancelled = true;
      renderer.stop();
      rendererRef.current = null;
    };
    // Re-init only when the mode toggles on/off — param changes go through the
    // cheap setParams path below, not a teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Push live params to the running renderer without re-creating it.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setParams(params);
    r.repaintOnce(); // repaint the single frame when paused (reduced motion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tweaks.cloudSpeed,
    tweaks.cloudFullness,
    tweaks.cloudIntensity,
    tweaks.cloudSize,
    tweaks.skyGradient,
    tweaks.skyBand,
    tweaks.bgMode,
    tweaks.theme,
  ]);

  // Live: re-resolve the sky every 3 minutes and on tab focus, so a session left
  // open through sunset catches up. Local clock only — no geolocation, no network.
  useEffect(() => {
    if (tweaks.bgMode !== 'cloud' || tweaks.skyBand !== 'auto') return;
    const tick = () => setLiveTick((n) => n + 1);
    const id = window.setInterval(tick, 180_000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, [tweaks.bgMode, tweaks.skyBand]);

  if (!active) return null;

  // The wrapper carries the static sky gradient (CSS vars) as the floor; the
  // canvas paints on top only when WebGPU is live. gpuOk=false => canvas hidden,
  // static sky shows through. Never blank.
  return (
    <div className="om-cloud-bg" aria-hidden data-fallback={gpuOk ? undefined : 'true'}>
      {gpuOk && <canvas ref={canvasRef} className="om-cloud-canvas" />}
    </div>
  );
}
