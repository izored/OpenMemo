# Multimedia FAB Button — Icon Animation Spec

**Status:** Deferred. Current button uses static Lucide `File` icon + CSS scale hover.  
**Owner:** Motion designer / frontend

---

## Current State

- Icon: Lucide `File` (SVG, 18×18px)
- Hover: CSS `scale(1.08)` + bg/text color invert
- No path animation

---

## Intended Interaction

| State | Trigger | Behavior |
|-------|---------|----------|
| Idle | — | Static icon |
| Hover-in | `mouseenter` | Animation plays forward (0 → end) |
| Hover-out | `mouseleave` | Animation plays in reverse (end → 0) |

Duration: 300–400ms. No loop.

---

## CSS/SVG vs Lottie

| Criterion | CSS + SVG | Lottie |
|-----------|-----------|--------|
| Simple scale / fade | ✓ ideal | overkill |
| Path morphing between shapes | ✗ requires JS interpolation | ✓ native |
| Custom per-keyframe easing | limited (`cubic-bezier`) | ✓ full AE graph editor |
| Multi-layer sequencing | ✗ complex | ✓ AE timeline |
| Authored in After Effects | ✗ | ✓ Bodymovin export |
| Secondary motion / overshoot | ✗ | ✓ |
| Bundle cost | 0 KB | ~60 KB (`lottie-web`) |
| Reversible on hover-out | ✓ | ✓ `setDirection(-1)` |

**Recommendation: Lottie.**

The animation goal (files fanning, folder morphing, or media types appearing) requires multi-step sequencing and path changes that CSS cannot drive without a JS animation library. AE + Bodymovin gives full control over timing curves, stagger, and secondary motion — all standard motion design tools.

Use CSS for now (scale spring already live). Switch to Lottie once the animation direction is decided and AE file is ready.

---

## React Integration (when ready)

Install:
```bash
npm install lottie-web
```

Component:
```tsx
// frontend/src/components/MultimediaIcon.tsx
import { useEffect, useRef } from 'react';
import lottie, { AnimationItem } from 'lottie-web';
import animationData from '@/assets/multimedia-icon.json'; // exported from AE via Bodymovin

export function MultimediaIcon({ size = 18 }: { size?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const anim = useRef<AnimationItem | null>(null);

  useEffect(() => {
    if (!container.current) return;
    anim.current = lottie.loadAnimation({
      container: container.current,
      animationData,
      renderer: 'svg',
      loop: false,
      autoplay: false,
    });
    return () => anim.current?.destroy();
  }, []);

  const playForward = () => { anim.current?.setDirection(1);  anim.current?.play(); };
  const playReverse = () => { anim.current?.setDirection(-1); anim.current?.play(); };

  return (
    <div
      ref={container}
      style={{ width: size, height: size }}
      onMouseEnter={playForward}
      onMouseLeave={playReverse}
    />
  );
}
```

In `SpeedDialFAB.tsx`: replace `<Icon size={18} />` with `<MultimediaIcon size={18} />` for the Multimedia item only. All other buttons keep the Lucide icon.

---

## AE Authoring Notes

- **Canvas:** 18×18px (or 36×36px @2x, scaled down in CSS with `width/height`)
- **Frame rate:** 60fps
- **Export:** Bodymovin AE plugin → JSON. Target < 10 KB.
- **Colors:** Solid fills only. No gradients, no bitmap layers. SVG renderer handles vectors only.
- **Color values:** Use `#202020` (light theme) or make the icon inherit `currentColor` by using the Lottie color filter feature at runtime.
- **Animation direction:** Forward = hover-in (frame 0 → end). Reverse = hover-out (end → 0). Design accordingly — the reversed animation must look intentional, not just a rewind.

---

## Animation Concept Options

Pick one for the first pass:

**1. File fan**
Single `File` shape → 3 files fan out (document, image, audio icons). Paths stay constant across frames; only transforms change. Easiest to author and reverse cleanly.

**2. Upload pulse**
`File` icon scales up with spring overshoot + a subtle ring expands outward. Two-layer AE: icon layer + ring layer. Very short (200ms).

**3. Type morph**
Lucide `File` path tweens to `Files` (two stacked documents). Requires shape layer path interpolation in AE. Looks polished; moderate complexity.

**Start with option 1 or 2** for the first Lottie version. Option 3 once the simpler ones are validated in browser.
