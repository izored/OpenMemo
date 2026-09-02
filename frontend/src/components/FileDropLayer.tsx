import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { ingestApi, collectionApi, spaceApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useConfirm } from './ConfirmModal';
import {
  dragHasFiles,
  dragHasText,
  filesFromDataTransfer,
  payloadFromDataTransfer,
  resolveDropTarget,
  isAllAudio,
  isAllImageUrls,
  type DropTarget,
} from '@/lib/fileDrop';

const HUGE = 1024 * 1024 * 1024; // 1 GiB — warn before ingesting monsters.

// The global drag-and-drop layer (ADR-023). Window listeners kill the browser's
// default "open the dropped file" behaviour everywhere, raise a full-viewport
// veil while a drag is in progress, and on drop either ingest straight into the
// current bucket (instant) or stage the payload into the New-Memo panel
// (prefill) per the hybrid commit model. All logic lives on `window`; the veil
// is a passive visual (pointer-events: none) so drops bubble up to one handler.
//
// Two drag shapes reach it (OPNMMO-0052). A Finder/Explorer drag carries
// `Files`. A drag out of a BROWSER — a link, an image, a selection — carries no
// file at all, only `text/uri-list` + `text/html` + `text/plain` strings. Only
// the first was handled, so dropping a link from a web page did nothing useful:
// the layer ignored it, the browser took the event back, and the app navigated
// away from itself to the dropped URL.
type DragKind = 'files' | 'links';

