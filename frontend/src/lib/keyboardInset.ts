// How much of the bottom of the layout viewport the on-screen keyboard hides,
// published as CSS variables so bottom sheets can sit on top of it.
//
// iOS Safari does not resize the page when the keyboard opens: it shrinks the
// VISUAL viewport and pans it, while `position: fixed; bottom: 0` stays pinned to
// the LAYOUT viewport, which is now behind the keyboard. The New Memo sheet
// ended up with its top half on screen, its bottom half under the keys, and bare
// background in between (iPhone 12 Pro Max, 2026-10-09).
//
//   --kb-inset   px between the layout viewport's bottom and the visible bottom
//   --vv-height  px of visible viewport, for capping a sheet's height
//
// Desktop and Android Chrome (which resizes the page itself) both read 0, so the
// sheet rules that consume these are no-ops there.
export function trackKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    // Pinch-zoom shrinks the visual viewport too. Only at scale 1 is the
    // missing height a keyboard rather than a magnifier.
    const inset = vv.scale > 1.01 ? 0 : Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
    root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
