import { useAppStore } from '@/stores/appStore';
import { ThumbnailEditModal } from './ThumbnailEditModal';

// Single mount point for the thumbnail/title editor. Any card or detail page
// opens it with openThumbEdit(memo); this renders it from the store.
export function ThumbnailEditHost() {
  const memo = useAppStore((s) => s.editThumbMemo);
  const close = useAppStore((s) => s.closeThumbEdit);
  if (!memo) return null;
  return <ThumbnailEditModal memo={memo} onClose={close} />;
}
