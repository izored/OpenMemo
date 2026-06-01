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
  notes?: string;
  // Speech-to-text state for audio memos. The transcript text itself lives in
  // content_text (so it embeds + is searchable); these track UI state + the
  // detected language.
  transcript_status?: 'pending' | 'processing' | 'done' | 'error' | null;
  transcript_lang?: string | null;
  // "Make it local" (yt-dlp download) state for link/video memos.
  localize_status?: 'pending' | 'processing' | 'done' | 'error' | null;
  sort_order?: number;
  pinned?: boolean;
  is_processed: boolean;
  created_at: string;
  updated_at: string;
  collections: CollectionRef[];
  tags: string[];
}

export type MemoType = 'note' | 'article' | 'video' | 'image' | 'audio' | 'document' | 'link' | 'code' | 'file';

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
  pinned: boolean;
  sort_order: number;
  created_at: string;
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
