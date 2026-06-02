import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { mediaSrc } from '@/lib/media';
import { videoEmbedUrl } from '@/lib/platforms';

// Single shared lightbox for the whole app. Reads the active media group +
// index from the store so arrow keys / on-screen arrows page between memos.
export function Lightbox() {
  const navigate = useNavigate();
  const group = useAppStore((s) => s.lightboxGroup);
  const index = useAppStore((s) => s.lightboxIndex);
  const close = useAppStore((s) => s.closeLightbox);
  const step = useAppStore((s) => s.lightboxStep);

  const open = index >= 0 && index < group.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, step]);

  if (!open) return null;

  const memo = group[index];
  const src = mediaSrc(memo);
  // Prefer a local file (no network, never expires) over a remote embed.
  const localVideo = memo.type === 'video' && memo.file_path ? `/api/memos/${memo.id}/file` : null;
  const embed = memo.type === 'video' && !localVideo ? videoEmbedUrl(memo) : null;
  const hasPrevNext = group.length > 1;

  return (
    <div className="om-lightbox" role="dialog" aria-modal="true" onClick={close}>
      {memo.type === 'video' ? (
        localVideo ? (
          <video
            key={memo.id}
            src={localVideo}
            controls
            autoPlay
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
            scrolling="no"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(90vw, 1280px)', aspectRatio: '16/9', border: 0, borderRadius: 12, boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}
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
