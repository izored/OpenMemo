import { useAppStore } from '@/stores/appStore';
import { PlaylistCoverModal } from './PlaylistCoverModal';

// Single mount point for the playlist/album cover editor. The Music page opens
// it with openCoverEdit(playlist); this renders it from the store.
export function PlaylistCoverHost() {
  const playlist = useAppStore((s) => s.editCoverPlaylist);
  const close = useAppStore((s) => s.closeCoverEdit);
  if (!playlist) return null;
  return <PlaylistCoverModal playlist={playlist} onClose={close} />;
}
