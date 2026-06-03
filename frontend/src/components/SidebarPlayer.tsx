import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { memoApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useAudioPlayer, formatTime } from '@/lib/audioPlayer';
import { useCoverMood } from '@/lib/coverMood';

// Persistent now-playing surface in the sidebar foot (ADR-005). Replaces the old
// top-right HeaderAudioPlayer; drives the one shared <audio>. Expanded: cover +
// title + scrubber + transport (repeat-one · play/pause · pin). Collapsed: a
// cover thumbnail wrapped in a progress ring so playback stays visible when the
// sidebar is tucked away. Music shows cover art; voice shows a mic glyph.
export function SidebarPlayer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const { track, playing, currentTime, duration, repeat, toggleRepeat, toggle, seek, close } = useAudioPlayer();

  // Pin state seeded from the playing track, toggled optimistically here. Reset
  // during render when the track changes (React's "store info from previous
  // renders" pattern) — no effect, no cascading-render lint warning.
  const [pinned, setPinned] = useState<boolean>(!!track?.pinned);
  const [seenMemo, setSeenMemo] = useState<string | undefined>(track?.memoId);
  // Tint the player to the cover's mood (music only), matching the reference UI.
  const mood = useCoverMood(track?.kind === 'music' ? track?.cover : null);
  if (track && track.memoId !== seenMemo) {
    setSeenMemo(track.memoId);
    setPinned(!!track.pinned);
  }

  if (!track) return null;

  const isMusic = track.kind === 'music';
  const hasDur = Number.isFinite(duration) && duration > 0;
  const pct = hasDur ? Math.min(100, (currentTime / duration) * 100) : 0;

  const goMemo = () => navigate(`/memo/${track.memoId}`);

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

  const cover =
    isMusic && track.cover ? (
      <img
        className="om-sb-player-cover"
        src={track.cover}
        alt=""
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
    ) : (
      <span className="om-sb-player-cover om-sb-player-cover-glyph">
        <Icon name={track.kind === 'voice' ? 'mic' : 'music'} size={collapsed ? 14 : 18} />
      </span>
    );

  // ── Collapsed sidebar: cover + progress ring, tap to play/pause ──
  if (collapsed) {
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

  // ── Expanded sidebar: full mini-player ──
  return (
    <div
      className={cn('om-sb-player', isMusic && 'is-music', mood && 'is-tinted')}
      role="region"
      aria-label="Now playing"
      style={mood ? ({ ['--cov-base']: mood.base, ['--cov-deep']: mood.deep } as React.CSSProperties) : undefined}
    >
      <div className="om-sb-player-head">
        <button className="om-sb-player-cover-btn" onClick={goMemo} title={track.title}>
          {cover}
        </button>
        <button className="om-sb-player-meta" onClick={goMemo} title={track.title}>
          <span className="om-sb-player-title">{track.title}</span>
          {track.subtitle && <span className="om-sb-player-sub">{track.subtitle}</span>}
        </button>
        <button className="om-sb-player-close" onClick={close} aria-label="Close player" title="Close">
          <Icon name="x" size={13} />
        </button>
      </div>

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

      <div className="om-sb-player-transport">
        <button
          className={cn('om-sb-player-btn', repeat && 'active')}
          onClick={toggleRepeat}
          title={repeat ? 'Repeat one: on' : 'Repeat one: off'}
          aria-pressed={repeat}
          aria-label="Repeat one"
        >
          <Icon name="repeat" size={15} />
        </button>
        <button
          className="om-sb-player-play"
          onClick={toggle}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} stroke={0} style={{ fill: 'currentColor' }} />
        </button>
        <button
          className={cn('om-sb-player-btn', pinned && 'active')}
          onClick={onPin}
          title={pinned ? 'Unpin memo' : 'Pin memo'}
          aria-pressed={pinned}
          aria-label="Pin memo"
        >
          <Icon name="pin" size={15} />
        </button>
      </div>
    </div>
  );
}
