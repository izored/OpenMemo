import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { searchApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { Memo } from '@/types';

export function SearchOverlay() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the search box when the overlay opens
      setQ('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results when the query is emptied
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchApi.search(q);
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, setOpen]);

  if (!open) return null;

  const go = (id: string) => {
    setOpen(false);
    navigate(`/memo/${id}`);
  };

  return (
    <>
      <div className="om-backdrop om-backdrop-instant" onClick={() => setOpen(false)} />
      <div className="om-modal om-modal-instant" role="dialog" aria-label="Search Memos">
        <div className="om-url-input" style={{ margin: 18, marginBottom: 0 }}>
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search across your Memos…"
          />
          <span className="om-kbd mono">esc</span>
        </div>
        <div
          className="om-modal-body"
          style={{ maxHeight: '50vh', overflowY: 'auto', gap: 2, marginTop: 14 }}
        >
          {loading && <p className="om-add-hint mono">Searching…</p>}
          {!loading && q.trim() && results.length === 0 && (
            <p className="om-add-hint mono">No results.</p>
          )}
          {results.map((r) => (
            <button key={r.id} className="om-connected-row" onClick={() => go(r.id)}>
              <Icon name="fileText" size={12} />
              <span className="om-connected-title">{r.title}</span>
              <span className="om-connected-date mono">{r.source_domain || r.type}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
