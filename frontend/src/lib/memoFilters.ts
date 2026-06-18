// The dashboard memo-type filter tabs, shared so the Space home shows the same
// set (and the same id→params mapping) without duplicating the list.

export interface MemoFilterDef { id: string; label: string }

export const MEMO_FILTERS: MemoFilterDef[] = [
  { id: 'all', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'link', label: 'Links' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  // The audio tab split in two (OPNMMO-0023): `type:audio_kind` ids map to the
  // server's audio_kind filter — music and voice are different things.
  { id: 'audio:music', label: 'Music' },
  { id: 'audio:voice', label: 'Voice' },
  { id: 'code', label: 'Code' },
  // Files = real documents + generic uploads. Comma group expands server-side
  // into a Memo.type IN (...) filter.
  { id: 'document,file', label: 'Files' },
];

/** Turn an activeFilter id into memo-list params (type + optional audio_kind). */
export function filterToParams(
  activeFilter: string,
): { type?: string; audio_kind?: 'voice' | 'music' } {
  if (activeFilter === 'all') return {};
  const [type, kind] = activeFilter.split(':');
  const params: { type?: string; audio_kind?: 'voice' | 'music' } = { type };
  if (kind === 'voice' || kind === 'music') params.audio_kind = kind;
  return params;
}
