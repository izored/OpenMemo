import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Single, app-wide audio player. One <audio> element lives in the provider
// (mounted in Layout, which never unmounts across route changes) so playback
// survives navigation — open a memo, hit back, the track keeps playing and the
// header mini-player stays visible. Cards and the detail page drive the same
// element through this context; there is never a second <audio> competing.

export interface AudioTrack {
  memoId: string;
  title: string;
  src: string;
  subtitle?: string;
}

interface AudioPlayerContextValue {
  track: AudioTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  /** Load + play a track. If it is already the active track, toggle play/pause. */
  play: (track: AudioTrack) => void;
  /** Play/pause the currently loaded track. */
  toggle: () => void;
  /** Jump to an absolute position in seconds. */
  seek: (seconds: number) => void;
  /** Stop, unload, and hide the player. */
  close: () => void;
  /** True when `memoId` is the track currently loaded in the player. */
  isActive: (memoId: string) => boolean;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within <AudioPlayerProvider>');
  return ctx;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const play = useCallback(
    (next: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      // Same track already loaded → just toggle, don't restart it.
      if (track && track.memoId === next.memoId) {
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
        return;
      }
      setTrack(next);
      setCurrentTime(0);
      setDuration(0);
      audio.src = next.src;
      audio.load();
      audio.play().catch(() => {});
    },
    [track],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [track]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : seconds;
    audio.currentTime = Math.max(0, Math.min(seconds, max));
    setCurrentTime(audio.currentTime);
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setTrack(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const isActive = useCallback((memoId: string) => track?.memoId === memoId, [track]);

  const value = useMemo<AudioPlayerContextValue>(
    () => ({ track, playing, currentTime, duration, play, toggle, seek, close, isActive }),
    [track, playing, currentTime, duration, play, toggle, seek, close, isActive],
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
      />
      {children}
    </AudioPlayerContext.Provider>
  );
}

/** Seconds → "m:ss". Non-finite (e.g. live WebM duration) renders as "0:00". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
