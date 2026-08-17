// Onboarding flow — data-driven so the tour can be reshaped without touching
// component logic. Bump STORAGE_KEY to re-show the tour after a big change.

export const ONBOARDING_VERSION = 2;
export const ONBOARDING_KEY = `openmemo_onboarded_v${ONBOARDING_VERSION}`;

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector to anchor the popup to. Omit for a centered card.
   *  May list several candidates: the first VISIBLE match wins, because the
   *  same control has different markup per page (the dashboard's bottom bar
   *  owns the + and hides the global FAB). */
  target?: string;
  placement?: 'right' | 'left' | 'top' | 'bottom' | 'center';
  /** Side-effect run when the step becomes active. */
  action?: 'openAdd';
  /** Gate progression on a real user action. `panelOpen` = the add-memo
   *  panel must be open before Next becomes available. */
  gate?: 'panelOpen';
  /** When the gate is satisfied, the spotlight smoothly morphs to this
   *  selector (e.g. from the FAB onto the now-open new-memo panel). */
  morphTarget?: string;
  /** Body copy shown once the gate is satisfied — replaces `body` so the
   *  card guides the user to the next thing. */
  gateBody?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'add',
    title: 'Capture anything',
    body: 'Click the + button to open the New Memo panel.',
    // The dashboard, which is where first launch lands, renders BottomBar. Its
    // mount effect puts `om-has-bbar` on <body>, which hides `.om-fab` outright
    // (openmemo.css). So this step spent its whole life pointing at a
    // display:none element: a zero-size rect, a 12px spotlight in the corner,
    // and a card clamped to 16,16 under the macOS traffic lights, which eat
    // every click under them. The + the user was told to press was the bottom
    // bar's island, which the tour never mentioned.
    target: '.om-island-trigger, .om-fab',
    placement: 'left',
    gate: 'panelOpen',
    morphTarget: '.om-island.open, .om-add-panel.open',
    gateBody: 'Save a link, note, file, or voice memo (or press N anytime). Hit Next when ready.',
  },
  {
    id: 'library',
    title: 'All Memos is your library',
    body: 'Everything you save lands here, in one place. This is home: the full library, newest first.',
    target: '[data-tour="nav-home"]',
    placement: 'right',
  },
  {
    id: 'collections',
    title: 'Collections group your library',
    body: 'Collections are labels for sorting the library, not separate boxes. A Memo can sit in several. Drag a card onto one in the sidebar to file it.',
    target: '.om-collections-head',
    placement: 'right',
  },
  {
    id: 'spaces',
    title: 'Spaces wall off a project',
    body: 'A Space is its own area with its own Memos and collections, kept out of the main library so everyday stuff stays clean. Open one to expand it; adds you make inside it land in it. Deleting a Space is the one thing you cannot undo, so it asks twice.',
    target: '.om-spaces-section',
    placement: 'right',
  },
  {
    id: 'hidden',
    title: 'A quiet hidden corner',
    body: 'Some Memos are nobody else’s business. Dwell on the + next to Collections and a faint "hidden" link fades in: that is the way into a passcode-locked section. Each Space keeps its own, and one passcode opens them all.',
    target: '.om-collections-head',
    placement: 'right',
  },
  {
    id: 'music',
    title: 'Music has its own room',
    body: 'Saved audio lives on the Music page. Paste a Spotify or Apple Music link for a lossless copy, build playlists, and play from the sidebar while you browse.',
    target: '[data-tour="nav-music"]',
    placement: 'right',
  },
  {
    id: 'search',
    title: 'Find it fast',
    body: 'Search across everything with ⌘K. Titles, content, and domains.',
    target: '.om-sidebar-search',
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
