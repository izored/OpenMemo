import { useRef, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MemoGrid } from '@/components/MemoGrid';
import { Icon } from '@/components/Icon';
import { musicApi, memoApi, collectionApi } from '@/lib/api';
import { useAudioPlayer, type AudioTrack } from '@/lib/audioPlayer';
import { useAppStore } from '@/stores/appStore';
import { useDndBus } from '@/lib/dndBus';
import { cn } from '@/lib/utils';
import type { Memo, MusicPlaylist } from '@/types';

// The Music page (Music Experience V2, OPNMMO-0023 / ADR-015).
//   /music            → hub: playlists row + the full music library grid
//   /music/:playlistId → playlist view: collage hero + numbered track list
// Tracks are plain audio memos (audio_kind=music); playlists are
// playlist-kind collections, invisible everywhere else.

function memoToTrack(m: Memo): AudioTrack {
  return {
    memoId: m.id,
    title: m.title,
    src: `/api/memos/${m.id}/file`,
    subtitle: m.audio_artist || m.source_domain || undefined,
    kind: 'music',
    cover: m.thumbnail_path || null,
    pinned: m.pinned,
  };
}

/** A track is playable once its file landed (download done or local upload). */
function isReady(m: Memo): boolean {
  return !!m.file_path || m.localize_status === 'done';
}

function PlaylistCover({ covers, size = 'md' }: { covers: string[]; size?: 'md' | 'lg' }) {
  return (
    <div className={cn('om-pl-cover', `om-pl-cover-${size}`, covers.length < 4 && 'few')}>
      {covers.length === 0 && (
        <span className="om-pl-cover-glyph"><Icon name="music" size={size === 'lg' ? 28 : 22} /></span>
      )}
      {covers.length > 0 && covers.length < 4 && (
        <img src={covers[0]} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
      )}
      {covers.length >= 4 &&
        covers.slice(0, 4).map((c, i) => (
          <img key={i} src={c} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        ))}
    </div>
  );
}

function PlaylistCard({ p, onOpen, onPlay }: { p: MusicPlaylist; onOpen: () => void; onPlay: () => void }) {
  // Droppable under the same `col-` namespace the sidebar uses, so dragging a
  // track card from the library files it into the playlist — same gesture,
  // same MemoGrid handler, zero new wiring.
  const { isOver, setNodeRef } = useDroppable({ id: `col-${p.id}` });
  // Active downloads only — a playlist saved without downloading is not
  // "stuck at 0%", it's simply remote (meta says how many are local).
  const downloading = p.progress.pending > 0;
  const pct = p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
  const meta = downloading
    ? `${p.progress.done} / ${p.progress.total} downloaded`
    : p.progress.done < p.track_count
      ? `${p.track_count} track${p.track_count === 1 ? '' : 's'} · ${p.progress.done} local`
      : `${p.track_count} track${p.track_count === 1 ? '' : 's'}`;
  return (
    <div
      ref={setNodeRef}
      className={cn('om-pl-card', isOver && 'drop-over')}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="om-pl-card-art">
        <PlaylistCover covers={p.covers} />
        <button
          className="om-pl-card-play"
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          title="Play playlist"
          aria-label={`Play ${p.name}`}
        >
          <Icon name="play" size={16} stroke={0} style={{ fill: 'currentColor', marginLeft: 2 }} />
        </button>
      </div>
      <div className="om-pl-card-body">
        <span className="om-pl-card-name">{p.name}</span>
        <span className="om-pl-card-meta mono">
          {meta}
          {p.progress.error > 0 && <span className="om-pl-card-err"> · {p.progress.error} failed</span>}
        </span>
        {downloading && (
          <span className="om-pl-card-bar"><span style={{ width: `${pct}%` }} /></span>
        )}
      </div>
    </div>
  );
}

