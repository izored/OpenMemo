import { useAppStore } from '@/stores/appStore';
import { GUIDES } from '@/lib/guides';
import { GuideModal } from './GuideModal';

// Mounts whichever step-by-step guide the store has open. One instance lives in
// Layout; anything can trigger a guide with `openGuide(id)`.
export function GuideHost() {
  const activeGuide = useAppStore((s) => s.activeGuide);
  const closeGuide = useAppStore((s) => s.closeGuide);
  if (!activeGuide) return null;
  const guide = GUIDES[activeGuide];
  if (!guide) return null;
  return (
    <GuideModal
      title={guide.title}
      steps={guide.steps}
      finishLabel={guide.finishLabel}
      onClose={closeGuide}
    />
  );
}
