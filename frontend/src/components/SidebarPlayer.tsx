import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { memoApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useIsMobile } from '@/lib/useBreakpoint';
import { useAudioPlayer, formatTime } from '@/lib/audioPlayer';
import { useCoverMood } from '@/lib/coverMood';
import { Marquee } from './Marquee';
import { VolumeControl } from './VolumeControl';
import { PlaylistMenu } from './PlaylistMenu';

// Persistent now-playing surface in the sidebar foot (ADR-005). Drives the one
// shared <audio>. Two sizes (appearance pref `playerSize`):
//   • small — cover thumbnail + title + scrubber + transport (default)
//   • big   — full cover on top fading into the cover-mood color, transport below
// Collapsed sidebar → a cover thumbnail in a progress ring. Music shows cover art;
// voice shows a mic glyph. Big needs a cover, so it falls back to small without one.
export function SidebarPlayer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const playerSize = useAppStore((s) => s.tweaks.playerSize);
  const isMobile = useIsMobile();
  const { track, playing, currentTime, duration, repeat, toggleRepeat, toggle, seek, close, next, prev, queueLength, queueIndex, shuffled, toggleShuffle, queueSource } = useAudioPlayer();
  // Up-next popover (ADR-015) — the queue, inspectable and editable in place.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- popover wiring kept for when the queue UI returns
  const [upNextOpen, setUpNextOpen] = useState(false);
  // "Add to playlist" for the playing track (music only).
  const [plMenuOpen, setPlMenuOpen] = useState(false);
  // Big layout: controls fade after ~5s of playback; pointer activity over the
  // player brings them back for another 5s. Paused = always visible.
  const [controlsOn, setControlsOn] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const pokeControls = useCallback(() => {
    setControlsOn(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsOn(false), 5000);
  }, []);
  const showControls = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setControlsOn(true);
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- syncing the fade timer to playback state is exactly an external-system subscription; the setState arms/disarms a timeout */
  useEffect(() => {
    // On touch/mobile the big player is the main now-playing surface — keep its
    // controls always visible rather than auto-hiding them.
    if (playing && !isMobile) pokeControls();
    else showControls();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [playing, isMobile, pokeControls, showControls]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Pin state seeded from the playing track, toggled optimistically here. Reset
  // during render when the track changes (React's "store info from previous
  // renders" pattern) — no effect, no cascading-render lint warning.
  const [pinned, setPinned] = useState<boolean>(!!track?.pinned);
  // Liked state, same optimistic seed/reset pattern as pinned.
  const [liked, setLiked] = useState<boolean>(!!track?.liked);
  const [seenMemo, setSeenMemo] = useState<string | undefined>(track?.memoId);
  // Tint the player to the cover's mood (music only), matching the reference UI.
  const mood = useCoverMood(track?.kind === 'music' ? track?.cover : null);
  if (track && track.memoId !== seenMemo) {
    setSeenMemo(track.memoId);
    setPinned(!!track.pinned);
    setLiked(!!track.liked);
  }

  if (!track) return null;

  const isMusic = track.kind === 'music';
  const hasCover = isMusic && !!track.cover;
  const hasDur = Number.isFinite(duration) && duration > 0;
  const pct = hasDur ? Math.min(100, (currentTime / duration) * 100) : 0;
  const moodStyle = mood
    ? ({ ['--cov-base']: mood.base, ['--cov-deep']: mood.deep } as React.CSSProperties)
    : undefined;

  const goMemo = () => navigate(`/memo/${track.memoId}`);
  // Cover art links to where the queue came from (the playlist); the title
  // keeps linking to the track's memo. Ad-hoc queues fall back to the memo.
  const goCover = () =>
    queueSource?.kind === 'playlist' ? navigate(`/music/${queueSource.id}`) : goMemo();
  const coverTitle = queueSource?.kind === 'playlist' ? 'Open playlist' : track.title;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hasDur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  const onPin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pinned;
    setPinned(next); // optimistic
    try {
      await memoApi.pin(track.memoId, next);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
    } catch {
      setPinned(!next); // revert on failure
    }
  };

  const onLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !liked;
    setLiked(next); // optimistic
    try {
      await memoApi.like(track.memoId, next);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch {
      setLiked(!next); // revert on failure
    }
  };

  const cover = hasCover ? (
    <img
      className="om-sb-player-cover"
      src={track.cover || ''}
      alt=""
      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
    />
  ) : (
    <span className="om-sb-player-cover om-sb-player-cover-glyph">
      <Icon name={track.kind === 'voice' ? 'mic' : 'music'} size={collapsed ? 14 : 16} />
    </span>
  );

  // Scrubber + transport are shared by the small and big layouts.
  const scrub = (
    <div className="om-sb-player-scrub">
      <span className="om-sb-player-time mono">{formatTime(currentTime)}</span>
      <div
        className="om-sb-player-track"
        onClick={onScrub}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
      >
        <div className="om-sb-player-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="om-sb-player-time mono">{hasDur ? formatTime(duration) : '--:--'}</span>
    </div>
  );

  // Queue transport (ADR-015) — prev/next show only while a playlist queue is
  // live. A single track keeps the familiar 4-control row.
  const hasQueue = queueLength > 1;
  const transport = (
    <div className="om-sb-player-transport">
      <VolumeControl className="om-sb-player-vol" size={14} />
      <button
        className={cn('om-sb-player-btn', repeat && 'active')}
        onClick={toggleRepeat}
        title={repeat ? 'Repeat one: on' : 'Repeat one: off'}
        aria-pressed={repeat}
        aria-label="Repeat one"
      >
        <Icon name={repeat ? 'repeat1' : 'repeat'} size={14} />
      </button>
      {hasQueue && (
        <button
          className={cn('om-sb-player-btn', shuffled && 'active')}
          onClick={toggleShuffle}
          title={shuffled ? 'Shuffle: on' : 'Shuffle: off'}
          aria-pressed={shuffled}
          aria-label="Shuffle"
        >
          <Icon name="shuffle" size={14} />
        </button>
      )}
      {hasQueue && (
        <button
          className="om-sb-player-btn"
          onClick={prev}
          disabled={queueIndex <= 0}
          title="Previous track"
          aria-label="Previous track"
        >
          <Icon name="skipBack" size={14} />
        </button>
      )}
      <button
        className="om-sb-player-play"
        onClick={toggle}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} stroke={0} style={{ fill: 'currentColor' }} />
      </button>
      {hasQueue && (
        <button
          className="om-sb-player-btn"
          onClick={next}
          disabled={queueIndex >= queueLength - 1}
          title="Next track"
          aria-label="Next track"
        >
          <Icon name="skipForward" size={14} />
        </button>
      )}
      <button
        className={cn('om-sb-player-btn', pinned && 'active')}
        onClick={onPin}
        title={pinned ? 'Unpin memo' : 'Pin memo'}
        aria-pressed={pinned}
        aria-label="Pin memo"
      >
        <Icon name="pin" size={14} />
      </button>
    </div>
  );

  // Big layout: queue transport lives under the scrubber (the corner cluster
  // stays exactly as ADR-010 placed it).
  const queueRow = hasQueue ? (
    <div className="om-sb-player-queue">
      <button className={cn('om-sb-player-btn', shuffled && 'active')} onClick={toggleShuffle} title={shuffled ? 'Shuffle: on' : 'Shuffle: off'} aria-pressed={shuffled} aria-label="Shuffle">
        <Icon name="shuffle" size={14} />
      </button>
      <button className="om-sb-player-btn" onClick={prev} disabled={queueIndex <= 0} title="Previous track" aria-label="Previous track">
        <Icon name="skipBack" size={14} />
      </button>
      <span
        className="om-sb-player-queue-pos mono"
        style={{ minWidth: `${String(queueLength).length * 2 + 3}ch` }}
      >{queueIndex + 1} / {queueLength}</span>
      <button className="om-sb-player-btn" onClick={next} disabled={queueIndex >= queueLength - 1} title="Next track" aria-label="Next track">
        <Icon name="skipForward" size={14} />
      </button>
      {isMusic && (
        <button
          className={cn('om-sb-player-btn', liked && 'active')}
          onClick={onLike}
          title={liked ? 'Unlike' : 'Like'}
          aria-label={liked ? 'Unlike' : 'Like'}
          aria-pressed={liked}
        >
          <Icon name="heart" size={13} style={liked ? { fill: 'currentColor' } : undefined} />
        </button>
      )}
    </div>
  ) : null;

  // ── Collapsed sidebar: cover + progress ring, tap to play/pause ──
  // Collapse is a desktop-only concept; in the full-screen mobile drawer we skip
  // the mini and always show the full player.
  if (collapsed && !isMobile) {
    const R = 18;
    const C = 2 * Math.PI * R;
    return (
      <button
        className={cn('om-sb-player-mini', playing && 'playing')}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        title={`${track.title}${track.subtitle ? ' — ' + track.subtitle : ''}`}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <svg className="om-sb-player-ring" viewBox="0 0 44 44" aria-hidden>
          <circle className="om-sb-player-ring-bg" cx="22" cy="22" r={R} />
          <circle
            className="om-sb-player-ring-fg"
            cx="22"
            cy="22"
            r={R}
            style={{ strokeDasharray: C, strokeDashoffset: C - (pct / 100) * C }}
          />
        </svg>
        {cover}
        <span className="om-sb-player-mini-badge">
          <Icon name={playing ? 'pause' : 'play'} size={10} stroke={0} style={{ fill: 'currentColor' }} />
        </span>
      </button>
    );
  }

  // ── Big: full cover, corner transport cluster, scrubber + volume below
  //    (ADR-010). Play hugs the top-right corner; pin + repeat are satellites;
  //    the close X moves to the top-LEFT so it never collides with the cluster. ──
  if ((playerSize === 'big' || isMobile) && hasCover) {
    return (
      <div
        className={cn('om-sb-player', 'om-sb-player-big', mood && 'is-tinted', !controlsOn && 'controls-off')}
        role="region"
        aria-label="Now playing"
        style={moodStyle}
        onPointerMove={playing ? pokeControls : undefined}
      >
        <div
          className="om-sb-player-big-cover"
          style={{ backgroundImage: `url(${track.cover})` }}
          onClick={goCover}
          role="button"
          aria-label={queueSource?.kind === 'playlist' ? 'Open playlist' : `Open ${track.title}`}
          title={coverTitle}
        />
        <button className="om-sb-player-big-x" onClick={close} aria-label="Close player" title="Close">
          <Icon name="x" size={14} />
        </button>

        <button
          className="om-sb-player-play om-sb-player-big-play"
          onClick={toggle}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} stroke={0} style={{ fill: 'currentColor' }} />
        </button>
        <button
          className={cn('om-sb-player-sat om-sb-player-big-pin', pinned && 'active')}
          onClick={onPin}
          title={pinned ? 'Unpin memo' : 'Pin memo'}
          aria-pressed={pinned}
          aria-label="Pin memo"
        >
          <Icon name="pin" size={14} />
        </button>
        <button
          className={cn('om-sb-player-sat om-sb-player-big-repeat', repeat && 'active')}
          onClick={toggleRepeat}
          title={repeat ? 'Repeat one: on' : 'Repeat one: off'}
          aria-pressed={repeat}
          aria-label="Repeat one"
        >
          <Icon name={repeat ? 'repeat1' : 'repeat'} size={14} />
        </button>
        {isMusic && (
          <button
            className={cn('om-sb-player-sat om-sb-player-big-addpl', plMenuOpen && 'active')}
            onClick={() => setPlMenuOpen((v) => !v)}
            title="Add to playlist"
            aria-label="Add to playlist"
            aria-expanded={plMenuOpen}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
        {plMenuOpen && <PlaylistMenu memoId={track.memoId} onClose={() => setPlMenuOpen(false)} />}

        <div className="om-sb-player-big-body">
          {queueRow}
          {scrub}
          <VolumeControl size={16}>
            <button className="om-sb-player-big-title" onClick={goMemo}>
              <Marquee text={track.title} auto />
            </button>
          </VolumeControl>
          {(track.subtitle || track.album) && (
            <span className="om-sb-player-big-sub mono">
              <Marquee text={[track.album, track.subtitle].filter(Boolean).join(' — ')} auto />
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Small (default): cover thumbnail + title + scrubber + transport ──
  return (
    <div
      className={cn('om-sb-player', isMusic && 'is-music', mood && 'is-tinted')}
      role="region"
      aria-label="Now playing"
      style={moodStyle}
    >
      <div className="om-sb-player-head">
        <button className="om-sb-player-cover-btn" onClick={goCover} title={coverTitle}>
          {cover}
        </button>
        <button className="om-sb-player-meta" onClick={goMemo}>
          <Marquee text={track.title} className="om-sb-player-title" auto />
        </button>
        {isMusic && (
          <button
            className={cn('om-sb-player-close', plMenuOpen && 'active')}
            onClick={() => setPlMenuOpen((v) => !v)}
            title="Add to playlist"
            aria-label="Add to playlist"
            aria-expanded={plMenuOpen}
          >
            <Icon name="plus" size={13} />
          </button>
        )}
        <button className="om-sb-player-close" onClick={close} aria-label="Close player" title="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      {scrub}
      {transport}
      {plMenuOpen && <PlaylistMenu memoId={track.memoId} onClose={() => setPlMenuOpen(false)} />}
    </div>
  );
}

// Up-next popover — the live queue above the player. Click a row to jump,
// × to drop it from the queue (the playing track can't be removed).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- queue popover, not currently mounted; kept for when the queue UI returns
function UpNext({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { queueTracks, queueIndex, jumpTo, removeAt, playing } = useAudioPlayer();
  if (!open || !queueTracks.length) return null;
  return (
    <>
      <div className="om-upnext-backdrop" onClick={onClose} aria-hidden />
      <div className="om-upnext" role="dialog" aria-label="Up next" data-lenis-prevent>
        <div className="om-upnext-head mono">Up next · {queueIndex + 1} / {queueTracks.length}</div>
        <div className="om-upnext-list">
          {queueTracks.map((t, i) => (
            <div key={`${t.memoId}-${i}`} className={cn('om-upnext-row', i === queueIndex && 'is-current')}>
              <button
                className="om-upnext-main"
                onClick={() => { if (i !== queueIndex) jumpTo(i); }}
                title={i === queueIndex ? 'Now playing' : `Play ${t.title}`}
              >
                <span className="om-upnext-num mono">{i + 1}</span>
                {t.cover ? (
                  <img src={t.cover} alt="" loading="lazy" />
                ) : (
                  <span className="om-upnext-glyph"><Icon name="music" size={12} /></span>
                )}
                <span className="om-upnext-meta">
                  <span className="om-upnext-title">{t.title}</span>
                  {t.subtitle && <span className="om-upnext-sub">{t.subtitle}</span>}
                </span>
                {i === queueIndex && (
                  <Icon name={playing ? 'pause' : 'play'} size={11} className="om-upnext-now" />
                )}
              </button>
              {i !== queueIndex && (
                <button
                  className="om-upnext-x"
                  onClick={() => removeAt(i)}
                  title="Remove from queue"
                  aria-label={`Remove ${t.title} from queue`}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