// Full-bleed cover tile for a playlist track (user feedback on 0023): the
// artwork is the whole tile, title rides a bottom gradient, play on hover.
// Remote tracks (saved without downloading) carry an explicit download chip —
// like any music app; downloading/failed states show in the same spot.
function MusicTile({ m, index, active, playing, onPlay, onDownload, onRemove }: {
  m: Memo; index: number; active: boolean; playing: boolean;
  onPlay: () => void; onDownload: () => void; onRemove: () => void;
}) {
  const ready = isReady(m);
  const failed = m.localize_status === 'error';
  const fetching = m.localize_status === 'pending' || m.localize_status === 'processing';
  const remote = !ready && !failed && !fetching;
  return (
    <button
      className={cn('om-mtile', active && 'is-active', fetching && 'is-pending')}
      onClick={onPlay}
      disabled={fetching}
      title={ready ? `Play ${m.title}` : failed ? 'Download failed — tap the chip to retry' : fetching ? 'Downloading…' : 'Remote track — open it, or tap the chip to download'}
    >
      {m.thumbnail_path ? (
        <img className="om-mtile-img" src={m.thumbnail_path} alt="" loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
      ) : (
        <span className="om-mtile-glyph"><Icon name="music" size={26} /></span>
      )}
      <span className="om-mtile-num mono">{index + 1}</span>
      <span
        className="om-mtile-remove"
        role="button"
        tabIndex={0}
        title="Remove from this playlist (the song stays saved)"
        aria-label={`Remove ${m.title} from this playlist`}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRemove(); } }}
      >
        <Icon name="x" size={11} />
      </span>
      {failed ? (
        <span
          className="om-mtile-state failed is-action"
          role="button"
          title="Retry download"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
        >
          <Icon name="refresh" size={10} /> retry
        </span>
      ) : fetching ? (
        <span className="om-mtile-state"><Icon name="refresh" size={10} className="om-spin" /> downloading</span>
      ) : remote ? (
        <span
          className="om-mtile-state is-action"
          role="button"
          title="Download this track"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
        >
          <Icon name="download" size={10} /> download
        </span>
      ) : null}
      {ready && (
        <span className="om-mtile-play" aria-hidden>
          <span className="om-mtile-play-badge">
            <Icon name={active && playing ? 'pause' : 'play'} size={16} stroke={0} style={{ fill: 'currentColor', marginLeft: active && playing ? 0 : 2 }} />
          </span>
        </span>
      )}
      <span className="om-mtile-cap">
        <span className="om-mtile-title">{m.title}</span>
        {m.audio_artist && <span className="om-mtile-artist">{m.audio_artist}</span>}
      </span>
    </button>
  );
}

// Sortable wrapper for a playlist tile — same app-level DndContext the cards
// use (distance: 8 keeps clicks working; see CLAUDE.md).
function SortableTile({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(listeners || {})}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      {children}
    </div>
  );
}

