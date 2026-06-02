# Architecture & Process Decisions

Significant decisions about how OpenMemo is built and how changes are scoped.
Newest first. Each entry is an ADR (Architecture Decision Record): the context,
the decision, and its consequences, so a future reader knows *why*, not just
*what*.

---

## ADR-001 — Memo-type changes are systematic across the whole type, not per-provider

**Date:** 2026-06-02 · **Status:** Accepted

### Context

Every memo has a *type* (`video`, `audio`, `link`, `image`, `document`, …), and
each type spans many *providers* / hosts:

- **video** — YouTube, Vimeo, Instagram, TikTok, Facebook, X, VK, Dailymotion,
  Twitch, Streamable, …
- **audio** — SoundCloud, Bandcamp, Mixcloud, …

Repeatedly, a feature was built for one provider and hardcoded to it, silently
breaking every other provider of the same type:

- The detail-page video embed handled **only YouTube**. Vimeo, Instagram,
  TikTok, VK and every other host got no inline player and a dead
  "No preview available" in the lightbox.
- The minimal video card showed a brand glyph only for YouTube/Vimeo; every
  other host fell back to a generic "video file" icon.

A user who never touches YouTube — say someone who only saves VK or Vimeo video
— experiences the feature as broken, even though "it works" for the provider it
was built against. A "YouTube embed" task is really a **video-type** task; an
"audio player" task is really an **audio-type** task.

### Decision

When a feature or change touches one provider/variant of a memo type, the
**default scope is the entire memo type** — every provider of that type — not
the single provider that prompted the work. Provider differences are routed
through a **shared abstraction**, never inlined as per-host conditionals
scattered across render components.

Operating rules:

1. **Default scope = the memo type.** "Add a video embed" means *all* video
   hosts. "Restyle the audio player" means *all* audio sources — change it for
   SoundCloud, change it for Bandcamp and Mixcloud too.
2. **Centralize provider differences.** One registry/abstraction
   (e.g. `frontend/src/lib/platforms.ts` for video hosts) consumed by every
   render site — card, lightbox, detail. No `if (host === 'youtube')` sprinkled
   through components.
3. **Confirm scope before starting.** If a request names a single provider,
   **stop and confirm with the user before coding**: surface a short plan and
   ask — *"this touches the `<type>` memo type; apply to all `<type>` providers,
   or just `<provider>`?"* Do not begin until the user confirms. Keep the user
   in the loop on scope.
4. **Graceful fallback is mandatory.** A provider we did not explicitly wire
   must still degrade safely (Open original / Make it local) — never a dead end.
   This guarantees robustness for hosts we haven't special-cased (e.g. VK).

### Consequences

- Slightly more upfront thought per change, in exchange for no silent
  regressions for non-default providers.
- Provider logic lives in one place and is unit-testable as a matrix
  (see `frontend/src/lib/platforms.test.ts`).
- A new provider is added in one file and lights up card + lightbox + detail
  simultaneously.

### Examples

- ❌ YouTube-only embed in `MemoDetail` → VK / Vimeo / Instagram users get nothing.
- ✅ Registry-driven embed across all video hosts + graceful Open original.
- ❌ SoundCloud-only audio-player restyle → Bandcamp / Mixcloud drift out of sync.
- ✅ One audio-player treatment applied to every audio source.

### Reference implementation

The video embed work (changelog 2.0.3) is the canonical example: a single
`lib/platforms.ts` registry maps host → brand glyph + embed URL, consumed by
`MemoCard`, `Lightbox`, and `MemoDetail`, with graceful fallback for unknown
hosts and a host test matrix in `lib/platforms.test.ts`.
