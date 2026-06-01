# OPNMMO — EntryBox

Entry tracking for openMemo. Managed by EntryBox.

## OPNMMO-0001 · 2026-05-28 14:57 · fix · done · 2026-05-28 18:19 — Dev panel was pushed to live production code not gitignored.


## OPNMMO-0002 · 2026-05-28 14:59 · idea · done · 2026-05-28 18:19 — Lightbox Arrow navigation

when click on an image memo card that leads us to its lightbox view, we need the two arrow left and right to the lightbox to go to next or previous memo card, also esc button should exist lightbox

## OPNMMO-0003 · 2026-05-28 15:00 · improve · done · 2026-05-28 18:13 — Settings page

Switch "Made by" section with "limit uploads section"

## OPNMMO-0004 · 2026-05-28 15:03 · improve · done · 2026-05-28 18:19 — memo details page of memodocs

its memodetails page is not really well done it's empty with just file name, i think for all memodetails page we need a richer section on top of the pin to side bar generate ai summary and download button a section where we see when memo has been added, tags colelction i nneed a good layout like the helath card of that memodetails but it's just areport card

## OPNMMO-0005 · 2026-05-28 17:28 · fix · done · 2026-05-28 18:12 — imported video files no thuymbnail generation, memocard still blank

this has been the fifth time i pointing this out i need a final fix, getting tired of this issue.

## OPNMMO-0006 · 2026-05-31 20:11 · improve · done · 2026-06-01 — minimal card style adjustement

in minimal card style i want for the video card, non hover stard thumbnail icon video icon bottom left of the card to be either youtube tiny logo if link is youtube vimdeo if vimeo, etc etc, video icon as it is now if its a local uploaded files,

## OPNMMO-0007 · 2026-05-31 20:16 · fix · done · 2026-06-01 — sunrise theme transition

it seems like the background color blurred blobs gets a refresh in opacity and or position if motion is enbaled just before the sunrise raidal animation begins, i should take into consideration the Background fade applied perecetange so the blobs don't just get bumped in opcaity and or change position a split second before radial show beign

> Resolved Bug B (the bump): `.om-app.theme-transitioning::before` now freezes
> `transition` + `animation-play-state` during the flip window, so the blob
> holds still until the radial covers it. The `*` color-crossfade rule never
> matched the `::before` pseudo, so it kept its own `transition: background .7s`
> + drift keyframe and twitched on var-rewrite. Bug A logged separately below.

## OPNMMO-0008 · 2026-06-01 · fix · logged — dark-mode blobs never hide (specificity collision)

Bug A, split from OPNMMO-0007. `[data-theme="hi"] .om-app::before { opacity: 0 }`
(hide blobs in dark) and `[data-bg="random"] .om-app::before { opacity: 1 }`
have EQUAL specificity, so source order wins → the later `random` rule always
beats the dark-hide → blobs stay visible (opacity 1) in dark mode instead of
hidden. Fix: raise the dark-hide rule's specificity (e.g.
`[data-theme="hi"][data-bg="random"] .om-app::before { opacity: 0 }`) or fold
bg-mode into the hide selector. Low priority / cosmetic; deferred.
