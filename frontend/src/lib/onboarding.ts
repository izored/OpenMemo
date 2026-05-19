// Onboarding flow — data-driven so the tour can be reshaped without touching
// component logic. Bump STORAGE_KEY to re-show the tour after a big change.

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_KEY = `openmemo_onboarded_v${ONBOARDING_VERSION}`;

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector to anchor the popup to. Omit → centered. */
  target?: string;
  placement?: 'right' | 'left' | 'top' | 'bottom' | 'center';
  /** Side-effect run when the step becomes active. */
  action?: 'openAdd';
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'add',
    title: 'Capture anything',
    body: 'Click the + button to open the New Memo panel. Save a link, note, file, or voice memo — or press N anytime.',
    target: '.om-fab',
    placement: 'left',
  },
  {
    id: 'search',
    title: 'Find it fast',
    body: 'Search across everything with ⌘K. Titles, content, and domains.',
    target: '.om-sidebar-search',
    placement: 'right',
  },
  {
    id: 'collections',
    title: 'Organise with collections',
    body: 'Group Memos into collections. Drag a card onto one in the sidebar to file it.',
    target: '.om-sidebar-nav',
    placement: 'right',
  },
  {
    id: 'settings',
    title: 'Make it yours',
    body: 'Open Settings, then Appearance, to tune theme, accent, layout, and background. Changes apply live.',
    target: '.om-sidebar-foot',
    placement: 'right',
  },
];
