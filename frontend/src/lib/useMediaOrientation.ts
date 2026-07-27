import { useEffect, useState } from 'react';

// Provider-agnostic video orientation, measured from the POSTER.
//
// We can't read an <iframe>'s intrinsic video size (cross-origin), so a remote
// embed's shape was previously guessed per-platform — everything without an
// explicit orientation defaulted to 16/9 and a portrait clip (a FB reel, a
// YouTube Short) got letterbox-cropped inside a landscape box.
//
// The fix needs no per-provider table and no backend field: a video's cached
// thumbnail/poster shares the video's own aspect, so loading that image off-
// screen and reading naturalWidth/Height tells us portrait vs landscape for ANY
// source that gave us a poster. Null until measured (or on error) — callers then
// fall back to the platform default.
export function useImageAspect(src: string | null | undefined): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the new poster loads
    setAspect(null);
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    img.onerror = () => {};
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return aspect;
}
