/* eslint-disable @typescript-eslint/no-explicit-any */
const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(error.detail || 'Request failed');
  }
  return resp.json();
}

// Memos
export const memoApi = {
  list: (params?: { type?: string; audio_kind?: 'voice' | 'music'; collection_id?: string; search?: string; hidden?: boolean; liked?: boolean; sort?: 'recent' | 'title' | 'artist'; offset?: number; limit?: number; workspace_id?: string }) => {
    const search = new URLSearchParams();
    // Spaces isolation (ADR-020): pass a Space's workspace_id to scope to it;
    // omit it and the server returns the main library only.
    if (params?.workspace_id) search.set('workspace_id', params.workspace_id);
    if (params?.type && params.type !== 'all') search.set('type', params.type);
    if (params?.audio_kind) search.set('audio_kind', params.audio_kind);
    if (params?.collection_id) search.set('collection_id', params.collection_id);
    if (params?.search) search.set('search', params.search);
    // hidden=true lists ONLY hidden memos (the passcode-gated hidden section).
    // Omitted = dashboard behavior (hidden memos excluded server-side).
    if (params?.hidden) search.set('hidden', 'true');
    // liked=true: every liked track, INCLUDING playlist-born ones (Favourite
    // Songs queue, OPNMMO-0041). Bypasses the playlist-born feed exclusion.
    if (params?.liked) search.set('liked', 'true');
    if (params?.sort && params.sort !== 'recent') search.set('sort', params.sort);
    if (params?.offset) search.set('offset', String(params.offset));
    if (params?.limit) search.set('limit', String(params.limit));
    return fetchJSON<{ items: any[]; total: number; offset: number; limit: number }>(`/memos?${search}`);
  },
  get: (id: string) => fetchJSON<any>(`/memos/${id}`),
  create: (data: any) => fetchJSON<{ id: string }>('/memos', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => fetchJSON<any>(`/memos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setRecency: (id: string, recency_at: string) =>
    fetchJSON<{ id: string; recency_at: string }>(`/memos/${id}/recency`, { method: 'PUT', body: JSON.stringify({ recency_at }) }),
  pin: (id: string, pinned: boolean) => fetchJSON<{ id: string; pinned: boolean }>(`/memos/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  like: (id: string, liked: boolean) => fetchJSON<{ id: string; liked: boolean }>(`/memos/${id}/like`, { method: 'PUT', body: JSON.stringify({ liked }) }),
  hide: (id: string, hidden: boolean) => fetchJSON<{ id: string; hidden: boolean }>(`/memos/${id}/hide`, { method: 'PUT', body: JSON.stringify({ hidden }) }),
  // Dashboard tile size — 'wide' spans two grid columns, 'normal' resets.
  setCardSize: (id: string, size: 'normal' | 'wide') =>
    fetchJSON<{ id: string; card_size: string | null }>(`/memos/${id}/card-size`, { method: 'PUT', body: JSON.stringify({ size }) }),
  listPinned: (workspace_id?: string) => fetchJSON<{ id: string; type: string; title: string; thumbnail_path?: string; source_domain?: string; source_favicon?: string; pinned: boolean }[]>(`/memos/pinned/list${workspace_id ? `?workspace_id=${encodeURIComponent(workspace_id)}` : ''}`),
  delete: (id: string) => fetchJSON<any>(`/memos/${id}`, { method: 'DELETE' }),
  restore: (id: string) => fetchJSON<any>(`/memos/${id}/restore`, { method: 'POST' }),
  listDeleted: () => fetchJSON<{ id: string; type: string; title: string; deleted_at: string | null }[]>('/memos/deleted/list'),
  summary: (id: string, mode: 'timestamp' | 'insights' | 'essay' = 'insights', model?: string) =>
    fetchJSON<{ id: string; mode: string; summary: string | null; status?: 'transcript_pending' }>(`/memos/${id}/summary`, {
      method: 'POST',
      body: JSON.stringify({ mode, model: model || undefined }),
    }),
  related: (id: string) => fetchJSON<any[]>(`/memos/${id}/related`),
  transcribe: (id: string) =>
    fetchJSON<{ id: string; status: string }>(`/memos/${id}/transcribe`, { method: 'POST' }),
  localize: (id: string, mode: 'video' | 'audio', quality: number = 1080) =>
    fetchJSON<{ id: string; status: string; mode: string }>(`/memos/${id}/localize`, {
      method: 'POST',
      body: JSON.stringify({ mode, quality }),
    }),
  // Set a custom thumbnail (already cropped client-side) for any memo. Multipart;
  // the browser sets the boundary, so don't add a Content-Type header.
  uploadThumbnail: async (id: string, file: Blob): Promise<{ thumbnail_path: string }> => {
    const form = new FormData();
    form.append('file', file, 'thumbnail');
    const resp = await fetch(`${API_BASE}/memos/${id}/thumbnail`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Thumbnail upload failed');
    }
    return resp.json();
  },
};

// Ingestion
export const ingestApi = {
  // `no_pull` saves the URL as a plain link, skipping the heavy visual pull
  // (yt-dlp / headless / media scrape) for pages that choke the pipeline or
  // when the user just wants the bookmark (OPNMMO-0049).
  // `audioOnly` (Music page "+"): file the link as a music memo and pull the
  // audio track, even for video hosts like YouTube.
  url: (url: string, collection_id?: string, opts?: { noPull?: boolean; audioOnly?: boolean; workspace_id?: string }) =>
    fetchJSON<{ id: string; title: string }>('/ingest/url', {
      method: 'POST',
      body: JSON.stringify({ url, collection_id, no_pull: opts?.noPull ?? false, audio_only: opts?.audioOnly ?? false, workspace_id: opts?.workspace_id }),
    }),
  note: (title: string, content: string, collection_id?: string, workspace_id?: string) =>
    fetchJSON<{ id: string }>('/ingest/note', {
      method: 'POST',
      body: JSON.stringify({ title, content, collection_id, workspace_id }),
    }),
  // Enumerate a playlist URL (flat, no downloads) so the panel can ask
  // "whole playlist or just this one?" with a real title + count (ADR-015).
  probePlaylist: (url: string) =>
    fetchJSON<{
      is_playlist: boolean;
      title: string;
      uploader?: string | null;
      count: number;
      truncated: boolean;
      entries: { url: string; title: string; artist?: string | null; thumbnail?: string | null }[];
      // Set when a playlist collection with this source URL already exists —
      // the panel shows "already saved" instead of offering a duplicate pull.
      already_saved?: { id: string; name: string } | null;
    }>('/ingest/playlist/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  // Ingest a whole playlist: creates a playlist collection + one audio memo
  // per track. download=true starts the sequential background download;
  // download=false keeps tracks remote (pull them later, per track or all).
  // status 'exists' = this URL was already pulled; collection_id points at it.
  playlist: (url: string, opts?: { title?: string; download?: boolean }) =>
    fetchJSON<{ collection_id: string; title: string; total: number; truncated: boolean; status: string }>(
      '/ingest/playlist',
      { method: 'POST', body: JSON.stringify({ url, title: opts?.title, download: opts?.download ?? true }) },
    ),
  // Preview a Spotify track / album / playlist link (no download). The Music
  // add-modal shows a real title + track count and flags an already-saved one.
  probeSpotify: (url: string) =>
    fetchJSON<{
      kind: 'track' | 'album' | 'playlist';
      title: string;
      artist?: string | null;
      cover?: string | null;
      count: number;
      entries?: { title: string; artist?: string | null }[];
      already_saved?: { id: string; name: string } | null;
    }>('/ingest/spotify/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  // Ingest a Spotify link as lossless music (SpotiFLAC). A track → one music
  // memo; an album/playlist → a playlist collection + one memo per track.
  // quality: '16' (CD) | '24' (hi-res). download=false saves remote, pull later.
  spotify: (
    url: string,
    opts?: { download?: boolean; quality?: '16' | '24'; title?: string; collection_id?: string },
  ) =>
    fetchJSON<{
      id?: string; collection_id?: string; title: string; type?: string;
      total?: number; status: string;
    }>('/ingest/spotify', {
      method: 'POST',
      body: JSON.stringify({
        url,
        download: opts?.download ?? true,
        quality: opts?.quality,
        title: opts?.title,
        collection_id: opts?.collection_id,
      }),
    }),
  // Preview an Apple Music link (no download). Same shapes as probeSpotify —
  // Apple Music is the second lossless front-end (ADR-019).
  probeApple: (url: string) =>
    fetchJSON<{
      kind: 'track' | 'album' | 'playlist';
      title: string;
      artist?: string | null;
      cover?: string | null;
      count: number;
      entries?: { title: string; artist?: string | null }[];
      already_saved?: { id: string; name: string } | null;
    }>('/ingest/apple/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  // Ingest an Apple Music link as lossless music (Qobuz audio). Verbatim sibling
  // of `spotify` — a track → one memo; an album/playlist → collection + tracks.
  apple: (
    url: string,
    opts?: { download?: boolean; quality?: '16' | '24'; title?: string; collection_id?: string },
  ) =>
    fetchJSON<{
      id?: string; collection_id?: string; title: string; type?: string;
      total?: number; status: string;
    }>('/ingest/apple', {
      method: 'POST',
      body: JSON.stringify({
        url,
        download: opts?.download ?? true,
        quality: opts?.quality,
        title: opts?.title,
        collection_id: opts?.collection_id,
      }),
    }),
  file: async (
    file: File,
    collection_id?: string,
    workspace_id?: string,
    opts?: { typeOverride?: string; transcribe?: boolean; audioKind?: 'voice' | 'music' },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (collection_id) form.append('collection_id', collection_id);
    if (workspace_id) form.append('workspace_id', workspace_id);
    // type_override pins the memo type when the extension would mis-file it
    // (a mic recording lands in a .webm container → would be "video").
    if (opts?.typeOverride) form.append('type_override', opts.typeOverride);
    if (opts?.transcribe) form.append('transcribe', 'true');
    // audio_kind flags a mic recording as 'voice' (ADR-005) so it keeps the
    // waveform UI and is excluded from the music-only player/aurora treatment.
    if (opts?.audioKind) form.append('audio_kind', opts.audioKind);
    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}/ingest/file`, { method: 'POST', body: form });
    } catch (e) {
      // fetch() throws TypeError when the connection is dropped mid-stream
      // (e.g. a reverse proxy kills the upload because of a body-size cap).
      // Surface a useful hint instead of "Failed to fetch".
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(
        `Upload aborted (${sizeMb} MB). The server or a proxy refused the request before a response arrived. ` +
        `If you are behind nginx/Docker, raise client_max_body_size; in dev mode make sure the Vite proxy points to uvicorn (default :8099).`,
        { cause: e },
      );
    }
    if (!resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      let detail: string;
      if (contentType.includes('application/json')) {
        const error = await resp.json().catch(() => ({ detail: resp.statusText }));
        detail = error.detail || resp.statusText;
      } else {
        // nginx returns HTML for 413/502 etc — give the user something readable.
        detail = `${resp.status} ${resp.statusText}`;
      }
      throw new Error(detail || 'Upload failed');
    }
    return resp.json();
  },
  // Import local audio as an auto-grouped album (or one playlist) in a single
  // request. Drop tracks plus an optional cover image; mode="album" groups by
  // each file's embedded album tag, mode="playlist" makes one playlist. A
  // dropped image wins as the cover, else embedded art is used.
  album: async (
    files: File[],
    opts?: { mode?: 'album' | 'playlist'; name?: string; workspace_id?: string },
  ) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    form.append('mode', opts?.mode ?? 'album');
    if (opts?.name) form.append('name', opts.name);
    if (opts?.workspace_id) form.append('workspace_id', opts.workspace_id);
    const resp = await fetch(`${API_BASE}/ingest/album`, { method: 'POST', body: form });
    if (!resp.ok) {
      const ct = resp.headers.get('content-type') || '';
      const detail = ct.includes('application/json')
        ? (await resp.json().catch(() => ({ detail: resp.statusText }))).detail
        : `${resp.status} ${resp.statusText}`;
      throw new Error(detail || 'Album upload failed');
    }
    return resp.json() as Promise<{
      collection_id: string;
      title: string;
      total: number;
      collections: { collection_id: string; title: string; tracks: number }[];
      status: string;
    }>;
  },
};

// Collections
export const collectionApi = {
  // Spaces isolation (ADR-020): omit workspace_id for the main library; pass a
  // Space's id to list only its collections.
  list: (workspace_id?: string) =>
    fetchJSON<any[]>(`/collections${workspace_id ? `?workspace_id=${encodeURIComponent(workspace_id)}` : ''}`),
  create: (data: { name: string; emoji?: string; description?: string; color?: string; kind?: 'standard' | 'playlist'; music_kind?: 'album' | 'playlist' | 'hero'; pinned?: boolean; workspace_id?: string }) =>
    fetchJSON<{ id: string }>('/collections', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    fetchJSON<any>(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => fetchJSON<any>(`/collections/${id}`, { method: 'DELETE' }),
  addMemo: (collectionId: string, memoId: string) =>
    fetchJSON<any>(`/collections/${collectionId}/memos/${memoId}`, { method: 'POST' }),
  removeMemo: (collectionId: string, memoId: string) =>
    fetchJSON<any>(`/collections/${collectionId}/memos/${memoId}`, { method: 'DELETE' }),
  // Custom playlist/album cover (already cropped client-side). Multipart — no
  // Content-Type header so the browser sets the multipart boundary.
  uploadCover: async (id: string, file: Blob): Promise<{ cover_url: string | null }> => {
    const form = new FormData();
    form.append('file', file, 'cover');
    const resp = await fetch(`${API_BASE}/collections/${id}/cover`, { method: 'POST', body: form });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || 'Cover upload failed');
    return resp.json();
  },
  deleteCover: (id: string) =>
    fetchJSON<{ cover_url: null }>(`/collections/${id}/cover`, { method: 'DELETE' }),
};

// Music page (ADR-015). Tracks come from memoApi.list (type=audio,
// audio_kind=music, optional collection_id=<playlist>).
export const musicApi = {
  playlists: () => fetchJSON<import('@/types').MusicPlaylist[]>('/music/playlists'),
  // "Download all" — queue every still-remote track of a playlist.
  downloadPlaylist: (id: string) =>
    fetchJSON<{ id: string; queued: number; status: string }>(`/music/playlists/${id}/download`, { method: 'POST' }),
  // Pause a running bulk pass — the in-flight track finishes, the rest reset.
  pausePlaylistDownload: (id: string) =>
    fetchJSON<{ id: string; reset: number; status: string }>(`/music/playlists/${id}/download/pause`, { method: 'POST' }),
};

// Chat
export const chatApi = {
  sessions: () => fetchJSON<any[]>('/chat/sessions'),
  messages: (sessionId: string) => fetchJSON<any[]>(`/chat/sessions/${sessionId}/messages`),
  deleteSession: (sessionId: string) => fetchJSON<any>(`/chat/sessions/${sessionId}`, { method: 'DELETE' }),
  stream: (data: {
    query: string;
    session_id?: string;
    collection_id?: string;
    memo_id?: string;
    model?: string;
    use_rag?: boolean;
  }, signal?: AbortSignal) => {
    return fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal,
    });
  },
};

// Backup & Restore
export const backupApi = {
  download: async (scope: 'structure' | 'essential' | 'full'): Promise<void> => {
    const resp = await fetch(`${API_BASE}/backup?scope=${scope}`, { method: 'POST' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Backup failed');
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const cd = resp.headers.get('content-disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const a = document.createElement('a');
    a.href = url;
    a.download = match?.[1] || `openmemo-backup-${scope}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },
  restore: async (file: File): Promise<{ ok: boolean; scope: string; version: string }> => {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`${API_BASE}/backup/restore`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Restore failed');
    }
    return resp.json();
  },
  // Scheduled archives written to disk (core/archive.py), as opposed to the
  // browser downloads above. Each one is verified after writing.
  listArchives: () => fetchJSON<ArchiveListing>('/backup/archives'),
  runArchive: (scope: 'database' | 'essential' | 'full') =>
    fetchJSON<ArchiveRun>(`/backup/archives?scope=${scope}`, { method: 'POST' }),
};

export interface ArchiveRun {
  ok: boolean;
  scope: string;
  name?: string;
  bytes?: number;
  memos?: number;
  media_files?: number;
  verified?: boolean;
  created_at?: string;
  reason?: string;
}

export interface ArchiveListing {
  destination: string;
  schedule: Record<string, { every_s: number; keep: number }>;
  runs: Record<string, ArchiveRun>;
  archives: { name: string; scope: string; bytes: number; created_at: string }[];
  total_bytes: number;
}

// Runtime user-configurable settings (persisted as JSON server-side).
export interface AppSettings {
  max_upload_mb: number;
  display_name: string;
  email: string;
  avatar_data_url: string;
  mailing_list_consent: boolean;
  auto_download_audio: boolean;
  auto_download_video: boolean;
  // Spotify → FLAC lossless quality: '16' (CD) | '24' (hi-res). SpotiFLAC.
  music_quality: '16' | '24';
  // Preferred lossless source — only 'qobuz' is wired today.
  music_provider: string;
  // Default Ollama chat model for AI features, server-side so every client
  // and the backend's own calls (summaries) agree. '' = backend env default.
  chat_model: string;
  // Ollama context window (num_ctx) for chat/summary calls. 0 = backend env
  // default (8192); a positive value overrides it (clamped 512–131072 server-side).
  num_ctx: number;
  // Read-only flag: whether a yt-dlp cookie jar is on the server. The jar
  // itself is never sent over the API (it's account credentials).
  yt_cookies_present: boolean;
  // Extension of the active custom background image (server-stored, full
  // quality), or '' if none. The image is served at /api/settings/background.
  bg_image_ext: string;
  // Read-only flag: whether a hidden-section passcode exists. The hash itself
  // never crosses the API.
  hidden_passcode_set: boolean;
  // Telegram capture relay (ADR-020). The bot token itself never crosses the
  // API — only the presence flag does; the owner lock is auto-captured from
  // the first sender.
  telegram_enabled: boolean;
  telegram_poll_minutes: number;
  telegram_default_collection: string;
  // Pull media locally for every bot save (download on save regardless of the
  // embed-host rule) so on-the-go captures survive takedown.
  telegram_force_localize: boolean;
  /** Mesh (ADR-024): two-way device sync. Gates the whole feature. */
  mesh_enabled: boolean;
  /** Where scheduled archives are written. '' = data/backups. Worth pointing
   *  outside the app directory, so wiping the app cannot wipe its backups. */
  backup_dest: string;
  telegram_token_present: boolean;
  telegram_user_locked: boolean;
}

export interface TelegramRelayStatus {
  running: boolean;
  last_poll_at: string | null;
  last_error: string | null;
  saved_count: number;
  telegram_token_present: boolean;
  telegram_user_locked: boolean;
}

// ── Mesh (ADR-024) ────────────────────────────────────────────────────────
// Every endpoint 404s while Mesh is off, so callers must tolerate that rather
// than treating it as an error worth showing.

export interface MeshConflict {
  id: string;
  peer: string;
  tbl: string;
  row_id: string;
  field: string;
  local_value: string | null;
  remote_value: string | null;
  base_value: string | null;
  created_at: string;
}

export interface MeshBatch {
  batch_id: string;
  peer: string;
  at: string;
  changes: number;
  undone: number;
}

export type MeshChoice = 'local' | 'remote' | 'both';

export interface MeshDevice {
  device_id: string;
  name: string;
  last_seen: string | null;
  is_primary: boolean;
  revoked: boolean;
  is_this_device: boolean;
}

export const meshApi = {
  status: () => fetchJSON<{ enabled: boolean; paired: boolean; peers: unknown[] }>('/mesh/status'),
  conflicts: () => fetchJSON<{ conflicts: MeshConflict[]; count: number }>('/mesh/conflicts'),
  resolve: (id: string, choice: MeshChoice, applyToAll = false) =>
    fetchJSON<{ ok: boolean; copy_id?: string; resolved?: number }>(
      `/mesh/conflicts/${id}/resolve`,
      { method: 'POST', body: JSON.stringify({ choice, apply_to_all: applyToAll }) },
    ),
  history: (limit = 50) => fetchJSON<{ batches: MeshBatch[] }>(`/mesh/history?limit=${limit}`),
  undo: (batchId: string) =>
    fetchJSON<{ reverted: number }>(`/mesh/history/${batchId}/undo`, { method: 'POST' }),

  // Pairing. Every one of these 404s while Mesh is off, so callers treat a
  // failure as the disabled state rather than something to show the user.
  pairStart: () =>
    fetchJSON<{ code: string; words: string[]; in_keychain: boolean; uri: string }>(
      '/mesh/pair/start', { method: 'POST' },
    ),
  pairJoin: (code: string) =>
    fetchJSON<{ ok: boolean }>('/mesh/pair/join', {
      method: 'POST', body: JSON.stringify({ code }),
    }),
  pairCode: () =>
    fetchJSON<{ available: boolean; code: string | null; words: string[] }>('/mesh/pair/code'),
  devices: () =>
    fetchJSON<{ devices: MeshDevice[]; this_device: string }>('/mesh/devices'),
  revokeDevice: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/mesh/devices/${id}/revoke`, { method: 'POST' }),
  makePrimary: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/mesh/devices/${id}/primary`, { method: 'POST' }),
};

export const settingsApi = {
  get: () => fetchJSON<AppSettings>('/settings'),
  update: (patch: Partial<AppSettings>) =>
    fetchJSON<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  // Upload a Netscape cookies.txt so yt-dlp can fetch age-restricted / private
  // sources. Multipart — never set Content-Type by hand (the browser adds the
  // multipart boundary). Returns the new presence flag.
  uploadCookies: async (file: File): Promise<{ yt_cookies_present: boolean }> => {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`${API_BASE}/settings/cookies`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Cookie upload failed');
    }
    return resp.json();
  },
  deleteCookies: () =>
    fetchJSON<{ yt_cookies_present: boolean }>('/settings/cookies', { method: 'DELETE' }),
  // Telegram capture relay (ADR-020). Set (or clear, with '') the bot token;
  // the token itself is write-only — only a presence flag ever comes back.
  setTelegramToken: (token: string) =>
    fetchJSON<{ telegram_token_present: boolean }>('/settings/telegram/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resetTelegramUserLock: () =>
    fetchJSON<{ telegram_user_locked: boolean }>('/settings/telegram/user-lock', {
      method: 'DELETE',
    }),
  telegramStatus: () => fetchJSON<TelegramRelayStatus>('/settings/telegram/status'),
  // Instagram login (final-fallback session for IG pulls). Writes into the same
  // shared cookie jar. The password is never stored — used once to sign in.
  instagramStatus: () =>
    fetchJSON<{ connected: boolean; who: string | null }>('/settings/instagram/status'),
  // Are Instagram saves actually resolving, or only appearing to? A tier ladder
  // degrades silently — every tier returns a memo — so this reports which tiers
  // the last few saves really used.
  instagramHealth: () =>
    fetchJSON<{
      status: 'ok' | 'session_expired' | 'no_session';
      connected: boolean;
      checked: number;
      degraded: number;
      blocked: number;
      recent_tiers: string[];
    }>('/settings/instagram/health'),
  instagramImportSession: (cookies: string) =>
    fetchJSON<{ connected: boolean; who: string | null }>('/settings/instagram/session', {
      method: 'POST',
      body: JSON.stringify({ cookies }),
    }),
  instagramLogin: (username: string, password: string) =>
    fetchJSON<{ status: string; connected: boolean; who: string | null }>('/settings/instagram/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  instagramDisconnect: () =>
    fetchJSON<{ connected: boolean; who: string | null }>('/settings/instagram/session', {
      method: 'DELETE',
    }),
  // Upload a custom appearance background, stored full-quality server-side.
  // Returns the active extension; the image is served at /api/settings/background.
  uploadBackground: async (file: File): Promise<{ bg_image_ext: string }> => {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`${API_BASE}/settings/background`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Background upload failed');
    }
    return resp.json();
  },
  deleteBackground: () =>
    fetchJSON<{ bg_image_present: boolean }>('/settings/background', { method: 'DELETE' }),
  // Hidden-section passcode. Set (first open) or change (requires current).
  setHiddenPasscode: (passcode: string, current?: string) =>
    fetchJSON<{ hidden_passcode_set: boolean }>('/settings/hidden-passcode', {
      method: 'POST',
      body: JSON.stringify({ passcode, current }),
    }),
  verifyHiddenPasscode: (passcode: string) =>
    fetchJSON<{ ok: boolean }>('/settings/hidden-passcode/verify', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),
  // Do the files the database references still exist? Checked hourly in the
  // background; `status: 'incident'` means MORE are missing than at the last
  // check, which is the case worth acting on immediately.
  libraryIntegrity: () => fetchJSON<LibraryIntegrity>('/settings/library/integrity'),
  libraryIntegrityCheck: () =>
    fetchJSON<LibraryIntegrity>('/settings/library/integrity/check', { method: 'POST' }),
};

export interface LibraryIntegrity {
  status: 'ok' | 'missing' | 'incident';
  memos: number;
  with_media: number;
  missing_media: number;
  recoverable: number;
  unrecoverable: number;
  with_thumb: number;
  missing_thumbs: number;
  delta: number;
  checked_at: string;
  previous_checked_at: string | null;
}

export const maintenanceApi = {
  clearCache: () => fetchJSON<{ ok: boolean; freed_bytes: number }>('/maintenance/clear-cache', { method: 'POST' }),
  localize: () => fetchJSON<{ memos_updated: number; images_localized: number }>('/maintenance/localize', { method: 'POST' }),
  reset: () => fetchJSON<{ ok: boolean }>('/maintenance/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  // Rebuild the whole vector index (re-embed every memo, purge ghost chunks).
  // Slow-ish (one Ollama embed batch per memo) — show progress state in the UI.
  reindex: () =>
    fetchJSON<{ reindexed_memos: number; chunks_written: number; failed: number; ghost_chunks_purged: number }>(
      '/maintenance/reindex',
      { method: 'POST' },
    ),
};

// Search
export const searchApi = {
  search: (q: string) => fetchJSON<{ results: any[] }>(`/search?q=${encodeURIComponent(q)}`),
};

// Health & Models
export const systemApi = {
  health: () => fetchJSON<{ status: string; ollama_connected: boolean; version: string }>('/health'),
  models: () => fetchJSON<{ models: any[] }>('/models'),
  // Storage sizes are an expensive server-side filesystem walk — only request
  // them where they're shown (Settings). The sidebar omits the flag so its
  // per-page memo-count fetch stays instant.
  stats: (includeStorage = false, workspace_id?: string) => {
    const qs = new URLSearchParams();
    if (includeStorage) qs.set('include_storage', 'true');
    if (workspace_id) qs.set('workspace_id', workspace_id);
    const q = qs.toString();
    return fetchJSON<{
      total_memos: number;
      total_collections: number;
      total_tags: number;
      memos_this_week: number;
      by_type: Record<string, number>;
      storage?: { db_bytes: number; files_bytes: number; cache_bytes: number; total_bytes: number };
    }>(`/stats${q ? `?${q}` : ''}`);
  },
};

// Spaces (ADR-020): a Space is a workspace-backed area above collections.
export const spaceApi = {
  list: () => fetchJSON<import('@/types').Space[]>('/spaces'),
  get: (id: string) => fetchJSON<import('@/types').Space>(`/spaces/${id}`),
  create: (data: { name: string; emoji?: string; icon?: string; color?: string; description?: string }) =>
    fetchJSON<import('@/types').Space>('/spaces', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; emoji: string; icon: string; color: string; description: string; cover_pos: string; pinned: boolean; sort_order: number }>) =>
    fetchJSON<import('@/types').Space>(`/spaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Destructive: deletes the Space, its collections, AND all its memos. The
  // server refuses unless confirm_name matches the Space's exact name.
  delete: (id: string, confirm_name: string) =>
    fetchJSON<{ status: string; removed: { memos: number } }>(`/spaces/${id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ confirm_name }),
    }),
  // Notion-style cover image. Multipart upload (no Content-Type header — the
  // browser sets the multipart boundary). Returns the updated Space.
  uploadCover: async (id: string, file: File): Promise<import('@/types').Space> => {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`${API_BASE}/spaces/${id}/cover`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Cover upload failed');
    }
    return resp.json();
  },
  deleteCover: (id: string) =>
    fetchJSON<import('@/types').Space>(`/spaces/${id}/cover`, { method: 'DELETE' }),
  // Download a zip backup of the whole Space (memos as Markdown + manifest).
  exportZip: async (id: string, name: string): Promise<void> => {
    const resp = await fetch(`${API_BASE}/spaces/${id}/export`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Export failed');
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openmemo_space_${name.slice(0, 40).replace(/[^\w-]+/g, '_')}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
