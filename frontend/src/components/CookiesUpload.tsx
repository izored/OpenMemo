import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Trash2, Upload } from 'lucide-react';
import { settingsApi } from '@/lib/api';

// Self-contained cookie-jar control: reads its own presence, uploads / removes,
// and keeps the shared ['settings'] query fresh so it works identically inside
// the cookies guide and on the Settings page. The jar is account credentials —
// it is only ever sent UP; the server never returns its contents.
export function CookiesUpload({ onChange }: { onChange?: (present: boolean) => void } = {}) {
  const queryClient = useQueryClient();
  const [present, setPresent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then((s) => setPresent(!!s.yt_cookies_present))
      .catch(() => setPresent(false));
  }, []);

  const sync = (next: boolean) => {
    setPresent(next);
    onChange?.(next);
    queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const res = await settingsApi.uploadCookies(file);
      sync(res.yt_cookies_present);
    } catch (e) {
      setError((e as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await settingsApi.deleteCookies();
      sync(res.yt_cookies_present);
    } catch (e) {
      setError((e as Error).message || 'Could not remove');
    } finally {
      setBusy(false);
    }
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input ref={inputRef} type="file" accept=".txt,text/plain" onChange={pick} style={{ display: 'none' }} />

      {present ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px', borderRadius: 12,
            background: 'var(--accent-soft)', border: '1px solid var(--border)',
          }}
        >
          <Check size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, flex: 1 }}>Cookies installed — downloads can authenticate.</span>
          <button className="om-btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload size={13} /> Replace
          </button>
          <button className="om-btn-ghost" onClick={remove} disabled={busy} title="Delete the cookie file from this machine">
            <Trash2 size={13} /> Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={busy}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            padding: '22px 14px', borderRadius: 12, width: '100%',
            background: dragging ? 'var(--accent-soft)' : 'var(--surface)',
            border: `1px dashed ${dragging ? 'var(--accent)' : 'var(--border-2)'}`,
            color: 'var(--text-2)', transition: 'background .15s, border-color .15s',
          }}
        >
          {busy ? <Loader2 size={18} className="om-spin" /> : <Upload size={18} style={{ color: 'var(--text-3)' }} />}
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            {busy ? 'Uploading…' : 'Drop cookies.txt here, or click to choose'}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>Netscape format · stays on this machine</span>
        </button>
      )}

      {error && <p className="om-modal-error" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
