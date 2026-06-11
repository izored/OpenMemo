import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { musicApi, collectionApi, memoApi } from '@/lib/api';

// "Add to playlist" popover (OPNMMO-0023 follow-up). One reusable surface for
// every place a music memo shows up: card actions, memo detail, the sidebar
// player. Lists playlists with membership ticks — click toggles the memo in or
// out; "New playlist" creates one (kind=playlist) and files the memo in it.
// Touch-first: no drag gesture required anywhere.
export function PlaylistMenu({
  memoId,
  memberIds,
  onClose,
}: {
  memoId: string;
  /** Collection ids this memo already belongs to (drives the ticks).
   *  Omit it and the menu fetches the memo to find out itself. */
  memberIds?: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: playlists = [] } = useQuery({
    queryKey: ['music-playlists'],
    queryFn: musicApi.playlists,
  });
  // Callers without the memo at hand (the sidebar player) omit memberIds —
  // fetch the memo once to seed the ticks.
  const { data: fetchedMemo } = useQuery({
    queryKey: ['memo', memoId],
    queryFn: () => memoApi.get(memoId),
    enabled: memberIds === undefined,
    staleTime: 10 * 1000,
  });
  // Optimistic membership — seeded from props/fetch, flipped locally per toggle.
  const [members, setMembers] = useState<Set<string> | null>(() =>
    memberIds !== undefined ? new Set(memberIds) : null,
  );
  const fetchedIds: string[] | undefined = fetchedMemo?.collections?.map(
    (c: { id: string }) => c.id,
  );
  if (members === null && fetchedIds) {
    // Hydrate once when the lazy fetch lands (render-time state seed, same
    // "store info from previous renders" pattern the sidebar player uses).
    setMembers(new Set(fetchedIds));
  }
  const memberSet = members ?? new Set<string>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['memos'] });
  };

  const toggleMembership = async (playlistId: string) => {
    if (busyId) return;
    setBusyId(playlistId);
    const isMember = memberSet.has(playlistId);
    try {
      if (isMember) await collectionApi.removeMemo(playlistId, memoId);
      else await collectionApi.addMemo(playlistId, memoId);
      const nxt = new Set(memberSet);
      if (isMember) nxt.delete(playlistId);
      else nxt.add(playlistId);
      setMembers(nxt);
      invalidate();
    } catch { /* server unreachable — leave the tick as it was */ }
    setBusyId(null);
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || busyId) return;
    setBusyId('new');
    try {
      const created = await collectionApi.create({ name: trimmed, kind: 'playlist' });
      await collectionApi.addMemo(created.id, memoId);
      setMembers(new Set(memberSet).add(created.id));
      invalidate();
      setName('');
      setCreating(false);
    } catch { /* leave the input for a retry */ }
    setBusyId(null);
  };

  return (
    <>
      <div className="om-plmenu-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-hidden />
      <div
        className="om-plmenu"
        role="dialog"
        aria-label="Add to playlist"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        data-lenis-prevent
      >
        <div className="om-plmenu-head mono">Add to playlist</div>
        <div className="om-plmenu-list">
          {playlists.length === 0 && !creating && (
            <p className="om-plmenu-empty">No playlists yet. Make one below.</p>
          )}
          {playlists.map((p) => {
            const isMember = memberSet.has(p.id);
            return (
              <button
                key={p.id}
                className={cn('om-plmenu-row', isMember && 'is-member')}
                onClick={() => toggleMembership(p.id)}
                disabled={busyId === p.id}
                title={isMember ? `Remove from ${p.name}` : `Add to ${p.name}`}
              >
                <span className="om-plmenu-check">
                  {isMember && <Icon name="check" size={11} />}
                </span>
                <span className="om-plmenu-name">{p.name}</span>
                <span className="om-plmenu-count mono">{p.track_count}</span>
              </button>
            );
          })}
        </div>
        {creating ? (
          <div className="om-plmenu-new">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createAndAdd();
                if (e.key === 'Escape') setCreating(false);
              }}
              placeholder="Playlist name"
              maxLength={200}
            />
            <button className="om-plmenu-go" onClick={createAndAdd} disabled={!name.trim() || busyId === 'new'} title="Create playlist">
              <Icon name="check" size={12} />
            </button>
          </div>
        ) : (
          <button className="om-plmenu-add" onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} />
            <span>New playlist</span>
          </button>
        )}
      </div>
    </>
  );
}
