import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { memoApi } from '@/lib/api';
import { mediaSrc } from '@/lib/media';
import type { Memo } from '@/types';

// Notion-header-style thumbnail editor: drop in a new image (or reposition /
// zoom the current one inside a fixed 3:2 frame), edit the title, and bake the
// framed crop to a JPEG that overrides the memo's thumbnail. Works for any memo
// type (a note/doc with no thumbnail simply starts from the upload prompt).
const FRAME_W = 384;
const FRAME_H = 256; // 3:2
const OUT_W = 900;
const OUT_H = 600;

export function ThumbnailEditModal({ memo, onClose }: { memo: Memo; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(memo.title);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const baseScale = img ? Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const drawW = img ? img.naturalWidth * scale : 0;
  const drawH = img ? img.naturalHeight * scale : 0;

  // Keep the image covering the frame (no empty edges).
  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(FRAME_W - drawW, x)),
      y: Math.min(0, Math.max(FRAME_H - drawH, y)),
    }),
    [drawW, drawH],
  );

  const loadFromBlob = useCallback((blob: Blob) => {
    // Object URL is same-origin, so the canvas never taints on save.
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const bs = Math.max(FRAME_W / image.naturalWidth, FRAME_H / image.naturalHeight);
      const dW = image.naturalWidth * bs;
      const dH = image.naturalHeight * bs;
      setImg(image);
      setZoom(1);
      setOff({ x: (FRAME_W - dW) / 2, y: (FRAME_H - dH) / 2 });
    };
    image.onerror = () => setErr('Could not load that image.');
    image.src = url;
  }, []);

  // Pull the current thumbnail (same-origin) so it can be repositioned. Remote
  // hosts that block CORS just fall back to the upload prompt.
  useEffect(() => {
    const src = mediaSrc(memo);
    if (!src) return;
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('fetch failed'))))
      .then((b) => { if (alive) loadFromBlob(b); })
      .catch(() => {});
    return () => { alive = false; };
  }, [memo, loadFromBlob]);

  // Change zoom and re-clamp the offset in one step (the new drawn size depends
  // on the new zoom), avoiding a setState-in-effect.
  const onZoom = (z: number) => {
    setZoom(z);
    if (!img) return;
    const s = baseScale * z;
    const dW = img.naturalWidth * s;
    const dH = img.naturalHeight * s;
    setOff((o) => ({
      x: Math.min(0, Math.max(FRAME_W - dW, o.x)),
      y: Math.min(0, Math.max(FRAME_H - dH, o.y)),
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

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      let changed = false;
      if (img) {
        const c = document.createElement('canvas');
        c.width = OUT_W;
        c.height = OUT_H;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable.');
        const ratio = OUT_W / FRAME_W;
        ctx.drawImage(img, off.x * ratio, off.y * ratio, drawW * ratio, drawH * ratio);
        const blob: Blob = await new Promise((res, rej) =>
          c.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed.'))), 'image/jpeg', 0.9),
        );
        await memoApi.uploadThumbnail(memo.id, blob);
        changed = true;
      }
      if (title.trim() && title.trim() !== memo.title) {
        await memoApi.update(memo.id, { title: title.trim() });
        changed = true;
      }
      if (changed) {
        qc.invalidateQueries({ queryKey: ['memos'] });
        qc.invalidateQueries({ queryKey: ['memo', memo.id] });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Could not save. Try uploading an image.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div className="om-modal" role="dialog" aria-modal="true" aria-label="Edit thumbnail" style={{ width: 'min(460px, calc(100vw - 32px))' }}>
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">Edit card</span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>Thumbnail &amp; title</b>
          </div>
          <button className="om-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="om-modal-body" style={{ gap: 14 }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} hidden />
          <div
            style={{
              position: 'relative', width: FRAME_W, height: FRAME_H, maxWidth: '100%',
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

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="om-field-label">Title</span>
            <input className="om-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Memo title" />
          </label>

          {err && <p className="om-modal-error" style={{ margin: 0 }}>{err}</p>}
        </div>

        <div className="om-modal-foot">
          <button className="om-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="om-btn-primary" onClick={save} disabled={saving}>
            {saving ? <><Loader2 size={14} className="om-spin" /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
