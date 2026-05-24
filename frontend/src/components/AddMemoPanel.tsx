import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { ingestApi, collectionApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import type { Collection } from '@/types';

type Tab = 'link' | 'note' | 'multimedia' | 'voice';

function AnimatedHeight({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setH(el.offsetHeight);
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.height;
      if (typeof next === 'number') setH(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabKey]);
  return (
    <div className="om-add-anim-h" style={{ height: typeof h === 'number' ? `${h}px` : h }}>
      <div ref={innerRef} className="om-add-anim-inner" key={tabKey}>
        {children}
      </div>
    </div>
  );
}

export function AddMemoPanel() {
  const open = useAppStore((s) => s.addPanelOpen);
  const setOpen = useAppStore((s) => s.setAddPanelOpen);
  const setWriterOpen = useAppStore((s) => s.setWriterOpen);
  const setCollectionModalOpen = useAppStore((s) => s.setCollectionModalOpen);
  const setEditingCollection = useAppStore((s) => s.setEditingCollection);
  const queryClient = useQueryClient();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  const [tab, setTab] = useState<Tab>('link');
  const [mediaKind, setMediaKind] = useState<'image' | 'video' | 'file'>('image');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [collection, setCollection] = useState<string>('');
  const [collOpen, setCollOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError('');
    }
  }, [open]);

  const activeColl = collections.find((c: Collection) => c.id === collection);

  const reset = () => {
    setUrl('');
    setNote('');
    setNoteTitle('');
    setTags([]);
    setError('');
  };
  const close = () => {
    setOpen(false);
  };
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    reset();
    close();
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (tab === 'link') {
        if (!url.trim()) return;
        await ingestApi.url(url.trim(), collection || undefined);
      } else if (tab === 'note') {
        if (!noteTitle.trim() && !note.trim()) return;
        await ingestApi.note(noteTitle.trim() || 'Untitled note', note, collection || undefined);
      } else if (tab === 'multimedia') {
        fileRef.current?.click();
        return;
      } else {
        return;
      }
      done();
    } catch (e) {
      setError((e as Error).message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (files: FileList | null) => {
    if (!files || !files.length) return;

    // Disclaimer for huge uploads — they consume RAM (browser side), disk
    // (server side), and processing time (embedding, thumbnail, etc.).
    // 1 GiB threshold; below that we just upload silently.
    const HUGE = 1024 * 1024 * 1024;
    const huge = Array.from(files).filter((f) => f.size >= HUGE);
    if (huge.length) {
      const totalMb = huge.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
      const ok = window.confirm(
        `Heads up — ${huge.length} file(s) totalling ${(totalMb / 1024).toFixed(2)} GB.\n\n` +
        `Large uploads take a while to ingest and consume disk + RAM for embedding. ` +
        `OpenMemo is local-first so they stay on your machine. Continue?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    setError('');
    try {
      for (const f of Array.from(files)) await ingestApi.file(f, collection || undefined);
      done();
    } catch (e) {
      setError((e as Error).message || 'Failed to upload');
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'link', icon: 'link', label: 'Link' },
    { id: 'note', icon: 'fileText', label: 'Note' },
    { id: 'multimedia', icon: 'image', label: 'Media' },
    { id: 'voice', icon: 'mic', label: 'Voice' },
  ];

  return (
    <>
    {open && collOpen && (
      <aside className="om-add-coll-flyout" aria-label="Choose collection">
        <div className="om-add-head">
          <div className="om-add-head-l">
            <b>Collection</b>
          </div>
          <button className="om-add-x" onClick={() => setCollOpen(false)} aria-label="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="om-add-coll-flyout-list">
          <button
            className={cn('om-add-coll-opt', !collection && 'active')}
            onClick={() => {
              setCollection('');
              setCollOpen(false);
            }}
          >
            <Icon name="inbox" size={11} />
            <span>No collection</span>
            <span className="mono" />
          </button>
          {collections.map((c: Collection) => (
            <button
              key={c.id}
              className={cn('om-add-coll-opt', collection === c.id && 'active')}
              onClick={() => {
                setCollection(c.id);
                setCollOpen(false);
              }}
            >
              <span>{c.emoji || '📁'}</span>
              <span>{c.name}</span>
              <span className="mono" />
            </button>
          ))}
        </div>
        <button
          className="om-add-coll-flyout-new"
          onClick={() => {
            setEditingCollection(null);
            setCollectionModalOpen(true);
          }}
        >
          <Icon name="plus" size={12} />
          <span>New collection…</span>
        </button>
      </aside>
    )}
    <aside className={cn('om-add-panel', open && 'open')} aria-hidden={!open}>
      <div className="om-add-head">
        <div className="om-add-head-l">
          <b>New Memo</b>
          <span className="om-add-kbd mono">N</span>
        </div>
        <button className="om-add-x" onClick={close} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="om-add-body">
        <div className="om-add-sect mono">Type</div>
        <div className="om-add-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={cn('om-add-tab', tab === t.id && 'active')}
              onClick={() => setTab(t.id)}
              title={t.label}
            >
              <Icon name={t.icon} size={13} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <AnimatedHeight tabKey={tab + (tab === 'multimedia' ? ':' + mediaKind : '') + (tab === 'link' && url ? ':p' : '')}>
          {tab === 'link' && (
            <div className="om-add-tab-pane">
              <div className="om-add-sect mono">URL</div>
              <div className="om-add-input">
                <Icon name="globe" size={13} />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste or type a URL…"
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                />
              </div>
              <p className="om-add-hint mono">
                Preview, metadata, and a screenshot will be captured automatically.
              </p>
            </div>
          )}

          {tab === 'note' && (
            <div className="om-add-tab-pane">
              <div className="om-add-sect-row">
                <span className="om-add-sect mono">Note</span>
                <button
                  className="om-add-expand"
                  onClick={() => {
                    setOpen(false);
                    setWriterOpen(true);
                  }}
                  title="Open writing session"
                >
                  <Icon name="arrowUpRight" size={11} />
                  <span>Fullscreen</span>
                </button>
              </div>
              <input
                className="om-add-title-input"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Untitled note"
              />
              <textarea
                className="om-add-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Start writing. Markdown supported: # ** [[ ]]"
                rows={6}
              />
              <div className="om-add-note-meta mono">
                <span>{note.length} chars</span>
                <span>· not saved yet</span>
              </div>
            </div>
          )}

          {tab === 'multimedia' && (
            <div className="om-add-tab-pane">
              <div className="om-add-sect mono">Kind</div>
              <div className="om-add-segment">
                {[
                  { id: 'image', label: 'Image', icon: 'image' },
                  { id: 'video', label: 'Video', icon: 'video' },
                  { id: 'file', label: 'File', icon: 'file' },
                ].map((k) => (
                  <button
                    key={k.id}
                    className={cn('om-add-seg', mediaKind === k.id && 'active')}
                    onClick={() => setMediaKind(k.id as 'image' | 'video' | 'file')}
                  >
                    <Icon name={k.icon} size={11} />
                    <span>{k.label}</span>
                  </button>
                ))}
              </div>
              <div
                className="om-add-dropzone"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onFile(e.dataTransfer.files);
                }}
              >
                <Icon name={mediaKind === 'image' ? 'image' : mediaKind === 'video' ? 'video' : 'file'} size={20} />
                <p>
                  Drop {mediaKind === 'image' ? 'an image' : mediaKind === 'video' ? 'a video' : 'a file'} or{' '}
                  <span className="om-add-link">browse</span>
                </p>
                <span className="mono">
                  {mediaKind === 'image' && 'JPG · PNG · WebP · GIF · SVG'}
                  {mediaKind === 'video' && 'MP4 · MOV · WebM · MKV'}
                  {mediaKind === 'file' && 'Any file type — code, archives, 3D, docs…'}
                </span>
              </div>
            </div>
          )}

          {tab === 'voice' && (
            <div className="om-add-tab-pane">
              <div className="om-add-sect mono">Voice Memo</div>
              <div className="om-add-voice">
                <div className="om-add-wave">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <span
                      key={i}
                      style={{
                        height: `${30 + Math.sin(i * 0.7) * 35 + Math.cos(i * 0.3) * 20}%`,
                        animationDelay: `${i * 40}ms`,
                      }}
                    />
                  ))}
                </div>
                <button className="om-add-rec" disabled>
                  <span className="om-add-rec-dot" />
                  <span>Record</span>
                  <span className="mono">soon</span>
                </button>
              </div>
              <p className="om-add-hint mono">Voice capture is coming soon.</p>
            </div>
          )}
        </AnimatedHeight>

        <div className="om-add-sect mono">Collection</div>
        <div className="om-add-coll-wrap">
          <button className="om-add-select" onClick={() => setCollOpen((v) => !v)}>
            <Icon name="folder" size={12} />
            <span>{activeColl ? activeColl.name : 'No collection'}</span>
            <Icon
              name="chevronDown"
              size={10}
              style={{ marginLeft: 'auto', opacity: 0.55, transform: collOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
            />
          </button>
        </div>

        <div className="om-add-sect mono">Tags</div>
        <div className="om-add-tag-input">
          {tags.map((t) => (
            <span key={t} className="om-add-tag-chip mono">
              #{t}
              <button onClick={() => setTags(tags.filter((x) => x !== t))}>×</button>
            </span>
          ))}
          <input
            placeholder={tags.length ? '' : 'Add tag…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                setTags([...tags, e.currentTarget.value.trim()]);
                e.currentTarget.value = '';
              }
            }}
          />
        </div>

        {error && <p className="om-add-hint mono" style={{ color: '#EF5048' }}>{error}</p>}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={mediaKind === 'image' ? 'image/*' : mediaKind === 'video' ? 'video/*' : undefined}
        hidden
        onChange={(e) => onFile(e.target.files)}
      />

      <div className="om-add-foot">
        <button className="om-add-foot-btn ghost" onClick={close}>
          Cancel
        </button>
        <button className="om-add-foot-btn primary" onClick={save} disabled={busy}>
          <span>{busy ? 'Saving…' : tab === 'multimedia' ? 'Choose file' : 'Save'}</span>
          <span className="mono om-add-kbd-inv">⏎</span>
        </button>
      </div>
    </aside>
    </>
  );
}
