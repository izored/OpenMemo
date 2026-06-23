import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { collectionApi } from '@/lib/api';
import type { MusicPlaylist } from '@/types';

// Cover editor for a playlist/album, same mechanics as the memo thumbnail editor
// (ThumbnailEditModal) but square: drop in a new image (or reposition / zoom the
// current one inside a fixed 1:1 frame) and bake the framed crop to a JPEG that
// becomes the playlist's custom cover. A playlist with no custom cover starts
// from the upload prompt (the track-art collage isn't a single croppable image).
const FRAME = 320; // 1:1
const OUT = 800;

export function PlaylistCoverModal({ playlist, onClose }: { playlist: MusicPlaylist; onClose: () => void }) {
  const qc = useQueryClient();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const kindLabel = playlist.music_kind === 'album' ? 'Album' : 'Playlist';

  const baseScale = img ? Math.max(FRAME / img.naturalWidth, FRAME / img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const drawW = img ? img.naturalWidth * scale : 0;
  const drawH = img ? img.naturalHeight * scale : 0;

  // Keep the image covering the frame (no empty edges).
  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(FRAME - drawW, x)),
      y: Math.min(0, Math.max(FRAME - drawH, y)),
    }),
    [drawW, drawH],
  );

  const loadFromBlob = useCallback((blob: Blob) => {
    // Object URL is same-origin, so the canvas never taints on save.
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const bs = Math.max(FRAME / image.naturalWidth, FRAME / image.naturalHeight);
      const dW = image.naturalWidth * bs;
      const dH = image.naturalHeight * bs;
      setImg(image);
      setZoom(1);
      setOff({ x: (FRAME - dW) / 2, y: (FRAME - dH) / 2 });
    };
    image.onerror = () => setErr('Could not load that image.');
    image.src = url;
  }, []);

  // Pull the current custom cover (same-origin) so it can be repositioned.
  useEffect(() => {
    if (!playlist.cover_url) return;
    let alive = true;
    fetch(playlist.cover_url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('fetch failed'))))
      .then((b) => { if (alive) loadFromBlob(b); })
      .catch(() => {});
    return () => { alive = false; };
  }, [playlist.cover_url, loadFromBlob]);

  // Change zoom and re-clamp the offset in one step.
  const onZoom = (z: number) => {
    setZoom(z);
    if (!img) return;
    const s = baseScale * z;
    const dW = img.naturalWidth * s;
    const dH = img.naturalHeight * s;
    setOff((o) => ({
      x: Math.min(0, Math.max(FRAME - dW, o.x)),
      y: Math.min(0, Math.max(FRAME - dH, o.y)),
    }));
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) { setErr(''); loadFromBlob(f); }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOff(clamp(drag.current.ox + (e.clientX - drag.current.x), drag.current.oy + (e.clientY - drag.current.y)));
  };
  const onPointerUp = () => { drag.current = null; };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['music-playlists'] });
  };

  const save = async () => {
    if (!img) { onClose(); return; }
    setSaving(true);
    setErr('');
    try {
      const c = document.createElement('canvas');
      c.width = OUT;
      c.height = OUT;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable.');
      const ratio = OUT / FRAME;
      ctx.drawImage(img, off.x * ratio, off.y * ratio, drawW * ratio, drawH * ratio);
      const blob: Blob = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed.'))), 'image/jpeg', 0.9),
      );
      await collectionApi.uploadCover(playlist.id, blob);
      refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Could not save. Try uploading an image.');
    } finally {
      setSaving(false);
    }
  };

  const removeCover = async () => {
    setRemoving(true);
    setErr('');
    try {
      await collectionApi.deleteCover(playlist.id);
      refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Could not remove the cover.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div className="om-modal" role="dialog" aria-modal="true" aria-label={`Edit ${kindLabel.toLowerCase()} cover`} style={{ width: 'min(420px, calc(100vw - 32px))' }}>
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">{kindLabel} cover</span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>{playlist.name}</b>
          </div>
          <button className="om-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="om-modal-body" style={{ gap: 14 }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} hidden />
          <div
            style={{
              position: 'relative', width: FRAME, height: FRAME, maxWidth: '100%',
              margin: '0 auto', borderRadius: 12, overflow: 'hidden',
              background: 'var(--surface-2)', cursor: img ? 'grab' : 'default',
              touchAction: 'none', userSelect: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {img ? (
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{ position: 'absolute', left: off.x, top: off.y, width: drawW, height: drawH, maxWidth: 'none', pointerEvents: 'none' }}
              />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3)' }}
              >
                <ImagePlus size={22} />
                <span style={{ fontSize: 13 }}>Upload an image</span>
              </button>
            )}
            <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)', borderRadius: 12, pointerEvents: 'none' }} />
          </div>

          {img && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-4)' }}>Zoom</span>
              <input
                type="range" min={1} max={3} step={0.01} value={zoom}
                onChange={(e) => onZoom(parseFloat(e.target.value))}
                className="om-ap-range" style={{ flex: 1 }} aria-label="Zoom"
              />
              <button className="om-btn-ghost" onClick={() => fileRef.current?.click()}>Replace</button>
            </div>
          )}

          <p className="mono" style={{ margin: 0, fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
            Drag to reposition · the cover is square
          </p>

          {err && <p className="om-modal-error" style={{ margin: 0 }}>{err}</p>}
        </div>

        <div className="om-modal-foot">
          {playlist.cover_url ? (
            <button className="om-btn-ghost" onClick={removeCover} disabled={removing || saving} title="Remove the custom cover, back to track art">
              {removing ? <Loader2 size={14} className="om-spin" /> : <Trash2 size={14} />} Remove
            </button>
          ) : (
            <button className="om-btn-ghost" onClick={onClose}>Cancel</button>
          )}
          <button className="om-btn-primary" onClick={save} disabled={saving || !img}>
            {saving ? <><Loader2 size={14} className="om-spin" /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
