import { useEffect, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { mediaSrc } from '@/lib/media';
import { videoEmbedUrl, resolveEmbedShape } from '@/lib/platforms';
import { useImageAspect } from '@/lib/useMediaOrientation';

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

  useEffect(() => {
    if (!open && !galleryOpen) return;
    const pageStep = galleryOpen ? galleryStep : step;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') pageStep(1);
      else if (e.key === 'ArrowLeft') pageStep(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, galleryOpen, close, step, galleryStep]);

  // Gallery (carousel) mode: page a single memo's image slides.
  if (galleryOpen) {
    const multi = gallery.length > 1;
    return (
      <div className="om-lightbox" role="dialog" aria-modal="true" onClick={close}>
        <img key={slide} src={gallery[slide]} alt={`Slide ${slide + 1}`} onClick={(e) => e.stopPropagation()} />
        {multi && (
          <>
            <button className="om-lightbox-nav prev" onClick={(e) => { e.stopPropagation(); galleryStep(-1); }} aria-label="Previous image">
              <Icon name="chevronLeft" size={26} />
            </button>
            <button className="om-lightbox-nav next" onClick={(e) => { e.stopPropagation(); galleryStep(1); }} aria-label="Next image">
              <Icon name="chevronRight" size={26} />
            </button>
            <div className="om-lightbox-count" onClick={(e) => e.stopPropagation()}>
              {slide + 1} / {gallery.length}
            </div>
          </>
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
      ) : src ? (
        <img key={memo.id} src={src} alt={memo.title} onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="om-lightbox-empty" onClick={(e) => e.stopPropagation()}>No preview available</div>
      )}

      {hasPrevNext && (
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
