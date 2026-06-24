// One source of truth for "what shape is this media?" — the REAL aspect ratio
// (width / height) of pulled media and thumbnails, measured from the loaded
// element rather than assumed from the memo type. A video is NOT 16:9 by
// default (a localized reel is 9:16); an image/poster keeps its own proportions.
//
// Used by the Edge masonry wall so every tile keeps its source shape via the
// `--card-ar` CSS var, image and video alike. Keep all ratio logic here so the
// grid, lightbox, and any future surface read the same number.

export type Orient = 'portrait' | 'landscape';

/** Aspect ratio (w / h) from intrinsic dimensions, or null if not measurable. */
export function mediaAspect(w: number, h: number): number | null {
  return w > 0 && h > 0 ? w / h : null;
}

/** Aspect of a loaded <img> from its natural size. */
export function imgAspect(el: HTMLImageElement): number | null {
  return mediaAspect(el.naturalWidth, el.naturalHeight);
}

/** Aspect of a <video> once metadata is known, from its intrinsic size. */
export function videoAspect(el: HTMLVideoElement): number | null {
  return mediaAspect(el.videoWidth, el.videoHeight);
}

/** Portrait when taller than wide; landscape otherwise (square reads landscape). */
export function aspectToOrient(ar: number | null): Orient {
  return ar != null && ar < 1 ? 'portrait' : 'landscape';
}