export function FileDropLayer() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeSpace = useAppStore((s) => s.activeSpace);
  const activeCollection = useAppStore((s) => s.activeCollection);
  const setPendingDropFiles = useAppStore((s) => s.setPendingDropFiles);
  const setPendingDropLinks = useAppStore((s) => s.setPendingDropLinks);
  const setAddPanelOpen = useAppStore((s) => s.setAddPanelOpen);
  const showNotice = useAppStore((s) => s.showNotice);
  const [ask, confirmModal] = useConfirm();

  // Collections + Spaces power the veil label only. Cheap, already cached.
  const { data: collections = [] } = useQuery({
    queryKey: ['collections', activeSpace],
    queryFn: () => collectionApi.list(activeSpace || undefined),
  });
  const { data: spaces = [] } = useQuery({ queryKey: ['spaces'], queryFn: spaceApi.list });

  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const [kind, setKind] = useState<DragKind>('files');
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

  // Latest context for the window listeners, refreshed each render so the
  // native handlers never read a stale route/store closure (activeSpace is
  // route-derived and not persisted — ADR-020).
  const ctxRef = useRef({ pathname: location.pathname, activeSpace, activeCollection, collections, spaces });
  ctxRef.current = { pathname: location.pathname, activeSpace, activeCollection, collections, spaces };

  const resolve = (): DropTarget => {
    const c = ctxRef.current;
    const sp = c.spaces.find((s) => s.id === c.activeSpace);
    return resolveDropTarget({
      pathname: c.pathname,
      activeSpace: c.activeSpace,
      activeCollection: c.activeCollection,
      collections: c.collections,
      spaceName: sp?.name ?? null,
      spaceEmoji: sp?.emoji ?? null,
    });
  };

  const dispatch = async (files: File[], t: DropTarget) => {
    if (!files.length) return;

    // Prefill branch — hand the files to the New-Memo panel and let the user
    // pick a home + tags. No upload here (ADR-023 §4).
    if (t.mode === 'prefill') {
      setPendingDropFiles(files);
      setAddPanelOpen(true);
      return;
    }

    // Instant branch — upload straight to the resolved bucket.
    const bytes = files.reduce((s, f) => s + f.size, 0);
    if (bytes >= HUGE) {
      const ok = await ask({
        title: `${files.length} file${files.length === 1 ? '' : 's'}, ${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
        body: 'That is a lot to ingest at once: openMemo has to read, thumbnail and embed every one of them, which takes a while and uses disk and memory while it runs. They stay on this machine either way.',
        confirmLabel: 'Add them',
      });
      if (!ok) return;
    }

    // Music page + pure audio → one auto-grouped album/playlist request.
    if (t.scope === 'music' && isAllAudio(files)) {
      setUploading({ done: 0, total: files.length });
      try {
        const res = await ingestApi.album(files, { workspace_id: t.workspaceId });
        queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
        queryClient.invalidateQueries({ queryKey: ['memos'] });
        showNotice(`Added ${res.total} track${res.total === 1 ? '' : 's'} to your music`, 'info');
      } catch (e) {
        showNotice((e as Error).message || 'Album upload failed', 'error');
      } finally {
        setUploading(null);
      }
      return;
    }

    // Everything else → one memo per file, uploaded independently so one
    // failure doesn't abort the batch.
    setUploading({ done: 0, total: files.length });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        await ingestApi.file(files[i], t.collectionId, t.workspaceId);
      } catch {
        failed.push(files[i].name);
      }
      setUploading({ done: i + 1, total: files.length });
    }
    setUploading(null);

    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['collections'] });
    if (t.workspaceId) {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space', t.workspaceId] });
    }

    const ok = files.length - failed.length;
    if (failed.length === 0) {
      showNotice(`Added ${ok} file${ok === 1 ? '' : 's'} to ${t.label}`, 'info');
    } else {
      const names = failed.slice(0, 3).join(', ') + (failed.length > 3 ? '…' : '');
      showNotice(`${failed.length} of ${files.length} failed: ${names}`, 'error');
    }
  };

  // Everything an add invalidates, in one place — both dispatchers need it.
  const refreshAfterAdd = (t: DropTarget) => {
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['collections'] });
    if (t.scope === 'music') queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    if (t.workspaceId) {
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      queryClient.invalidateQueries({ queryKey: ['space', t.workspaceId] });
    }
  };

  // A link / image / selection dragged out of a browser. Same hybrid commit as
  // files: a clear bucket ingests immediately, an ambiguous surface prefills.
  const dispatchLinks = async (payload: { urls: string[]; text: string }, t: DropTarget) => {
    const { urls, text } = payload;
    if (!urls.length && !text) return;

    // Prefill branch, and the only home for a dragged text selection — a note
    // needs a title and a home, which is exactly what the panel asks for.
    if (t.mode === 'prefill' || !urls.length) {
      setPendingDropLinks({ urls, text });
      setAddPanelOpen(true);
      return;
    }

    // The Music page pulls a dropped link as audio, matching what its own "+"
    // does with a pasted link — dropping a track on Music means "this is music".
    const audioOnly = t.scope === 'music';

    // Several image links at once → one carousel memo, the same shape the Link
    // tab produces for a multi-link paste. Anything else is one memo per link.
    if (!audioOnly && urls.length > 1 && isAllImageUrls(urls)) {
      setUploading({ done: 0, total: urls.length });
      try {
        const res = await ingestApi.gallery(urls, {
          collection_id: t.collectionId,
          workspace_id: t.workspaceId,
        });
        showNotice(
          res.failed?.length
            ? `Saved ${res.slides} of ${urls.length} pictures to ${t.label}`
            : `Saved ${res.slides} pictures to ${t.label}`,
          res.failed?.length ? 'error' : 'info',
        );
      } catch (e) {
        showNotice((e as Error).message || 'Could not save those pictures', 'error');
      } finally {
        setUploading(null);
      }
      refreshAfterAdd(t);
      return;
    }

    setUploading({ done: 0, total: urls.length });
    const failed: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        await ingestApi.url(urls[i], t.collectionId, {
          audioOnly,
          workspace_id: t.workspaceId,
        });
      } catch {
        failed.push(urls[i]);
      }
      setUploading({ done: i + 1, total: urls.length });
    }
    setUploading(null);
    refreshAfterAdd(t);

    const ok = urls.length - failed.length;
    if (failed.length === 0) {
      showNotice(`Saved ${ok} link${ok === 1 ? '' : 's'} to ${t.label}`, 'info');
    } else {
      showNotice(`${failed.length} of ${urls.length} links could not be saved`, 'error');
    }
  };

  useEffect(() => {
    // Panels own their own dropzones (AddMemoPanel Media tab, MusicAddModal).
    // While one is open the global layer stays out of the way — it still kills
    // the browser hijack, but never ingests or shows its veil.
    const suppressed = () => useAppStore.getState().addPanelOpen || useAppStore.getState().musicModalOpen;

    let depth = 0;
    // Anchors and images inside openMemo are natively draggable, so dragging a
    // memo card's link across the app produces a text/uri-list drag that looks
    // exactly like one from another window. A drag that STARTED in this
    // document is never an import. (dnd-kit's card reorder is pointer-driven
    // and carries no DataTransfer at all, so it never reaches this code.)
    let internal = false;

    // A drag shape this layer recognises, whoever started it. Cancelling is
    // decided from THIS, never from `kindOf`. See `onOver`.
    const shapeOf = (dt: DataTransfer | null): DragKind | null => {
      if (dragHasFiles(dt)) return 'files';
      if (dragHasText(dt)) return 'links';
      return null;
    };

    // What is being dragged for INGEST purposes, or null for "not ours".
    const kindOf = (dt: DataTransfer | null): DragKind | null => {
      const shape = shapeOf(dt);
      return shape === 'links' && internal ? null : shape;
    };

    const onStart = () => { internal = true; };

    // Nothing arrived for a beat, so the drag is over even though the event
    // that says so never came. `dragleave` is missed outright when the pointer
    // leaves the window fast enough, and `dragend` only fires for a drag that
    // started here. Between them the veil could stay up over a live app with
    // no way down but a reload. `dragover` repeats every few frames while a
    // drag is over the window, so silence is the reliable end-of-drag signal.
    let idle: ReturnType<typeof setTimeout> | null = null;
    const clearIdle = () => { if (idle) { clearTimeout(idle); idle = null; } };
    const armIdle = () => {
      clearIdle();
      idle = setTimeout(() => { depth = 0; setActive(false); }, 400);
    };

    const onEnter = (e: DragEvent) => {
      if (!shapeOf(e.dataTransfer)) return;
      e.preventDefault();
      const k = kindOf(e.dataTransfer);
      if (!k) return;
      // Depth is counted for every drag we would ingest and dropped only by the
      // matching leave, so the two stay symmetric. `suppressed()` gates the
      // veil alone: gating the count too let a panel opening mid-drag strand it
      // above zero, and a count that never returns to zero is a stuck veil.
      depth++;
      if (depth !== 1 || suppressed()) return;
      // A link drag has no item count worth showing, since the payload is
      // unreadable until drop, by spec.
      const items = k === 'files' ? e.dataTransfer?.items : null;
      setCount(items ? Array.from(items).filter((it) => it.kind === 'file').length : 0);
      setKind(k);
      setTarget(resolve());
      setActive(true);
    };

    const onOver = (e: DragEvent) => {
      const shape = shapeOf(e.dataTransfer);
      if (!shape) return;
      // preventDefault on dragover is REQUIRED, and it is required for drags we
      // will NOT ingest too. `drop` only fires on an element that accepted the
      // drag here; skip this and the browser keeps the gesture and performs its
      // own default, which for the image or link a memo card was carrying means
      // navigating the tab clean out of the app. That is the blank page a fast
      // card drag used to leave behind: dnd-kit lost the race to the browser's
      // native image drag, and openMemo then let the browser have it.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = kindOf(e.dataTransfer) ? 'copy' : 'none';
      if (kindOf(e.dataTransfer)) armIdle();
    };

    const onLeave = (e: DragEvent) => {
      if (!kindOf(e.dataTransfer)) return;
      // dragleave fires per descendant; only hide once the pointer has truly
      // left the window (depth back to zero).
      depth = Math.max(0, depth - 1);
      if (depth === 0) { clearIdle(); setActive(false); }
    };

    const onDrop = (e: DragEvent) => {
      const shape = shapeOf(e.dataTransfer);
      const k = kindOf(e.dataTransfer);
      // Stop the browser from opening or navigating to whatever was released,
      // an internal drag included, since that is the one that would land on our
      // own file route and take the app down with it.
      if (shape) e.preventDefault();
      depth = 0;
      internal = false;
      clearIdle();
      setActive(false);
      if (!k || suppressed()) return;
      const t = resolve();
      if (k === 'files') {
        void dispatch(filesFromDataTransfer(e.dataTransfer), t);
      } else {
        const payload = payloadFromDataTransfer(e.dataTransfer);
        void dispatchLinks({ urls: payload.urls, text: payload.text }, t);
      }
    };

    // Some browsers fire a final dragend without a matching dragleave.
    const onEnd = () => { depth = 0; internal = false; clearIdle(); setActive(false); };

    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
      clearIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read live state via ctxRef / getState; bind once.
  }, []);

  return (
    <>
      {confirmModal}
      {active && (
        <div className="om-dropveil" aria-hidden>
          <div className="om-dropveil-card">
            <div className="om-dropveil-icon">
              <Icon name={kind === 'links' ? 'link' : 'upload'} size={26} />
            </div>
            <p className="om-dropveil-title">{kind === 'links' ? 'Drop to save the link' : 'Drop to add'}</p>
            <p className="om-dropveil-sub mono">
              {target?.mode === 'prefill'
                ? 'Choose a collection before saving'
                : <>Into <b>{target?.label}</b></>}
              {count > 0 && <> · {count} file{count === 1 ? '' : 's'}</>}
            </p>
          </div>
        </div>
      )}

      {uploading && (
        <div className="om-drop-progress" role="status" aria-live="polite">
          <Icon name="upload" size={14} />
          <span>Uploading {uploading.done} / {uploading.total}…</span>
        </div>
      )}
    </>
  );
}
