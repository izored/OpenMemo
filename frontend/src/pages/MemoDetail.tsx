import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Sparkles,
  Loader2,
  ExternalLink,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
  Save,
  Tag,
  Folder,
  Download,
  Maximize2,
  Expand,
  Pin,
  PinOff,
  FileText,
  Play,
  Pause,
  HardDriveDownload,
  Film,
  Music,
  Check,
  Trash2,
  AlignLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BackButton } from '@/components/BackButton';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { memoApi, collectionApi } from '@/lib/api';
import { AskMemoPanel } from '@/components/AskMemoPanel';
import { audioEmbed, canMakeLocal } from '@/lib/media';
import { videoEmbedUrl } from '@/lib/platforms';
import { useAudioPlayer, formatTime } from '@/lib/audioPlayer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Memo, Collection } from '@/types';

/**
 * Wraps an image or local video preview with three affordances:
 *   - Theater toggle (top-right): expands preview to full content width
 *   - Fullscreen (top-right): browser-native fullscreen API
 *   - Lightbox (click image only): modal overlay, Esc/click closes
 */
function MediaPreview({ src, alt, kind }: { src: string; alt: string; kind: 'image' | 'video' }) {
  const [theater, setTheater] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  const goFullscreen = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  };

  // Esc closes the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    <>
      <div className={cn('om-media-preview', theater && 'theater')} style={{ marginBottom: '24px' }}>
        {kind === 'video' ? (
          <video
            ref={(el) => { mediaRef.current = el; }}
            src={src}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            ref={(el) => { mediaRef.current = el; }}
            src={src}
            alt={alt}
            onClick={() => setLightbox(true)}
            style={{ cursor: 'zoom-in' }}
          />
        )}
        <div className="om-media-controls">
          <button
            type="button"
            className="om-media-btn"
            onClick={() => setTheater((v) => !v)}
            title={theater ? 'Exit theater (compact)' : 'Theater (full width)'}
            aria-label={theater ? 'Exit theater mode' : 'Theater mode'}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className="om-media-btn"
            onClick={goFullscreen}
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <Expand size={14} />
          </button>
        </div>
      </div>
      {lightbox && kind === 'image' && (
        <div className="om-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(false)}>
          <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="om-lightbox-close"
            onClick={() => setLightbox(false)}
            aria-label="Close lightbox"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}

// Report card for file-backed memos (documents, code, generic files). These
// often have little or no extracted text, so the detail page would otherwise
// be a bare title. The card surfaces the key metadata at a glance.
function DocReportCard({ memo }: { memo: Memo }) {
  const ext = memo.title.includes('.') ? memo.title.split('.').pop()!.toUpperCase() : '';
  const text = memo.content_text || memo.content_raw || '';
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readMins = wordCount ? Math.max(1, Math.round(wordCount / 200)) : 0;
  const added = new Date(memo.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const typeLabel =
    ({ document: 'Document', code: 'Source file', file: 'File' } as Record<string, string>)[memo.type] || 'File';

  const stats: { label: string; value: string }[] = [
    { label: 'Added', value: added },
    { label: 'Kind', value: ext ? `${ext} · ${typeLabel}` : typeLabel },
  ];
  if (wordCount) stats.push({ label: 'Length', value: `${wordCount.toLocaleString()} words · ${readMins} min read` });
  stats.push({
    label: 'Collections',
    value: memo.collections?.length ? memo.collections.map((c) => c.name).join(', ') : 'None',
  });
  stats.push({
    label: 'Tags',
    value: memo.tags?.length ? memo.tags.join(', ') : 'None',
  });
  stats.push({ label: 'AI summary', value: memo.ai_summary ? 'Generated' : 'Not yet' });

  return (
    <div className="om-doc-report">
      <div className="om-doc-report-head">
        <div className="om-doc-report-badge">{ext ? `.${ext.toLowerCase()}` : <FileText size={22} />}</div>
        <div className="om-doc-report-headtext">
          <span className="mono om-doc-report-eyebrow">{typeLabel}</span>
          <h2 className="om-doc-report-title">{memo.title}</h2>
        </div>
      </div>
      <div className="om-doc-report-grid">
        {stats.map((s) => (
          <div key={s.label} className="om-doc-report-stat">
            <span className="mono om-doc-report-stat-label">{s.label}</span>
            <span className="om-doc-report-stat-value">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Inline audio player for the detail page. Drives the SAME shared <audio> as
// the header mini-player (via the audio context), so playback continues and
// stays in sync if the user navigates away. Probes duration up-front so the
// total length shows before the first play.
function AudioMemoPlayer({ memo }: { memo: Memo }) {
  const { play, toggle, seek, isActive, playing, currentTime, duration } = useAudioPlayer();
  const src = `/api/memos/${memo.id}/file`;
  const active = isActive(memo.id);
  const [probeDur, setProbeDur] = useState(0);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = src;
    const on = () => setProbeDur(Number.isFinite(a.duration) ? a.duration : 0);
    a.addEventListener('loadedmetadata', on);
    return () => {
      a.removeEventListener('loadedmetadata', on);
      a.src = '';
    };
  }, [src]);

  const dur = active && Number.isFinite(duration) && duration > 0 ? duration : probeDur;
  const cur = active ? currentTime : 0;
  const isPlaying = active && playing;
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  const onPlay = () => {
    if (active) toggle();
    else play({ memoId: memo.id, title: memo.title, src, subtitle: memo.source_domain || undefined });
  };
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || dur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * dur);
  };

  return (
    <div className="om-audio-detail" style={{ marginBottom: '20px' }}>
      {memo.thumbnail_path && (
        <img
          className="om-audio-detail-cover"
          src={memo.thumbnail_path}
          alt=""
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      )}
      <button
        className={cn('om-audio-detail-play', isPlaying && 'playing')}
        onClick={onPlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className="om-audio-detail-body">
        <div
          className="om-audio-detail-track"
          onClick={onScrub}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          tabIndex={0}
        >
          <div className="om-audio-detail-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="om-audio-detail-meta mono">
          <span>{formatTime(cur)}</span>
          <span>{dur > 0 ? formatTime(dur) : '--:--'}</span>
        </div>
      </div>
      <a
        className="om-audio-detail-dl"
        href={`/api/memos/${memo.id}/file?download=1`}
        download
        title="Download original"
        aria-label="Download original"
      >
        <Download size={16} />
      </a>
    </div>
  );
}

// Transcript block, rendered directly under the audio player. Shows the cleaned
// speech-to-text result, a live "transcribing…" state, or an on-demand
// Transcribe button for audio that was uploaded (rather than recorded).
function AudioTranscript({ memo }: { memo: Memo }) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState(false);
  const status = memo.transcript_status;
  const text = memo.content_text || '';
  const pending = status === 'pending' || status === 'processing' || starting;

  const startTranscribe = async () => {
    setStarting(true);
    try {
      await memoApi.transcribe(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="om-transcript" style={{ marginBottom: '24px' }}>
      <button
        className="om-extracted-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{ marginBottom: open ? '10px' : 0 }}
      >
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        <FileText size={14} />
        Transcript
        {memo.transcript_lang && (
          <span className="om-tag" style={{ textTransform: 'uppercase', marginLeft: 4 }}>{memo.transcript_lang}</span>
        )}
        {pending && <Loader2 size={14} className="om-spin" style={{ marginLeft: 4 }} />}
      </button>

      {open && (
        pending ? (
          <p className="om-detail-desc">Transcribing audio… this runs locally and may take a moment.</p>
        ) : text ? (
          <div className="om-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_raw || text}</ReactMarkdown>
          </div>
        ) : status === 'error' ? (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>
              Transcription failed. Check that the speech-to-text model is installed on the server.
            </p>
            <button className="om-btn-ghost om-btn-pill" onClick={startTranscribe} disabled={starting}>
              <Sparkles size={14} /> Try again
            </button>
          </div>
        ) : (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>No transcript yet.</p>
            <button className="om-btn-primary om-btn-pill" onClick={startTranscribe} disabled={starting}>
              {starting ? <Loader2 size={14} className="om-spin" /> : <Sparkles size={14} />}
              Transcribe
            </button>
          </div>
        )
      )}
    </div>
  );
}

// Two-tab panel for video memos sourced from YouTube/social platforms.
// "Video description" = platform metadata. "Transcript" = Whisper STT result.
// Fixes the bug where content_text (YouTube description) was mislabeled "Transcript".
function VideoContentPanel({ memo }: { memo: Memo }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'description' | 'transcript'>('description');
  const [starting, setStarting] = useState(false);
  const status = memo.transcript_status;
  const pending = status === 'pending' || status === 'processing' || starting;
  const descText = memo.video_description || memo.description || '';

  const startTranscribe = async () => {
    setStarting(true);
    try {
      await memoApi.transcribe(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  if (!descText && !status && !memo.file_path) return null;

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button
          className={cn('om-tab-btn', tab === 'description' && 'active')}
          onClick={() => setTab('description')}
        >
          <AlignLeft size={13} />
          Video description
        </button>
        <button
          className={cn('om-tab-btn', tab === 'transcript' && 'active')}
          onClick={() => setTab('transcript')}
        >
          <FileText size={13} />
          Transcript
          {pending && <Loader2 size={12} className="om-spin" style={{ marginLeft: 4 }} />}
          {status === 'done' && memo.transcript_lang && (
            <span className="om-tag" style={{ textTransform: 'uppercase', marginLeft: 4 }}>{memo.transcript_lang}</span>
          )}
        </button>
      </div>

      {tab === 'description' && (
        descText ? (
          <p className="om-detail-desc" style={{ whiteSpace: 'pre-wrap' }}>{descText}</p>
        ) : (
          <p className="om-detail-desc" style={{ fontStyle: 'italic' }}>No description available.</p>
        )
      )}

      {tab === 'transcript' && (
        pending ? (
          <p className="om-detail-desc">Transcribing audio… this runs locally and may take a moment.</p>
        ) : status === 'done' && memo.content_text ? (
          <div className="om-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_text}</ReactMarkdown>
          </div>
        ) : status === 'error' ? (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>
              Transcription failed. Check that the speech-to-text model is installed on the server.
            </p>
            {memo.file_path && (
              <button className="om-btn-ghost om-btn-pill" onClick={startTranscribe} disabled={starting}>
                <Sparkles size={14} /> Try again
              </button>
            )}
          </div>
        ) : memo.file_path ? (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>No transcript yet. Transcribe the audio with Whisper.</p>
            <button className="om-btn-primary om-btn-pill" onClick={startTranscribe} disabled={starting}>
              {starting ? <Loader2 size={14} className="om-spin" /> : <Sparkles size={14} />}
              Transcribe
            </button>
          </div>
        ) : (
          <p className="om-detail-desc">
            Download first using <strong>Make it local &rarr; Audio + transcript</strong> to generate a real transcript.
          </p>
        )
      )}
    </div>
  );
}

// Remote audio (yt-dlp pull) when auto-download is OFF: stream it inline via the
// platform's embed widget (SoundCloud/Mixcloud), with options to open the
// original or save a local copy for offline + transcription.
function AudioStreamEmbed({ memo }: { memo: Memo }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const embed = audioEmbed(memo);

  const save = async () => {
    setSaving(true);
    try {
      await memoApi.localize(memo.id, 'audio');
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      alert((e as Error).message || 'Failed to start download');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      {embed ? (
        <iframe className="om-audio-embed" src={embed} title={memo.title} allow="autoplay" loading="lazy" />
      ) : (
        <div className="om-audio-embed-fallback">
          {memo.thumbnail_path && (
            <img src={memo.thumbnail_path} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
          )}
          <p className="om-detail-desc">
            No inline player for {memo.source_domain || 'this source'}. Open the original or save a local copy.
          </p>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {memo.source_url && (
          <a href={memo.source_url} target="_blank" rel="noopener noreferrer" className="om-btn-ghost om-btn-pill">
            Open original <ExternalLink size={14} />
          </a>
        )}
        <button className="om-btn-primary om-btn-pill" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={14} className="om-spin" /> : <HardDriveDownload size={14} />} Save audio in openMemo
        </button>
      </div>
    </div>
  );
}

// "Make it local" — download a remote video/audio source via yt-dlp so the memo
// survives the original being deleted/privated. Offers three modes; polls
// localize_status (driven by the page's refetchInterval) and shows progress.
function MakeItLocalPanel({ memo }: { memo: Memo }) {
  const queryClient = useQueryClient();
  // Audio-only sources (SoundCloud, Bandcamp, etc.) have no video track — only
  // offer the audio download. Video sources keep both options.
  const isAudio = memo.type === 'audio';
  const [mode, setMode] = useState<'video' | 'audio'>(isAudio ? 'audio' : 'video');
  const [starting, setStarting] = useState(false);
  const status = memo.localize_status;
  const busy = status === 'pending' || status === 'processing' || starting;

  const start = async () => {
    setStarting(true);
    try {
      await memoApi.localize(memo.id, mode);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
      alert((e as Error).message || 'Failed to start download');
    } finally {
      setStarting(false);
    }
  };

  const modes: { id: typeof mode; label: string; icon: React.ElementType; hint: string }[] = isAudio
    ? [{ id: 'audio', label: 'Save audio', icon: Music, hint: 'Download the audio track' }]
    : [
        { id: 'video', label: 'Video', icon: Film, hint: 'Download the video (up to 1080p)' },
        { id: 'audio', label: 'Audio only', icon: Music, hint: 'Just the audio track — transcribe later if needed' },
      ];

  return (
    <div className="om-localize" style={{ marginBottom: '24px' }}>
      <div className="om-notes-label" style={{ marginBottom: '10px' }}>
        <HardDriveDownload size={16} className="om-section-icon" />
        <h3 className="om-section-h">Make it local</h3>
        {status === 'done' && <span className="om-tag" style={{ color: 'var(--accent)' }}>Saved locally</span>}
      </div>

      {busy ? (
        <p className="om-detail-desc">
          <Loader2 size={14} className="om-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
          Downloading from {memo.source_domain || 'source'}… this can take a while for long videos.
        </p>
      ) : status === 'error' ? (
        <div>
          <p className="om-detail-desc" style={{ marginBottom: 10 }}>
            Download failed. The source may be private, region-locked, or unsupported by yt-dlp.
          </p>
          <button className="om-btn-ghost om-btn-pill" onClick={start}>
            <HardDriveDownload size={14} /> Try again
          </button>
        </div>
      ) : (
        <>
          <p className="om-detail-desc" style={{ marginBottom: 12 }}>
            Save a copy to OpenMemo so it keeps working even if the original is taken down.
          </p>
          <div className="om-localize-modes">
            {modes.map((m) => (
              <button
                key={m.id}
                className={cn('om-localize-mode', mode === m.id && 'active')}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                <m.icon size={15} />
                <span>{m.label}</span>
                {mode === m.id && <Check size={13} className="om-localize-check" />}
              </button>
            ))}
          </div>
          <button className="om-btn-primary om-btn-pill" onClick={start} style={{ marginTop: 12 }}>
            <HardDriveDownload size={14} /> Save {mode === 'audio' ? 'audio' : 'video'} in openMemo
          </button>
        </>
      )}
    </div>
  );
}

export function MemoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [showExtracted, setShowExtracted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editSourceUrl, setEditSourceUrl] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [editCollectionIds, setEditCollectionIds] = useState<string[]>([]);

  const { data: memo, isLoading } = useQuery({
    queryKey: ['memo', id],
    queryFn: () => memoApi.get(id!),
    enabled: !!id,
    // While a transcription OR a "make it local" download is running in the
    // background, poll so the result appears as soon as it lands.
    refetchInterval: (q) => {
      const m = q.state.data as Memo | undefined;
      const busy = (s?: string | null) => s === 'pending' || s === 'processing';
      return busy(m?.transcript_status) || busy(m?.localize_status) ? 2500 : false;
    },
  });

  const { data: related = [] } = useQuery<Memo[]>({
    queryKey: ['memo-related', id],
    queryFn: () => memoApi.related(id!),
    enabled: !!id,
  });

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  // Initialize edit form when memo loads
  useEffect(() => {
    if (memo) {
      setEditTitle(memo.title || '');
      setEditSourceUrl(memo.source_url || '');
      setEditContent(memo.content_raw || memo.content_text || '');
      setEditNotes(memo.notes || '');
      setEditTags(memo.tags || []);
      setEditCollectionIds(memo.collections?.map((c: { id: string }) => c.id) || []);
      setNoteContent(memo.content_raw || memo.content_text || '');
    }
  }, [memo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!confirmDelete) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmDelete(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [confirmDelete]);

  const togglePin = async () => {
    if (!id || !memo) return;
    try {
      await memoApi.pin(id, !memo.pinned);
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
    } catch (e) {
      console.error(e);
    }
  };

  const handleGenerateSummary = async () => {
    if (!id) return;
    setGeneratingSummary(true);
    try {
      await memoApi.summary(id);
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await memoApi.delete(id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      navigate(-1);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await memoApi.update(id, {
        title: editTitle,
        source_url: editSourceUrl,
        content_raw: editContent,
        notes: editNotes,
        tags: editTags,
        collection_ids: editCollectionIds,
      });
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      setIsEditing(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = editTagInput.trim().toLowerCase();
    if (t && !editTags.includes(t)) {
      setEditTags([...editTags, t]);
    }
    setEditTagInput('');
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter((t) => t !== tag));
  };

  const toggleCollection = (cid: string) => {
    if (editCollectionIds.includes(cid)) {
      setEditCollectionIds(editCollectionIds.filter((c) => c !== cid));
    } else {
      setEditCollectionIds([...editCollectionIds, cid]);
    }
  };

  // Debounced notes auto-save when not in edit mode
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  useEffect(() => {
    if (memo?.notes !== undefined) setNotesDraft(memo.notes || ''); // eslint-disable-line react-hooks/set-state-in-effect
  }, [memo?.notes]);

  const saveNotes = useCallback(async () => {
    if (!id || isEditing) return;
    if (notesDraft === (memo?.notes || '')) return;
    setNotesSaving(true);
    try {
      await memoApi.update(id, { notes: notesDraft });
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
    } catch (e) {
      console.error(e);
    } finally {
      setNotesSaving(false);
    }
  }, [id, notesDraft, memo?.notes, isEditing, queryClient]);

  useEffect(() => {
    const timer = setTimeout(saveNotes, 1000);
    return () => clearTimeout(timer);
  }, [notesDraft, saveNotes]);

  if (isLoading) {
    return (
      <div className="om-detail-loading">
        <div className="om-detail-spinner" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="om-detail-loading">
        <p className="om-detail-desc">Memo not found</p>
      </div>
    );
  }

  // Inline player for a remote video memo (no local file yet). Covers every
  // platform in the registry — YouTube, Vimeo, Instagram, TikTok, etc. Null →
  // no embeddable player; the "Make it local" panel + Open Original still show.
  const videoEmbed = memo.type === 'video' && !memo.file_path ? videoEmbedUrl(memo) : null;
  const isWebType = memo.type === 'article' || memo.type === 'link';

  return (
    <div className="om-detail-page">
      {/* Content pane */}
      <div className="om-detail-pane">
        {/* Header */}
        <header className="om-detail-top">
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <BackButton />
          </div>
          <div className="om-detail-actions">
            {/* Delete with inline confirm popover */}
            {!isEditing && (
              <div style={{ position: 'relative' }}>
                <button
                  className="om-icon-btn"
                  onClick={() => setConfirmDelete((v) => !v)}
                  title="Delete memo"
                  aria-label="Delete memo"
                >
                  <Trash2 size={15} />
                </button>
                {confirmDelete && (
                  <div
                    className="om-delete-confirm"
                    role="dialog"
                    aria-label="Confirm delete"
                  >
                    <span className="om-delete-confirm-label">Delete memo?</span>
                    <button className="om-btn-ghost om-btn-pill" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    <button className="om-btn-danger om-btn-pill" onClick={handleDelete}>Delete</button>
                  </div>
                )}
              </div>
            )}
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="om-btn-ghost om-btn-pill"
              >
                <Pencil size={14} />
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="om-btn-primary om-btn-pill"
                  style={saving ? { opacity: 0.5 } : undefined}
                >
                  {saving ? <Loader2 size={14} className="om-spin" /> : <Save size={14} />}
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="om-btn-ghost om-btn-pill"
                >
                  <X size={14} />
                  Cancel
                </button>
              </>
            )}
            {memo.source_url && !isEditing && (
              <a
                href={memo.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="om-btn-ghost om-btn-pill"
              >
                <ExternalLink size={14} />
                Open Original
              </a>
            )}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`om-icon-btn${chatOpen ? ' active' : ''}`}
            >
              <MessageSquare size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="om-detail-scroll">
          <div className="om-detail-content">
            {/* Memo type */}
            <div style={{ marginBottom: '12px' }}>
              <span className="om-section-h">{memo.type}</span>
            </div>

            {/* Title */}
            {isEditing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="om-detail-title-input"
                style={{ marginBottom: '8px' }}
              />
            ) : (
              <h1 className="om-detail-title" style={{ marginBottom: '8px' }}>{memo.title}</h1>
            )}

            {/* Meta */}
            <div className="om-detail-meta" style={{ marginBottom: '24px' }}>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--text-4)' }}>
                {new Date(memo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
              {memo.source_domain && !isEditing && (
                <>
                  <span style={{ color: 'var(--text-4)' }}>•</span>
                  <a
                    href={memo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="om-source link-dotted"
                  >
                    {memo.source_favicon && <img src={memo.source_favicon} alt="" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />}
                    {memo.source_domain}
                    <ExternalLink size={12} />
                  </a>
                </>
              )}
              {isEditing && (
                <>
                  <span style={{ color: 'var(--text-4)' }}>•</span>
                  <input
                    value={editSourceUrl}
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                    placeholder="Source URL"
                    className="om-detail-url-input"
                  />
                </>
              )}
              {!isEditing && memo.tags?.length > 0 && (
                <>
                  <span style={{ color: 'var(--text-4)' }}>•</span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {memo.tags.map((tag: string) => (
                      <span key={tag} className="om-tag">{tag}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Edit: Tags */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-notes-label" style={{ marginBottom: '8px' }}>
                  <Tag size={14} className="om-section-icon" />
                  <span className="om-section-h">Tags</span>
                </div>
                <div className="om-detail-tags">
                  {editTags.map((tag) => (
                    <span key={tag} className="om-tag-edit">
                      {tag}
                      <button onClick={() => removeTag(tag)}><X size={12} /></button>
                    </span>
                  ))}
                  <span className="om-tag-add">
                    <input
                      value={editTagInput}
                      onChange={(e) => setEditTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                      placeholder="Add tag..."
                      style={{ background: 'none', border: 0, outline: 'none', font: 'inherit', color: 'inherit', minWidth: '80px' }}
                    />
                  </span>
                </div>
              </div>
            )}

            {/* Edit: Collections */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-notes-label" style={{ marginBottom: '8px' }}>
                  <Folder size={14} className="om-section-icon" />
                  <span className="om-section-h">Collections</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {collections.map((col: Collection) => (
                    <button
                      key={col.id}
                      onClick={() => toggleCollection(col.id)}
                      className={`om-coll-chip${editCollectionIds.includes(col.id) ? ' active' : ''}`}
                    >
                      {col.emoji} {col.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* AI Summary block (when generated) */}
            {!isEditing && memo.ai_summary && (
              <div className="om-ai-summary" style={{ marginBottom: '24px' }}>
                <div className="om-ai-summary-head">
                  <Sparkles size={16} className="om-accent-icon" />
                  <span className="om-ai-summary-label">AI Summary</span>
                </div>
                <div className="om-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.ai_summary}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Report card for file-backed memos (doc / code / generic file) */}
            {!isEditing && (memo.type === 'document' || memo.type === 'code' || memo.type === 'file') && (
              <DocReportCard memo={memo} />
            )}

            {/* Header action row — same component, same metrics, real gap */}
            {!isEditing && (
              <div className="om-detail-actions">
                <button
                  onClick={togglePin}
                  className="om-btn-ghost om-btn-pill"
                  title={memo.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                  aria-pressed={!!memo.pinned}
                >
                  {memo.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  <span>{memo.pinned ? 'Unpin' : 'Pin to sidebar'}</span>
                </button>
                {!memo.ai_summary && (
                  <button
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                    className="om-btn-ghost om-btn-pill"
                    style={{ opacity: generatingSummary ? 0.4 : undefined }}
                  >
                    {generatingSummary ? <Loader2 size={14} className="om-spin" /> : <Sparkles size={14} />}
                    <span>Generate AI Summary</span>
                  </button>
                )}
                {memo.file_path && (
                  <a
                    className="om-btn-ghost om-btn-pill"
                    href={`/api/memos/${memo.id}/file?download=1`}
                    download
                  >
                    <Download size={14} />
                    <span>Download original</span>
                  </a>
                )}
              </div>
            )}

            {/* Image preview — with lightbox, theater, fullscreen. Uploaded
                images serve from the file route; scraped image memos (a Facebook
                /photo, an Instagram/X photo, etc.) have no local file — their
                real, localized image lives in thumbnail_path. */}
            {memo.type === 'image' && !isEditing && (memo.file_path || memo.thumbnail_path) && (
              <MediaPreview
                src={memo.file_path ? `/api/memos/${memo.id}/file` : memo.thumbnail_path || ''}
                alt={memo.title}
                kind="image"
              />
            )}

            {/* Local video preview — with theater + fullscreen */}
            {memo.type === 'video' && memo.file_path && !isEditing && (
              <MediaPreview src={`/api/memos/${memo.id}/file`} alt={memo.title} kind="video" />
            )}

            {/* Audio memo — inline player + transcript below it */}
            {memo.type === 'audio' && memo.file_path && !isEditing && (
              <>
                <AudioMemoPlayer memo={memo} />
                <AudioTranscript memo={memo} />
              </>
            )}

            {/* Inline platform embed (YouTube, Vimeo, Instagram, TikTok, …) */}
            {videoEmbed && !isEditing && (
              <div className="om-video-embed" style={{ marginBottom: '24px' }}>
                <iframe
                  src={videoEmbed}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  scrolling="no"
                  title={memo.title}
                />
              </div>
            )}

            {/* Remote audio (yt-dlp pull, no local file). Auto-download in flight
                or errored → progress/retry panel; otherwise (auto-download off) →
                stream it inline via the platform embed.
                canMakeLocal() confirms type === "audio", has source_url, no file_path,
                and localize_status !== "done" before rendering either panel. */}
            {!isEditing && canMakeLocal(memo) && memo.type === 'audio' && (
              memo.localize_status ? (
                <MakeItLocalPanel memo={memo} />
              ) : (
                <AudioStreamEmbed memo={memo} />
              )
            )}

            {/* Make it local — remote video with no local file yet
                (YouTube, Vimeo, Instagram, TikTok, Vimeo, etc.).
                canMakeLocal() ensures this NEVER shows for article, link, image,
                note, document, code, or file memo types. */}
            {!isEditing && canMakeLocal(memo) && memo.type === 'video' && (
              <MakeItLocalPanel memo={memo} />
            )}

            {/* Video description + transcript tabs for YouTube/social video memos */}
            {!isEditing && memo.type === 'video' && memo.source_url && (
              <VideoContentPanel memo={memo} />
            )}

            {/* Transcript for locally uploaded video files (no source URL) */}
            {!isEditing && memo.type === 'video' && !memo.source_url && memo.file_path &&
              (memo.transcript_status || memo.content_text) && (
              <AudioTranscript memo={memo} />
            )}

            {/* Rich Web Preview for article/link */}
            {isWebType && !isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-web-card">
                  {memo.thumbnail_path && (
                    <div className="om-web-card-thumb">
                      <img src={memo.thumbnail_path} alt="" onError={(e) => { (e.target as HTMLImageElement).closest('.om-web-card-thumb')?.remove(); }} />
                    </div>
                  )}
                  <div className="om-web-card-body">
                    <div className="om-web-card-source">
                      {memo.source_favicon ? (
                        <img src={memo.source_favicon} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                      ) : (
                        <GlobeIcon size={18} className="om-section-icon" />
                      )}
                      <span className="om-web-card-domain">{memo.source_domain || 'Website'}</span>
                    </div>
                    <h2 className="om-web-card-title">{memo.title}</h2>
                    {memo.description && (
                      <p className="om-web-card-desc">{memo.description}</p>
                    )}
                    <a
                      href={memo.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="om-btn-primary om-btn-pill"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Open Original
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>

                {/* Collapsible extracted content */}
                {(memo.content_text || memo.content_raw) && (
                  <div style={{ marginTop: '16px' }}>
                    <button
                      onClick={() => setShowExtracted(!showExtracted)}
                      className="om-extracted-toggle"
                    >
                      {showExtracted ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {showExtracted ? 'Hide extracted content' : 'Show extracted content'}
                    </button>
                    {showExtracted && (
                      <div className="om-extracted-body om-prose">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_raw || memo.content_text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Content body for note */}
            {memo.type === 'note' && !isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <MarkdownEditor
                  viewFirst
                  value={noteContent}
                  onSave={(val) => {
                    setNoteContent(val);
                    memoApi.update(memo.id, { content_raw: val, content_text: val }).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['memo', id] });
                      queryClient.invalidateQueries({ queryKey: ['memos'] });
                    });
                  }}
                  placeholder="Click to write your note..."
                />
              </div>
            )}

            {/* Document / code content */}
            {(memo.type === 'document' || memo.type === 'code') && !isEditing && memo.content_text && (
              <div className="om-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_raw || memo.content_text}</ReactMarkdown>
              </div>
            )}

            {/* Edit: Content */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <label className="om-field-label-block">Content</label>
                <MarkdownEditor
                  value={editContent}
                  onChange={(val) => setEditContent(val)}
                  placeholder="Write content..."
                />
              </div>
            )}

            {/* Notes section */}
            <div className="om-notes-section">
              <div className="om-notes-head">
                <div className="om-notes-label">
                  <Pencil size={16} className="om-section-icon" />
                  <h3 className="om-section-h">My Notes</h3>
                </div>
                {notesSaving && <Loader2 size={14} className="om-section-icon om-spin" />}
              </div>
              <MarkdownEditor
                viewFirst={!isEditing}
                value={isEditing ? editNotes : notesDraft}
                onChange={isEditing ? (val) => setEditNotes(val) : (val) => setNotesDraft(val)}
                onSave={(val) => {
                  if (isEditing) return;
                  memoApi.update(memo.id, { notes: val }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['memo', id] });
                  });
                }}
                placeholder="Click to add your thoughts, annotations, or highlights..."
              />
            </div>

            {/* Related memos */}
            {!isEditing && related.length > 0 && (
              <div className="om-related">
                <h3 className="om-section-h">Related Memos</h3>
                <div className="om-related-strip">
                  {related.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/memo/${r.id}`)}
                      className="om-related-card"
                    >
                      <p className="om-related-card-title">{r.title}</p>
                      <p className="om-related-card-meta">{r.source_domain || r.type}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat pane */}
      {chatOpen && (
        <div className="om-detail-chat">
          <AskMemoPanel memoId={id!} />
        </div>
      )}
    </div>
  );
}

function GlobeIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size || 24}
      height={size || 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
