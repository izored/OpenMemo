import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { mediaSrc } from '@/lib/media';
import { videoEmbedUrl, resolveEmbedShape } from '@/lib/platforms';
import { useImageAspect } from '@/lib/useMediaOrientation';

// One slide of a carousel, with its controls ON the picture — the same shape as
// the memo page's viewer. The lightbox's own arrows sit at the far edges of the
// screen because they page between MEMOS; reusing that position for slides read
// as "next memo" and left the photo with no visible carousel control at all.
function SlideStage({
  urls, index, onStep, alt,
}: { urls: string[]; index: number; onStep: (d: number) => void; alt: string }) {
  const i = Math.min(index, urls.length - 1);
  return (
    // inline-block, NOT flex: a flex wrapper lets the <img> take the full
    // available width and `object-fit: contain` letterboxes the photo inside
    // it, so controls anchored to the element sat hundreds of pixels out in
    // the dark. Shrink-wrapping means the box IS the photo.
    <div
      style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxWidth: '100%', maxHeight: '100%' }}
      onClick={(e) => e.stopPropagation()}
    >
      <img
        key={`${i}-${urls[i]}`}
        src={urls[i]}
        alt={`${alt} — ${i + 1} of ${urls.length}`}
        // The height cap is in viewport units on purpose: `max-height: 100%`
        // cannot resolve against a shrink-wrapping parent (auto height), so a
        // tall photo would size to full width and run off the screen. 64px is
        // the lightbox's own 32px padding, top and bottom.
        style={{
          display: 'block', width: 'auto', height: 'auto',
          maxWidth: '100%', maxHeight: 'calc(100vh - 64px)',
        }}
      />
      <button
        className="om-lightbox-nav prev"
        style={{ left: 8 }}
        onClick={(e) => { e.stopPropagation(); onStep(-1); }}
        aria-label="Previous image"
      >
        <Icon name="chevronLeft" size={26} />
      </button>
      <button
        className="om-lightbox-nav next"
        style={{ right: 8 }}
        onClick={(e) => { e.stopPropagation(); onStep(1); }}
        aria-label="Next image"
      >
        <Icon name="chevronRight" size={26} />
      </button>
      {/* Top left, mirroring the memo page's counter — the lightbox toolbar
          already owns the top right corner. */}
      <div className="om-lightbox-count" style={{ top: 10, left: 10, bottom: 'auto', transform: 'none' }}>
        {i + 1} / {urls.length}
      </div>
    </div>
  );
}

