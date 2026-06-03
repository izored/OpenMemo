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
  /** 'voice' | 'music' (ADR-005) — drives the player's cover-vs-glyph styling. */
  kind?: 'voice' | 'music' | null;
  /** Cover-art image src (music only); absent → the player shows a glyph. */
  cover?: string | null;
  /** Pinned state at play time — seeds the player's pin toggle. */
  pinned?: boolean;
}

interface AudioPlayerContextValue {
  track: AudioTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  /** Repeat-one: when true, the track restarts on end instead of stopping. */
  repeat: boolean;
  /** Toggle repeat-one. */
  toggleRepeat: () => void;
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
  /**
   * Fill `out` with the current frequency spectrum (0..1 per bin) from the
   * WebAudio analyser, for live waveform visualization. Returns true if real
   * data was written (audio graph ready + a track loaded), false otherwise so
   * callers can fall back to a static bar pattern. Cheap to call each rAF.
   */
  getLevels: (out: number[]) => boolean;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components -- context hook colocated with its provider (standard pattern); not a fast-refresh boundary
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
  // Repeat-one. Mirrored into a ref so the <audio> onEnded closure (bound once)
  // always reads the current value without re-binding the listener.
  const [repeat, setRepeat] = useState(false);
  const repeatRef = useRef(false);
  const toggleRepeat = useCallback(() => {
    setRepeat((r) => {
      repeatRef.current = !r;
      return !r;
    });
  }, []);

  // WebAudio analyser graph for the live waveform. A MediaElementSource can be
  // created only ONCE per <audio> element (a second call throws), so the ctx,
  // source, and analyser are built lazily on first play and kept in refs.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Backed by a concrete ArrayBuffer so the type matches getByteFrequencyData's
  // Uint8Array<ArrayBuffer> signature across TS lib versions.
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioCtxRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      /* analyser is decorative — playback still works without it */
    }
  }, []);

  const getLevels = useCallback((out: number[]): boolean => {
    const analyser = analyserRef.current;
    const buf = freqRef.current;
    if (!analyser || !buf || !track) return false;
    analyser.getByteFrequencyData(buf);
    const n = out.length;
    const step = Math.max(1, Math.floor(buf.length / n));
    for (let i = 0; i < n; i++) {
      out[i] = buf[i * step] / 255;
    }
    return true;
  }, [track]);

  const play = useCallback(
    (next: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      ensureGraph();
      // A suspended context (autoplay policy) must be resumed on user gesture.
      audioCtxRef.current?.resume?.().catch(() => {});
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
    [track, ensureGraph],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    audioCtxRef.current?.resume?.().catch(() => {});
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
    () => ({ track, playing, currentTime, duration, repeat, toggleRepeat, play, toggle, seek, close, isActive, getLevels }),
    [track, playing, currentTime, duration, repeat, toggleRepeat, play, toggle, seek, close, isActive, getLevels],
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          // Repeat-one: restart the same track instead of stopping (ADR-005).
          const audio = audioRef.current;
          if (repeatRef.current && audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
          } else {
            setPlaying(false);
          }
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
      />
      {children}
    </AudioPlayerContext.Provider>
  );
}

/** Seconds → "m:ss". Non-finite (e.g. live WebM duration) renders as "0:00". */
// eslint-disable-next-line react-refresh/only-export-components -- pure time formatter shared with the players; not a fast-refresh boundary
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
