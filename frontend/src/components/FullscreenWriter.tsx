import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { ingestApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

export function FullscreenWriter() {
  const open = useAppStore((s) => s.writerOpen);
  const setOpen = useAppStore((s) => s.setWriterOpen);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      // eslint-disable-next-line react-hooks/immutability -- handleSave is a stable closure defined just below; invoking it here is intentional
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleSave();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title, body]);

  if (!open) return null;

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const mins = Math.max(1, Math.round(words / 220));

  const handleSave = async () => {
    if (!title.trim() && !body.trim()) return;
    setBusy(true);
    try {
      await ingestApi.note(title.trim() || 'Untitled note', body);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setTitle('');
      setBody('');
      setOpen(false);
    } catch {
      alert('Failed to save note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('om-writer', focus && 'focus')}>
      <div className="om-writer-top">
        <div className="om-writer-top-l">
          <button className="om-icon-btn" onClick={() => setOpen(false)} title="Close">
            <Icon name="x" size={14} />
          </button>
          <span className="mono om-writer-eyebrow">Writing</span>
        </div>
        <div className="om-writer-top-r mono">
          <span>{words} words</span>
          <span className="dot">·</span>
          <span>{mins} min read</span>
          <span className="dot">·</span>
          <button
            className={cn('om-writer-focus', focus && 'on')}
            onClick={() => setFocus((v) => !v)}
          >
            <Icon name="target" size={11} />
            <span>Focus</span>
          </button>
          <button
            className="om-add-foot-btn primary"
            style={{ marginLeft: 8 }}
            onClick={handleSave}
            disabled={busy}
          >
            <span>{busy ? 'Saving…' : 'Save Memo'}</span>
            <span className="mono om-add-kbd-inv">⌘⏎</span>
          </button>
        </div>
      </div>
      <div className="om-writer-stage">
        <input
          className="om-writer-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled note"
          autoFocus
        />
        <textarea
          className="om-writer-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'Begin where you are.\n\nMarkdown supported: # heading, ** bold, [[ link ]] another Memo.'}
        />
      </div>
      <div className="om-writer-foot mono">
        <span>Esc to exit</span>
        <span>·</span>
        <span>Cmd ⏎ to save</span>
      </div>
    </div>
  );
}
