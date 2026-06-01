import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAudioPlayer, formatTime } from '@/lib/audioPlayer';

// Persistent mini audio player, pinned top-right of the app shell. Lives in
// Layout (which never unmounts) so it stays visible — playing OR paused —
// across every route until the user closes it. Drives the one shared <audio>.
export function HeaderAudioPlayer() {
  const navigate = useNavigate();
  const { track, playing, currentTime, duration, toggle, seek, close } = useAudioPlayer();

  if (!track) return null;

  const hasDur = Number.isFinite(duration) && duration > 0;
  const pct = hasDur ? Math.min(100, (currentTime / duration) * 100) : 0;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hasDur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(ratio * duration);
  };

  return (
    <div className="om-mini-player" role="region" aria-label="Audio player">
      <button
        className="om-mini-play"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>

      <div className="om-mini-body">
        <button
          className="om-mini-title"
          onClick={() => navigate(`/memo/${track.memoId}`)}
          title={track.title}
        >
          {track.title}
        </button>
        <div className="om-mini-row">
          <span className="om-mini-time mono">{formatTime(currentTime)}</span>
          <div
            className="om-mini-track"
            onClick={onScrub}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            tabIndex={0}
          >
            <div className="om-mini-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="om-mini-time mono">{hasDur ? formatTime(duration) : '--:--'}</span>
        </div>
      </div>

      <button className="om-mini-close" onClick={close} aria-label="Close player" title="Close">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
