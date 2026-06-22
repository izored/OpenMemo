import { motion } from 'framer-motion';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import type { MemoFilterDef } from '@/lib/memoFilters';

// Maps filter IDs to Icon names from the existing Icon component.
const FILTER_ICONS: Record<string, string> = {
  all: 'grid',
  note: 'type',
  link: 'link',
  image: 'image',
  video: 'video',
  'audio:music': 'music',
  'audio:voice': 'mic',
  code: 'code',
  'document,file': 'fileText',
};

interface BottomBarFiltersProps {
  filters: MemoFilterDef[];
  active: string;
  onChange: (id: string) => void;
}

// No LayoutGroup wrapper — the shared layoutId "om-bbar-pill" bridges these
// buttons and the settings cog (in BottomBar.tsx) into one animated pill.
export function BottomBarFilters({ filters, active, onChange }: BottomBarFiltersProps) {
  return (
    <>
      {filters.map((f) => (
        <motion.button
          key={f.id}
          className={cn('om-bbar-ib', active === f.id && 'active')}
          onClick={() => onChange(f.id)}
          title={f.label}
          aria-label={f.label}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          {active === f.id && (
            <motion.span
              layoutId="om-bbar-pill"
              className="om-bbar-pill"
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          )}
          <span className="om-bbar-ib-ico">
            <Icon name={FILTER_ICONS[f.id] ?? 'file'} size={18} />
          </span>
        </motion.button>
      ))}
    </>
  );
}
