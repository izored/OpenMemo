import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { VoiceRecorder } from './VoiceRecorder';
import { ingestApi, collectionApi, spaceApi } from '@/lib/api';
import { collectionEmojiOrDefault } from '@/lib/collectionEmoji';
import { playlistShape } from '@/lib/playlistUrl';
import { useAppStore } from '@/stores/appStore';
import { useConfirm } from './ConfirmModal';
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

// `embedded` (ADR-021): render only the form content, no fixed aside / scale
// animation — the bottom-bar IslandFab owns the glass surface and the morph.
export function AddMemoPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const open = useAppStore((s) => s.addPanelOpen);
  const setOpen = useAppStore((s) => s.setAddPanelOpen);
  // Files handed off from the global FileDropLayer's prefill branch (ADR-023).
  const pendingDropFiles = useAppStore((s) => s.pendingDropFiles);
  const setPendingDropFiles = useAppStore((s) => s.setPendingDropFiles);
  // Links / text dragged out of a browser (OPNMMO-0052).
  const pendingDropLinks = useAppStore((s) => s.pendingDropLinks);
  const setPendingDropLinks = useAppStore((s) => s.setPendingDropLinks);
  const bottomBarPresent = useAppStore((s) => s.bottomBarPresent);
  const [ask, confirmModal] = useConfirm();
  const setWriterOpen = useAppStore((s) => s.setWriterOpen);
  const setAddMemoBusy = useAppStore((s) => s.setAddMemoBusy);
  const lastCreatedCollectionId = useAppStore((s) => s.lastCreatedCollectionId);
  const setLastCreatedCollectionId = useAppStore((s) => s.setLastCreatedCollectionId);
  // When a Space is open, adds land in it (ADR-020) and the collection picker
  // shows the Space's collections, not the library's.
  const activeSpace = useAppStore((s) => s.activeSpace);
  // When a collection view is open (dashboard filter / Space view), a new memo
  // should land in it — the picker pre-selects the collection on panel open.
  const activeCollection = useAppStore((s) => s.activeCollection);
  const queryClient = useQueryClient();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections', activeSpace],
    queryFn: () => collectionApi.list(activeSpace || undefined),
  });
  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: spaceApi.list,
    enabled: !!activeSpace,
  });
  const targetSpace = activeSpace ? spaces.find((s) => s.id === activeSpace) : null;

  const [tab, setTab] = useState<Tab>('link');
  const [mediaKind, setMediaKind] = useState<'image' | 'video' | 'audio' | 'file'>('image');
  const [url, setUrl] = useState('');
  // "Don't pull": save the link as-is, no visual scrape (OPNMMO-0049).
  const [noPull, setNoPull] = useState(false);
  const [note, setNote] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [collection, setCollection] = useState<string>('');
  const [collOpen, setCollOpen] = useState(false);
  // Inline "create collection" inside the picker (ADR-021): the whole flow stays
  // in the open panel instead of launching the separate modal (which the island's
  // click-outside then closed, losing the in-progress memo). The new collection
  // is auto-selected on create.
  const [creatingColl, setCreatingColl] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [collBusy, setCollBusy] = useState(false);
  // The collection popup renders through a portal in FIXED coords measured off
  // the select button. In-flow it lived inside the panel's scrolling body,
  // which clipped its top and swallowed wheel scroll — unscrollable with many
  // collections. Fixed + portal = full height, its own scrollbar, no clipping.
  const collBtnRef = useRef<HTMLButtonElement>(null);
  const [collPos, setCollPos] = useState<{ left: number; width: number; bottom: number } | null>(null);
  const toggleColl = () => {
    setCollOpen((v) => {
      const next = !v;
      if (next && collBtnRef.current) {
        const r = collBtnRef.current.getBoundingClientRect();
        setCollPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 });
      }
      // Always reopen the picker in its list state, never mid-create.
      if (!next) { setCreatingColl(false); setNewCollName(''); }
      return next;
    });
  };

  // Create a collection inline and immediately select it for this memo. Lands in
  // the active Space when one is open (ADR-020), else the main library.
  const createColl = async () => {
    const name = newCollName.trim();
    if (!name || collBusy) return;
    setCollBusy(true);
    try {
      const created = await collectionApi.create({
        name,
        emoji: collectionEmojiOrDefault(name),
        workspace_id: activeSpace || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      if (created?.id) setCollection(created.id);
      setCreatingColl(false);
      setNewCollName('');
      setCollOpen(false);
    } catch (e) {
      setError((e as Error).message || 'Failed to create collection');
    } finally {
      setCollBusy(false);
    }
  };
  const [busy, setBusy] = useState(false);
  // Files staged for the prefill flow (dropped elsewhere, waiting for the user
  // to pick a collection + tags here, then Save). Empty = normal Media tab.
  const [staged, setStaged] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Every http(s) link in the field. The URL box takes a whole pasted BLOCK of
  // links, not just one — images worth keeping together are usually found one
  // at a time, on different sites, and drag-and-drop cannot express that
  // because the files are not on disk.
  const links = url.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  const multi = links.length > 1;
  // 'carousel' = one memo holding every image; 'separate' = one memo per link.
  const [multiMode, setMultiMode] = useState<'carousel' | 'separate'>('carousel');

  // Playlist detection (OPNMMO-0023 / ADR-015). A playlist-shaped URL triggers
  // a flat yt-dlp probe; the panel then asks: whole playlist or just this one?
  // Skipped entirely for a multi-link paste — that is a different question.
  const plShape = multi ? { isPlaylist: false, hasSingleItem: false } : playlistShape(url);
  const [plProbe, setPlProbe] = useState<{
    title: string;
    count: number;
    truncated: boolean;
    alreadySaved: { id: string; name: string } | null;
  } | null>(null);
  const [plProbing, setPlProbing] = useState(false);
  const [plChoice, setPlChoice] = useState<'playlist' | 'single'>('single');
  // Off by default: pull the playlist as remote tracks first, download later
  // from the Music page (per track or all at once) — like any music app.
  const [plDownload, setPlDownload] = useState(false);
  useEffect(() => {
    const many = url.split(/\s+/).filter((s) => /^https?:\/\//i.test(s.trim())).length > 1;
    const shape = many ? { isPlaylist: false } : playlistShape(url);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset probe state as the URL changes
    setPlProbe(null);
    if (!shape.isPlaylist) {
      setPlProbing(false);
      return;
    }
    // ALWAYS default to "just this one" — ingesting 100 tracks must be a
    // deliberate, explicit pick, never a default (user feedback on 0023).
    setPlChoice('single');
    setPlProbing(true);
    // Debounce so typing/pasting doesn't fire a probe per keystroke.
    const t = setTimeout(async () => {
      try {
        const res = await ingestApi.probePlaylist(url.trim());
        setPlProbe({
          title: res.title,
          count: res.count,
          truncated: res.truncated,
          alreadySaved: res.already_saved ?? null,
        });
      } catch {
        setPlProbe(null); // probe failed — the URL still saves as a single link
      } finally {
        setPlProbing(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [url]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale error when the panel opens
      setError('');
    }
  }, [open]);

  // Each open re-targets the collection the user is currently looking at (or
  // clears it on the plain dashboard), so "add while inside Fitness" files the
  // memo into Fitness with zero clicks. Manual picks after open still win.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill from the open collection view
      setCollection(activeCollection || '');
    }
  }, [open, activeCollection]);

  // Prefill handoff (ADR-023): files dropped on an ambiguous surface arrive via
  // the store. Jump to the Media tab, stage them, and clear the slice — Save
  // uploads them into whatever collection/tags the user then picks.
  useEffect(() => {
    if (!pendingDropFiles || !pendingDropFiles.length) return;
    const files = pendingDropFiles;
    setTab('multimedia');
    const kind = files.every((f) => f.type.startsWith('image/'))
      ? 'image'
      : files.every((f) => f.type.startsWith('video/'))
        ? 'video'
        : files.every((f) => f.type.startsWith('audio/'))
          ? 'audio'
          : 'file';
    setMediaKind(kind);
    // Replace (not append) so the handoff is idempotent — React StrictMode
    // re-runs this effect on the panel's mount, and the global + embedded panel
    // instances both consume the slice; a fresh open always starts clean.
    setStaged(files);
    setPendingDropFiles(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume the one-shot handoff slice
  }, [pendingDropFiles, setPendingDropFiles]);

  // The same handoff for a browser drag: links go to the Link tab (one per
  // line — the multi-link shape it already parses), a dragged selection with no
  // link in it goes to the Note tab. Replace, never append, for the same
  // StrictMode / two-instance reason as the file handoff above.
  useEffect(() => {
    if (!pendingDropLinks) return;
    const { urls, text } = pendingDropLinks;
    if (urls.length) {
      setTab('link');
      setUrl(urls.join('\n'));
    } else if (text) {
      setTab('note');
      setNote(text);
    }
    setPendingDropLinks(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume the one-shot handoff slice
  }, [pendingDropLinks, setPendingDropLinks]);

  // Drop the staged set whenever the panel closes without saving, so reopening
  // never shows files left over from a cancelled drop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear staged on close
    if (!open) setStaged([]);
  }, [open]);

  // A collection just created from the "New collection…" flow auto-selects here,
  // so the user lands back in the panel with it already chosen (no reselect).
  useEffect(() => {
    if (lastCreatedCollectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-select a just-created collection
      setCollection(lastCreatedCollectionId);
      setLastCreatedCollectionId(null);
    }
  }, [lastCreatedCollectionId, setLastCreatedCollectionId]);

  const activeColl = collections.find((c: Collection) => c.id === collection);

  const reset = () => {
    setUrl('');
    setNoPull(false);
    setMultiMode('carousel');
    setNote('');
    setNoteTitle('');
    setTags([]);
    setStaged([]);
    setError('');
  };
  const close = () => {
    setOpen(false);
  };
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    // Memo counts on collection cards / sidebar move when an add targets a
    // collection — keep them honest.
    queryClient.invalidateQueries({ queryKey: ['collections'] });
    // Keep Space counts fresh so the header stats and the delete warning
    // ("N memos will be gone") never lie after an add into a Space.
    if (activeSpace) {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space', activeSpace] });
    }
    reset();
    close();
  };

  const save = async () => {
    setBusy(true);
    setAddMemoBusy(true);
    setError('');
    try {
      if (tab === 'link') {
        if (!url.trim()) return;
        if (multi) {
          if (multiMode === 'carousel') {
            // One memo holding every picture. Links that hold no image are
            // reported rather than dropped in silence.
            const res = await ingestApi.gallery(links, {
              collection_id: collection || undefined,
              workspace_id: activeSpace || undefined,
            });
            if (res.failed?.length) {
              queryClient.invalidateQueries({ queryKey: ['memos'] });
              setError(
                `Saved ${res.slides} image${res.slides === 1 ? '' : 's'}. ` +
                `${res.failed.length} link${res.failed.length === 1 ? '' : 's'} held no image.`,
              );
              setUrl(res.failed.join('\n'));
              return;
            }
            done();
            navigate(`/memo/${res.id}`);
            return;
          }
          // One memo per link — each goes through the normal save path, so a
          // failing link never aborts the ones after it.
          const bad: string[] = [];
          setProgress({ done: 0, total: links.length });
          for (let i = 0; i < links.length; i++) {
            try {
              await ingestApi.url(links[i], collection || undefined, {
                noPull,
                workspace_id: activeSpace || undefined,
              });
            } catch {
              bad.push(links[i]);
            }
            setProgress({ done: i + 1, total: links.length });
          }
          setProgress(null);
          if (bad.length) {
            queryClient.invalidateQueries({ queryKey: ['memos'] });
            setError(`${bad.length} of ${links.length} failed.`);
            setUrl(bad.join('\n'));
            return;
          }
          done();
          return;
        }
        if (plShape.isPlaylist && plChoice === 'playlist') {
          // Whole playlist → playlist collection; downloads only when asked.
          // Land on the playlist itself; a re-pasted URL returns the existing
          // one (status 'exists'), so this never creates a duplicate.
          const res = await ingestApi.playlist(url.trim(), { download: plDownload });
          queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
          done();
          navigate(`/music/${res.collection_id}`);
          return;
        }
        await ingestApi.url(url.trim(), collection || undefined, { noPull, workspace_id: activeSpace || undefined });
      } else if (tab === 'note') {
        if (!noteTitle.trim() && !note.trim()) return;
        await ingestApi.note(noteTitle.trim() || 'Untitled note', note, collection || undefined, activeSpace || undefined);
      } else if (tab === 'multimedia') {
        if (staged.length) {
          await uploadFiles(staged);
        } else {
          fileRef.current?.click();
        }
        return;
      } else {
        return;
      }
      done();
    } catch (e) {
      setError((e as Error).message || 'Failed to save');
    } finally {
      setBusy(false);
      setAddMemoBusy(false);
    }
  };

  // Add more files to the staged set (prefill flow) without uploading yet.
  const stageFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length) setStaged((prev) => [...prev, ...arr]);
  };

  const uploadFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;

    // Disclaimer for huge uploads — they consume RAM (browser side), disk
    // (server side), and processing time (embedding, thumbnail, etc.).
    // 1 GiB threshold; below that we just upload silently.
    const HUGE = 1024 * 1024 * 1024;
    const huge = Array.from(files).filter((f) => f.size >= HUGE);
    if (huge.length) {
      const totalMb = huge.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
      const ok = await ask({
        title: `${huge.length} file${huge.length === 1 ? '' : 's'}, ${(totalMb / 1024).toFixed(2)} GB`,
        body: 'That is a lot to ingest at once: openMemo has to read, thumbnail and embed every one of them, which takes a while and uses disk and memory while it runs. They stay on this machine either way.',
        confirmLabel: 'Add them',
      });
      if (!ok) return;
    }

    setBusy(true);
    setError('');
    const arr = Array.from(files);
    setProgress({ done: 0, total: arr.length });
    const failed: string[] = [];
    // Bulk: upload each file independently so one failure doesn't abort the
    // rest. Progress ticks per file.
    for (let i = 0; i < arr.length; i++) {
      try {
        await ingestApi.file(arr[i], collection || undefined, activeSpace || undefined);
      } catch {
        failed.push(arr[i].name);
      }
      setProgress({ done: i + 1, total: arr.length });
    }
    setProgress(null);
    setBusy(false);

    if (failed.length === 0) {
      done();
      return;
    }
    // Some (or all) failed — refresh whatever did import, keep the panel open
    // and report which files failed.
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    const names = failed.slice(0, 3).join(', ') + (failed.length > 3 ? '…' : '');
    setError(`${failed.length} of ${arr.length} failed: ${names}`);
  };

  // Mic recording → upload as audio, with optional background transcription.
  const handleSaveRecording = async (file: File, opts: { transcribe: boolean }) => {
    setBusy(true);
    setError('');
    try {
      await ingestApi.file(file, collection || undefined, activeSpace || undefined, {
        typeOverride: 'audio',
        transcribe: opts.transcribe,
        audioKind: 'voice',
      });
      done();
    } catch (e) {
      setError((e as Error).message || 'Failed to save recording');
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

  // The global corner instance steps aside on bottom-bar pages — the island
  // renders this same component with `embedded` instead (ADR-021).
  if (!embedded && bottomBarPresent) return null;

  return (
    <>
    {confirmModal}
    <aside
      className={cn(embedded ? 'om-add-embedded' : 'om-add-panel', (open || embedded) && 'open')}
      aria-hidden={embedded ? undefined : !open}
    >
      <div className="om-add-head">
        <div className="om-add-head-l">
          <b>New Memo</b>
          {targetSpace ? (
            <span className="om-add-space-chip mono" title={`Saving into the "${targetSpace.name}" Space`}>
              {targetSpace.emoji || '🗂️'} {targetSpace.name}
            </span>
          ) : (
            <span className="om-add-kbd mono">N</span>
          )}
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
              {/* A textarea, not an input: pasting a BLOCK of links (one per
                  line) is the whole point of the carousel flow, and an <input>
                  flattens a multi-line paste into one unreadable line. It grows
                  with the content and stays one row tall for a single URL.
                  Enter still saves; Shift+Enter adds a line. */}
              <div className="om-add-input">
                <Icon name="globe" size={13} />
                <textarea
                  className="om-add-url-area"
                  value={url}
                  rows={Math.min(6, Math.max(1, url.split('\n').length))}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste one URL — or several, one per line…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      save();
                    }
                  }}
                />
              </div>
              {multi ? (
                // Several links pasted at once → the one question worth asking.
                <div className="om-add-pl">
                  <div className="om-add-sect mono">{links.length} links detected</div>
                  <div className="om-add-pl-opts">
                    <button
                      className={cn('om-add-pl-opt', multiMode === 'carousel' && 'active')}
                      onClick={() => setMultiMode('carousel')}
                    >
                      <Icon name="image" size={13} />
                      <span className="om-add-pl-opt-main">
                        <b>One carousel memo</b>
                        <small>
                          All {links.length} images in a single memo you swipe through. Each one is
                          downloaded, so it survives the sources going away.
                        </small>
                      </span>
                    </button>
                    <button
                      className={cn('om-add-pl-opt', multiMode === 'separate' && 'active')}
                      onClick={() => setMultiMode('separate')}
                    >
                      <Icon name="link" size={13} />
                      <span className="om-add-pl-opt-main">
                        <b>Separate memos</b>
                        <small>One memo per link, saved the usual way</small>
                      </span>
                    </button>
                  </div>
                  {multiMode === 'separate' && (
                    <label className="om-switch-row">
                      <input
                        type="checkbox"
                        className="om-switch-input"
                        checked={noPull}
                        onChange={(e) => setNoPull(e.target.checked)}
                      />
                      <span className="om-switch"><span className="om-switch-dot" /></span>
                      <span className="om-switch-label">Don't pull content, just save the links</span>
                    </label>
                  )}
                </div>
              ) : plShape.isPlaylist ? (
                // Playlist-shaped URL → ask: whole playlist or just this one?
                <div className="om-add-pl">
                  {plProbing && !plProbe ? (
                    <p className="om-add-hint mono">Checking playlist…</p>
                  ) : (
                    <>
                      <div className="om-add-sect mono">This link is a playlist</div>
                      <div className="om-add-pl-opts">
                        <button
                          className={cn('om-add-pl-opt', plChoice === 'playlist' && 'active')}
                          onClick={() => setPlChoice('playlist')}
                        >
                          <Icon name="listMusic" size={13} />
                          <span className="om-add-pl-opt-main">
                            <b>Whole playlist</b>
                            <small>
                              {plProbe?.alreadySaved
                                ? `Already in your Music as "${plProbe.alreadySaved.name}". Save opens it, no duplicate.`
                                : plProbe
                                  ? `${plProbe.title} · ${plProbe.count} tracks${plProbe.truncated ? ' (first 100)' : ''}`
                                  : 'Creates a music playlist'}
                            </small>
                          </span>
                        </button>
                        <button
                          className={cn('om-add-pl-opt', plChoice === 'single' && 'active')}
                          onClick={() => setPlChoice('single')}
                        >
                          <Icon name={plShape.hasSingleItem ? 'video' : 'link'} size={13} />
                          <span className="om-add-pl-opt-main">
                            <b>{plShape.hasSingleItem ? 'Just this video' : 'Just this link'}</b>
                            <small>Saves one memo, like any link</small>
                          </span>
                        </button>
                      </div>
                      {plChoice === 'playlist' && (
                        <>
                          <label className="om-switch-row">
                            <input
                              type="checkbox"
                              className="om-switch-input"
                              checked={plDownload}
                              onChange={(e) => setPlDownload(e.target.checked)}
                            />
                            <span className="om-switch"><span className="om-switch-dot" /></span>
                            <span className="om-switch-label">Download tracks to this device now</span>
                          </label>
                          <p className="om-add-hint mono">
                            {plDownload
                              ? 'Tracks download one by one — follow progress on the Music page.'
                              : 'Saves the playlist + track info only. Download per track (or all) from the Music page.'}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <label
                  className="om-switch-row"
                  title={
                    noPull
                      ? 'Saves the bookmark with its title and icon. No preview, no media scrape — for links that fail or that you only want to keep.'
                      : 'Preview, metadata, and a screenshot will be captured automatically.'
                  }
                >
                  <input
                    type="checkbox"
                    className="om-switch-input"
                    checked={noPull}
                    onChange={(e) => setNoPull(e.target.checked)}
                  />
                  <span className="om-switch"><span className="om-switch-dot" /></span>
                  <span className="om-switch-label">
                    Don't pull content, just save the link
                    <Icon name="info" size={11} />
                  </span>
                </label>
              )}
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
              <div className="om-add-segment grid-2x2">
                {[
                  { id: 'image', label: 'Image', icon: 'image' },
                  { id: 'video', label: 'Video', icon: 'video' },
                  { id: 'audio', label: 'Audio', icon: 'mic' },
                  { id: 'file', label: 'File', icon: 'file' },
                ].map((k) => (
                  <button
                    key={k.id}
                    className={cn('om-add-seg', mediaKind === k.id && 'active')}
                    onClick={() => setMediaKind(k.id as 'image' | 'video' | 'audio' | 'file')}
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
                  if (staged.length) stageFiles(e.dataTransfer.files);
                  else uploadFiles(e.dataTransfer.files);
                }}
              >
                <Icon name={mediaKind === 'image' ? 'image' : mediaKind === 'video' ? 'video' : mediaKind === 'audio' ? 'mic' : 'file'} size={20} />
                {progress ? (
                  <>
                    <p>Uploading {progress.done} / {progress.total}…</p>
                    <span className="mono">Keep this panel open until it finishes</span>
                  </>
                ) : staged.length ? (
                  <>
                    <p><b>{staged.length} file{staged.length === 1 ? '' : 's'} ready</b></p>
                    <span className="mono">
                      {staged.slice(0, 3).map((f) => f.name).join(' · ')}{staged.length > 3 ? ' …' : ''} · click or drop to add more
                    </span>
                  </>
                ) : (
                  <>
                    <p>
                      Drop {mediaKind === 'image' ? 'images' : mediaKind === 'video' ? 'videos' : mediaKind === 'audio' ? 'audio files' : 'files'} or{' '}
                      <span className="om-add-link">browse</span>
                    </p>
                    <span className="mono">
                      {mediaKind === 'image' && 'JPG · PNG · WebP · GIF · SVG — select multiple'}
                      {mediaKind === 'video' && 'MP4 · MOV · WebM · MKV — select multiple'}
                      {mediaKind === 'audio' && 'MP3 · WAV · FLAC · M4A · OGG — lossless supported'}
                      {mediaKind === 'file' && 'Any file type — select multiple'}
                    </span>
                  </>
                )}
              </div>
              {staged.length > 0 && (
                <button
                  className="om-add-staged-clear mono"
                  onClick={() => setStaged([])}
                  type="button"
                >
                  Clear {staged.length} staged file{staged.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          )}

          {tab === 'voice' && (
            <VoiceRecorder onSave={handleSaveRecording} busy={busy} />
          )}
        </AnimatedHeight>

        <div className="om-add-sect mono">Collection</div>
        <div className="om-add-coll-wrap">
          <button ref={collBtnRef} className="om-add-select" onClick={toggleColl} aria-expanded={collOpen}>
            <Icon name="folder" size={12} />
            <span>{activeColl ? activeColl.name : 'No collection'}</span>
            <Icon
              name="chevronDown"
              size={10}
              style={{ marginLeft: 'auto', opacity: 0.55, transform: collOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
            />
          </button>
          {collOpen &&
            collPos &&
            createPortal(
              // The layer class also tells IslandFab's click-outside handler
              // these clicks belong to the add flow — not a dismiss.
              <div className="om-add-coll-pop-layer">
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 499 }}
                  onClick={() => setCollOpen(false)}
                />
                <div
                  className="om-add-coll-pop is-portal"
                  role="listbox"
                  aria-label="Choose collection"
                  style={{ position: 'fixed', left: collPos.left, width: collPos.width, bottom: collPos.bottom, zIndex: 500 }}
                >
                  {/* New collection sits at the TOP of the picker — create,
                      then land back in the full list with it selected. */}
                  {creatingColl ? (
                    <div className="om-add-coll-new">
                      <span className="om-add-coll-new-emoji">{collectionEmojiOrDefault(newCollName)}</span>
                      <input
                        className="om-add-coll-new-input"
                        autoFocus
                        value={newCollName}
                        onChange={(e) => setNewCollName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); createColl(); }
                          else if (e.key === 'Escape') { setCreatingColl(false); setNewCollName(''); }
                        }}
                        placeholder="Collection name…"
                      />
                      <button
                        className="om-add-coll-new-go"
                        onClick={createColl}
                        disabled={collBusy || !newCollName.trim()}
                        aria-label="Create collection"
                        title="Create"
                      >
                        <Icon name={collBusy ? 'refresh' : 'check'} size={12} className={collBusy ? 'om-spin' : undefined} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="om-add-coll-opt new"
                      onClick={() => { setNewCollName(''); setCreatingColl(true); }}
                    >
                      <Icon name="plus" size={12} />
                      <span>New collection…</span>
                    </button>
                  )}
                  <button
                    className={cn('om-add-coll-opt', !collection && 'active')}
                    onClick={() => { setCollection(''); setCollOpen(false); }}
                  >
                    <Icon name="inbox" size={11} />
                    <span>No collection</span>
                    <span className="mono" />
                  </button>
                  {collections.map((c: Collection) => (
                    <button
                      key={c.id}
                      className={cn('om-add-coll-opt', collection === c.id && 'active')}
                      onClick={() => { setCollection(c.id); setCollOpen(false); }}
                    >
                      <span>{c.emoji || '📁'}</span>
                      <span>{c.name}</span>
                      <span className="mono" />
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )}
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
        accept={mediaKind === 'image' ? 'image/*' : mediaKind === 'video' ? 'video/*' : mediaKind === 'audio' ? 'audio/*' : undefined}
        hidden
        onChange={(e) => {
          if (staged.length) stageFiles(e.target.files);
          else uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="om-add-foot">
        <button className="om-add-foot-btn ghost" onClick={close}>
          Cancel
        </button>
        {tab !== 'voice' && (
          <button className="om-add-foot-btn primary" onClick={save} disabled={busy}>
            <span>{progress ? (tab === 'link' ? `Saving ${progress.done}/${progress.total}…` : `Uploading ${progress.done}/${progress.total}…`) : busy ? 'Saving…' : tab === 'multimedia' ? (staged.length ? `Add ${staged.length} file${staged.length === 1 ? '' : 's'}` : 'Choose files') : tab === 'link' && multi ? (multiMode === 'carousel' ? `Save carousel (${links.length})` : `Save ${links.length} memos`) : tab === 'link' && plShape.isPlaylist && plChoice === 'playlist' ? (plProbe?.alreadySaved ? 'Open playlist' : 'Save playlist') : 'Save'}</span>
            <span className="mono om-add-kbd-inv">⏎</span>
          </button>
        )}
      </div>
    </aside>
    </>
  );
}