// Single shared lightbox for the whole app. Reads the active media group +
// index from the store so arrow keys / on-screen arrows page between memos.
export function Lightbox() {
  const navigate = useNavigate();
  const group = useAppStore((s) => s.lightboxGroup);
  const index = useAppStore((s) => s.lightboxIndex);
  const close = useAppStore((s) => s.closeLightbox);
  const step = useAppStore((s) => s.lightboxStep);
  const gallery = useAppStore((s) => s.lightboxGallery);
  const slide = useAppStore((s) => s.lightboxSlide);
  const galleryStep = useAppStore((s) => s.galleryStep);

  // Gallery mode (intra-memo carousel paging) takes precedence — a single memo's
  // slides, arrows page SLIDES. Rendered before the hook-dependent memo mode so
  // its own keyboard handler runs; keep the early return AFTER all hooks below.
  const galleryOpen = slide >= 0 && slide < gallery.length;

  const open = index >= 0 && index < group.length;
  const memo = open ? group[index] : undefined;

  // Poster aspect for a remote embed — same provider-agnostic signal as the memo
  // page: a portrait clip's thumbnail is portrait, so the frame follows it
  // instead of cropping the video into a 16/9 box. Must run before any early
  // return so hook order stays stable.
  const posterSrc = memo && memo.type === 'video' && !memo.file_path ? mediaSrc(memo) : null;
  const posterAspect = useImageAspect(posterSrc);

  // A carousel opened straight from a card (dashboard, search, a collection)
  // used to show slide 1 and nothing else — the paging UI only existed for the
  // memo page's own viewer. Any memo carrying a gallery pages here too, so the
  // arrows mean the same thing wherever the lightbox was opened from.
  const memoSlides =
    !galleryOpen && memo && memo.type !== 'video' && (memo.gallery?.length ?? 0) > 1
      ? memo.gallery!.map((g) => g.url)
      : null;
  const [slideIdx, setSlideIdx] = useState(0);
  const memoSlideStep = (d: number) =>
    setSlideIdx((prev) => (memoSlides ? (prev + d + memoSlides.length) % memoSlides.length : 0));
  // Opening a different memo starts at its first slide, never a stale index.
  useEffect(() => { setSlideIdx(0); }, [memo?.id]);

  useEffect(() => {
    if (!open && !galleryOpen) return;
    const pageStep = galleryOpen ? galleryStep : memoSlides ? memoSlideStep : step;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') pageStep(1);
      else if (e.key === 'ArrowLeft') pageStep(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, galleryOpen, close, step, galleryStep, memoSlides?.length]);

  // Gallery (carousel) mode: page a single memo's image slides.
  if (galleryOpen) {
    return (
      <div className="om-lightbox" role="dialog" aria-modal="true" onClick={close}>
        {gallery.length > 1 ? (
          <SlideStage urls={gallery} index={slide} onStep={galleryStep} alt="Slide" />
        ) : (
          <img key={slide} src={gallery[slide]} alt={`Slide ${slide + 1}`} onClick={(e) => e.stopPropagation()} />
        )}
        <div className="om-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
          <button className="om-lightbox-close" onClick={close} aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </div>
      </div>
    );
  }

  if (!open || !memo) return null;

  const src = mediaSrc(memo);
  // Prefer a local file (no network, never expires) over a remote embed.
  const localVideo = memo.type === 'video' && memo.file_path ? `/api/memos/${memo.id}/file` : null;
  // Autoplay is right here: the user explicitly clicked the card to play.
  const embed = memo.type === 'video' && !localVideo ? videoEmbedUrl(memo, { autoplay: true }) : null;
  const hasPrevNext = group.length > 1;
  // Size relative to the overlay (which is already inset by the sidebar via
  // --sidebar-w in CSS) rather than the raw viewport — so the embed stays centered
  // in the visible area whether the sidebar is open or collapsed. Widths use 100%
  // (of the inset overlay), not vw (the full window).
  const shape = embed ? resolveEmbedShape(memo, posterAspect) : { kind: 'video' as const, aspectRatio: '16/9' };
  const kind = shape.kind;
  const shadow = '0 30px 80px rgba(0,0,0,0.5)';
  const embedStyle: CSSProperties =
    kind === 'portrait'
      ? { height: 'min(85vh, 720px)', aspectRatio: shape.aspectRatio, width: 'auto', maxWidth: '100%', border: 0, borderRadius: 12, boxShadow: shadow }
      : kind === 'card'
      ? { width: 'min(100%, 550px)', height: 'min(85vh, 800px)', border: 0, borderRadius: 12, boxShadow: shadow, background: '#15202b' }
      : { width: 'min(100%, 1280px)', aspectRatio: '16/9', maxHeight: '85vh', border: 0, borderRadius: 12, boxShadow: shadow };

  return (
    <div className="om-lightbox" role="dialog" aria-modal="true" onClick={close}>
      {memo.type === 'video' ? (
        localVideo ? (
          <video
            key={memo.id}
            src={localVideo}
            poster={memo.thumbnail_path || undefined}
            controls
            autoPlay
            // Muted so autoplay is actually allowed (browsers block unmuted
            // autoplay, which left the lightbox on a paused black frame). The
            // poster fills the gap before the first frame; controls let the user
            // unmute, and the memo page player plays with sound.
            muted
            playsInline
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }}
          />
        ) : embed ? (
          <iframe
            key={memo.id}
            src={embed}
            title={memo.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            scrolling={kind === 'card' ? 'auto' : 'no'}
            onClick={(e) => e.stopPropagation()}
            style={embedStyle}
          />
        ) : (
          <div className="om-lightbox-empty" onClick={(e) => e.stopPropagation()}>
            <p>No inline preview for {memo.source_domain || 'this source'}.</p>
            {memo.source_url && (
              <a
                href={memo.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="om-lightbox-open"
                style={{ marginTop: 12 }}
              >
                <Icon name="arrowUpRight" size={14} />
                <span>Open original</span>
              </a>
            )}
          </div>
        )
      ) : memoSlides ? (
        <SlideStage urls={memoSlides} index={slideIdx} onStep={memoSlideStep} alt={memo.title} />
      ) : src ? (
        <img key={memo.id} src={src} alt={memo.title} onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="om-lightbox-empty" onClick={(e) => e.stopPropagation()}>No preview available</div>
      )}

      {/* Inside a carousel the arrows page SLIDES and live on the picture
          (SlideStage); stepping between memos would skip the other eleven
          photos the user just opened, so the screen-edge arrows stay off. */}
      {!memoSlides && hasPrevNext && (
        <>
          <button
            className="om-lightbox-nav prev"
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            aria-label="Previous memo"
          >
            <Icon name="chevronLeft" size={26} />
          </button>
          <button
            className="om-lightbox-nav next"
            onClick={(e) => { e.stopPropagation(); step(1); }}
            aria-label="Next memo"
          >
            <Icon name="chevronRight" size={26} />
          </button>
          <div className="om-lightbox-count" onClick={(e) => e.stopPropagation()}>
            {index + 1} / {group.length}
          </div>
        </>
      )}

      <div className="om-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          className="om-lightbox-open"
          onClick={() => { close(); navigate(`/memo/${memo.id}`); }}
        >
          <Icon name="arrowUpRight" size={14} />
          <span>Open memo page</span>
        </button>
        <button className="om-lightbox-close" onClick={close} aria-label="Close">
          <Icon name="x" size={20} />
        </button>
      </div>
    </div>
  );
}
