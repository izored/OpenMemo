import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';

// In-panel microphone recorder. Uses the native MediaRecorder + WebAudio APIs
// (no third-party dependency). Records into the best container the browser
// offers, shows a live level meter while recording, lets the user preview /
// re-record, and hands the finished File up to the panel to upload. A toggle
// (default ON) flags the recording for background transcription on save.

type Status = 'idle' | 'recording' | 'recorded';

const BARS = 28;

// Pick the best-supported recording container. Chrome/Edge → WebM/Opus,
// Firefox → Ogg/Opus, Safari → MP4/AAC. We name the file with an audio
// extension so the backend files it as audio even before type_override.
function pickMime(): { mime: string; ext: string } {
  const candidates: [string, string][] = [
    ['audio/webm;codecs=opus', 'weba'],
    ['audio/webm', 'weba'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/ogg', 'ogg'],
    ['audio/mp4', 'm4a'],
  ];
  if (typeof MediaRecorder !== 'undefined') {
    for (const [mime, ext] of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
      } catch {
        /* ignore */
      }
    }
  }
  return { mime: '', ext: 'webm' };
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function VoiceRecorder({
  onSave,
  busy,
}: {
  onSave: (file: File, opts: { transcribe: boolean }) => void | Promise<void>;
  busy?: boolean;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [transcribe, setTranscribe] = useState(true);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.15));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const extRef = useRef<string>('webm');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const cleanupStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Tear down the mic + revoke the preview URL on unmount.
  useEffect(
    () => () => {
      cleanupStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [cleanupStream, previewUrl],
  );

  const runMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const next: number[] = [];
      const step = Math.floor(data.length / BARS) || 1;
      for (let i = 0; i < BARS; i++) {
        const v = data[i * step] / 255;
        next.push(0.12 + v * 0.88);
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { mime, ext } = pickMime();
      extRef.current = ext;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setStatus('recorded');
        cleanupStream();
      };
      rec.start();

      // Live level meter (best-effort — recording still works if it throws).
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;
        runMeter();
      } catch {
        /* meter is decorative */
      }

      setElapsed(0);
      setStatus('recording');
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') setError('Microphone permission denied.');
      else if (name === 'NotFoundError') setError('No microphone found.');
      else setError('Could not start recording.');
      cleanupStream();
    }
  }, [cleanupStream, runMeter]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const discard = useCallback(() => {
    blobRef.current = null;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setElapsed(0);
    setLevels(Array(BARS).fill(0.15));
    setStatus('idle');
    setError('');
  }, []);

  const save = useCallback(() => {
    const blob = blobRef.current;
    if (!blob) return;
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
    const file = new File([blob], `Voice memo ${stamp}.${extRef.current}`, { type: blob.type });
    onSave(file, { transcribe });
  }, [onSave, transcribe]);

  return (
    <div className="om-add-tab-pane">
      <div className="om-add-sect mono">Voice Memo</div>

      {error && (
        <p className="om-add-hint mono" style={{ color: '#EF5048' }}>
          {error}
        </p>
      )}

      <div className={cn('om-add-voice', status === 'recording' && 'recording')}>
        <div className="om-add-wave" aria-hidden>
          {levels.map((h, i) => (
            <span key={i} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>

        {status === 'recorded' && previewUrl && (
          <audio className="om-add-voice-preview" src={previewUrl} controls preload="metadata" />
        )}

        <div className="om-add-voice-timer mono">{fmt(elapsed)}</div>

        <div className="om-add-voice-actions">
          {status === 'idle' && (
            <button className="om-add-rec" onClick={start} type="button">
              <span className="om-add-rec-dot" />
              <span>Record</span>
            </button>
          )}
          {status === 'recording' && (
            <button className="om-add-rec recording" onClick={stop} type="button">
              <span className="om-add-rec-stop" />
              <span>Stop</span>
            </button>
          )}
          {status === 'recorded' && (
            <>
              <button className="om-add-rec" onClick={discard} type="button" disabled={busy}>
                <Icon name="refresh" size={12} />
                <span>Re-record</span>
              </button>
              <button className="om-add-rec primary" onClick={save} type="button" disabled={busy}>
                <Icon name="check" size={12} />
                <span>{busy ? 'Saving…' : 'Save memo'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        className="om-add-toggle"
        onClick={() => setTranscribe((v) => !v)}
        aria-pressed={transcribe}
      >
        <span className={cn('om-add-toggle-switch', transcribe && 'on')}>
          <span className="om-add-toggle-knob" />
        </span>
        <span className="om-add-toggle-label">
          Transcribe after saving
          <span className="mono">Local speech-to-text · multilingual</span>
        </span>
      </button>
    </div>
  );
}