export function MusicPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playlistId } = useParams();
  const setAddPanelOpen = useAppStore((s) => s.setAddPanelOpen);
  const { playQueue, toggle, isActive, playing } = useAudioPlayer();

  const { data: playlists = [] } = useQuery({
    queryKey: ['music-playlists'],
    queryFn: musicApi.playlists,
    // Live progress while any playlist is still downloading; idle otherwise.
    refetchInterval: (q) => {
      const d = q.state.data as MusicPlaylist[] | undefined;
      return d?.some((p) => p.progress.pending > 0) ? 2500 : false;
    },
  });
  const anyDownloading = playlists.some((p) => p.progress.pending > 0);

  // Library search + sort. Search debounces (no request per keystroke) and
  // both feed the server: `search` is the same title/content filter the list
  // API already had, `sort` is the new recent/title/artist order.
  const [libSearch, setLibSearch] = useState('');
  const [libQuery, setLibQuery] = useState('');
  const [libSort, setLibSort] = useState<'recent' | 'title' | 'artist'>('recent');
  useEffect(() => {
    const t = setTimeout(() => setLibQuery(libSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [libSearch]);

  // The library: standalone music memos only (same infinite pattern as the
  // dashboard). Playlist tracks are excluded server-side and live inside
  // their playlist view. Polls along with playlist progress so a deleted
  // playlist's freed tracks pop in.
  const {
    data: libData,
    isLoading: libLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['memos', 'music-library', libQuery, libSort],
    queryFn: ({ pageParam }) =>
      memoApi.list({
        type: 'audio',
        audio_kind: 'music',
        search: libQuery || undefined,
        sort: libSort,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    refetchInterval: anyDownloading ? 4000 : false,
    staleTime: 60 * 1000,
  });
  const library: Memo[] = libData?.pages.flatMap((p) => p.items) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Tracks of the open playlist (playlist order = recency stagger, see ingest).
  const { data: plTracks, isLoading: tracksLoading } = useQuery({
    queryKey: ['memos', 'playlist-tracks', playlistId],
    queryFn: () =>
      memoApi.list({ type: 'audio', collection_id: playlistId!, limit: 200 }),
    enabled: !!playlistId,
    refetchInterval: anyDownloading ? 2500 : false,
  });
  const tracks: Memo[] = plTracks?.items ?? [];

  // Drag-to-reorder (playlist view). Local order mirrors the server list,
  // diverges while a drag is live, and persists on drop by rewriting the
  // recency stagger — the exact trick the dashboard grid uses.
  const dndBus = useDndBus();
  const [orderedTracks, setOrderedTracks] = useState<Memo[]>([]);
  const orderRef = useRef<Memo[]>([]);
  const draggingRef = useRef(false);
  // Server list wins whenever no drag is live (same guard MemoGrid uses).
  useEffect(() => {
    if (draggingRef.current) return;
    const list: Memo[] = plTracks?.items ?? [];
    setOrderedTracks(list);
    orderRef.current = list;
  }, [plTracks]);

  // eslint-disable-next-line react-hooks/immutability -- effect intentionally writes the shared handler-bus ref each render to keep handlers fresh (CLAUDE.md dnd bus)
  useEffect(() => {
    if (!dndBus || !playlistId) return;
    // eslint-disable-next-line react-hooks/immutability -- intentional cross-component handler bus shared via a ref (see CLAUDE.md dnd bus)
    dndBus.current = {
      onDragStart: () => {
        draggingRef.current = true;
      },
      onDragOver: (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = orderRef.current.findIndex((m) => m.id === active.id);
        const newIndex = orderRef.current.findIndex((m) => m.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        orderRef.current = arrayMove(orderRef.current, oldIndex, newIndex);
        setOrderedTracks([...orderRef.current]);
      },
      onDragEnd: () => {
        const final = orderRef.current;
        if (!final.length) {
          draggingRef.current = false;
          return;
        }
        // Top track gets NOW, each next 1s earlier — dragged order persists,
        // and a memo added later still lands on top of the playlist.
        const base = Date.now();
        Promise.all(
          final.map((m, i) => memoApi.setRecency(m.id, new Date(base - i * 1000).toISOString())),
        )
          .catch(() => { /* refetch below restores the server truth */ })
          .finally(() => {
            draggingRef.current = false;
            queryClient.invalidateQueries({ queryKey: ['memos'] });
          });
      },
    };
    return () => {
      if (dndBus) dndBus.current = {};
    };
  });

  const queueFrom = (all: Memo[], startMemo?: Memo, opts?: { shuffle?: boolean }) => {
    const ready = all.filter(isReady);
    if (!ready.length) return;
    const start = startMemo ? ready.findIndex((m) => m.id === startMemo.id) : 0;
    playQueue(ready.map(memoToTrack), Math.max(0, start), opts);
  };

  const playPlaylist = async (p: MusicPlaylist, opts?: { shuffle?: boolean }) => {
    const res = await queryClient.fetchQuery({
      queryKey: ['memos', 'playlist-tracks', p.id],
      queryFn: () => memoApi.list({ type: 'audio', collection_id: p.id, limit: 200 }),
      staleTime: 10 * 1000,
    });
    queueFrom(res.items as Memo[], undefined, opts);
  };

  // Play the library as a queue — what you see is what queues (current
  // search + sort), fetched fresh up to the same 200-track cap playlists use.
  const playLibrary = async (opts?: { shuffle?: boolean }) => {
    const res = await queryClient.fetchQuery({
      queryKey: ['memos', 'music-library-queue', libQuery, libSort],
      queryFn: () =>
        memoApi.list({
          type: 'audio',
          audio_kind: 'music',
          search: libQuery || undefined,
          sort: libSort,
          limit: 200,
        }),
      staleTime: 10 * 1000,
    });
    queueFrom(res.items as Memo[], undefined, opts);
  };

  // Pull a track out of the open playlist. The memo survives — playlist-born
  // tracks resurface in the library, dragged-in ones never left it.
  const removeFromPlaylist = async (m: Memo) => {
    if (!playlistId) return;
    try {
      await collectionApi.removeMemo(playlistId, m.id);
    } catch { /* surfaced by the queries refetching */ }
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
  };

  // Per-track "download locally" — same Make-it-local pipeline, one track.
  const downloadTrack = async (m: Memo) => {
    try {
      await memoApi.localize(m.id, 'audio');
    } catch { /* surfaced by polling */ }
    queryClient.invalidateQueries({ queryKey: ['memos', 'playlist-tracks'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
  };

  const downloadAll = async (p: MusicPlaylist) => {
    try {
      await musicApi.downloadPlaylist(p.id);
    } catch { /* surfaced by polling */ }
    queryClient.invalidateQueries({ queryKey: ['memos', 'playlist-tracks'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
  };

  // Create an empty playlist right on the page — no URL, no memo needed.
  const [creatingPl, setCreatingPl] = useState(false);
  const [newPlName, setNewPlName] = useState('');
  const createPlaylist = async () => {
    const name = newPlName.trim();
    if (!name) return;
    try {
      const created = await collectionApi.create({ name, kind: 'playlist' });
      setNewPlName('');
      setCreatingPl(false);
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
      navigate(`/music/${created.id}`);
    } catch { /* keep the input so the name survives a retry */ }
  };

  const deletePlaylist = async (p: MusicPlaylist) => {
    const ok = window.confirm(
      `Delete the playlist "${p.name}"?\n\nIts ${p.track_count} track(s) move back to your music library. Only the playlist goes.`,
    );
    if (!ok) return;
    await collectionApi.delete(p.id);
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    navigate('/music');
  };

  // ── Playlist view (/music/:playlistId) ──
  if (playlistId) {
    const playlist = playlists.find((p) => p.id === playlistId);
    const trackTotal = playlist?.track_count ?? tracks.length;
    const downloading = (playlist?.progress.pending ?? 0) > 0;
    // Any track still remote (not local, not actively downloading)?
    const hasRemote = tracks.some((t) => !isReady(t) && t.localize_status !== 'pending' && t.localize_status !== 'processing');
    return (
      <div className="om-music">
        <button className="om-music-back" onClick={() => navigate('/music')} title="Back to Music">
          <Icon name="chevronLeft" size={14} />
          <span>Back to Music</span>
        </button>

        <header className="om-pl-hero">
          <PlaylistCover covers={playlist?.covers ?? tracks.filter((t) => t.thumbnail_path).slice(0, 4).map((t) => t.thumbnail_path!)} size="lg" />
          <div className="om-pl-hero-body">
            <span className="om-greet-eyebrow mono">
              Playlist · {trackTotal} track{trackTotal === 1 ? '' : 's'}
              {downloading && playlist && ` · ${playlist.progress.done}/${playlist.progress.total} downloaded`}
            </span>
            <h1 className="om-greet-title">{playlist?.name ?? 'Playlist'}</h1>
            <div className="om-pl-hero-actions">
              <button
                className="om-btn-primary om-pl-playall"
                onClick={() => queueFrom(orderedTracks)}
                disabled={!tracks.some(isReady)}
              >
                <Icon name="play" size={13} stroke={0} style={{ fill: 'currentColor' }} />
                <span>Play all</span>
              </button>
              <button
                className="om-btn-secondary"
                onClick={() => queueFrom(orderedTracks, undefined, { shuffle: true })}
                disabled={!tracks.some(isReady)}
                title="Play this playlist in random order"
              >
                <Icon name="shuffle" size={13} />
                <span>Shuffle</span>
              </button>
              {playlist && hasRemote && !downloading && (
                <button className="om-btn-secondary" onClick={() => downloadAll(playlist)} title="Download every remote track to this device">
                  <Icon name="download" size={13} />
                  <span>Download all</span>
                </button>
              )}
              {playlist?.source_url && (
                <a className="om-btn-secondary" href={playlist.source_url} target="_blank" rel="noreferrer" title="Open the source playlist">
                  <Icon name="arrowUpRight" size={13} />
                  <span>Source</span>
                </a>
              )}
              {playlist && (
                <button className="om-btn-secondary om-pl-delete" onClick={() => deletePlaylist(playlist)} title="Delete playlist (tracks stay)">
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Which playlist the tiles below belong to — spelled out, no guessing. */}
        <div className="om-section-head" style={{ marginBottom: 12 }}>
          <span className="om-section-label mono">Tracks in “{playlist?.name ?? 'this playlist'}”</span>
          <Icon name="listMusic" size={11} className="om-section-icon" />
        </div>

        {tracksLoading ? (
          <div className="om-empty"><div className="om-empty-mark"><Icon name="refresh" size={24} /></div><p>Loading tracks…</p></div>
        ) : tracks.length === 0 ? (
          <div className="om-empty">
            <div className="om-empty-mark"><Icon name="music" size={24} /></div>
            <p>No tracks in this playlist yet. Drag a song from the library onto its card.</p>
          </div>
        ) : (
          <SortableContext items={orderedTracks.map((m) => m.id)} strategy={rectSortingStrategy}>
            <div className="om-track-grid">
              {orderedTracks.map((m, i) => (
                <SortableTile key={m.id} id={m.id}>
                  <MusicTile
                    m={m}
                    index={i}
                    active={isActive(m.id)}
                    playing={isActive(m.id) && playing}
                    onPlay={() => {
                      if (isActive(m.id)) toggle();
                      else if (isReady(m)) queueFrom(orderedTracks, m);
                      // Remote / failed → open the memo (embed, Make-it-local, error
                      // detail). Downloads stay behind the explicit chip.
                      else navigate(`/memo/${m.id}`);
                    }}
                    onDownload={() => downloadTrack(m)}
                    onRemove={() => removeFromPlaylist(m)}
                  />
                </SortableTile>
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    );
  }

  // ── Hub view (/music) ──
  return (
    <div className="om-music">
      {/* Same header skeleton as the dashboard — adding music goes through the
          global FAB / New Memo panel, no extra chrome here. */}
      <header className="om-header om-music-head">
        <div className="om-greet">
          <span className="om-greet-eyebrow mono">Music library</span>
          <h1 className="om-greet-title">Music</h1>
          <p className="om-greet-sub">Every song you saved, ready to play.</p>
        </div>
      </header>

      <section className="om-music-sect">
        <div className="om-section-head">
          <span className="om-section-label mono">Playlists</span>
          <span className="om-lib-actions">
            {creatingPl ? (
              <span className="om-lib-search">
                <Icon name="listMusic" size={11} />
                <input
                  autoFocus
                  value={newPlName}
                  onChange={(e) => setNewPlName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createPlaylist();
                    if (e.key === 'Escape') { setCreatingPl(false); setNewPlName(''); }
                  }}
                  placeholder="Playlist name"
                  maxLength={200}
                  aria-label="New playlist name"
                />
                <button className="om-lib-search-x" onClick={createPlaylist} disabled={!newPlName.trim()} title="Create playlist" aria-label="Create playlist">
                  <Icon name="check" size={10} />
                </button>
              </span>
            ) : (
              <button className="om-lib-act" onClick={() => setCreatingPl(true)} title="Create an empty playlist">
                <Icon name="plus" size={11} />
                <span>New playlist</span>
              </button>
            )}
            <Icon name="listMusic" size={11} className="om-section-icon" />
          </span>
        </div>
        {playlists.length === 0 ? (
          <div className="om-pl-empty">
            <Icon name="listMusic" size={18} />
            <p>
              No playlists yet. Create one here, or paste a YouTube Music playlist link into{' '}
              <button className="om-add-link" onClick={() => setAddPanelOpen(true)}>New Memo</button>{' '}
              and pick “whole playlist”.
            </p>
          </div>
        ) : (
          <div className="om-pl-row" data-lenis-prevent>
            {playlists.map((p) => (
              <PlaylistCard
                key={p.id}
                p={p}
                onOpen={() => navigate(`/music/${p.id}`)}
                onPlay={() => playPlaylist(p)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="om-music-sect">
        <div className="om-section-head">
          <span className="om-section-label mono">Library</span>
          <span className="om-lib-actions">
            <span className="om-lib-search">
              <Icon name="search" size={11} />
              <input
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                placeholder="Search songs"
                aria-label="Search the music library"
              />
              {libSearch && (
                <button className="om-lib-search-x" onClick={() => setLibSearch('')} title="Clear search" aria-label="Clear search">
                  <Icon name="x" size={10} />
                </button>
              )}
            </span>
            <select
              className="om-lib-sort mono"
              value={libSort}
              onChange={(e) => setLibSort(e.target.value as 'recent' | 'title' | 'artist')}
              title="Sort the library"
              aria-label="Sort the library"
            >
              <option value="recent">Recent</option>
              <option value="title">Title A–Z</option>
              <option value="artist">Artist A–Z</option>
            </select>
            <button
              className="om-lib-act"
              onClick={() => playLibrary()}
              disabled={!library.some(isReady)}
              title="Play the whole library"
            >
              <Icon name="play" size={11} stroke={0} style={{ fill: 'currentColor' }} />
              <span>Play all</span>
            </button>
            <button
              className="om-lib-act"
              onClick={() => playLibrary({ shuffle: true })}
              disabled={!library.some(isReady)}
              title="Play the library in random order"
            >
              <Icon name="shuffle" size={11} />
              <span>Shuffle</span>
            </button>
            <Icon name="music" size={11} className="om-section-icon" />
          </span>
        </div>
        {libLoading ? (
          <div className="om-empty"><div className="om-empty-mark"><Icon name="refresh" size={24} /></div><p>Loading music…</p></div>
        ) : library.length === 0 && libQuery ? (
          <div className="om-empty">
            <div className="om-empty-mark"><Icon name="search" size={24} /></div>
            <p>No songs match “{libQuery}”.</p>
          </div>
        ) : library.length === 0 ? (
          <div className="om-empty">
            <div className="om-empty-mark"><Icon name="music" size={26} /></div>
            <span className="mono om-greet-eyebrow">Nothing here yet</span>
            <h2>No music yet</h2>
            <p>Paste a track link or upload audio files. Whole playlists keep their tracks on the shelf above.</p>
          </div>
        ) : (
          <>
            <MemoGrid memos={library} />
            <div ref={sentinelRef} style={{ height: 1 }} />
            {isFetchingNextPage && (
              <div className="om-empty"><div className="om-empty-mark"><Icon name="refresh" size={24} /></div><p>Loading more…</p></div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
