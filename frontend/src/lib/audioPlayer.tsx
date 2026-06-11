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
  /** Liked state at play time — seeds the player's heart toggle (music). */
  liked?: boolean;
}

/** Where the live queue came from. Set when a playlist is queued, so the
 *  player's cover art can link back to the playlist instead of the memo. */
export type QueueSource = { kind: 'playlist'; id: string } | null;

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
   * Load a track list as the play queue and start at `startIndex` (ADR-015).
   * On track end the queue auto-advances (repeat-one still wins); it stops
   * after the last track. Playing a single track anywhere clears the queue.
   * `opts.shuffle` starts the queue shuffled: the start track plays first,
   * the rest follow in random order. `opts.source` records where the queue
   * came from (a playlist), so the player can link back to it.
   */
  playQueue: (tracks: AudioTrack[], startIndex?: number, opts?: { shuffle?: boolean; source?: QueueSource }) => void;
  /** Where the live queue came from (null = ad-hoc queue / single track). */
  queueSource: QueueSource;
  /** Jump to the next queued track (no-op without a queue / at the end). */
  next: () => void;
  /** Jump to the previous queued track (no-op without a queue / at the start). */
  prev: () => void;
  /** True while the queue plays in shuffled order. */
  shuffled: boolean;
  /** Shuffle the upcoming queue (current track stays put) / restore source order. */
  toggleShuffle: () => void;
  /** Number of tracks in the active queue (0 = no queue). */
  queueLength: number;
  /** Index of the active track within the queue (-1 = no queue). */
  queueIndex: number;
  /** The live queue, in play order (empty = no queue). For the Up-next list. */
  queueTracks: AudioTrack[];
  /** Jump straight to a queued track by index. */
  jumpTo: (index: number) => void;
  /** Drop a queued track by index (the playing track can't be removed). */
  removeAt: (index: number) => void;
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
  //
  // MOBILE: the graph is skipped entirely on coarse-pointer devices. Routing
  // the element through an AudioContext means the OS suspends the context on
  // screen lock / tab minimize and playback goes SILENT in the background —
  // the classic mobile background-audio killer. Without the graph the bare
  // <audio> element keeps playing under lock, driven by the Media Session
  // handlers below. getLevels() returns false and every waveform caller
  // already falls back to its static bar pattern by design.
  const allowGraphRef = useRef(
    typeof window === 'undefined' || !window.matchMedia
      ? true
      : !window.matchMedia('(pointer: coarse)').matches,
  );
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Backed by a concrete ArrayBuffer so the type matches getByteFrequencyData's
  // Uint8Array<ArrayBuffer> signature across TS lib versions.
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioCtxRef.current || !allowGraphRef.current) return;
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

  // Play queue (ADR-015). Mirrored into refs so the <audio> onEnded closure
  // (bound once) can auto-advance without re-binding listeners.
  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const queueRef = useRef<AudioTrack[]>([]);
  const queueIndexRef = useRef(-1);
  // Shuffle: the queue plays in random order while the source order is kept
  // aside, so toggling shuffle off restores it with the current track intact.
  const [shuffled, setShuffled] = useState(false);
  const shuffledRef = useRef(false);
  const sourceOrderRef = useRef<AudioTrack[]>([]);
  // Queue provenance — survives in a ref for the snapshot writer.
  const [queueSource, setQueueSource] = useState<QueueSource>(null);
  const queueSourceRef = useRef<QueueSource>(null);

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
    sourceOrderRef.current = [];
    shuffledRef.current = false;
    queueSourceRef.current = null;
    setQueue([]);
    setQueueIndex(-1);
    setShuffled(false);
    setQueueSource(null);
  }, []);

  // Fisher–Yates over everything except `first`, which stays at position 0 —
  // the playing track never jumps when shuffle flips on.
  const shuffleAfter = (tracks: AudioTrack[], first: AudioTrack): AudioTrack[] => {
    const rest = tracks.filter((t) => t.memoId !== first.memoId);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [first, ...rest];
  };

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
    (tracks: AudioTrack[], startIndex = 0, opts?: { shuffle?: boolean; source?: QueueSource }) => {
      if (!tracks.length) return;
      const start = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const doShuffle = !!opts?.shuffle;
      const list = doShuffle ? shuffleAfter(tracks, tracks[start]) : tracks;
      const i = doShuffle ? 0 : start;
      sourceOrderRef.current = tracks;
      shuffledRef.current = doShuffle;
      queueRef.current = list;
      queueIndexRef.current = i;
      queueSourceRef.current = opts?.source ?? null;
      setShuffled(doShuffle);
      setQueue(list);
      setQueueIndex(i);
      setQueueSource(opts?.source ?? null);
      loadTrack(list[i]);
    },
    [loadTrack],
  );

  const toggleShuffle = useCallback(() => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (!q.length || i < 0) return;
    const current = q[i];
    if (!shuffledRef.current) {
      sourceOrderRef.current = q;
      const list = shuffleAfter(q, current);
      queueRef.current = list;
      queueIndexRef.current = 0;
      shuffledRef.current = true;
      setQueue(list);
      setQueueIndex(0);
      setShuffled(true);
    } else {
      const source = sourceOrderRef.current.length ? sourceOrderRef.current : q;
      const si = Math.max(0, source.findIndex((t) => t.memoId === current.memoId));
      queueRef.current = source;
      queueIndexRef.current = si;
      shuffledRef.current = false;
      setQueue(source);
      setQueueIndex(si);
      setShuffled(false);
    }
  }, []);

  const next = useCallback(() => stepQueue(1), [stepQueue]);
  const prev = useCallback(() => stepQueue(-1), [stepQueue]);

  const jumpTo = useCallback(
    (index: number) => {
      const q = queueRef.current;
      if (index < 0 || index >= q.length) return;
      queueIndexRef.current = index;
      setQueueIndex(index);
      loadTrack(q[index]);
    },
    [loadTrack],
  );

  const removeAt = useCallback((index: number) => {
    const q = queueRef.current;
    const cur = queueIndexRef.current;
    if (index < 0 || index >= q.length || index === cur) return;
    const removed = q[index];
    const nq = q.filter((_, i) => i !== index);
    queueRef.current = nq;
    setQueue(nq);
    // Keep the source order in sync so toggling shuffle off can't resurrect it.
    sourceOrderRef.current = sourceOrderRef.current.filter((t) => t.memoId !== removed.memoId);
    if (index < cur) {
      queueIndexRef.current = cur - 1;
      setQueueIndex(cur - 1);
    }
  }, []);

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

  // ── Continue listening (OPNMMO-0023 follow-up) ──
  // The player snapshots itself to localStorage (track, queue, order, position)
  // and a reload restores it PAUSED — never autoplay. Volume already persists.
  const RESUME_KEY = 'om-player-resume';
  const restoredRef = useRef(false);
  const lastPosSaveRef = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (raw && audio) {
        const snap = JSON.parse(raw) as {
          track?: AudioTrack | null;
          queue?: AudioTrack[];
          sourceOrder?: AudioTrack[];
          index?: number;
          shuffled?: boolean;
          position?: number;
          source?: QueueSource;
        };
        if (snap?.track?.src) {
          queueRef.current = Array.isArray(snap.queue) ? snap.queue : [];
          sourceOrderRef.current = Array.isArray(snap.sourceOrder) ? snap.sourceOrder : [];
          queueIndexRef.current = typeof snap.index === 'number' ? snap.index : -1;
          shuffledRef.current = !!snap.shuffled;
          queueSourceRef.current = snap.source ?? null;
          setQueue(queueRef.current);
          setQueueIndex(queueIndexRef.current);
          setShuffled(shuffledRef.current);
          setQueueSource(queueSourceRef.current);
          setTrack(snap.track);
          audio.src = snap.track.src;
          audio.load();
          audio.volume = volumeRef.current;
          const pos = Number(snap.position) || 0;
          lastPosSaveRef.current = pos;
          if (pos > 0) {
            const onMeta = () => {
              try { audio.currentTime = Math.min(pos, audio.duration || pos); } catch { /* not seekable */ }
            };
            audio.addEventListener('loadedmetadata', onMeta, { once: true });
          }
          setCurrentTime(pos);
        }
      }
    } catch { /* corrupted snapshot — start clean */ }
    restoredRef.current = true;
  }, []);

  // Snapshot on any structural change (track / queue / order). Position rides
  // along from the last throttled save so a fresh snapshot can't zero it.
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      if (!track) {
        localStorage.removeItem(RESUME_KEY);
        return;
      }
      localStorage.setItem(RESUME_KEY, JSON.stringify({
        track,
        queue: queueRef.current,
        sourceOrder: sourceOrderRef.current,
        index: queueIndexRef.current,
        shuffled: shuffledRef.current,
        source: queueSourceRef.current,
        position: audioRef.current?.currentTime || lastPosSaveRef.current,
      }));
    } catch { /* private mode / quota — resume is best-effort */ }
  }, [track, queue, queueIndex, shuffled]);

  // Throttled position save (~every 5s of playback + on pause).
  const savePosition = useCallback((t: number, force = false) => {
    if (!restoredRef.current) return;
    if (!force && Math.abs(t - lastPosSaveRef.current) < 5) return;
    lastPosSaveRef.current = t;
    try {
      const raw = localStorage.getItem(RESUME_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      snap.position = t;
      localStorage.setItem(RESUME_KEY, JSON.stringify(snap));
    } catch { /* ignore */ }
  }, []);

  // Media Session — lets the OS media keys (the keyboard play/pause key) and the
  // lock-screen / notification transport drive our player (ADR-005). Handlers are
  // bound once; they read the live <audio> via the ref.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const a = () => audioRef.current;
    try {
      // Resume a suspended AudioContext before play — a lock-screen / notif
      // "play" tap must revive the graph (when one exists), not stay silent.
      ms.setActionHandler('play', () => {
        audioCtxRef.current?.resume?.().catch(() => {});
        a()?.play().catch(() => {});
      });
      ms.setActionHandler('pause', () => a()?.pause());
      ms.setActionHandler('seekbackward', (d) => { const el = a(); if (el) el.currentTime = Math.max(0, el.currentTime - (d.seekOffset || 10)); });
      ms.setActionHandler('seekforward', (d) => { const el = a(); if (el) el.currentTime = el.currentTime + (d.seekOffset || 10); });
      ms.setActionHandler('seekto', (d) => { const el = a(); if (el && d.seekTime != null) el.currentTime = d.seekTime; });
      // Queue transport (ADR-015) — OS next/prev keys step the play queue.
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

  // Coming back to the tab with a suspended AudioContext while the element is
  // "playing" = silence. Resume the graph on visibility return (desktop only —
  // mobile never builds the graph, see ensureGraph).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const ctx = audioCtxRef.current;
      const audio = audioRef.current;
      if (ctx?.state === 'suspended' && audio && !audio.paused) {
        ctx.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const value = useMemo<AudioPlayerContextValue>(
    () => ({ track, playing, currentTime, duration, repeat, toggleRepeat, volume, muted, setVolume, toggleMute, play, playQueue, next, prev, shuffled, toggleShuffle, queueLength: queue.length, queueIndex, queueTracks: queue, queueSource, jumpTo, removeAt, toggle, seek, close, isActive, getLevels }),
    [track, playing, currentTime, duration, repeat, toggleRepeat, volume, muted, setVolume, toggleMute, play, playQueue, next, prev, shuffled, toggleShuffle, queue, queueIndex, queueSource, jumpTo, removeAt, toggle, seek, close, isActive, getLevels],
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={(e) => {
          setPlaying(false);
          savePosition(e.currentTarget.currentTime, true);
        }}
        onEnded={() => {
          // Repeat-one: restart the same track instead of stopping (ADR-005).
          const audio = audioRef.current;
          if (repeatRef.current && audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
            return;
          }
          // Queue auto-advance (ADR-015): play the next queued track; stop
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
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
          savePosition(e.currentTarget.currentTime);
        }}
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
