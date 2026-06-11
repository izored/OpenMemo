import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
  /** Output volume, 0..1. Persisted across sessions. */
  volume: number;
  /** Muted flag (independent of volume — unmutes when volume is dragged up). */
  muted: boolean;
  /** Set the output volume (0..1). A value > 0 also clears mute. */
  setVolume: (v: number) => void;
  /** Toggle mute. */
  toggleMute: () => void;
  /** Load + play a track. If it is already the active track, toggle play/pause.
   *  Clears any active queue — a single-track play is never silently queued. */
  play: (track: AudioTrack) => void;
  /**
   * Load a track list as the play queue and start at `startIndex` (ADR-014).
   * On track end the queue auto-advances (repeat-one still wins); it stops
   * after the last track. Playing a single track anywhere clears the queue.
   */
  playQueue: (tracks: AudioTrack[], startIndex?: number) => void;
  /** Jump to the next queued track (no-op without a queue / at the end). */
  next: () => void;
  /** Jump to the previous queued track (no-op without a queue / at the start). */
  prev: () => void;
  /** Number of tracks in the active queue (0 = no queue). */
  queueLength: number;
  /** Index of the active track within the queue (-1 = no queue). */
  queueIndex: number;
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

  // Volume + mute. Persisted (last volume restored next session). Mirrored into
  // refs so play() can apply them to a freshly-loaded <audio> without re-binding.
  const VOL_KEY = 'om-player-volume';
  const [volume, setVolumeState] = useState<number>(() => {
    const v = parseFloat(typeof localStorage !== 'undefined' ? localStorage.getItem(VOL_KEY) || '' : '');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  });
  const [muted, setMuted] = useState(false);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(false);

  const setVolume = useCallback((v: number) => {
    const nv = Math.min(1, Math.max(0, v));
    volumeRef.current = nv;
    const audio = audioRef.current;
    if (audio) {
      audio.volume = nv;
      // Dragging the slider up implicitly unmutes (matches every player).
      if (nv > 0 && audio.muted) {
        audio.muted = false;
        mutedRef.current = false;
        setMuted(false);
      }
    }
    try { localStorage.setItem(VOL_KEY, String(nv)); } catch { /* private mode */ }
    setVolumeState(nv);
  }, []);

  const toggleMute = useCallback(() => {
    const nm = !mutedRef.current;
    mutedRef.current = nm;
    const audio = audioRef.current;
    if (audio) audio.muted = nm;
    setMuted(nm);
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

  // Play queue (ADR-014). Mirrored into refs so the <audio> onEnded closure
  // (bound once) can auto-advance without re-binding listeners.
  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const queueRef = useRef<AudioTrack[]>([]);
  const queueIndexRef = useRef(-1);

  // Load + play a track on the shared element (no toggle logic, no queue edits).
  const loadTrack = useCallback(
    (t: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      ensureGraph();
      // A suspended context (autoplay policy) must be resumed on user gesture.
      audioCtxRef.current?.resume?.().catch(() => {});
      setTrack(t);
      setCurrentTime(0);
      setDuration(0);
      audio.src = t.src;
      audio.load();
      // Apply the persisted volume / mute to the freshly-loaded element.
      audio.volume = volumeRef.current;
      audio.muted = mutedRef.current;
      audio.play().catch(() => {});
    },
    [ensureGraph],
  );

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    queueIndexRef.current = -1;
    setQueue([]);
    setQueueIndex(-1);
  }, []);

  const play = useCallback(
    (next: AudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      // Same track already loaded → just toggle, don't restart it (and keep
      // any queue it belongs to).
      if (track && track.memoId === next.memoId) {
        ensureGraph();
        audioCtxRef.current?.resume?.().catch(() => {});
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
        return;
      }
      clearQueue();
      loadTrack(next);
    },
    [track, ensureGraph, clearQueue, loadTrack],
  );

  const stepQueue = useCallback(
    (delta: number) => {
      const q = queueRef.current;
      const i = queueIndexRef.current + delta;
      if (!q.length || i < 0 || i >= q.length) return;
      queueIndexRef.current = i;
      setQueueIndex(i);
      loadTrack(q[i]);
    },
    [loadTrack],
  );

  const playQueue = useCallback(
    (tracks: AudioTrack[], startIndex = 0) => {
      if (!tracks.length) return;
      const i = Math.max(0, Math.min(startIndex, tracks.length - 1));
      queueRef.current = tracks;
      queueIndexRef.current = i;
      setQueue(tracks);
      setQueueIndex(i);
      loadTrack(tracks[i]);
    },
    [loadTrack],
  );

  const next = useCallback(() => stepQueue(1), [stepQueue]);
  const prev = useCallback(() => stepQueue(-1), [stepQueue]);

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
    clearQueue();
    setTrack(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [clearQueue]);

  const isActive = useCallback((memoId: string) => track?.memoId === memoId, [track]);

  // Media Session — lets the OS media keys (the keyboard play/pause key) and the
  // lock-screen / notification transport drive our player (ADR-005). Handlers are
  // bound once; they read the live <audio> via the ref.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const a = () => audioRef.current;
    try {
      ms.setActionHandler('play', () => a()?.play().catch(() => {}));
      ms.setActionHandler('pause', () => a()?.pause());
      ms.setActionHandler('seekbackward', (d) => { const el = a(); if (el) el.currentTime = Math.max(0, el.currentTime - (d.seekOffset || 10)); });
      ms.setActionHandler('seekforward', (d) => { const el = a(); if (el) el.currentTime = el.currentTime + (d.seekOffset || 10); });
      ms.setActionHandler('seekto', (d) => { const el = a(); if (el && d.seekTime != null) el.currentTime = d.seekTime; });
      // Queue transport (ADR-014) — OS next/prev keys step the play queue.
      ms.setActionHandler('nexttrack', () => stepQueue(1));
      ms.setActionHandler('previoustrack', () => stepQueue(-1));
    } catch {
      /* some actions are unsupported on some browsers — ignore */
    }
    return () => {
      try {
        for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack'] as const) {
          ms.setActionHandler(action, null);
        }
      } catch {
        /* ignore */
      }
    };
  }, [stepQueue]);

  // OS media-overlay metadata (title / artist / artwork) per track.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.subtitle || '',
        artwork: track.cover ? [{ src: track.cover, sizes: '512x512', type: 'image/png' }] : [],
      });
    } catch {
      /* MediaMetadata unsupported — ignore */
    }
  }, [track]);

  // Reflect play/pause to the OS so the media key toggles the right state.
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }, [playing]);

  const value = useMemo<AudioPlayerContextValue>(
    () => ({ track, playing, currentTime, duration, repeat, toggleRepeat, volume, muted, setVolume, toggleMute, play, playQueue, next, prev, queueLength: queue.length, queueIndex, toggle, seek, close, isActive, getLevels }),
    [track, playing, currentTime, duration, repeat, toggleRepeat, volume, muted, setVolume, toggleMute, play, playQueue, next, prev, queue.length, queueIndex, toggle, seek, close, isActive, getLevels],
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
            return;
          }
          // Queue auto-advance (ADR-014): play the next queued track; stop
          // after the last one.
          const q = queueRef.current;
          const i = queueIndexRef.current;
          if (q.length && i >= 0 && i < q.length - 1) {
            queueIndexRef.current = i + 1;
            setQueueIndex(i + 1);
            loadTrack(q[i + 1]);
            return;
          }
          setPlaying(false);
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
