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
  list: (params?: { type?: string; collection_id?: string; search?: string; offset?: number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.type && params.type !== 'all') search.set('type', params.type);
    if (params?.collection_id) search.set('collection_id', params.collection_id);
    if (params?.search) search.set('search', params.search);
    if (params?.offset) search.set('offset', String(params.offset));
    if (params?.limit) search.set('limit', String(params.limit));
    return fetchJSON<{ items: any[]; total: number }>(`/memos?${search}`);
  },
  get: (id: string) => fetchJSON<any>(`/memos/${id}`),
  create: (data: any) => fetchJSON<{ id: string }>('/memos', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => fetchJSON<any>(`/memos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setRecency: (id: string, recency_at: string) =>
    fetchJSON<{ id: string; recency_at: string }>(`/memos/${id}/recency`, { method: 'PUT', body: JSON.stringify({ recency_at }) }),
  pin: (id: string, pinned: boolean) => fetchJSON<{ id: string; pinned: boolean }>(`/memos/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  listPinned: () => fetchJSON<{ id: string; type: string; title: string; thumbnail_path?: string; source_domain?: string; source_favicon?: string; pinned: boolean }[]>('/memos/pinned/list'),
  delete: (id: string) => fetchJSON<any>(`/memos/${id}`, { method: 'DELETE' }),
  summary: (id: string) => fetchJSON<{ summary: string }>(`/memos/${id}/summary`, { method: 'POST' }),
  related: (id: string) => fetchJSON<any[]>(`/memos/${id}/related`),
};

// Ingestion
export const ingestApi = {
  url: (url: string, collection_id?: string) =>
    fetchJSON<{ id: string; title: string }>('/ingest/url', {
      method: 'POST',
      body: JSON.stringify({ url, collection_id }),
    }),
  note: (title: string, content: string, collection_id?: string) =>
    fetchJSON<{ id: string }>('/ingest/note', {
      method: 'POST',
      body: JSON.stringify({ title, content, collection_id }),
    }),
  file: async (file: File, collection_id?: string, workspace_id?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (collection_id) form.append('collection_id', collection_id);
    if (workspace_id) form.append('workspace_id', workspace_id);
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
};

// Collections
export const collectionApi = {
  list: () => fetchJSON<any[]>('/collections'),
  create: (data: { name: string; emoji?: string; description?: string; color?: string }) =>
    fetchJSON<{ id: string }>('/collections', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    fetchJSON<any>(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => fetchJSON<any>(`/collections/${id}`, { method: 'DELETE' }),
  addMemo: (collectionId: string, memoId: string) =>
    fetchJSON<any>(`/collections/${collectionId}/memos/${memoId}`, { method: 'POST' }),
  removeMemo: (collectionId: string, memoId: string) =>
    fetchJSON<any>(`/collections/${collectionId}/memos/${memoId}`, { method: 'DELETE' }),
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
  }) => {
    return fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
};

// Backup & Restore
export const backupApi = {
  download: async (scope: 'structure' | 'full'): Promise<void> => {
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
};

// Runtime user-configurable settings (persisted as JSON server-side).
export interface AppSettings {
  max_upload_mb: number;
  display_name: string;
  email: string;
  avatar_data_url: string;
  mailing_list_consent: boolean;
}

export const settingsApi = {
  get: () => fetchJSON<AppSettings>('/settings'),
  update: (patch: Partial<AppSettings>) =>
    fetchJSON<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
};

export const maintenanceApi = {
  clearCache: () => fetchJSON<{ ok: boolean; freed_bytes: number }>('/maintenance/clear-cache', { method: 'POST' }),
  localize: () => fetchJSON<{ memos_updated: number; images_localized: number }>('/maintenance/localize', { method: 'POST' }),
  reset: () => fetchJSON<{ ok: boolean }>('/maintenance/reset', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
};

// Search
export const searchApi = {
  search: (q: string) => fetchJSON<{ results: any[] }>(`/search?q=${encodeURIComponent(q)}`),
};

// Health & Models
export const systemApi = {
  health: () => fetchJSON<{ status: string; ollama_connected: boolean; version: string }>('/health'),
  models: () => fetchJSON<{ models: any[] }>('/models'),
  stats: () => fetchJSON<{
    total_memos: number;
    total_collections: number;
    total_tags: number;
    memos_this_week: number;
    by_type: Record<string, number>;
    storage?: { db_bytes: number; files_bytes: number; cache_bytes: number; total_bytes: number };
  }>('/stats'),
};
