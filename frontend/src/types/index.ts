export interface Memo {
  id: string;
  type: MemoType;
  title: string;
  description?: string;
  content_text?: string;
  content_raw?: string;
  video_description?: string;
  source_url?: string;
  source_domain?: string;
  source_favicon?: string;
  file_path?: string;
  thumbnail_path?: string;
  ai_summary?: string;
  // On-demand AI summaries cached per mode (timestamp | insights | essay).
  summaries?: Partial<Record<SummaryMode, string>> | null;
  notes?: string;
  // Transcript state for video/audio memos. The transcript text itself lives in
  // content_text (so it embeds + is searchable); these track UI state, the
  // detected language, and how it was obtained (host captions vs Whisper STT).
  transcript_status?: 'pending' | 'processing' | 'done' | 'error' | null;
  transcript_lang?: string | null;
  transcript_source?: 'captions' | 'stt' | null;
  // "Make it local" (yt-dlp download) state for link/video memos.
  localize_status?: 'pending' | 'processing' | 'done' | 'error' | null;
  // Last yt-dlp failure reason (truncated) — lets the UI tell an age/login gate
  // ("needs cookies") apart from a region-lock / unsupported source.
  localize_error?: string | null;
  // Audio sub-kind (ADR-005): 'voice' = mic recording (waveform, no aurora),
  // 'music' = uploaded file or linked SoundCloud/Bandcamp/… (cover player +
  // inline card player + aurora). Absent/null for non-audio memos.
  audio_kind?: 'voice' | 'music' | null;
  /** Artist from an uploaded music file's tags (ID3/Vorbis/…), when present. */
  audio_artist?: string | null;
  /** Album name (music only) — Qobuz match on SpotiFLAC downloads, or the
   *  source album's name at ingest. */
  audio_album?: string | null;
  sort_order?: number;
  pinned?: boolean;
  /** Liked track (music surfaces: heart on the tile, wide tile, Play liked). */
  liked?: boolean;
  /** Hidden from the main dashboard (still visible in collections); listed in
   *  the passcode-gated hidden section. */
  hidden?: boolean;
  is_processed: boolean;
  created_at: string;
  updated_at: string;
  collections: CollectionRef[];
  tags: string[];
}

export type MemoType = 'note' | 'article' | 'video' | 'image' | 'audio' | 'document' | 'link' | 'code' | 'file';

export type SummaryMode = 'timestamp' | 'insights' | 'essay';

export interface CollectionRef {
  id: string;
  name: string;
  color: string;
}

export interface Collection {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  color: string;
  // Collection sub-kind (ADR-015): 'standard' = normal collection,
  // 'playlist' = music playlist (Music page only). The API defaults to
  // standard, so existing surfaces never see playlists.
  kind?: 'standard' | 'playlist';
  /** Playlists: the source playlist URL they were ingested from. */
  source_url?: string | null;
  pinned: boolean;
  sort_order: number;
  created_at: string;
}

/** A music playlist as served by /api/music/playlists (ADR-015). */
export interface MusicPlaylist {
  id: string;
  name: string;
  source_url?: string | null;
  /** What the source was: an album shows a single cover + "Album" label,
   *  a playlist keeps the 4-cover collage. */
  music_kind: 'album' | 'playlist';
  created_at: string;
  track_count: number;
  /** Up to 4 track cover URLs for the collage. */
  covers: string[];
  /** Download progress derived from per-track localize_status. `pending`
   *  counts tracks actively queued/downloading; remote tracks saved without
   *  downloading count in none of done/error/pending. */
  progress: { total: number; done: number; error: number; pending: number; active?: boolean };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: ChatSource[];
  created_at: string;
}

export interface ChatSource {
  memo_id: string;
  title: string;
  domain: string;
  snippet: string;
  distance: number;
}

export interface ChatSession {
  id: string;
  title: string;
  model_used?: string;
  collection_id?: string;
  memo_id?: string;
  created_at: string;
}

export interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
}
