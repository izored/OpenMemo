# Changelog

All notable changes to OpenMemo are documented here.

---
## [2.3.0] - Unreleased

Three big pushes. The Settings page is rebuilt as a bento with the live appearance preview as its hero. Restricted videos stop being a dead end: when "Make it local" fails behind a sign-in (age-restricted or private), the panel walks you through the fix instead of a bare "Try again", and yt-dlp can authenticate with your own browser cookies. And the Music page learns to speak Spotify and Apple Music: paste a Spotify or Apple Music track, album, or playlist and get it back in lossless FLAC, through a brand-new add panel of its own.

### Added

- 📱 **Every page reflows to one column on a phone.** Settings, Collections, and Ask now stack into a single readable column on mobile (Settings' bento had a dead rule that left it cramped two-up), and the new-memo / add-music panels slide up as near-full-width bottom sheets instead of a tiny corner card. Continues the responsive pass (ADR-009 steps 6 + 7).
- 📱 **Phone feed is a single column, and scrolling feels native.** On a phone the dashboard (and music library) drop to one full-width column so cards are readable instead of cramped two-up, and the smooth-scroll engine steps aside below the tablet breakpoint so touch gets real native momentum. Focusing a search box or input no longer jolt-zooms the page either (text fields are floored at 16px on touch). Continues the responsive pass (ADR-009 steps 2 + 8).
- 📱 **The app opens up on a phone.** openMemo was built desktop-first and the sidebar rail used to eat two-thirds of a phone screen. Below a 1024px width the rail now leaves the page and becomes a full-screen drawer: tap the hamburger in the new slim top bar to slide it in, tap the logo to go home, tap the big close button (or the scrim, or Escape) to dismiss it. The drawer closes itself on every navigation. One shared breakpoint hook drives all of this, so the desktop layout is untouched. First step of the whole-app responsive pass (ADR-009).
- 🗂️ **Collections collapse in the drawer.** On a phone the collections list shows the first three with a "show more" chevron, so the drawer stays scannable instead of running long. Creating a collection is desktop-only there, so the header "+" becomes that expand/collapse control.
- 🧹 **The drawer foot is one tidy row.** Below the player, the profile/settings button and the theme switch now share a single row (the theme switch is the compact sun/moon toggle, like the collapsed rail) instead of stacking a full-width theme row above the foot, giving the now-playing player the breathing room it deserves.
- 📐 **Mobile space tidied up.** The drawer no longer leaves a dead gap: the now-playing player grows to fill the space between the collections list and the pinned foot (its cover expands, with a floor so it never collapses), and the floating "+" hides while the drawer is open. The dashboard drops the wide desktop side padding for a tight edge so cards use the screen, the Music page rails bleed to the screen edge (the next card peeks) instead of stopping short, and vertical pages no longer scroll sideways by accident (carousels keep their own horizontal scroll).
- 🎚️ **The big now-playing player is the default on mobile, sized to fit.** On a phone the sidebar player no longer shrinks to a thumbnail that clipped its buttons (the old "drop to 90% zoom" workaround). The full-cover big player is the default in the drawer, with its controls always visible instead of auto-hiding, and its cover is capped so it stays proportional to the rest of the drawer rather than a full-width square. Desktop keeps your chosen Small or Big preference.
- 🖥️ **Appearance editing tells you it is desktop-only.** The live-preview Appearance panel is a desktop side panel. On mobile the Settings hero now explains that accent, background, layout and columns are desktop-only, points you at the light/dark toggle you still have in the menu, and stops opening a cramped half-broken panel.

### Fixed

- 🎵 **Qobuz pulls now retry, and they tell you why they failed.** The lossless relay is shared and gets overloaded, answering with HTTP 503 and a "try again in N minutes" note. The resolver only retried rate-limits (429), so a 503 was treated as a permanent failure: the relay's own message was thrown away and every track was left with a useless "Qobuz community API returned 503". Worse, a 503 wrongly burned the one CD-quality downgrade meant for genuine "no hi-res" releases. Now any transient 5xx is retried with backoff like a 429, and when the relay asks for a long cool-down the track fails fast carrying the relay's actual words ("the server is overloaded, try again in about 26 minutes") instead of hanging the whole playlist behind a 38-minute wall. A failed tile now reads "failed why?" and taps through to the reason, the playlist header gains a "Why?" button that names the overall cause, and a new `openmemo.music` log traces every track's resolve and relay status so a bad pull is diagnosable instead of silent.
- 🎵 **Failed and queued playlist tracks were invisible.** A playlist page only showed tracks that finished downloading. The track list filtered by `type='audio'`, but a track stays `type='link'` until its file lands, so every still-remote, queued, or failed track got dropped (a 10-track playlist with 3 local showed 3 tiles, the other 7 gone). The playlist view now lists tracks by `audio_kind='music'`, which catches them at every stage, and the memo list API returns `localize_status` so each tile knows whether it finished, is downloading, or failed. Tracks that are not local yet render dimmed and desaturated. The whole playlist shows now: what is here, and what is still coming.
- ☁️ **Cloud-download button on every not-local track.** A track that is remote (saved without auto-download), queued, or failed now wears a cloud-download badge in the center of its tile. Tap it to pull that one track to your device. The badge wears your accent tint from the Appearance panel (a failed track uses the deeper accent, tap to retry); a track mid-download shows the cloud spinning, no tap. The old tiny corner chip is now just a one-word status label (`not local`, `downloading`, `failed`), and `failed` stays red so the error still reads at a glance.
- ⤓ **Re-download button on the playlist page.** When any track in a playlist is not on your device, a Re-download button sits in the hero next to Play all. It pulls every remote, queued, or failed track in one go, so a half-downloaded album finishes without hunting tile by tile. It stays put whenever any track is still off your device, and names the count when tracks have failed.
- 🔁 **Downloads no longer stick on "pending" forever.** Playlist downloads run as background tasks with no job table, so a track caught mid-download when the app stopped had nothing to resume it and would spin "downloading" forever, while hiding the playlist's download button. On startup every track left in `pending`/`processing` without a local file is now marked failed (`Download interrupted (app restarted). Tap to retry.`), so its cloud/retry control and the Re-download button come back.
- ✏️ **Edit a playlist's name and description, with a description that pulls from the link.** A playlist page had no way to rename it or say what it is. The hero now carries an edit pencil next to the title: tap it to rename inline and write a description. Better yet, the description seeds itself on import. When you paste a playlist or album link that carries a blurb (YouTube, SoundCloud, Spotify, Apple Music), that text lands as the description automatically, and you can rewrite or clear it any time. Where a source has no blurb, the field simply waits for you to fill it. The description sits under the title, clamped to three lines so a long one never shoves the controls off-screen.

- ⏸️ **Pause a playlist download mid-pass.** A bulk "Download all" had no brakes: once it started, you watched it grind through every track. The playlist header now swaps to a Pause button while a bulk pass is running. Press it and the track in flight finishes (a download can't be cut mid-fetch), every track still queued resets to remote so its cloud chip comes back, and Download all returns to resume from where it stopped. The Pause button keys off whether a bulk pass is actually running, not just whether something is downloading, so grabbing a single track from its tile never turns the header into a Pause control. Works the same for albums.
- ▶️ **The playing playlist is now obvious, and you can pause it from its card.** On the Music page a playlist or album that is feeding the player wears an accent stroke, and its corner badge stays pinned (not hover-only) showing a pause icon. Tap it to pause or resume without opening the playlist or reaching for the sidebar player. Every other card still shows play and starts fresh. Albums get the same treatment, since they are the same card.

- ⤓ **The "Download all" button stopped vanishing when you grab one track.** Tapping a single tile's cloud chip marked that track `processing`, and the header's bulk button was wired to hide whenever any track was processing. So the moment you pulled one song, the whole-playlist button disappeared and you were stuck downloading one tile at a time. The bulk button now only cares whether tracks are still off your device, not whether one is mid-download. Grab one, the header button stays. Only that one tile spins.
- 🌗 **Dimmed music tiles stopped inverting in the light theme.** Off-device tracks render dimmed so a glance separates what is here from what is not. The dim used opacity, which blends toward the surface behind it: fine over a dark theme, but over a light theme it washed the art *brighter*, so "dimmed" read as lit-up. It now uses a brightness filter that darkens the same way in every theme. Dim always reads as dim.
- 🟢 **Download badge icon now picks a readable color on your accent.** The cloud-download circle on a not-local tile hardcoded a white icon. On a pale or green accent that white nearly vanished. The icon now follows the contrast-aware accent text color (dark on pale accents, white on dark ones), and the resting badge sits a touch deeper than the raw accent so a light accent does not glow.

- 🎚️ **Hi-res downloads no longer fail on CD-only releases** — the lossless chain now always asks Qobuz for hi-res (24-bit) and **downgrades to 16-bit CD on its own** when a release has no hi-res master. The community relay answers a hi-res request for a CD-only track with an HTTP 400 instead of falling back server-side, so a 2014 soundtrack like *Captain America* would land in `error` ("Qobuz community API returned 400") and never download. `_community_flac_url` now catches that one case, drops to 16-bit, and retries — so every track resolves to the best quality it actually has. The CD/Hi-Res quality toggle is gone from the music add panel: quality is automatic, picked per track in the background (default is hi-res). Applies to both Spotify and Apple Music, since they share the resolver.

- 🛡️ **Cloudflare Turnstile no longer blocks link saves** — sites like Dribbble and Behance protect their pages with Cloudflare Turnstile (the interactive "confirm you are human" CAPTCHA). The headless browser now uses `patchright`, a patched Playwright fork that removes CDP fingerprint markers at the binary level so Turnstile's proof-of-work check passes automatically, with no CAPTCHA service and no paid API. Three more layers of protection work alongside it: stealth JS patches (`navigator.webdriver`, plugins, `chrome.runtime`), cookie persistence that carries the `cf_clearance` token across requests so repeat visits skip the challenge entirely, and human-like scroll timing to avoid robotic timing signals. The plain-HTTP extractor also gained a Cloudflare-page detector so challenge interstitials (title "Human Verification", "Just a moment", etc.) are correctly escalated to the headless path instead of being saved as a useless "Human Verification" memo.

- ➕ **Big player's add-to-playlist closes the gap** — the + satellite sat 22px under repeat while every other control in the right column keeps an 8px rhythm. Now it lines up like the rest.
- ✏️ **Card pen moved under the delete ✕** — the edit-thumbnail pen lived alone in the top-left; it now joins the action cluster on every card variant, directly below the ✕: row cards, minimal cards, and minimal note columns (right below the stack). On the active music card it follows the action row to the left edge, since the play cluster owns that corner.
- 🔁 **Album downloads retry rate-limited tracks on their own** — the shared Qobuz community endpoint throttles bursts (HTTP 429), so on a 10-track album a few tracks would land in error and stay there until you hit Download all again. The playlist download pass now takes a second run at every errored track after a 90-second cooldown, so albums arrive complete without babysitting. Stubborn tracks remain retryable per memo, same as before.
- 🌙 **Note cards stayed beige in dark mode** — the warm background was an inline style that CSS could not override. Backgrounds now come from CSS rules keyed on `data-tint` and `[data-theme="hi"]`, using `color-mix` to nudge each tint toward your accent color. All four tint variants darken properly when you flip to dark mode and transition smoothly with the rest of the UI. The random-bg override (which uses `!important`) now gets a higher-specificity dark mode rule so it also darkens correctly when both are active.
- 📐 **Playlist detail page squashed at the top** — the "Back to Music" button had no top margin, so the page started flush against the window edge instead of breathing like every other page. Now matches the 48 px top padding the main header uses.
- 🎵 **Add-to-playlist menu not clickable in the big sidebar player** — the menu's z-index (5) was below the fixed backdrop's (59), so the backdrop swallowed every click. The menu now sits at 65 with the backdrop just under it (64), so its rows are clickable and tapping outside still dismisses it.
- 📋 **Confirm hint sat above the buttons** — the "Hide keeps it in collections" note appeared between the title and the buttons instead of below them. Moved below the action row and margin fixed (was -10 px pulling it into the buttons).
- 📏 **Queue position counter shifted layout on shuffle** — when shuffle pinned a two-digit track at position 1, the "1 / 101" span shrank, nudging the skip buttons. The span now reserves `minWidth` based on the longest position string in the queue, and the text centers inside it.
- 🎯 **Primary buttons no longer cramped on the right** — Add music, Play all, and every other primary button inherited a tight 6 px right padding from the shared style. That asymmetry was built for buttons ending in a keyboard chip, a shape nothing uses anymore, yet it kept biting every new button (third time now). The shared style is symmetric 14 px both sides; the chip case keeps its tight edge through a `:has(.om-kbd-inv)` rule that only fires when a chip is actually inside, and the one-off Play all patch is gone.
- 🟦 **1 px border bleeding out of the big player** — the big player kept the small player's border under its cover art, leaking a 1 px line at the top edge that ignored the mood tint. Border removed; the artwork owns the edges.

### Changed

- 🎶 **Playlist tile remove chip shows a confirm overlay** — tapping the × on a track no longer removes it instantly. A small overlay (Delete / Remove) covers the tile so you can choose between permanently deleting the memo and simply pulling it out of this playlist. Same visual language as the card-level confirm dialog.
- 🎵 **Artist above title in playlist tiles** — the artist name moves to the smaller, dimmer line above the title, so the song title is the bold anchor at the bottom of each tile. Mirrors the reading order of most music apps.
- 👻 **Track position badge is hover-only** — the number (e.g. "71") is hidden at rest and fades in on hover, reducing visual noise without hiding the information.
- 🔢 **Queue position counter shrinks to 9 px** — the "44 / 101" readout in the big sidebar player was a touch too large; 9 px mono keeps it readable as data without competing with the title.
- ↕️ **Big player: scrubber moves below the transport row** — the seek bar now sits between the skip/shuffle row and the track title instead of above the controls. Eyes move from "where am I in the queue" to "where am I in this track" to "what track is this" top to bottom.
- 🧭 **One header for every page** — new shared `PageHeader` component renders the eyebrow, title, sub, optional back pill and the action rail on Dashboard, Music, Collections, Settings and Hidden. Collections and Settings hand-rolled their own headers with different top paddings, which is why their titles never lined up with the rest of the app. Wrapper paddings are gone; every title sits on the same baseline under the same sticky blur, and the Settings title joins the global type scale (ADR-016).
- 🎛️ **Big player transport, settled** — repeat lives under play and add-to-playlist under repeat (the right-side satellite column); the queue row reads shuffle · previous · position · next. The up-next button is hidden for now.
- 🎼 **Music above Ask Memo** — sidebar nav order now goes All Memos, Collections, Music, Ask Memo.
- ✂️ **Hide hint names the destination** — the delete dialog's hide hint now says the memo moves to the Hidden section instead of vaguely promising it stays in collections.

- 🫥 **Playlist tiles vanished after drag-reorder shipped** — the sortable wrapper became the grid cell and the tile inside collapsed to zero width. One CSS rule makes tiles fill their wrapper again.
- ➕ **Big player's add-to-playlist did nothing** — the popover opened above the player, straight into the big layout's `overflow: hidden`. It now opens inside, overlaying the artwork. The + also moves under the repeat button, completing the right-side column.

### Changed

- 🕶️ **Big player controls get out of the way** — while a song plays, the transport (play, pin, repeat, add, close, queue row) fades out after 5 seconds, leaving artwork, title, scrubber and volume. Move the pointer over the player and they come back for another 5. Paused keeps everything visible.
- 🌓 **Theme selector slims down** — the sidebar's System option is gone (dark mode is a deliberate flip, never an OS guess); Light and Dark remain. Collapsed sidebar now shows a single toggle that flips to the other theme instead of hiding the control entirely.

### Added

- 🎠 **The Music hub goes full music app** — the page now opens on a hero rail of big cards: **Favourite Songs** (a gradient heart card that plays every liked track in one tap, with a shuffle button on hover) followed by your newest saves, each as full-bleed artwork with the kind, name, and track count resting on a bottom gradient. Below it, albums and playlists split into their own sideways-scrolling rails, and the full library grid keeps its search, sort, and play/shuffle controls at the bottom. The rails also finally scroll sanely inside the smooth-scroll pane: a vertical wheel over a rail scrolls the page like everywhere else (it used to freeze dead), sideways input (trackpad swipe, shift+wheel) slides the rail, and a flick past the rail's edge no longer turns into the browser's back gesture.
- 💿 **Albums know they're albums** — paste an album link (Spotify `/album/`, YouTube's `OLAK5uy_` lists) and openMemo remembers it's an album, not a playlist. Albums show a single cover everywhere (hero and card — no more 4-tile collage of the same artwork), and the Music page cards carry an eyebrow line above the name — **N tracks · Album** (playlists say **Playlist**) — while the album page header reads **Album · N tracks**. The add panel's Spotify preview says which one you're about to save. Existing playlists are reclassified from their source link on first start.
- 🏷️ **Downloaded FLACs carry their tags** — the lossless files from the Spotify chain used to arrive completely untagged (no title, no artist, no art). Now every download gets proper Vorbis tags — title, artist, album (from the Qobuz match) — plus embedded cover art, so the file keeps its identity outside openMemo. The album name also lands on the memo (`audio_album`), and the big player finally says what's playing: **album — artist** under the title (sliding like the title does when it's too long), with the same info passed to the OS media overlay. Tracks of already-saved albums inherit the album name on first start.
- 🎧 **Spotify → lossless FLAC** — paste a Spotify track, album, or playlist into the Music page and openMemo fetches it in real FLAC, no Spotify account needed. The chain is account-free end to end: the public Spotify embed gives title / artist / cover (and the track list for albums and playlists), song.link and Deezer resolve an ISRC, the Qobuz public API finds the matching release, and a lossless community provider returns the FLAC stream — saved straight into your library. A track lands as one music memo; an album or playlist becomes a playlist collection with one memo per track. Spotify sources ride the same download pipeline as everything else, so the per-track download chip, **Download all**, and playlist auto-download all just work (new `backend/core/spotiflac.py`, `POST /api/ingest/spotify` + `/probe`, ADR-017). Ports the open-source [SpotiFLAC](https://github.com/spotbye/SpotiFLAC) approach.
- 🍎 **Apple Music → lossless FLAC** — paste an Apple Music track, album, or playlist and get the same real FLAC, no Apple account needed. Apple is only a metadata front-end here: `music.apple.com` serializes the full tracklist server-side (read with no auth), an Apple track URL resolves through song.link → Deezer to an ISRC, and from there the **exact same Qobuz chain** as Spotify returns the FLAC — the audio source never changes. Unlike Spotify's ~50-track embed cap, Apple's page serialized **67 of 67** tracks on a 67-track playlist, so long playlists come through whole. A track lands as one music memo; an album or playlist becomes a playlist collection with one memo per track, riding the same download pipeline (chip, **Download all**, auto-download) with zero extra wiring (new `backend/core/apple_music.py`, `POST /api/ingest/apple` + `/probe`, ADR-019). The add panel previews Apple links exactly like Spotify ones.
- ➕ **The Music page gets its own add panel** — the **Add music** button (and the **+** on the Music page) now open a music-specific panel instead of the generic New Memo one, with the same bottom-right slide-in. Three tabs: **Link** (any track or playlist URL — Spotify resolves to FLAC, YouTube / SoundCloud / Bandcamp keep their yt-dlp path), **Upload** (drop audio files straight into the library), and **Playlist** (spin up an empty one). A pasted Spotify link previews its cover, title, and track count before you commit, with a one-tap **Download now** choice.
- 🎚️ **Lossless quality, your pick** — a gear in the music add panel reveals a settings drawer: choose **CD (16-bit)** or **Hi-Res (24-bit)** FLAC for Spotify downloads, and toggle auto-download for linked audio. Persisted server-side as `music_quality` / `music_provider`, so the choice sticks. Lossless currently routes through Qobuz; Tidal and Amazon are wired as future providers.
- ❤️ **Liked songs** — a heart button joins the big player's queue row, right of next: one tap likes the playing track. Liked tracks carry a small heart above the artist name on their playlist tile and stretch to a double-width (1×2) tile, so favourites stand out at a glance. The playlist hero gains a **Play liked** button that queues only the hearted tracks. New `liked` column on memos (PRAGMA-guarded migration) and `PUT /api/memos/{id}/like`; like is its own flag, fully independent of pin.
- 🖼️ **Cover art links back to the playlist** — when the queue came from a playlist, clicking the player's cover (big art or the small thumbnail) opens that playlist instead of the track's memo page. The track title still opens the memo. The queue now remembers its source (`queueSource`), survives a reload with the rest of the continue-listening snapshot, and clears whenever a single track plays.
- ✏️ **Edit thumbnails from playlist tiles** — every track tile grows a hover pen (under the number badge, always visible on touch) that opens the same thumbnail & title editor the memo cards use. No more detouring through the memo page to fix a cover.
- 🎞️ **Pick your download quality** — "Make it local" now has quality pills: 720p, 1080p (default), 1440p and 4K. Above 1080p the backend falls back to VP9/AV1 (hosts don't serve mp4 there) and still remuxes into an mp4 the browser plays. A heads-up under the picker warns about file sizes; if the source has no stream at the picked height, the best below it is saved. Verified end-to-end: a 4K pick produces a real 3840×2160 file.
- ⏳ **Every Settings card loads in place** — the whole bento now reserves its layout with the same shimmer the stats tiles use (a generic `.om-skel`). The Profile card no longer pops in and shifts the masonry; Local AI, Files & limits and the Trash row show skeletons until their data lands.
- 🩺 **AI errors you can actually read** — Summarize and Ask Memo failures now surface as inline messages instead of dying in the browser console. A missing model tells you the exact `ollama pull` command; Ollama being down or timing out says so in plain words. New error state under the AI Summary block, and the Ask panel renders the backend's `error` stream events. The root cause of "Summarize does nothing": the configured default model was never installed, and the failure was invisible.
- 🎯 **Real RAG retrieval** — semantic search was near-random because nomic embed models were fed raw text without their required task prefixes (`search_document:` / `search_query:`); they are now applied automatically at index and query time. Retrieval also drops chunks beyond a cosine-distance cutoff (`RAG_MAX_DISTANCE`, default 0.80) instead of stuffing noise into the prompt, scopes collection chats to the collection (the filter existed but was ignored), answers honestly when nothing relevant exists, and carries conversation history so follow-ups work in RAG mode too.
- 🧹 **Live-only vector index** — deleting a memo now purges its embeddings immediately (restore re-embeds), so Ask Memo can no longer cite ghost memos that 404 on click. Plus a one-click **Rebuild** row in Settings → Local AI (`POST /api/maintenance/reindex`) that re-embeds the whole library with the current model + chunking and sweeps stale chunks. Run it after changing `EMBED_MODEL` or upgrading past 2.2.x — first run on my own library purged 60 ghost chunks.
- 🤖 **Model resolution with fallbacks** — every chat/summary call resolves its model against what is actually installed: per-request pick → saved Settings default (now persisted server-side as `chat_model`) → env default → any installed model. Case-insensitive (`qwen2.5:3b` finds `Qwen2.5:3b`). The Settings dropdown writes the server-side default, so backend-initiated calls (summaries) follow it too. Defaults move to `gemma4:e4b`.
- 📏 **No more silent truncation** — chat/summary calls pass an explicit 8192-token context window (`OLLAMA_NUM_CTX`); Ollama's 4096 default was dropping the second half of long transcripts without a peep. Chunks shrank to 384 tokens so chunk + nomic prefix fit the embed model's own 512-token window. And `backend/.env` now loads by absolute path, so the dev server started from the repo root stops running on wrong code defaults.
- 📚 **Ollama handbook + ADR-014** — new `docs/ollama.md` (which model powers what, the index-must-match-model rule, retrieval tuning, troubleshooting) and ADR-014 documenting the resilient-by-construction Ollama architecture.
- 🙈 **Hide, don't delete.** The full-bleed delete prompt on a card grows a second answer: **Hide** sits next to **Delete**, and an ✕ in the top-right corner cancels. Hiding drops the memo from the main dashboard and the pinned sidebar list, but it stays in every collection it belongs to. New `hidden` column (PRAGMA-guarded migration), `PUT /api/memos/{id}/hide`, and the list API filters hidden memos out of the dashboard query while `?hidden=true` serves the hidden section.
- 🍞 **Branded notice toast.** A new bottom-center toast (`NoticeToast`, same geometry as the undo-delete toast) replaces the raw browser `alert()` for errors. First wired into the memo card's delete and hide failures; the rest of the app's alerts can migrate to it one by one.
- 🕵️ **Passcode-gated hidden section.** Hold your cursor on the sidebar "+" for 1.5 seconds and a small "hidden" link fades in between Collections and the "+". It opens `/hidden`: the first visit asks you to set a passcode, every later session asks for it back. The passcode lives server-side as a salted PBKDF2 hash and never crosses the API. A soft privacy gate, not encryption. Unhide any card from there to put it back on the dashboard.
- 🎶 **Music library** — a whole new section in the sidebar, right under Ask Memo. One page for everything you collect by ear: playlists up top, the full music library below, same masonry grid as home. Tracks are plain audio memos (`audio_kind=music`), so search, detail pages, and the shared player all just work (OPNMMO-0023, ADR-015).
- 📜 **Playlist ingestion via yt-dlp** — paste a YouTube / YouTube Music playlist (SoundCloud sets and Bandcamp albums too) into New Memo and it asks: whole playlist or just this one? Whole playlist creates a playlist collection plus one audio memo per track, enumerated with `--flat-playlist` (capped at 100 entries so a YouTube Mix can't run forever). Titles, artists (" - Topic" stripped), and covers come from the flat probe. Saving the playlist is always an explicit pick, never a default.
- ⬇️ **Download now, or later** — playlist ingest has a "Download tracks to this device now" toggle (off by default). Off saves the playlist as remote track memos, like any music app; each tile carries a **download** chip, the playlist page has **Download all**, and failed tracks get a **retry** chip. Downloads run one track at a time through the existing Make-it-local pipeline, with progress derived from per-track `localize_status` — restart-safe, no job table.
- 🃏 **Playlist cards and full-bleed tiles** — playlists render as 2x2 cover collages with a live download bar; tracks in a playlist are full-bleed cover tiles (number badge, title on a bottom gradient, play on hover). Music memo cards in the grid go full-bleed too: square artwork edge to edge, title overlaid, no body bar. The playlist page gets a boxed hero naming exactly what you're looking at, with a clear "Back to Music" button.
- ⏭️ **A real play queue** — playing a playlist plays through it. The shared player gains `playQueue` / next / prev with auto-advance (repeat-one still wins), prev/next buttons in the sidebar player, a position readout in the big layout, and OS media-key next/previous support. Playing a single track anywhere clears the queue.
- 🎚️ **Music / Voice dashboard filters** — the old Audio tab splits in two, backed by a new `audio_kind` param on `GET /api/memos`. Music and voice notes are different things; now they filter that way.
- 🧹 **Clean feeds, everywhere** — playlist-born tracks live inside their playlist, full stop. They no longer flood All Memos, the type tabs, or the Music page library: the library is just the songs you saved one by one, like a liked-songs shelf. A new `playlist_born` column makes the rule precise: filing a library song into a playlist by hand keeps it in the library (it lives in both, Spotify-style), and deleting a playlist returns its born tracks to the library instead of losing them. Server-side exclusion, with regression tests (`backend/tests/test_playlist_feed_filter.py`).
- 🆕 **Create a playlist on the Music page** — a "New playlist" button in the Playlists header: type a name, hit Enter, land inside the fresh (empty) playlist ready to fill via drag or the Add-to-playlist popover. No URL required anymore.
- 📱 **Background audio survives a locked phone** — the live-waveform analyser routed every track through a WebAudio context, and mobile browsers suspend that context the moment the screen locks: instant silence. On touch devices the player now skips the analyser graph entirely (waveforms fall back to their static bars, playback keeps running under lock), the lock-screen play button revives a suspended context, and returning to the tab resumes it on desktop too. One global audio element and Media Session controls were already in place.
- 🔎 **Search and sort the music library** — a search box (debounced, server-side, same filter the list API already had) and a sort pill (Recent / Title A–Z / Artist A–Z, new `sort` param on `GET /api/memos`) sit in the Library header. Play all and Shuffle queue exactly what you filtered, so "shuffle everything by this artist" is now two clicks. Fine at 50 songs, still fine at 500.
- 🔃 **Reorder playlist tracks by drag** — grab any tile in the playlist view and drop it where it belongs. The order persists through the same recency stagger the dashboard's drag-to-reorder already uses (top track = now, each next 1s earlier), so nothing new in the data model and Play all follows the order you see.
- ➖ **Remove a track from its playlist** — every tile in the playlist view grows a hover × (always visible on touch): one tap pulls the song out of the playlist without deleting anything. Playlist-born tracks move back to the library; songs you filed in by hand never left it. The same toggle also works from the new playlist popover anywhere.
- ➕ **Add to playlist, no drag required** — a new playlist popover on every surface a song lives: the card's hover actions, the memo detail header, and the sidebar player (compact and big layouts). It lists your playlists with membership ticks (click toggles in or out), and "New playlist" creates one on the spot and files the song in it: manual playlist creation lands as a side effect. Drag-onto-a-card still works; it just stopped being the only way. Touch users are no longer locked out. Adding the same track twice is now a server-side no-op instead of an error.
- ⏯️ **Continue listening** — reload the app and the player comes back exactly where you left it: same track, same queue (shuffle state included), same position, paused and ready. The snapshot lives in localStorage and updates as you listen (throttled, plus on every pause); closing the player clears it. Never autoplays on boot.
- 🪜 **Up next, finally visible** — a queue button on the sidebar player opens a popover with the whole play queue: covers, titles, the playing row accent-washed. Click a row to jump straight to it, hit × to drop a track from the queue (the playing one is safe). Works in both player layouts; the queue stops being a black box.
- 🔀 **Shuffle, everywhere a queue lives** — the player gains a real shuffle: the playing track stays put, the rest of the queue reorders randomly, and toggling it off restores the source order with your place intact. Shuffle buttons land in the sidebar player (both layouts), on the playlist hero, and the Library header gets Play all + Shuffle so the whole library can finally play through as one queue.
- 🔁 **Paste it twice, get it once** — re-pasting an already-pulled playlist URL no longer creates a duplicate: the New Memo panel says "Already in your Music" and Save opens the existing playlist (`status: 'exists'` from the ingest endpoint). Tracks dedupe too: a song already in the library is linked into the new playlist instead of re-created, so the same song in two playlists is one memo, two memberships, one download.
- 🔑 **Guided fix for locked downloads** — a failed "Make it local" on a sign-in-gated source (age-restricted / private) now detects the gate from yt-dlp's error and offers a **Follow these steps** button next to Try again, with a softer "do you really want this one saved?" nudge. Opens a centered, fixed-height six-step guide popup (why it failed → **how safe is this?** → install exporter → sign in → export → upload) that walks through getting browser cookies and uploading them. The safety step spells out where the file lives (`data/yt_cookies.txt`), that only yt-dlp reads it, and that nothing is sent to any openMemo service. Generic providers still show the plain failure message.
- 🍪 **yt-dlp cookie authentication** — a Netscape `cookies.txt` uploaded to openMemo is passed to yt-dlp (`--cookies`) for every "Make it local" download and thumbnail fetch. Centralized in one `_cookie_args()` helper so it works for every provider, not just YouTube (ADR-001). The jar lives under `DATA_DIR`, is never returned over the API or logged, and is git-ignored. New `POST` / `DELETE /api/settings/cookies` with format + size validation; `GET /api/settings` exposes a read-only `yt_cookies_present` flag.
- 🧩 **Reusable GuideModal framework** — a new centered step-by-step popup (`GuideModal` + `GuideHost`, driven by an `activeGuide` store id) that any future guide can reuse: steps are data, any step can render a live control (the cookie upload is the first). Reuses the existing `.om-modal` design system, so it themes automatically.
- 🧰 **Cookie management in Settings** — a "Cookies for restricted downloads" row: a self-contained drag-and-drop `CookiesUpload` (install / replace / remove) plus a "Show me how" link that opens the same guide.
- 🎛️ **Appearance live-preview is the hero.** The feature I am most proud of now leads the page: a full-width panel, its own theme-aware surface with your accent as the only color, one clear "Open live preview" CTA, and a mini window mock. No more burying it in a tiny CTA row (ADR-011).
- 🔢 **Stats load with skeletons.** The five library tiles (Memos, Collections, Tags, This week, On disk) always render, showing a shimmer loader until the numbers arrive. The row holds its height from first paint, so the page no longer jumps when stats land.
- 🤖 **Pick a default model.** The Local AI card has an in-brand dropdown to set the model used across chat and Ask. It writes the same persisted `chatModel` those surfaces already read, so it is the app-wide default with nothing to keep in sync.
- ⭐ **My picks are marked.** In the live-preview panel, the options I run openMemo with (Card Minimal, Layout Boxed, Player Big) carry a small asterisk, with a one-line note in my voice. A hint, not a forced default.
- 🎠 **Built-with is a marquee.** The open-source credits auto-scroll in a band that pauses on hover. Hover any name and its description replaces the subline, so you read what each tool does in place instead of a floating tooltip.
- 🖼️ **Full-quality custom backgrounds.** Uploading an appearance background now ingests the original image server-side (`data/background.<ext>`, served by `GET /api/settings/background`) instead of cramming a downscaled JPEG into localStorage, so it stays crisp even at 0% blur. Magic-byte validation, a 10 MB cap, and a placeholder seam for future lossless compression of larger images (ADR-013).
- ✏️ **Editable card thumbnail + title** — hover any memo card and a pen icon appears top-left. It opens a Notion-style editor: upload a new image, or drag to reposition and zoom the current one inside a 3:2 frame, rename the title, save. The card updates in place. Works on every memo type (a note or doc with no image starts at the upload prompt), and MemoDetail's edit mode gets a "Change thumbnail & title" button that opens the same editor. Backend: `POST /api/memos/{id}/thumbnail` with magic-byte image validation and a 10 MB cap; the crop exports as a 900×600 JPEG into the public thumbs cache, overrides `thumbnail_path`, and cleans up the previous custom file. Frontend: `ThumbnailEditModal` + `ThumbnailEditHost` mounted in Layout, driven by `editThumbMemo` store state; the pen click never triggers card open or drag. One caveat: a remote thumbnail that blocks CORS can't be repositioned (falls back to upload); same-origin and cached ones work.

### Changed

- 🚧 **"Make it local" failures explain themselves** — the error branch in `MakeItLocalPanel` now tailors its copy to the failure reason. A new `localize_error` column (PRAGMA-guarded migration) stores yt-dlp's last message so the UI can tell an age/login gate apart from a region-lock or unsupported source; it is cleared on retry and on success.
- 🍱 **Settings is a bento.** Full-width feature blocks (hero, stats, built-with) stack over a CSS masonry of the smaller cards. Short cards get hugged by the next one instead of stretching to fill a row, so there is no empty space below their content (ADR-011).
- 🗂️ **Trash moved into Files & limits.** Recently-deleted was a near-empty card on its own, so it is a row in the Files card now. The card was renamed to match.
- 🛟 **Data safety sits beside the Danger zone.** Backup & Restore and the destructive actions are a half-width duo at the bottom of the page, grouped where they belong.
- 🎨 **Appearance hero follows the theme.** Switching light and dark cross-fades the hero background instead of snapping, the accent glow inside the card is gone, the "Open live preview" CTA inverts its colors on hover (and flips back when you hover "Replay product tour"), and the panel's "live" badge has a pulsing accent dot.
- 🎵 **Music note on the player setting.** The Player size row in the appearance panel carries a small music icon.

### Fixed

- 🎭 **Theater mode actually goes theater** — the button toggled a class that had nothing to expand into: the preview lives inside the 720px detail column, so nothing moved. The scroll pane is now a CSS container and theater expands the image or video to the full pane width while the text column stays at 720px. Smoothly animated, works for images and made-local videos alike.
- 🔇 **Opening a video memo no longer autoplays** — autoplay was baked into the platform embed URLs, so the detail page blasted playback on load. It is opt-in now: the lightbox keeps autoplay (you just clicked play), the detail page loads silent. Twitch needed an explicit opt-out since its player autoplays by default.
- 🧯 **A comma-separated `OLLAMA_HOSTS` no longer crashes boot** — once `backend/.env` started loading by absolute path, pydantic-settings began hard-failing the whole app when a list field arrived as anything but JSON. `OLLAMA_HOSTS` and `CORS_ORIGINS` now accept both spellings: the JSON array (`'["http://a","http://b"]'`, the docker-compose form) and the plain comma list (`http://a,http://b`).

---
## [2.2.0] - 2026-06-05

The big one. Everything saved since 2.0.2, shipped together. Audio grows into a
first-class media experience, the now-playing player is rebuilt around the cover
art, every video platform plays inline and wears its source brand, links survive
antibot walls, and the home page that used to hang on "Loading Memos…" for ~15
seconds now paints in well under a second.

### Added

- 🎚️ **Cover-first now-playing player** — the full-bleed player is rebuilt around the artwork: play in the top-right corner, pin + repeat as satellites, scrubber along the bottom, the cover left clear. Applies to the inline music card and the big sidebar player (ADR-010).
- 🔊 **Volume control everywhere** — one volume + mute on the shared `<audio>` (persisted across sessions), surfaced by a `VolumeControl`: a speaker icon that pulses every 15s so you can tell which card is playing, click to mute, and a slider that slides out on hover. Same control on the card player, both sidebar players, and the detail hero.
- 🏃 **Scrolling titles** — long track names scroll on a single line (`Marquee`): automatically on the track that's playing, on hover elsewhere. Honors `prefers-reduced-motion`.
- 🎬 **Music detail hero** — a music memo with cover art gets a large cover-forward now-playing card on its detail page (`MusicDetailPlayer`): the cover plus a mood-gradient veil with no seam, a centered transport, brightness that follows the theme (full in light, dimmed in dark), and a panel width that follows the artwork shape (16:9 thumbnail wide, square art compact).
- 🎤 **Artist from file tags** — uploaded music shows its artist, read from the file's own tags via mutagen (MP3, FLAC, M4A, OGG, and the rest). Shown only when a real tag exists, never the source domain, and it feeds the OS media overlay.
- 🔁 **Repeat-one reads as repeat-one** — the repeat icon shows a "1" badge when repeat-one is active.
- 🔗 **Direct file links save correctly** — a URL pointing straight at a file (a `.jpg`, `.mp3`, `.pdf`, detected by extension or content-type) now files as the right memo type instead of saving a blank card: images render and cache locally, audio auto-pulls into a playable memo, PDFs become documents.
- 📝 **Get transcript without losing the video** — a standalone **Get transcript** button on the Transcript tab of any video memo pulls the text in the background while the video stays embedded. Caption-first: it grabs the source's own subtitles via yt-dlp (fast, free, no download) and falls back to downloading audio to a temp file + local Whisper STT only when the host has no captions. The transcript carries inline `[mm:ss]` timestamps, is stored in `content_text` (so it embeds for RAG + search), and shows a `CC`/`STT` badge for how it was obtained. Works across every video host via yt-dlp; auth-walled/private sources degrade to "open original". New `core/transcript.py`; see ADR-004.
- ✨ **Three-mode AI summary (Timestamp / Key Insights / Essay)** — the AI Summary block is now a mode selector. **Timestamp** produces a chronological outline anchored to the transcript's `[mm:ss]` marks; **Key Insights** is bullet takeaways; **Essay** is flowing prose. Each mode is a separate Ollama call fed the full transcript and cached per-mode (`summaries` column) so switching back is instant. Reused across video, audio and document memos.
- 🎬 **Inline players for every video platform** — the memo detail page and the dashboard lightbox now embed the source player for YouTube, Vimeo, Instagram, TikTok, X, Facebook, Dailymotion, Streamable and Twitch. Driven by a single platform registry (`frontend/src/lib/platforms.ts`) shared by the card, lightbox and detail so they never drift apart. Hosts with no embeddable player fall back to "Open original" instead of a dead end.
- 🏷️ **Brand glyphs on video cards** — Instagram, TikTok, X, Facebook, Threads, Reddit, Dailymotion and Twitch links show their platform logo on the minimal video card; any other remote host shows its favicon; only true local uploads fall back to the generic video icon.
- ✅ **Platform embed test matrix** — `frontend/src/lib/platforms.test.ts` locks embed-URL + glyph behavior across 12+ hosts, including graceful nulls for unknown / embed-less hosts and local files.
- 🎯 **New collection auto-selects in the new-memo panel** — creating a collection from the panel's "New collection…" flow now auto-selects it for the memo you're adding, instead of making you reopen the picker and choose it again.
- 🌐 **Self-hosted page scraper (local Microlink replacement)** — a headless Chromium (Playwright, `backend/core/headless.py`) now renders links the plain HTTP fetch can't read: Cloudflare managed-challenge and JS-rendered antibot pages (Dribbble, Behance, …). It executes the challenge JS so the real OpenGraph image + page content extract correctly. Replaces the Microlink API dependency entirely — Microlink began paywalling exactly these sites (`EPROXYNEEDED`) — so there's no third-party API, no key, and no per-site limit; the browser ships inside the `openmemo-api` image. Launched lazily and degrades to the plain fetch if the browser is unavailable (feature is purely additive). Auth-walled content (private Facebook/Instagram photos) still needs the browser extension — that's a login wall, not antibot.
- 🎧 **Sidebar now-playing player** — the persistent audio player moves from the top-right pill into the sidebar foot. Cover, title, source, scrubber, and a transport of **repeat-one · play/pause · pin** (single-track focus replaces next/prev). When the sidebar is collapsed it shrinks to a cover thumbnail wrapped in a progress ring, so you can still see something is playing. Drives the one shared `<audio>`, so playback survives navigation.
- 💿 **Inline music card player** — the active music card flips to an in-card player at the **same size** (an overlay, no resize/zoom — nothing jumps). The cover stays crisp; a bottom→top gradient (cover-mood tint + a blur masked behind the controls) carries the transport (**repeat-one · play/pause · pin**) + title. Music only — voice memos keep their waveform tile.
- 🎨 **Cover-mood tint** — the sidebar + inline players take the artwork's dominant color (extracted client-side via canvas in `lib/coverMood.ts`, no dependency), white controls over it, like a proper now-playing surface. Falls back to theme tokens when no color can be read.
- 🪟 **Small / big sidebar player** — an appearance preference. **Small** (default) is the cover-thumbnail row; **big** shows the full cover on top fading into the cover-mood color with the transport below, like a now-playing card. Music-with-cover only (falls back to small otherwise).
- ⌨️ **Media-key control** — the keyboard play/pause key and the OS lock-screen / notification transport now drive the player via the Media Session API, with title / artist / cover shown in the OS overlay.
- 🌌 **Aurora glow on the playing track** — a faint aurora-borealis halo, tinted from the track's own cover, blooms behind the active music card and bleeds just past its edge. Two color blobs drift independently (9s vs 11s, opposite directions) under a heavy blur so it shimmers organically and never visibly loops. Music only; honors `prefers-reduced-motion`.
- 🗂️ **Voice vs music taxonomy** — a new `audio_kind` column (`voice` | `music`, ADR-005) finally separates mic recordings from uploaded/linked music. The recorder flags its captures `voice`; everything else audio is `music`. One predicate `audioKind(memo)` drives every render site. PRAGMA-guarded migration backfills existing rows.
- 🔌 **Audio platform registry** — `frontend/src/lib/audioPlatforms.ts` centralizes linked-audio hosts (SoundCloud, Bandcamp, Mixcloud, Audius, Audiomack) the way `platforms.ts` does for video. Adding a host lights up the live embed + card at once. Backend mirror: `core/extractor.is_audio_host`.
- ♾️ **Infinite scroll for the memo feed.** The dashboard loads memos in pages of 50 via `useInfiniteQuery` with an `IntersectionObserver` sentinel 300 px below the grid — memos 51+ are now reachable by scrolling. Switching filter tabs or collections resets to page 1. The list query is trimmed with SQLAlchemy `load_only()` so heavy unused columns (`content_raw`, `summaries`, `embedding_ids`, `transcript_*`, `localize_status`) are no longer fetched per page.

### Changed

- 🧭 **Detail meta row** — Pin and Download now sit inline next to the date and source instead of in a separate row; "Download original" is now "Download to device" so it's clear it pulls the file to your computer; and the source link gained a hover state.
- 📝 **Music keeps a Description, not a transcript** — a song's transcript is its lyrics (a separate, later feature), so music memos no longer show a transcript panel. A collapsible **Description** takes its place, surfacing the original notes, tracklist, and timestamps from the source. Voice memos keep their transcript.
- 📥 **Source player is collapsible** — the live platform widget on a music detail page can be hidden, and collapses by default once the track is saved locally; its redundant "Open original" button is gone (the source chip at the top already covers it).
- 🔁 **Transcript decoupled from "Make it local"** — transcript extraction no longer downloads the media or changes the memo type. The old `audio_transcript` download mode is removed; **Make it local → Audio only** is now an explicit, warned video→audio (podcast) conversion, not a transcript side door. `POST /memos/:id/transcribe` routes local files to Whisper STT and remote-only memos to the caption-first extractor. See ADR-004.
- 🧩 **Video platform detection centralized** — the YouTube-only `videoSource()` / `youtubeEmbed()` helpers in `lib/media.ts` were replaced by the shared `lib/platforms.ts` registry consumed by `MemoCard`, `Lightbox` and `MemoDetail`. Adding a new host now lights up all three at once.
- 🔀 **Audio player relocated** — `HeaderAudioPlayer` (top-right pill) is removed in favor of the sidebar player; the shared engine gains repeat-one state (`onEnded` → restart).
- 🧱 **Sidebar is a 3-zone layout** — the sidebar no longer scrolls as a whole; only the middle (nav / pinned / collections) scrolls in a dedicated `.om-sidebar-body`, so the now-playing player + foot stay pinned to the bottom with no auto-margin gap. `.om-sidebar` is now `height:100dvh; overflow:hidden`.
- 📐 **Sidebar player width + accent swatch** — the player now spans the full rail width (matches the foot divider below it; was inset), and appearance's last accent swatch is a usable mid-grey (`#71717A`) instead of near-white.
- ✨ **Player polish** — the card↔player swap now cross-fades both ways (framer `AnimatePresence`) instead of a hard flip; the sidebar is a 3-zone column where **only the collections list scrolls** (search / nav / pinned / headers stay fixed — ADR-006); the big player's cover **dissolves** into the mood color (no hard cut) with a roomier transport; sidebar-player icons sized to match the nav for cohesion; mic / music kind icon on audio card titles.
- 🗂️ **Memo feed is indexed.** Added DB indexes for the list query (`memos(is_deleted, recency_at DESC, created_at DESC)`, `memos(type)`, `memos(workspace_id)`, `memo_collections(collection_id)`) so browsing stays fast into the thousands of memos. Created idempotently on startup.
- 🩺 **Container healthcheck now uses `/api/ping`.** Pure liveness, no external dependencies; Ollama reachability is reported separately and lazily by `/api/health`.

### Fixed

- 📍 **Sidebar big-player close button drifted to the top of the sidebar** — the player had no positioning context, so its absolute close ✕ resolved against an ancestor and rendered far from the player it belonged to. It's now anchored to the player (top-left) and revealed on hover.
- 🌗 **Player mood color snapped on theme switch** — the veil brightness is now an animatable `filter`, and `filter` was added to the theme-swap transition list, so the dim cross-fades between light and dark instead of jumping.
- 🧩 **Detail player loaded piecemeal** — the hero now waits until its cover and aspect are known, then fades in as one unit, so nothing pops in on load and the width no longer jumps between memo types.
- 🎞️ **Getting a transcript destroyed the video** — asking for a transcript on a YouTube/social video used the only available path (`Make it local → Audio + transcript`), which downloaded the audio and flipped `memo.type` from `video` to `audio`. Since the inline embed is gated on `type === 'video' && !file_path`, the video silently vanished and the memo became audio-only — you lost the video to get its text. Transcript extraction is now fully non-destructive (never sets `type`/`file_path`); the video stays embedded while the transcript fills its tab. Whole video type, every host (ADR-004).
- 📺 **Non-YouTube video embeds** — Instagram (and Vimeo, TikTok, Facebook, …) video memos showed no inline player: a dead "No preview available" in the lightbox and only a "Make it local" panel on the detail page. They now embed the source player the way YouTube always did.
- 🏷️ **Generic glyph on social video cards** — an Instagram / TikTok / Threads video card showed a generic "video file" icon instead of its platform logo on the minimal card pill.
- 🔗 **Blank memo on bot-walled links** — saving a link that answers with a Cloudflare/JS antibot challenge (HTTP 202 + JS stub, as Dribbble now does) stored an empty memo with no title, image or content: `extract_url` had been refactored to `raise_for_status()`, which lets 2xx-but-not-200 challenge stubs through, and the old Microlink fallback was paywalled for exactly these sites (`EPROXYNEEDED`). `extract_url` now gates strictly on a real 200 and otherwise escalates to the self-hosted headless browser (see Added), which renders past the challenge and extracts the real og:image + content — Dribbble/Behance/etc. pull their actual hero image again. Only when even the browser gets nothing does the save fall back to a "preview unavailable — open original" card that still survives source deletion. Whole `link` type, not one host.
- 🖼️ **Photo posts saved as video** — a Facebook / TikTok / X photo URL was filed as a video memo (domain-based type forcing) and pulled no image. Photo-vs-video is now resolved from the URL when yt-dlp finds no stream: unambiguous photo paths (FB `/photo`, TikTok `/photo/`, X `/status/…/photo/`) classify as image; real videos still win. Centralized in `extractor._url_media_hint` + `classify.derive_memo_type` per ADR-001 — no per-host hacks. (Instagram `/p/` stays video-by-default, since it is photo-or-video ambiguous and yt-dlp decides.)
- 🗂️ **Server error adding a memo to a collection** — selecting a collection in the New-Memo panel returned a 500 for every memo type (note / link / file): the collection lookup autoflushed the pending memo, so `memo.collections.append()` fired an async-illegal lazy load (`MissingGreenlet`). The new memo's relationship is now marked loaded-empty before the append, so the join row writes cleanly.
- 🖼️ **Social photo posts pulled a placeholder, not the photo** — a Facebook / Instagram / X / TikTok photo URL came in as a video card with the platform's generic share image (FB's cookie/marketing collage), because the scraper trusted `og:image`, which these platforms fill with a placeholder for logged-out scrapers. Photo-type URLs now ask the headless browser for the largest *rendered* DOM image — the real subject — and prefer it. A FB photo now saves the real `scontent.fbcdn.net` image, localized to disk (survives source deletion). General, keyed off `_url_media_hint`; no per-host code. (Auth-walled *private* photos still need the extension — login wall, not antibot.)
- 🌅 **Scraped image memos showed blank on their detail page** — MemoDetail rendered an image only when the memo had a local `file_path`, so a scraped social-photo memo (which has only the localized `thumbnail_path`, no uploaded file) opened blank. It now renders the image from `file_path` *or* `thumbnail_path`.
- 🧲 **"Make it local" appeared everywhere** — the download panel showed on articles, links, images, notes and documents where it is meaningless (`type !== 'audio'` matched everything). Visibility is now a single centralized predicate `canMakeLocal(memo)` (remote `video`/`audio`, not already local) used at both render sites. See `docs/make-it-local.md` + ADR-003.
- 🩹 **Linked audio dead-ended on a yt-dlp hiccup** — when yt-dlp's metadata probe failed at save time (common for SoundCloud), `extract_video` fell back to `type = "video"`, and a `video`-typed SoundCloud memo has no embed and no audio render path — the detail page showed nothing. Audio hosts now classify `audio` even when yt-dlp fails (centralized `AUDIO_HOSTS`), so this can't dead-end. Whole audio type, every host (ADR-005, ADR-001).
- 🩹 **Remote audio could render nothing / hid the live embed** — the SoundCloud/Mixcloud widget only showed when auto-download was off, and a `localize_status: done` state with no `file_path` fell through every branch to a blank page. The detail page's audio section is restructured to always offer a listen path: the live platform widget plus Make-it-local, in every state, and the source embed stays available as a reference even after the track is pulled.
- 🧪 **Smoke-test fixture didn't run startup** — `TestClient(app)` without the context manager never fired the app lifespan, so additive schema migrations (the new `audio_kind` column) weren't applied and the memos endpoint 500'd with `no such column`. The fixture now enters the context manager so startup + migrations run.
- ❌ **Close buttons showed the Twitter/X logo** — `Icon` resolves `BRAND_PATHS` before `ICON_PATHS`, and the Twitter/X brand glyph was keyed `'x'` — the same name every close button uses (`name="x"`). So every close ✕ (modals, lightbox, card delete, sidebar player, FAB) rendered the Twitter logo app-wide. Renamed the brand glyph to `'twitterX'` (Icon + platforms registry + test); `name="x"` is the close cross again, Twitter cards keep their logo.
- 🎚️ **Voice + cover-less audio stay on the classic waveform card** — the full-bleed inline player + aurora are now gated on album art, so a voice recording (or any cover-less audio) keeps the classic waveform tile + centred play button instead of a cover-less takeover that showed a double play button on hover.
- 🎨 **Waveform follows the theme accent** — the playing waveform was a muddy `color-mix(in oklab, accent, text)` that swapped hue from grey (rest) to the mix (playing). Bars are now the theme accent throughout (calm at rest, full when active — same hue), and the tile is faintly accent-tinted.
- 🧹 **ESLint clean** — resolved all 27 outstanding eslint problems across the frontend (real fixes for `no-explicit-any`, unused caught error + `preserve-caught-error`, a redundant assignment; documented, behavior-preserving disables for the new react-hooks v6 rules flagging intentional patterns). `npm run lint` now exits clean.
- 🎵 **AI Summary showed on music memos** — the panel was gated only on "has text" (`content_text`), so a music track with a transcript rendered an AI Summary with Timestamp/Insights/Essay modes — summarizing a song is meaningless. Eligibility is now one predicate, `canSummarize` (frontend `lib/media.ts`) / `can_summarize` (backend `core/classify.py`), gated by memo type **and** `audio_kind`: music never summarizes, voice (spoken word) still does. Which types qualify lives in one editable `SUMMARIZABLE_TYPES` set per end, and the `POST /summary` endpoint enforces the same rule so the API can't be summoned past the UI. See ADR-007.
- 📐 **Instagram and TikTok embeds clipped in portrait.** Both platforms produce portrait (9:16) content but the embed container used a hardcoded `aspect-ratio: 16/9` — cutting off the video. `embedOrientation: 'portrait'` is now an optional field in the platform registry (`lib/platforms.ts`); `embedAspectRatio()` returns `9/16` for Instagram and TikTok and `16/9` for every other host. Lightbox: portrait embeds are height-constrained (`min(85vh, 720px)`) with `width: auto` instead of width-constrained. MemoDetail: the container aspect-ratio is driven by the registry and a `.om-video-embed--portrait` modifier (max-width 400px, centred) is added for portrait platforms. All non-portrait hosts (YouTube, Vimeo, Facebook, etc.) are unchanged — the registry is the single source of truth per ADR-001.
- 💡 **Hint added for portrait platform embeds.** When viewing an Instagram or TikTok video that hasn't been saved locally, a nudge appears above the Make it Local panel pointing users toward saving for a clean native player without platform UI.
- 🎨 **Voice memo waveform tile ignored dark/light theme.** A hardcoded warm-beige gradient (`TINT_FALLBACK`) was applied as an inline style on `.om-audio-frame`, overriding the CSS class background entirely — so the tile always rendered the same beige regardless of theme. Removed the inline style and added a `--audio-frame-bg` CSS variable per theme (mid-gray `#3a3a3e` for dark, warm `--bg-rail` for light, `#2e2e32` for hi-contrast) mixed with the user's accent color at 18% (30% when playing). The waveform tile now adapts to dark/light mode and picks up the chosen accent tint.
- ⚡ **Home page hung ~15s on "Loading Memos…".** The sidebar's `/api/stats` call walked the whole `files/` directory (GBs, slow over a Docker-for-Windows bind mount) **synchronously inside an async handler**, freezing uvicorn's single event loop, so the fast memo query (~0.5s) queued behind it. Storage sizes are now opt-in (`?include_storage=true`, used only by Settings), computed via `asyncio.to_thread` (never blocks the loop), and cached 60s. The sidebar's per-page call returns counts only. Measured on 85 memos / 1.1 GB: stats 20s → 0.27s, and the memo query stays ~0.38s even while the storage walk runs.
- 🔌 **A down Ollama stalled the UI and faked container ill-health.** The container healthcheck hit `/api/health`, which probed Ollama with a 10s connect timeout, so an offline LLM marked the API unhealthy and added a ~13s stall to the Settings page (plus ~8.6k pointless Ollama probes a day). Liveness is now a dependency-free `/api/ping` and the healthcheck points there. `/api/health` (Settings only) probes Ollama on demand with a ~1.5s timeout and a 15s cache.

---
## [2.0.2] - 2026-06-01

Audio memos pulled from yt-dlp platforms now behave like first-class audio: they
download automatically, show their cover art on the card, and play from a real
player instead of a confusing "Make it local" prompt with a Video button.

### Added

- 🎧 **Auto-download pulled audio** — paste a SoundCloud / Bandcamp / Mixcloud link and openMemo downloads the audio in the background on save, so it lands as a local, playable audio memo with no manual step. Survives the original being taken down. New `Auto-download pulled audio` toggle under Settings → Uploads.
- 📻 **Stream embed for remote audio** — when auto-download is off, the memo detail streams the track inline via the platform's embed widget (SoundCloud/Mixcloud), with "Open original" and "Save audio in openMemo" actions, instead of the make-it-local panel.
- 🖼️ **Cover art on audio cards + player** — audio memos with artwork now show the cover on the dashboard card and beside the detail player, instead of always falling back to the waveform.

### Changed

- 🎵 **"Make it local" is audio-only for audio sources** — audio-only platforms no longer offer a nonsensical "Video" download option; they get a single "Save audio" action.
- ▶️ **Remote audio is reachable from the dashboard** — the audio card play button is no longer a dead disabled control for not-yet-downloaded tracks; it opens the detail page where the track streams or finishes downloading.

### Fixed

- 🪟 **Lightbox toolbar spacing** — the "Open memo page" and close buttons no longer crowd the viewport edge or each other, and the button label no longer clips.
- 🗑️ **MemoDetail delete confirm sizing** — the inline "Delete memo?" popover is more compact (smaller label and buttons), and a duplicated CSS block for it was removed.

---
## [2.0.1] - 2026-06-01

A polish pass on top of 2.0.0. Smaller scope, but every item is something you
probably ran into on day one. The MemoDetail page can scroll again, the Settings
"What's New" modal scrolls cleanly without dragging the page behind it, deleting a
memo no longer feels like a one-way door, and a "Make it local" download finally
keeps the YouTube thumbnail instead of replacing it with a random ffmpeg frame.

### Added

- 🗑️ **Soft delete with 5-second undo** — deleting a memo now slides a toast in at the bottom-center with **Undo** and a live countdown bar. Hit Undo and the card pops back. Backed by new `is_deleted` + `deleted_at` columns on `memos` and new `POST /api/memos/{id}/restore` + `GET /api/memos/deleted/list` endpoints.
- ♻️ **Recently Deleted modal in Settings** — a new "Trash" card under Settings opens a scrollable modal of recently deleted memos with one-click **Restore**. Native wheel-stop on the modal root so Lenis can't intercept the scroll (same fix as the changelog modal).
- 🪟 **Full-bleed in-card delete confirm** — clicking the × on a card now darkens that card edge-to-edge with a frosted overlay and a "Delete memo? Cancel / Delete" prompt that respects the card's rounded corners. Confirm triggers the soft delete + undo toast.
- 🗑️ **Delete in MemoDetail header** — a small trash button top-right of the memo detail header opens an inline confirm popover, deletes, and navigates back.
- 🎬 **Video description & transcript tabs** — video Memos now show two tabs on the detail page: "Video description" (the platform's own text, pulled by yt-dlp) and "Transcript" (your local Whisper text). The transcript tab only fills in once you actually transcribe, so a YouTube description never masquerades as a transcript again.

### Changed

- 🎞️ **"Make it local" keeps the source thumbnail** — yt-dlp now reports the source thumbnail URL during a localize, and openMemo caches that instead of overwriting the memo's thumbnail with an ffmpeg frame. The dashboard card keeps showing the YouTube/Vimeo poster after the video is downloaded. ffmpeg frame remains a fallback only when neither memo nor source has a thumbnail.
- 📺 **Transcript is a collapsed toggle by default** — audio and video memo transcripts no longer dump the full text inline. The "Transcript" header is now a chevron toggle; click to expand. Keeps long video pages short until you ask for the text.
- 🔝 **MemoDetail header layout** — the back arrow moves to the top-left of the header where you expect it; the memo type label moves into the content area above the title.
- 🛠️ **Dev `npm run dev` proxies to Docker by default** — `vite.config.ts` default `apiTarget` is now `http://localhost:8091` (Docker/nginx, always running) instead of `:8099` (local uvicorn). Override with `VITE_API_TARGET` when running `dev.ps1`.
- 🌐 **One video extractor for every site** — the separate YouTube and social-video code paths are gone, replaced by a single yt-dlp path that handles all 1000+ sites yt-dlp supports. Vimeo, Dailymotion, Rumble, Bilibili and the rest now extract exactly the way YouTube does.
- 🎵 **Audio platforms save as audio** — links from SoundCloud, Bandcamp and Mixcloud are detected as audio-only (via yt-dlp's codec info) and filed as audio Memos instead of video.
- 🗂️ **Video description stored separately** — a new `video_description` column keeps the platform's text apart from `content_text`, which is now reserved for the real transcript. A migration backfills existing video Memos.
- 🎙️ **Transcript is always opt-in** — "Make it local" no longer has a combined "Audio + transcript" mode. Download audio or video, then transcribe on demand with the Transcribe button. Recordings still offer transcription at capture time.

### Fixed

- 📜 **MemoDetail scroll works again** — long memo pages were unscrollable since 2.0.0. The `om-main-inner` wrapper inside `<main>` had no height, so `om-detail-scroll`'s `flex: 1` resolved to zero. One CSS rule (`.om-main:has(.om-detail-page) .om-main-inner { height: 100% }`) restores the chain.
- 📜 **"What's New" modal scrolls correctly on long releases** — 2.0.0's release notes overflowed and clipped at the viewport edges. The modal now uses `max-height: calc(100vh - 80px)` with a flex layout and an internal `overflow-y: auto` body, and a native (non-React) wheel listener on the modal root stops Lenis from hijacking the wheel and scrolling the Settings page behind it.
- 🏷️ **YouTube description no longer mislabeled as a transcript** — video Memos were showing the pulled platform description under a "Transcript" heading even when nothing had been transcribed. The transcript view now renders only real Whisper output (when `transcript_status` is done).

---
## [2.0.0] - 2026-06-01

The biggest release yet, by a wide margin. This is months of work and fine-tuning
landing at once, and it gets openMemo a lot closer to what it was meant to be from
the start. Almost every part of the app got touched: capture, storage, the card
grid, search, the detail page, settings, the whole look. Dozens of fixes too, the
kind that turn a rough build into something that feels finished.

Audio is the headline. openMemo now records, plays, and reads back sound. Capture a
voice memo straight from your mic. Drop in any audio file, lossless WAV and FLAC
included. Play it all from a header mini-player that follows you across the app and
keeps going while you move between pages, with a waveform that reacts to the sound
as it plays.

And then it transcribes. This is the part I am most proud of. Every recording and
every uploaded file gets turned into clean, searchable text by faster-whisper,
running entirely on your own machine, in dozens of languages, on your GPU or your
CPU. No cloud, no API key, no per-minute bill. A voice memo becomes something you
can search, read back, and ask questions about, exactly like the rest of your
Memos. Speech-to-text that good, fully local and free, is the feature I wanted in
openMemo more than any other.

Make it local is the other big one. Point it at any video or audio link yt-dlp can
fetch, from YouTube and Vimeo to podcast hosts and direct media files, and openMemo
pulls the media down and keeps it, so a Memo survives the original being taken
offline.

The minimal card mode is the one I am proudest of on the design side. It is a full
redesign: cards drop their text and go full-bleed thumbnail, images detect their own
orientation and switch aspect ratio, and on hover the thumbnail blurs in place under
a soft tint while the title, tags, and source pill surface. Quiet at rest, alive on
hover. This is the openMemo I pictured when I started, and it is finally on screen.

The light and dark theme switch is the other piece I keep coming back to. It is a
cinematic sunrise and sunset: an opaque glow grows from the horizon, sunrise lifting
from the bottom going light, dusk rolling down from the top going dark, fully
covering the cards as it sweeps so the theme flips hidden underneath and is revealed
as the glow fades. I have not seen this transition anywhere else on the web, and I
am genuinely proud of it.

Around those: pin Memos and collections to the sidebar, a profile with your name
and avatar, thumbnails for uploaded videos, upload limits you control with no real
ceiling, far better saving of social and bot-walled links, drag a card onto a
collection to file it, and drag to reorder your filter tabs. This is a 2.0 because
it is not one feature, it is the release where the whole thing grew up.

A note on the look: bento-grid web design kept inspiring me through this one,
apps like Letterly and plenty of others. More to come on that front soon.

### Added

- 🎙️ **Voice recording in the New Memo panel** — the Voice tab now records from the mic (native `MediaRecorder` + WebAudio level meter, preview + re-record before saving) and uploads as an audio memo. No third-party dependency. New `VoiceRecorder` component; picks the best container the browser supports (WebM/Opus, Ogg/Opus, or MP4/AAC).
- 🔊 **Persistent header audio player** — a mini-player pinned top-right (`HeaderAudioPlayer`, driven by a single shared `<audio>` in an `AudioPlayerProvider` mounted in `<Layout>`) keeps playing across navigation and stays visible when paused. Scrub, elapsed/total time, click the title to open the memo, close to dismiss.
- 🎧 **Audio cards & inline detail player** — dashboard audio cards get a real play/pause control wired to the shared player; the memo detail page shows an inline player (scrubber, time, download). Lossless WAV/FLAC play natively.
- 📝 **Local transcription (speech-to-text)** — `faster-whisper` transcribes recordings (toggle in the Voice tab, **on by default**) and uploaded audio (on-demand **Transcribe** button on the memo page). Multilingual with automatic language detection; auto-detects CUDA (float16) and falls back to CPU (int8). The transcript is stored as the memo's `content_text`, so audio becomes **searchable and chattable via RAG**, and is rendered under the player. New module `backend/core/transcribe.py`; lazy-loaded so the app boots even without the package.
- 🎵 **Explicit Audio uploader** — the Media panel adds an Audio kind (`accept="audio/*"`); `/api/ingest/file` gains `type_override` (pins a `.webm` recording as audio, not video) and `transcribe` flags. `/api/memos/{id}/file` now serves a correct `audio/*` MIME (incl. FLAC/Opus/WebM) so browsers play and seek. New nullable `transcript_status` / `transcript_lang` columns on `memos` (auto-migrated on startup); new dep `faster-whisper`.
- 📺 **Platform logos on minimal video cards** (ENTRY OPNMMO-0006) — the bottom-left pill on a minimal-mode video card now shows the source platform's brand glyph: the YouTube logo (red) for YouTube links, the Vimeo logo (blue) for Vimeo, and the generic video icon for local uploads or other hosts. New fill-based `BRAND_PATHS` in `Icon` (kept separate from the stroke-based icon set) and a `videoSource()` detector in `lib/media.ts`.
- 💾 **"Make it local" — download any video or audio link so it survives deletion** — any Memo backed by a URL that yt-dlp can fetch (YouTube, Vimeo, social video, podcast hosts, direct media files, and the long list of sites yt-dlp supports) now gets a "Make it local" panel on its detail page. Pick a mode — **Video** (up to 1080p mp4), **Audio only**, or **Audio + transcript** (downloads audio then runs faster-whisper) — and yt-dlp pulls the media into `files/`, flipping the Memo to a local video or audio that plays and seeks even if the original is taken down. Backend: `POST /api/memos/{id}/localize` + `localize_memo_task` (new `backend/core/localize_media.py`); new nullable `localize_status` column (auto-migrated); a video thumbnail is generated after download. The page polls until the download finishes. Verified end-to-end: a YouTube link → `done`, Memo flips to local audio, served with `audio/mp4` + `206` Range.
- 🎚️ **Live waveform on audio cards while playing** — the dashboard audio card's waveform is now a `<canvas>` that animates the real frequency spectrum from the shared player's WebAudio `AnalyserNode` while that track plays (calm static bars otherwise). The `AudioPlayerProvider` builds the analyser graph once per `<audio>` (a `MediaElementSource` can only be created once) and exposes `getLevels()`; bars paint in `currentColor` so they stay theme- + accent-aware.
- 🗣️ **Transcribe local videos too** — the transcribe path now accepts local **video** memos, not just audio (faster-whisper reads the video container and pulls the audio track itself). A localized or uploaded video shows the Transcript section + on-demand Transcribe button like audio memos do.
- 🧲 **Drag a memo card onto a sidebar collection to file it** — dragging any card and dropping it on a collection in the sidebar now adds the memo to that collection. Previously the drop target existed but never fired because the grid's `DndContext` and the sidebar lived in separate providers. The `DndContext` was lifted to `<Layout>` (wrapping both the sidebar and the routed page) with a small ref "bus" (`lib/dndBus.ts`) so the active grid registers its drag handlers into the shared context. Card click + drag-to-reorder behaviour is unchanged (`PointerSensor` `distance: 8` preserved).
- 🧹 **Background memo-type sorter (runs on startup + twice weekly)** — a scheduled job re-files every memo to its canonical type so the database stays tidy. `backend/core/classify.py:derive_memo_type` is the single source of truth: uploaded file → type by extension; YouTube / social-video URL → `video`; direct image/pdf/etc. link → `image`/`document`/…; any other web page → `link`; text-only → `note`. `reclassify_all` rewrites only mismatches (idempotent). Wired via APScheduler in the FastAPI lifespan: once on boot, then Mon & Thu 03:00. Manual trigger: `POST /api/maintenance/reclassify-types` (`?dry_run=true` to preview).
- 🎴 **Minimal card mode — complete redesign with full-bleed thumbnails + hover overlays** — opt-in `cardStyle: 'minimal'` in Appearance (renamed from `min`). Image/video/link cards lose their text body in favour of a full-bleed thumbnail. Image cards auto-detect orientation on `onLoad` (`naturalHeight > naturalWidth` → `data-orient="portrait"`) and switch between `aspect-ratio: 3/4` (portrait) and `4/3` (landscape). On hover, the thumbnail itself blurs in place (`filter: blur(12px)` with `transform: scale(1.10)`, scale runs 1.8s + blur 0.7s for a subtle parallax feel). A theme-aware gradient veil fades over the blurred image — cream gradient in light, dark vignette in `[data-theme="hi"]`. Description text floats around the action cluster via `::before { float: right; shape-outside: inset(0); }`, so it wraps naturally then flows full-width below. Tags sit bottom-right on the same row as the always-visible domain pill (bottom-left).
- 🎯 **Always-visible affordance pills (minimal mode)** — link cards show a `[favicon] domain.com` pill bottom-left (with `rootDomain()` stripping `www.` + paths). Image/video/audio cards show an icon-only pill (just the type icon) that expands left-to-right on hover via `max-width: 0 → 220px` + `padding-left: 0 → 6px` (300ms ease) to reveal the title. Icon has `flex-shrink: 0` so it never compresses during the reveal animation.
- 🏷️ **Integrated action cluster (arrow + pin + delete)** — all three actions live in a single `.om-card-actions` flex row, hover-revealed top-right, styled identically (`.om-action` token: `rgba(20,20,22,0.72)` bg, `backdrop-filter: blur(12px)`, 30×30, 8px radius). New `onOpen` prop on `<Chrome>` renders the arrow as the first action when supplied — wired on note/image/video/doc/file/link cards. The old `.om-drag` grip handle is gone (DnD still works — listeners spread on the card root via `dragHandleProps`). Notes stack the actions vertically (`flex-direction: column`) so they don't sit on top of the title.
- 🖼️ **Click-to-lightbox for image + video cards (both card styles)** — clicking an image card opens a fullscreen lightbox with the image; clicking a video card opens an HTML5 `<video controls autoPlay>` for local files or a YouTube `<iframe>` embed for `youtube.com/watch?v=…` / `youtu.be/…` URLs (detected by `youtubeEmbed()` helper). Lightbox toolbar gets an "Open memo page" pill (`.om-lightbox-open`, arrow icon + text) alongside the close X — navigates to the detail page. Esc closes; click-backdrop closes. Lightbox left edge offset by `var(--sidebar-w)` (76px collapsed / 260px expanded, set on `:root` by a `useEffect` in `<Sidebar>`) so the sidebar stays visible.
- 🤖 **Headless AI ingestion endpoint** — `POST /api/ingest/ai` accepts pre-structured JSON (type, title, content, source_url, source_domain, tags[], collection_id, …) for local AI agents feeding cards into OpenMemo. Unlike `/url` (extracts) and `/extension` (DOM scrape), the caller is the AI so all metadata is pre-supplied — endpoint just persists + runs the embedding task in the background. Returns `{id, title, type, status, tags}`.
- 🎚️ **Background image blur slider** — Appearance panel gains a 0–120px range slider when `bgMode === 'image'`, wired to `Tweaks.bgBlur` (default 64). Drives `--bg-blur` CSS var; `[data-bg="image"] .om-app::before` and the dark-theme override both use `filter: blur(var(--bg-blur, 64px))` instead of a hardcoded 64px.
- 🛡️ **Branded delete confirm modal** — replaces the browser-native `confirm()` on memo delete with a centred `.om-confirm-overlay` (`z-index: 250`, backdrop blur). Card-styled `.om-confirm` panel uses surface tokens, accent typography, red Delete button + grey Cancel. Esc dismisses, click-backdrop cancels, Delete auto-focused.
- 🔁 **Video thumbnail backfill endpoint** — `POST /api/maintenance/backfill-video-thumbs` re-runs `extract_video_thumbnail` for every video memo missing a thumbnail (skips when ffmpeg isn't on PATH → 503). Idempotent; returns `{processed, skipped_existing, failed, total_videos}`. For videos that uploaded before ffmpeg was installed or whose extraction silently failed.
- ⬅️➡️ **Lightbox prev/next navigation across the grid** (ENTRY OPNMMO-0002) — opening any image/video card's lightbox now lets you page through every other media memo in the grid without closing it. On-screen chevron arrows (left/right), `←`/`→` arrow keys, a wrap-around `n / total` counter, and `Esc` to close. The lightbox was promoted from a per-card local component to a single shared grid-level overlay driven by a Zustand slice (`lightboxGroup` / `lightboxIndex` + `openLightbox`/`closeLightbox`/`lightboxStep`), rendered once in `<Layout>`. `MemoGrid` passes the ordered image/video memos as the navigable group.
- 📄 **Memodoc detail report card** (ENTRY OPNMMO-0004) — document, code, and generic `file` memos (which often have little or no extracted text, leaving the detail page a bare title) now lead with a report card: a kind badge (file extension), title, and a stat grid showing Added date, Kind, Length (word count + reading time, when text exists), Collections, Tags, and AI-summary status. Sits above the pin / generate-summary / download action row.


- 🎞️ **Local video preview + media controls in MemoDetail** — image and local video memos now share a `MediaPreview` component with three affordances: a hover-revealed Theater toggle (top-right) that expands the preview to full content width, a Fullscreen button (browser native fullscreen API), and click-to-Lightbox on images (Esc or click-outside closes). Local-file videos (`type: video` with a `file_path`) finally render at all — previously only YouTube embeds did.


- 🗂️ **Accept any file type** — the upload handler no longer enforces an extension allow-list or magic-byte gate (images are still sanity-checked). Files are categorized into image/audio/video/document/code/file; unknown types become `file` and show a file icon + extension badge on the card.
- 💻 **Code file handling** — source/script files are detected as a `code` memo type, stored as text and rendered as a fenced, language-tagged code block. Hardened comment + read-only handling guarantees uploaded files are never executed/interpreted.
- ⚙️ **Configurable max upload size** — new `GET/PUT /api/settings` (JSON-persisted) and a Settings → Uploads card to set the per-file limit (default 5 GB; user can raise it up to 1 TB or set `0` for effectively uncapped — this is a local-first app, the user owns the disk).
- 🛟 **Huge-upload disclaimer** — Add Memo's file picker now warns before sending anything ≥ 1 GiB: total size, that ingestion and embedding will take a while, and a reminder that files stay on the user's machine. One-click confirm/cancel.
- 🧪 **Unknown extension passthrough** — Uploading a file with an extension (or no extension) the categorizer has never seen still succeeds end-to-end: the original extension is preserved on disk, the memo is created with `type: "file"`, and the background processor no longer tries to UTF-8 read a binary blob (e.g. `.blend`, `.3mf`, archives) — `content_text` stays empty for true binaries instead of being polluted with replacement characters. Known-text extensions (`.txt`, `.csv`, `.log`, `.tsv`, `.srt`, `.vtt`) still get read.
- 🌐 **Local copies of extracted web content** — saved articles/links now download their referenced images into `files/extracted/<memo_id>/` and rewrite the Markdown to a local `/api/files/extracted/...` route, so memos survive the source being deleted. Runs automatically on new URL/extension ingests; a Settings → Uploads "Localize" button backfills existing memos. Served with a path-traversal-guarded route registered before the catch-all.
- 📌 **Pin from card hover (memos + collections)** — pinning is no longer detail-only. MemoCard grows a pin button left of delete in `om-card-actions`; pinned cards keep the accent button visible permanently. CollectionsPage cover gains an `.om-coll-pin` button at top-left, mirroring the same accent treatment. Both flows invalidate `['memos','pinned']` and `['collections']` query keys, so the Sidebar's Pinned section refreshes instantly.
- 🎬 **Video upload thumbnails** — new `backend/core/video.py:extract_video_thumbnail` shells out to ffmpeg (`-ss 1.0 -frames:v 1 -vf scale=480:-2 -q:v 4`) to grab a still frame from any uploaded video. Falls back to frame 0 for clips shorter than a second. Best-effort: when ffmpeg isn't on PATH the video memo simply renders without a thumb (no error). Wired into the existing `process_file_memo` background task.
- 👤 **Profile editing — name, avatar, email, mailing list opt-in** — `app_settings.json` gains `display_name`, `email`, `avatar_data_url`, `mailing_list_consent`; `SettingsPatch` accepts them via the existing `PUT /api/settings`. New Profile SettingCard at the top of the left column with an avatar picker (resized client-side to a 256² JPEG data URL so the JSON stays small), inline name/email inputs that save on blur, and an opt-in checkbox for the creator's personal updates list. Sidebar foot now reads `display_name` + `avatar_data_url` via React Query (`['settings']`), falling back to "openMemo" / initials when unset.
- 🌌 **Living-cell intro animation** — the welcome screen's single placeholder orb is replaced by four blurred blobs on independent 14/17/19/22s loops with `mix-blend-mode: screen` and `filter: blur(28px)`. Calm, slow, centred. Honours `prefers-reduced-motion`.
- 🌊 **Smooth scroll (Framer-style)** — Lenis 1.3 is wired into `.om-main` with a 1.1s exp-out easing curve. New `.om-main-inner` wrapper holds the scroll content. CSS imported from `lenis/dist/lenis.css`.


### Changed

- 🔊 **Audio play button unified with the video play button** — the dashboard audio card's play/pause control now reuses the shared `.om-play` token (same white circle, dark icon, size, shadow, and hover-scale as the video card) instead of a divergent accent-colored button. The `pause` glyph was reshaped into fillable bars so it renders under `fill` like `play`. One source of truth for the round play affordance across audio + video, both card styles.
- 🎛️ **Media-kind selector is a 2×2 grid** — with the new Audio kind, the New Memo → Media "Kind" selector (Image / Video / Audio / File) now lays out as a 2×2 grid (`.om-add-segment.grid-2x2`) instead of squeezing four items into one row.
- 🎵 **Audio waveform tile is theme-aware** — the dashboard audio card's waveform paints in `currentColor` (dim text at rest, accent-mixed when playing) so it reads correctly in both themes, instead of the baked-in white pixels that vanished on the light surface. (Superseded mid-release by the live `<canvas>` waveform above.)
- ⬆️ **yt-dlp now self-updates on container start (no longer hard-pinned)** — the image previously pinned `yt-dlp==2024.8.6`, which goes stale fast (YouTube breaks old builds every few weeks) and made "Make it local" / YouTube ingest fail with "Video unavailable". `requirements.txt` now floor-pins (`yt-dlp>=2025.1.0`) and the backend Dockerfile entrypoint runs `pip install --upgrade yt-dlp` on start (best-effort; skipped offline or via `YTDLP_AUTOUPDATE=0`), so it tracks the latest release without an image rebuild.
- 🙂 **Sidebar collection emoji no longer washed out** — the right-side emoji inherited `--text-4` (32% dim) at 10.5px, so text-presentation glyphs (🖥️ ☀️ …) looked faint. Split into a dedicated `.om-coll-emoji` span at full opacity, larger (14px), with a color-emoji font stack and a hover scale.
- 🌅 **Theme transition rebuilt — opaque sunrise/sunset reveal** — the swap is now an opaque radial glow that grows from the horizon (sunrise from the bottom, nightfall from the top) and fully covers the background blobs as it climbs. The theme flips underneath the cover (hidden), then the glow fades out to reveal the new theme. Replaces the old see-through overlay that let blobs bleed through. Built from a `clip-path: circle()` growth on an inner element with `filter: blur()` on the outer wrapper (separate elements — blur on the clipped element leaves a hard edge). Glow takes a light tint from the user's accent colour. All timing/blur/radius values live in committed `frontend/src/lib/transitionConfig.ts`, persisted to localStorage. The `theme-transitioning` `!important` colour-crossfade override is scoped to a short window so it no longer freezes Framer Motion card animations.
- 🪟 **Card style: `hybrid` → `normal`, `Min` → `Minimal`** — `Tweaks.cardStyle: 'minimal' | 'hybrid'` becomes `'minimal' | 'normal'`. Default `DEFAULT_TWEAKS.cardStyle` is now `'normal'`. AppearancePanel labels read `Normal | Minimal` (Normal first). Migration in `appStore.loadTweaks()` converts both `'rich'` and `'hybrid'` from localStorage → `'normal'` on load. All CSS selectors `[data-card="hybrid"]` → `[data-card="normal"]`; swatch class `.s-hybrid` → `.s-normal`.
- 🌿 **Sidebar active-state — no more left edge bar** — dropped `.om-nav-item.active::before` (2×14px accent strip) and `.om-coll.active`'s `box-shadow: inset 2px 0 0 var(--accent)`. Active state now reads purely as `background: var(--surface-2)` + `color: var(--text)` — cleaner.
- 🗣️ **Voice tab — explicit "coming soon" notice** — `AddMemoPanel` voice tab now leads with a prominent `.om-add-coming-soon` callout (`surface-3` bg, mic icon, "Voice capture is not yet available" + "planned for a future release"). The decorative waveform + Record button stay below at 35% opacity / `pointer-events: none` as a visual preview.
- 📁 **File/doc minimal card surface** — `[data-card="minimal"] .om-card-doc` now uses `var(--bg-rail)` (matches sidebar tint, follows theme changes) with a visible `--border-2` stroke instead of disappearing into the dashboard background. File-icon SVG (`.om-file-svg`) reduced 60% → 42% width / 140 → 98px max. Card scales down 5% on hover for a subtle press-in feel.
- 🎵 **Audio card minimal — waveform tile + play button stub** — audio memos in minimal mode now show a decorative waveform SVG background and a frosted-glass play button that fades in on hover. Play button is a visual stub (no JS wiring yet); full inline audio playback is planned as a future feature.
- 🌈 **Hover overlay redesigned — flat frosted tint (link + video cards)** — replaced the gradient-from-top veil with a flat accent-tinted tint scoped to the two card types that have blur and description (`om-card-link`, `om-card-video`). Light theme: white base tinted with the user's accent. Dark theme: dark base tinted with the user's accent. Text colour flips with the tint (dark on light, white on dark) — readable against any thumbnail regardless of image content. Image, audio, note, and doc cards are untouched.
- 📥 **Bulk local import hardened (Media panel)** — selecting or dropping multiple images/videos/files already worked, but one failed file aborted the whole batch and there was no progress. Now each file uploads independently (continue-on-error), a live `Uploading n / total…` counter shows in the dropzone + button, and partial successes still refresh the grid while reporting which files failed. Dropzone copy updated to plural ("select multiple").
- 🔀 **Drag to reorder the dashboard filter tabs** — the filter selector (All / Notes / Links / …) is now drag-sortable; the order persists per browser (`openmemo_filter_order` in localStorage via the `filterOrder` store slice). Uses a nested `DndContext` (separate from the card/collection drag context) with `distance: 8` so plain clicks still select a filter. Saved order is reconciled with the current tab set on load — new tabs (e.g. Code/Audio) append, removed ids drop.
- 🗂️ **Code and Audio are now their own filter tabs** — the dashboard selector gains `Code` (uploaded source files — own memo type, not text notes) and `Audio` tabs. Files tab narrows to real documents + generic uploads (`document,file`). Sets up a future in-app code viewer/editor (see roadmap backlog).
- 🔗 **Saved web pages are now filed as `link`, not `article`** — the Links filter tab matches `type === 'link'`, but `extract_url` (and the extension/AI ingest paths) stored most pages as `article`, so saved links never appeared under Links. Web pages now classify as `link` at save time (`extract_url`, `/url`, `/extension` all run the canonical classifier `derive_memo_type`), and the background sorter migrates existing `article` memos to `link`. There is no longer an `article` type in the taxonomy.
- ⚙️ **Settings — swapped "Made by" and "Uploads/Limits" sections** (ENTRY OPNMMO-0003) — the creator "Made by" card moves to the left column (after Library & Storage), and the Uploads/Limits card moves to the right column (after Local AI, before Built with).
- 🧩 **Lightbox is now a single shared component** — the duplicated per-card lightbox markup (image + video, with YouTube embed / local `<video>` handling) was consolidated into one `<Lightbox>` reading the shared store. `mediaSrc` / `youtubeEmbed` extracted to `frontend/src/lib/media.ts` and reused by both `MemoCard` and `Lightbox`.


- 🌅 **Theme toggle — cinematic sunset/sunrise transition** — replaces the fullscreen `z-index: 9999` overlay with a `z-index: 0` layer that sits BEHIND the cards. Going dark: midnight-blue night falls from the top (`rgba(25,55,140)` center). Going light: warm amber dawn rises from the bottom. Overlay is deliberately under all UI (sidebar, cards stay accessible during animation). Theme data-attribute flip is delayed 100ms so the overlay has a head start before CSS vars change. All UI elements crossfade over 3s via `.om-app.theme-transitioning *` scoped transitions. Background blobs are hidden during the 12s animation window and fade back in after. Documented as a design decision in `docs/memo-card-visual-system.md`.
- 🧭 **First-time tour now gates progress on a real `+` click** — the `Capture anything` step disables Next until the user actually opens the add-memo panel. The coach layer becomes `pointer-events: none` while gated so the FAB receives the click; the card buttons keep `pointer-events: auto`. Once the panel opens, the spotlight smoothly morphs from the FAB onto the panel via existing `transition: all .25s`. New `TourStep` fields: `gate`, `morphTarget`, `gateBody`.
- 🎨 **AppearancePanel — slimmer, sidebar-aware, opens on the LEFT** — the panel is now anchored on the left side of the canvas, with the horizontal offset wired to the sidebar width (260px expanded / 76px collapsed) via a compound `.om-add-panel.om-ap-panel` selector and an `.om-app.sidebar-collapsed` ancestor rule. Dropped the `1×` animation-speed button (default bumped to `2×`) and the `Rich` card-style option (the related `[data-card="rich"]` CSS is also gone). The remaining cardStyle options use the `.two` segment modifier so Min + Hybrid fill the row evenly. Existing localStorage values for `blobSpeed: 1` and `cardStyle: 'rich'` are migrated to `2` and `'hybrid'` on load.
- 🌀 **Background blob animation ~3× more visible** — `@keyframes omIridescent` rebuilt: translate amplitude ±6–7%, rotate ±6–7°, scale up to 1.18, with five keyframes instead of four. Default speed change to `2×` pairs with this so motion is actually felt without being distracting.
- 🪪 **Sidebar wordmark only — logomark dropped** — removed the small `O` avatar from the sidebar header. `.om-brand-name` size bumped 15 → 19px so the wordmark carries the slot on its own.
- 🎨 **Contrast-aware accent text colour** — new `--accent-text` CSS var derived from accent luminance (light accents → dark text, dark accents → white). Install-extension button and other accent-painted controls now read from it instead of hardcoding `#fff`, fixing invisible text on the light-grey accent. Computed in `applyTweaks` via a new exported `luminance(hex)` helper.
- 🧬 **Settings layout polish** — Profile card lives at the top of the left column. Built-with hover panel now keeps the last hovered description after `mouseleave` (no clear) and locks `min-height: 112px` so neighbouring cards don't shift. Danger zone is nested under Built-with in the right column.
- 🔃 **Single, recency-driven sort order** — dropped the four sort modes (Recent / Oldest / Title / Custom) from the dashboard and the appStore. There is one sort, always: `desc(recency_at)`. New `memos.recency_at` TIMESTAMP column with a migration that backfills from `created_at`. Drag-to-reorder writes `recency_at = NOW − (i × 1s)` per card; a brand-new memo created later still lands on top because its `recency_at = NOW()` is greater than every rewritten value. New `PUT /api/memos/{id}/recency` replaces the old `/sort` endpoint; the frontend `sortMode` state, `SortMode` type, sort dropdown UI, and `memoApi.updateSort` are all gone.


- ❤️ **Settings "Built with" card rebuilt with intent** — lead paragraph now thanks the OSS authors openly; tiles still link to each project but on hover/focus a single description slot below the grid updates with a one-line "what it does" + a "Learn more →" link out, instead of every tile being a blank pill. Expanded the entry list (added MDXEditor, yt-dlp) and gave every entry a real description. Moved the Creator card *above* the Built-with card so the "Made by" attribution leads, and equalised the footer divider's vertical space (24 px above + 24 px below the rule instead of 28 px / 8 px) so the divider sits symmetrically.


- 🧹 **Phase out Tailwind** — documented in `CLAUDE.md`: Tailwind's `dark:` variant is incompatible with the `[data-theme]` theme system; components using Tailwind classes should be migrated to the `om-*` token system on sight.
- 🛠️ **Local dev one-command startup** — `dev.ps1` starts uvicorn on `:8099` in its own terminal then launches `npm run dev` with the proxy pointed at it; no Docker required for raw dev. `DATABASE_URL` and `CHROMA_PERSIST_DIR` are now absolute paths anchored to the project root so the wrong DB is never created regardless of which directory uvicorn starts from. Vite proxy target is configurable via `VITE_API_TARGET` env var (now defaults to `:8099` for local dev; Docker users can override to `:8091`).


- 🔀 **Sidebar settings button toggles home ↔ settings** — clicking the foot button while already on `/settings` now navigates to `/` (home) instead of reloading settings. Title attribute reflects current action.
- ✨ **Appearance CTA stronger visual hierarchy** — "Open live preview" button in Settings now has an accent-tinted background (`color-mix(accent 8%, surface-2)`) and an accent-weighted border instead of blending into the surface. The arrow button is accent-filled by default (not just on hover) so it reads as the primary action in the card.
- 🎴 **Minimal mode applies to Collections page** — collection cards in minimal mode use full-bleed cover (`aspect-ratio: 4/3`, cover fills face absolutely), body text hidden at rest and overlays at the bottom on hover (dark gradient + white text). Stack fan-out on hover is preserved. Consistent with minimal image-card language.


- 🧩 **Chrome extension version bump to 1.8.6** — version synced with app. Options page now shows port hint: Docker `:8091` / dev server `:8099`.

---

### Fixed

- 👁️ **Audio play buttons + progress bars invisible in light mode** — the header mini-player, the memo-detail player, and the dashboard audio-card play button all filled with `var(--accent)`. The accent is user-customizable to any color (incl. the near-white swatch), so on a light surface the controls vanished. All audio play/pause buttons and progress fills now use the text/bg inversion (`var(--text)` on `var(--bg)`), which always contrasts the surface — dark in light mode, light in dark — regardless of the chosen accent.
- 🖱️ **Page unscrollable after navigating back from a memo** — opening a note/file (or any) memo and returning to the dashboard left the page frozen — no scroll until a full refresh. Two parts: (1) `<main>` carries `key={location.pathname}`, so React mounts a fresh scroll node on every route change, but the Lenis smooth-scroll effect had `[]` deps and never rebound (old Lenis stuck on the detached node, new node had no driver) — the effect now depends on `location.pathname`; (2) on the memo detail page, scrolling happens on an inner native-overflow pane while `.om-main` is `overflow:hidden`, so Lenis (which hijacks the wheel globally) starved the inner scroll — Lenis is now skipped entirely on `/memo/*` routes. Both the dashboard-return scroll and the detail-page scroll now work without a refresh.
- 🌅 **Theme transition: background blobs twitched just before the sunrise** (ENTRY OPNMMO-0007) — with motion enabled, the blurred background orbs visibly bumped in opacity/position a split second before the radial sunrise/sunset began. The blob lives on `.om-app::before`, which the transition-window `*` color-crossfade rule never matched (pseudo-elements aren't selected by `*`), so it kept its own `transition: background .7s` + drift keyframe and re-interpolated the instant `applyTweaks()` rewrote the `--bg-*` vars. `.om-app.theme-transitioning::before` now freezes both `transition` and `animation-play-state` for the transition window, so the blobs hold perfectly still until the radial covers the swap. (A separate, pre-existing specificity bug where dark-mode blobs never hide is logged as OPNMMO-0008.)
- 🎚️ **Audio/video couldn't seek — served full 200 instead of 206 Partial Content** — two compounding causes: (1) the backend's `FileResponse` did not actually honor the `Range` header on this Starlette version (returned the whole file with no `Accept-Ranges`), and (2) nginx dropped the client `Range` header before it reached the upstream. Fixed both: `get_memo_file` now parses `Range` explicitly and streams a `206` with `Content-Range` + `Accept-Ranges` (full responses also advertise `Accept-Ranges: bytes` so players show a scrubber); `nginx.conf` forwards `Range`/`If-Range` and sets `proxy_force_ranges on`. Verified end-to-end (`bytes=100-199` → `206 Content-Range: bytes 100-199/96044`), including suffix (`bytes=-500`) and open-ended (`bytes=1000-`) ranges.
- 📂 **Files tab showed nothing despite having file memos** — the Files filter tab sent `type=document`, but uploaded files are stored as `file` / `code` / `audio` (only true documents are `document`), so they never matched. The Files tab now maps to a type group (`document,file,code,audio`) and the `GET /api/memos` `type` param accepts a comma-separated list → `Memo.type IN (...)`. All file-backed memos now appear under Files.
- 🚫 **Drag-over collection showed a left-edge accent bar** — the sidebar collection drop-target highlight used `inset 2px 0 0 var(--accent)` (a colored left strip), which violates the project's no-left-edge-bar rule. Replaced with a `.om-coll.drop-over` class: full inset ring (`inset 0 0 0 1px var(--accent)`) + soft accent fill.
- 🎯 **Memo detail loading spinner not centred** — `.om-detail-loading` used `height: 100%`, which collapsed because the parent had no fixed height, pinning the spinner to the top. Switched to `min-height: 80vh` so it centres in the visible area.
- 🪟 **Header backdrop hard-flipped on theme change** — the header `::before` carried a hardcoded `rgba()` gradient wash that snapped between themes (CSS can't interpolate between two gradients). Removed the background fill, kept only `backdrop-filter: blur()`. Note: full-width layout will need a token-safe wash restored later.
- 🪞 **Lightbox covered the sidebar** — used `inset: 0` on `position: fixed`, blanketing the whole viewport. New `--sidebar-w` CSS var (set on `:root` by `<Sidebar>` based on `sidebarCollapsed` state) drives `.om-lightbox { left: var(--sidebar-w, 0) }`. Sidebar stays visible and interactive when the lightbox is open.
- ✨ **Inner halo glow on transparent minimal cards** — `.om-card-dom` (dominant-color blurred backdrop) bled through transparent minimal cards as a centred glow. Now `display: none` in minimal mode. Dark theme additionally gets a darker border (`rgba(0,0,0,0.55)` resting / `0.75` hover) so the card edge reads as a real stroke rather than a bright halo through the blur.
- 🎨 **Action buttons unified across all themes and card styles** — `.om-action` is now a single flat rule: 20×20px, charcoal frosted bg (`rgba(20,20,22,0.72)`), white icon, no `backdrop-filter`, no per-theme variants. Eliminates visual inconsistency between light and dark theme action clusters.
- 📐 **Hover overlay text aligns with action icons** — overlay `padding-top` reduced 16→12px to match action button top position (12px). Float obstacle width reduced 110→76px, height 38→26px to match the new 20×20px action cluster (was sized for old 30×30px buttons). Description text no longer cut short on the right side.
- 🌑 **Dark hover veil no longer fires on image cards** — `[data-theme="hi"] .om-min-hover` was applying a black vignette unconditionally, including over full-bleed images with no text. Scoped with `:has(.om-min-hover-desc:not(:empty))` — the same guard already used in the light theme. Image cards now show a clean full-bleed photo in both themes.
- 🧹 **Dead `data-theme="dark"` CSS aliases removed** — `:root, [data-theme="dark"]` → `:root` only. The `[data-theme="dark"] .om-filter-tab.active` rule removed. Dark theme has always rendered via `[data-theme="hi"]`; `"dark"` was never set on `<html>`. No visual change — dead selectors only.
- 🎴 **Minimal card dark hover tint was broken** — `[data-theme="hi"] [data-card="minimal"]` used a descendant combinator (space) but both attributes live on the same `<html>` element — the rule never matched. Fixed to compound selector `[data-theme="hi"][data-card="minimal"]`. Dark hover tint, border color, and text color on minimal link/video cards now correctly apply in dark mode.
- 🎬 **Video thumbnails never generated in Docker — final fix** (ENTRY OPNMMO-0005) — root cause was `ffmpeg` missing from the backend Docker image: `backend/core/video.py` shells out to it, so `ffmpeg_available()` returned `false` inside the container and every uploaded video rendered a blank card. The extraction code, classification (`.mp4`/`.mov`/… → `video`), and backfill endpoint were all already correct — only the runtime binary was absent. Added `ffmpeg` to `backend/Dockerfile`'s `apt-get install`. After rebuilding the image, `POST /api/maintenance/backfill-video-thumbs` regenerates thumbnails for already-imported videos.
- 🛠️ **Dev panel rendered in production builds** (ENTRY OPNMMO-0001) — `frontend/src/dev/` is gitignored but a Docker build context still copies it (gitignore ≠ dockerignore), so the dev panel shipped in built images. The `import.meta.glob` import and the render are now both gated on `import.meta.env.DEV`, so Vite dead-code-eliminates the panel from any production build regardless of whether the folder is present.


- 🪟 **Edit-collection modal hidden behind the FAB + add-panel** — `.om-modal-backdrop` `z-index` 60 → 80 so it sits above the FAB (60), AddMemoPanel (61), and the `.om-fab.open` close affordance (62). Modal scrim now properly covers everything underneath.
- 📌 **Pinned memos in the sidebar** — pinning is no longer collection-only. New `memos.pinned BOOLEAN DEFAULT 0` column (lightweight migration), `PUT /api/memos/{id}/pin`, `GET /api/memos/pinned/list`. The Sidebar's Pinned section now renders pinned collections **and** pinned memos in one group; clicking a pinned memo navigates straight to its detail page. MemoDetail gains a "Pin to sidebar" / "Unpin" pill in the action row. Drag-to-reorder within the Pinned section is intentionally out of scope for this commit (existing `sort_order` column orders the list; UI for manual reorder will land next).


- 🗂️ **File-memo thumbnail now bakes the extension into the icon** — previously the file card showed a generic Icon + a tiny ".pdf" label *below* the icon. Replaced with an inline SVG file shape that draws the extension as text *inside* the icon body — one component, extension passed as a prop, no per-type icon library. Adapts to the active text color via `currentColor`, auto-shrinks the font for unusual extensions (`.markdown`, `.dockerfile`), and scales crisp at any DPR. Matches the reference example the user provided.

- 🎛️ **Memo detail action buttons mismatched + touching** — "Generate AI Summary" was `om-btn-ghost om-btn-pill` (36 px tall, 10 px radius) while "Download original" was `om-btn-secondary` with a pile of inline styles (30 px tall, 8 px radius), and they had no parent gap, so they butted into each other with visibly different heights. Both now use `om-btn-ghost om-btn-pill` (same class, same metrics) inside a new layout-only `.om-detail-actions` flex row with `gap: 8px`. Removed inline styles. Sets a precedent for future MemoDetail header pills: drop them into `.om-detail-actions` and they line up with the rest.

- ✍️ **Note rendering polish (issue 10 — multiple sub-bugs)**:
  - 🎨 **Note card body rendered fluorescent on light backgrounds** — `NOTE_TINTS[3]` is the dark-bg / cream-text variant, but the JSX never set `data-tint` on the card root, so the CSS rule `[data-bg="random"] .om-card-note[data-tint="3"]` (which restores the intended dark background) never matched. The card kept the JS inline cream text *and* the random-bg-mode cream background — invisible / fluorescent. Card now sets `data-tint={tintIdx}`.
  - 💻 **Fenced code blocks with unknown languages broke the editor** — `codeMirrorPlugin.codeBlockLanguages` only listed ~22 entries; pasting fenced blocks for Kotlin, Swift, Ruby, PHP, Lua, R, Dart, Elixir, etc. either crashed or rendered as raw text. Expanded the map to cover ~50 languages + common aliases (`py`/`python`, `sh`/`bash`/`shell`, `rs`/`rust`, `kt`/`kotlin`, `cs`/`csharp`, `rb`/`ruby`, `hs`/`haskell`, `jl`/`julia`, `make`/`makefile`, `docker`/`dockerfile`, `gql`/`graphql`, `protobuf`/`proto`, etc.). Unknown tags still fall back to plain monospace instead of crashing.
  - 📋 **Pasting a long Markdown note into another note silently failed** — the paste handler called `insertMarkdown(text)` immediately, but if the wrapper element received the paste before the contenteditable had taken focus the call became a no-op. Now the handler `ref.current.focus()`s first and falls back to `getMarkdown() + '\n\n' + text → setMarkdown()` if `insertMarkdown` throws or doesn't change the document. The pasted content never disappears now.
- 📐 **Pandoc grid tables still don't render visually** — known limitation: ReactMarkdown + `remark-gfm` only parse pipe tables (`| a | b |`). Pandoc grid tables (`+---+---+`) render as plain text and would need a dedicated remark plugin (`remark-grid-tables` was evaluated but skipped to avoid a heavy dep). Use pipe tables (or the toolbar's Insert Table) until further notice.

- 🫳 **Drag-to-reorder only worked from the tiny grip icon** — `dragHandleProps.attributes` / `listeners` were bound to the corner `<span class="om-drag">` only, so the rest of the card body was a dead surface. Listeners are now spread onto the card root, so the entire thumbnail is a drag surface; PointerSensor still has `activationConstraint: { distance: 8 }`, so a simple click navigates to the memo as before — only pointerdown + movement >8px starts a drag. Added `touch-action: none` / `user-select: none` on `.om-card` (browsers were claiming pointerdown for native scroll/select on some platforms) and a `cursor: grabbing` on `:active` so the affordance is obvious.

- 🎥 **Facebook reels (and other bot-walled URLs) saved with bare-URL title + brown gradient** — yt-dlp can't extract FB reels (`No video formats found`), and when Microlink rate-limited or flaked, no further fallback ran so the memo ended up with `title = <raw URL>` and no thumbnail. Added a third extractor tier (`_fetch_og_meta`) that pulls the page directly with a browser UA and parses OpenGraph / Twitter-card / `<title>` tags — zero new dependency, no API key. When all three tiers fail, the memo description is now `"Preview unavailable — <domain> blocked metadata extraction. Open the original to view."` instead of silently rendering a placeholder gradient over a truncated URL. Playwright/Puppeteer can be added later if a major site moves to JS-only rendering, but Microlink + direct OG covers the common cases today.

- 🖼️ **Image thumbnails + MemoDetail preview broken in dev for Docker-ingested memos** — file-serving routes (`GET /api/memos/{id}/file`, `GET /api/files/{path}`) called `Path(memo.file_path).exists()` directly. A memo created inside Docker stores `file_path = /app/files/<ws>/<file>`; when the same DB is opened under the local `dev.ps1` uvicorn on Windows, that path doesn't resolve and the route 404s, leaving image cards on the fallback gradient and MemoDetail with a broken preview. New `backend/core/file_paths.resolve_memo_path()` re-anchors anything after the trailing `files` segment onto the current `settings.FILES_DIR`, so the same DB works under either runtime without a backfill step. Reverse-direction (Windows-ingested memo viewed in Docker) is handled by the same helper.

- 🎬 **"Failed to fetch" on every file upload (Docker users + mixed-stack dev)** — the Vite dev proxy defaulted to `http://localhost:8091`, which is the Dockerised nginx, whose stock `client_max_body_size 1m` rudely closed the TCP connection mid-upload for anything larger than 1 MB. Browsers surface that as `TypeError: Failed to fetch` long before the request ever reaches uvicorn, so the cause was invisible from the UI. Fixed across the stack:
  - `nginx.conf` now sets `client_max_body_size 0` and `proxy_request_buffering off`, with 1-hour proxy read/send timeouts, so the reverse proxy in Docker mode no longer caps uploads.
  - `vite.config.ts` defaults `VITE_API_TARGET` to the local uvicorn on `:8099` (matches `dev.ps1`); Docker users can still set it to `:8091` explicitly.
  - `FileUploadHandler.save()` streams to disk in 1 MiB chunks instead of `await file.read()` (which loaded the whole file into RAM), so a 30 GB upload no longer balloons the Python process by 30 GB.
  - The size cap is enforced incrementally during the stream; if exceeded, the partial file is deleted and a clean 413 returned.
  - `ingestApi.file()` in `lib/api.ts` now catches the network-level `TypeError` and converts it into a useful error message naming the body-size cap as the likely cause, instead of bubbling up "Failed to fetch".
  - Non-JSON error responses (nginx HTML pages) are now rendered as readable text.

- 🖼️ **Thumbnails never loaded (pre-existing)** — the catch-all `/api/files/{path}` route was registered before `/api/files/thumb/{name}`, so the greedy path param swallowed every thumbnail request and 404'd it; the thumb/file handlers also called a nonexistent `SafePath.serve_path()` (now `.resolve()`) which would 500. Cached thumbnails now serve correctly in cards and MemoDetail, with proper `image/webp`·`image/avif` content types.
- 🌐 **Social/bot-walled URL ingestion** — Facebook, Instagram, TikTok, Twitter/X, Reddit, Pinterest, Vimeo and Twitch URLs now route through yt-dlp for metadata + thumbnail extraction instead of a raw HTTP fetch that bots block. Pages that block server fetches (e.g. Dribbble) fall back to Microlink API for rich OG thumbnail + title, then to a minimal link memo — saving never fails with a 400/422 error. Removed the "use extension" hard block.
- 🔃 **New memos sank to the bottom** — the "Recent" sort ranked `sort_order` above `created_at`, so freshly added memos appeared last; "Recent" is now pure newest-first and manual ordering moved to the dedicated "Custom order" sort.
- 📁 **Collection on add was ignored** — all ingest endpoints (url/note/file/extension) accepted a `collection_id` but never linked it to the memo; new memos now land in the chosen collection (`api.ts file()` + AddMemoPanel now pass it through).
- 🖼️ **Uploaded images never rendered** — `memo.file_path` is an absolute path, so `/api/files/${file_path}` 404'd in cards and MemoDetail; added `GET /api/memos/{id}/file` (inline render, plus `?download=1` for original-file download) and pointed the UI at it.
- 🎨 **Markdown editor unreadable in dark mode** — `MarkdownEditor` used Tailwind `prose dark:prose-invert` + hardcoded `text-white`, but theming is `[data-theme]`-attribute based so `dark:` never matched; migrated to the token-aware `.om-prose` system and added token overrides for MDXEditor's bundled inline-code span and CodeMirror code blocks. Readable in both themes, view + edit.

- 📥 **Download original uploaded file** — MemoDetail now has a "Download original" action for any file-backed memo, served via `GET /api/memos/{id}/file?download=1` with the original filename.


- 🎨 **Minimal card hover veil too opaque on thumbnails** — light-theme gradient over blurred thumbnails (`rgba(245,242,236,…)`) peaked at 0.92 opacity, nearly washing out the image. Reduced to `0.72 / 0.32 / 0.05` (top / mid / bottom) so the blurred thumbnail bleeds through while text and tags remain readable.
- 🎨 **Minimal card action icons ignored light/dark theme** — buttons were hardcoded `color: #fff` with `rgba(255,255,255,0.18)` background, invisible on any light card. Light theme now applies dark ink buttons (`rgba(0,0,0,0.08)` bg / `rgba(0,0,0,0.75)` color) to all minimal card types; dark-tint note (`data-tint="3"`) keeps white since its background is `#2A2622`.
- 📍 **Sidebar collapsed avatar off-centre** — collapsed `.om-foot-btn` used `grid-template-columns: 44px` with no item alignment, so the 32 px avatar sat left-aligned inside the 44 px column. Added `justify-items: center`; avatar now sits exactly centred.
- 🖼️ **AVIF / HEIC / HEIF uploads rejected as "not a valid image"** — `_validate_image_magic` only knew fixed-offset magic bytes (PNG, JPEG, GIF, WEBP, BMP, TIFF). ISOBMFF-based formats (AVIF, HEIC, HEIF) carry no fixed header — their box type `ftyp` lives at bytes 4–7. Added an explicit check: `header[4:8] == b"ftyp"` passes immediately, covering all ISO Base Media File Format images.

### Removed

- 🗑️ **Retired audio-digest feature fully pruned from the source tree** — a long-disabled feature (its router was never mounted, its page never routed, its model only touched by the workspace-reset wipe) left dead code scattered across backend and frontend. All of it is now gone: the dead API router, its TTS helper (plus the archived copy), the unrouted page (plus its archived copy), the unused API client and type, the orphaned script-generation helper in `core/rag.py`, and the unused ORM model along with its lone reference in the `/api/maintenance/reset` loop. No runtime behaviour changes — verified backend imports clean and `tsc -b` passes. (Any orphaned table on existing databases is inert; nothing references it.)

### Migration notes

- localStorage `openmemo_tweaks.cardStyle === 'hybrid'` or `'rich'` is rewritten to `'normal'` the next time `loadTweaks()` runs (first page load after upgrade). No user action required.
- ffmpeg must be on `$PATH` for video thumbnails. Already installed on the Windows dev box; the Docker image bakes it in.


## [1.8.5] - 2026-05-19

### Fixed

- 🔌 **Browser extension connectivity** — added a `chrome-extension://*` CORS regex on the API and the missing `scripting` manifest permission; the popup no longer falsely reports "Is the server running?".

### Changed

- 🖼️ **Defuddle-style link extraction** — `extract_url` now reads JSON-LD schema.org images, resolves all image/link URLs absolute, strips nav/footer/ad clutter, and keeps images in the markdown so MemoDetail renders the hero and inline images.
- 🧠 **Extension extracts from the live DOM** — content script now does meta + JSON-LD + readable-content → markdown extraction in-page (works on SPA / bot-walled sites like Dribbble where a server fetch returns nothing); sends `thumbnail`/`description` to `/ingest/extension`, which only falls back to a server fetch for missing fields.

---
## [1.8.0] - 2026-05-18

### Added

- 🎨 **Full UI rebuild on a new design-token system** — introduced a cohesive, token-driven design system (`openmemo.css`, Satoshi/General Sans/Cabinet fonts, full inline icon set, appearance helpers) and rebuilt every screen against the live FastAPI backend (no mock data).
- 🧩 **Collections page** (`/collections`) — stacked-card hover fan-out, per-collection memo count + recent titles via `useQueries`, hover edit button, "New collection" card; cover uses the collection's thumbnail, else the latest memo's, else a color gradient.
- 🪟 **New-memo glass panel** — FAB-anchored capture panel with an animated-height tab morph (Link / Note / Media / Voice), wired to the ingest API.
- 🎚️ **Live Appearance panel** — theme, accent (+ two custom swatches), card style, Boxed/Full layout, grid columns, background image/random, and a master background-fade slider; all persisted and applied to `<html>` live.
- 🗂️ **Collection flyout** — the new-memo collection picker is now a separate left-side panel with a "New collection…" action, replacing the cropped in-panel popup.
- ↕️ **Sort dropdown** — Recent (default) / Oldest / Title / Custom order on the dashboard header.
- 🔍 **Command search overlay** — ⌘K opens a real search modal over any screen.
- ✍️ **Fullscreen writer** — distraction-free note composer wired to note ingest.
- 💾 **Storage stats** — `/api/stats` now reports real on-disk usage (database / files / Chroma cache / total); shown in a Settings "Storage" card with a usage bar.
- 🧷 **Browser-extension Settings card** — dedicated install / GitHub entry point.
- 🌈 **Dominant-color card backdrop** — a blurred, saturated copy of a card's preview image sits behind the surface so cards take on the resource's own colors.
- 🟡 **Sliding filter pill** — framer-motion shared-layout pill animates under the active dashboard filter.
- 🧭 **First-run onboarding** — fullscreen intro (with a swappable motion slot) + a data-driven coachmark tour; replayable from Settings.
- 💬 **Ask memo history** — left-side chat session list (new chat, resume past chats); composer is centered until the first message, then docks to the bottom.
- 🖼️ **Local thumbnail cache** — remote preview images are downloaded once on ingest and served from `/api/files/thumb/…` instead of being re-fetched every load.
- 🧹 **Maintenance endpoints** — `Clear cached previews` and `Reset workspace` are now real, guarded actions.
- 📓 **Changelog & update check** — Settings footer surfaces the version with a pulsing dot when a newer GitHub release exists; the changelog modal shows release notes + update steps.
- 🗂️ **Collections edit mode** — a top-right Edit toggle turns on per-card edit + drag-to-reorder (persisted to `sort_order`); calmer default view with no hover chrome.
- 📐 **Standard page frame** — one shared width + header rhythm across Dashboard, Collections, Settings (and future pages); a single `--page-max` token, Boxed/Full aware.
- 🧱 **Bento Settings grid** — masonry columns so cards pack upward with no dead space.

### Changed

- 🧭 **Memo detail stays a routed page** (`/memo/:id`) — the design's slide-over + backdrop blur was intentionally not adopted.
- 📐 **Layout width** — new Boxed (default, max-width) / Full toggle; sparse grids no longer stretch a lone card across the page (`.om-masonry-col` width capped).
- 🧑‍🎨 **Settings reflow** — Identity replaced by a slimmer **Creator** card (`dev.izo.red`), Danger zone laid out 3/4 with Creator at 1/4 so it no longer over-pads; Appearance link navigates home then animates the panel in.
- 🎯 **Density removed** — spacing locked to `roomy`.
- 🔤 **Menu text colour** — option/menu text stays the text colour; the accent is reserved for icons and indicators only.
- ✒️ **Brand voice pass** — name rendered as `openMemo`; "Memo/Memos" always capital M; em dashes removed from all UI copy; dropped "second brain" framing; intro / creator / settings copy rewritten to the brand voice.

### Fixed

- 🖼️ **Background image weight** — 5 MB upload ceiling + canvas downscale (≤1280px, JPEG q0.72) before persisting, so the backdrop no longer bloats local storage.
- 🧱 **Cropped collection picker** — replaced the clipped in-panel dropdown with a dedicated flyout.
- 📏 **Over-wide cards** — tightened masonry column max-width for image and text-only memos.

---
## [1.8.4] - 2026-05-19

### Added

- 🎞️ **Sidebar spring animation** — `<aside>` replaced with Framer Motion `motion.aside`; `animate={{ width }}` with `spring(stiffness: 320, damping: 32)` drives the expand/collapse. App shell switched from CSS grid to flex so the animated width propagates to the main content area.
- 📊 **Library & Storage merged card** — combined separate Library and Storage stats cards into one with a 2×2 inline-baseline stat grid (border dividers, no backgrounds) and a storage bar below.
- 🧩 **Browser extension card redesign** — two-column layout: copy + install button on the left, a CSS-drawn popup mockup on the right with a Framer Motion `whileInView` fade-up entrance.
- 🟥 **Danger zone visual differentiation** — `color-mix(in oklab, ...)` tints the card background and border a subtle red, with the eyebrow label also tinted; prevents it from blending with neutral cards.

### Changed

- 📐 **Settings grid → two flex columns** — replaced masonry with two independent `om-settings-col` flex divs so each column stacks cards with equal `gap: 16px` regardless of card height.
- ↔️ **Full-width grid alignment** — toggling "Full" layout now left-aligns the masonry grid (`--grid-margin: 0`, `max-width: none` on masonry columns) instead of centering it.
- 🔲 **Chrome extension popup rounded corners** — popup body background set to transparent; content wrapped in `.popup-root` with `border-radius: 14px` so the rounded shape is visible in the browser chrome.
- 🧹 **`om-setting-head` margin-bottom** — reduced from 14px to 1px to tighten the settings card header spacing.

---
## [1.8.2] - 2026-05-19

### Added

- 💾 **Backup & Restore** — `POST /api/backup?scope=structure` downloads a hot SQLite snapshot (memos, collections, tags, chats) as a zip; `scope=full` also bundles all uploaded files (thumbnail cache excluded). `POST /api/backup/restore` accepts the zip, disposes the SQLAlchemy pool atomically, replaces the database, and restores files for full-scope backups. Settings page gains a **Backup & Restore** card with Download buttons for each scope and a double-confirmed Restore flow.

---
## [1.8.1] - 2026-05-19

### Changed

- 🎨 **CSS cohesion — MemoDetail + AskMemoPanel → om-* design system** — migrated both components off Tailwind + `var(--color-*)` tokens onto `openmemo.css` om-* classes; theme switching (`data-theme`), accent colour changes, and density now apply to the detail view for the first time.
- 🖌️ **New om-* classes in openmemo.css** — `om-detail-page`, `om-detail-pane`, `om-detail-chat`, `om-detail-scroll`, `om-detail-title-input`, `om-tag-edit`, `om-coll-chip`, `om-ai-summary`, `om-image-memo`, `om-video-embed`, `om-web-card`, `om-code-inline`, `om-code-block`, `om-notes-section`, `om-related`, `om-related-strip`, `om-related-card`, `om-ask-panel`, `om-panel-msg`, `om-panel-bubble`, `om-citation-chip`, `om-ask-panel-composer`, `om-btn-pill`, `om-spin`, `om-accent-icon`.
- 📐 **Detail page layout fix** — `:has(.om-detail-page)` strips `om-main` padding and overflow so the two-pane flex layout fills the viewport correctly.
- 🎞️ **Entrance animation** — detail pane and chat panel slide in via `omDetailIn` keyframe, respects `prefers-reduced-motion`.

---
## [1.7.43] - 2026-05-18

### Added

- 🖱️ **Live drag-to-reorder** — cards visually swap in real time while holding and dragging, powered by `onDragOver` + synchronous `dragOrderRef` to avoid stale state.
- 🎞️ **FLIP settle animation** — on drop, framer-motion `layout` animates each card to its final position with a 250ms ease-out spring.
- ✨ **Drag lift effect** — the held card springs into a slightly scaled, rotated state using framer-motion, matching the motion.dev drag feel.
- 📋 **README overhaul** — updated copy, fixed `docs/MEMORY.md` and `docs/DESIGN.md` paths, corrected roadmap link to `Specs/ROADMAP.md`.

### Changed

- 🎯 **Collision detection → `pointerWithin`** — swap only triggers when the pointer is physically inside another card's bounds; fixes diagonal move mis-fires and cross-column jumps.
- 🏗️ **Drag architecture** — removed dnd-kit CSS transforms entirely; array order controls card positions, DragOverlay shows the floating ghost. Eliminates the transform conflict that caused infinite render loops with `rectSortingStrategy`.

### Fixed

- 💥 **`Maximum update depth exceeded` crash** — caused by `rectSortingStrategy` measuring DOM rects in a layout effect loop during rapid swaps. Reverted to `verticalListSortingStrategy`.
- 🔄 **Snap-back on drop** — `handleDragEnd` was reading stale `localMemos` closure; replaced with synchronous `dragOrderRef` that updates in the same tick as each swap.
- ↕️ **Up/down drag broken** — `closestCenter` was finding horizontally adjacent cards when dragging vertically; fixed by switching to `pointerWithin`.

---
## [1.7.42] - 2026-05-09

### Added

- 🧩 **Dashboard grid density control** — added a 4/5 memo-card layout setting in `SettingsPage.tsx` so dashboard density can be changed from Settings.
- 🧠 **Grid preference persistence** — added `dashboardGridColumns` state and setter to the app store so the chosen dashboard layout survives refreshes.
- 🧱 **Masonry dashboard support** — introduced masonry-style layout behavior for the main dashboard to better accommodate variable memo card heights.
- 🧭 **Inline BAF action** — moved the BAF/Add New action beside the search bar for faster dashboard access.
- ✍️ **Full note-detail editing flow** — the note detail editor, rendered markdown view, and toolbar improvements from the recent editor work are now part of the release history.
- 🗂️ **Settings redesign foundation** — the bento-style Settings redesign, creator/info cards, and supporting stats/settings improvements are included in this release line.

### Changed

- 🎛️ **Appearance settings flow** — placed the new dashboard grid control inside the Appearance section and refined the segmented control styling so the selected state reads clearly.
- 📐 **Dashboard layout wiring** — `MemoGrid` now reads the saved dashboard grid preference instead of relying on a hardcoded 5-column desktop layout.
- 🪄 **Header and navigation polish** — the dashboard top bar, inline controls, hamburger/header work, and homepage CSS refinements are now aligned as part of the same release stream.
- 📝 **Memo card readability** — cleaned up memo card text hierarchy for clearer scanning in the dashboard.
- ⚡ **FAB behavior** — the main Speed Dial flow now aligns better with direct note creation and inline dashboard actions.

### Removed

- 🧹 **Floating FAB wiring** — removed floating FAB usage from `Layout.tsx` along with stale related imports and unused state.
- 🚫 **Broken settings collapse pattern** — removed the inconsistent keyboard-shortcuts collapse behavior from Settings so the full shortcuts grid stays visible.

### Fixed

- ✨ **Speed dial JSX repair** — fixed the broken JSX block in `SpeedDialFAB.tsx`.
- 🫧 **Hover animation jitter** — separated parent positioning transforms from child hover scale transforms in `SpeedDialFAB.tsx` so hover animation feels stable.
- 🚫 **Duplicate store destructure error** — removed the repeated `useAppStore()` destructure that caused redeclare issues.
- 🛠️ **Store wiring for grid controls** — fixed the missing app store state/setter pair so the 4/5 dashboard buttons render and behave correctly.
- 🔎 **OP-07 selected-state diagnosis** — confirmed the settings control was rendering in the DOM and traced the missing selected state to absent store wiring rather than a visual bug.
- 📝 **Markdown paste and render pipeline** — preserved markdown syntax correctly on paste, improved fenced code block handling, and tightened rendered markdown typography.
- 🧾 **Markdown editor view-first behavior** — fixed read/view mode initialization and blur-save handling so markdown notes open and save more reliably.
- 🔄 **Late-load sync and preview snippet issues** — corrected note preview and markdown state sync issues across the note flow.
- 🔎 **Medium fetch false alarm** — confirmed the `403 Forbidden` issue comes from Medium blocking automated extraction, not from an OpenMemo regression.

### Docs

- 📘 **README and roadmap sync** — updated release-facing documentation, roadmap entries, and changelog history to match the shipped UI/editor/dashboard work.
- 🏷️ **Versioned release prep** — prepared the project history for the `v1.7.42` tag and release notes.

---

## [1.7.4] - Unreleased

### Added

- 📐 **Unified top bar** — Dashboard header is one flex row: hamburger (left) + greeting + centered filter pills + search box (right). Hamburger integrated directly in dashboard; Layout's floating hamburger hidden on `/`.
- 🖱️ **FAB cursor** — Speed Dial main button and dial items show `cursor-pointer` on hover.

### Changed

- ⚡ **FAB click** — Main Speed Dial FAB button now opens the new-note modal directly on click. Hover still opens the full dial (Note / Link / Multimedia) with ease-in animation.
- 📐 **Filter pills centered** — Type filters (All / Image / Links / Videos / Notes / Files) are centered within the header flex row.
- 🔲 **5-column memo grid** — Dashboard grid is now `grid-cols-5` at `xl` breakpoint (was 4). Gap reduced to `gap-6`.

### Fixed

- ⌨️ **Settings keyboard shortcuts** — Shortcuts grid is always visible; removed broken collapse/expand toggle that left it in an inconsistent state.
- 📝 **MarkdownEditor `viewFirst`** — `editing` state is now derived from the `viewFirst` prop instead of a fragile `useState(!viewFirst)` + sync effect. ReactMarkdown renders on load; MDXEditor opens only on user click.
- 📝 **Markdown paste + render (full fix)** — Plain-text paste now routes through `insertMarkdown()` so syntax (`#`, `**`, fenced code, tables) becomes proper nodes instead of escaped literals. Added `codeMirrorPlugin` for fenced code block rendering. Added `@tailwindcss/typography` so `prose` classes style headings/lists/blockquotes. Updated `code` component for react-markdown v10 (`inline` prop removed). Tightened note view spacing (`prose-sm` + custom margins).

---

## [1.7.3] - 2026-05-07

### Added

- 📊 **Stats card** — full-width bento card showing live memo, collection, and tag counts from `/api/stats`; by-type emoji breakdown; "added this week" counter
- 📣 **Feedback card** — "Send Feedback" mailto link pre-filled with `[OpenMemo Feedback]` subject; zero infra
- 🧩 **Chrome Extension card** — "Save from anywhere" card with View on GitHub link
- ⌨️ **Keyboard Shortcuts card** — collapsible 3-column grid showing 6 core shortcuts
- 🔴 **Danger Zone card** — Export all memos (JSON download) + disabled Clear all data with warning copy
- 👤 **Creator card** — "Made By Reda Izo" with portrait photo, bio, and 4 social link pills (izo.red, GitHub, X, Threads)
- ❤️ **Built With card** — mosaic grid of 11 open-source dependencies, each with a one-line description
- 🔖 **Version footer** — replaces About card; small O logo + `v{version}` pulled from `/api/health`
- 🗄️ **`/api/stats` endpoint** — returns `total_memos`, `total_collections`, `total_tags`, `memos_this_week`, `by_type` breakdown

### Changed

- 📐 Settings page layout switched from single-column sections to a **2-column bento grid**
- 📐 Appearance + Ollama cards are now side-by-side
- 📐 Feedback + Chrome Extension cards are now side-by-side
- 📐 Creator (Made By) + Built With cards are now side-by-side at the bottom

---

## [1.7.2] - 2026-05-07

### Fixed

- 📐 Sidebar now pushes content (flex layout) instead of overlaying — responsive, no overlap
- 📐 Removed `backdrop-blur` from sidebar backdrop — cleaner dim effect on main content only
- 📐 Hamburger button fades out when sidebar is open (close button lives inside sidebar header)
- ⚡ Drag-and-drop card reorder is instant — optimistic local state updates immediately, API fires in background
- 🗄️ Ollama embed model fallback now distinguishes endpoint-404 from model-404 — prevents cascading fallback to removed `/api/embeddings` route
- 🗄️ `EMBED_MODEL` correctly wired into `docker-compose.yml` environment — was only in `backend/.env` which Docker ignores
- 🗄️ `/api/models` filters out embed/bert-family models — only chat models appear in the dropdown
- 🗄️ AskMemo stream error handling — Ollama exceptions yield SSE error event instead of silently closing the connection
- 🗄️ AskMemo checks `resp.ok` before reading stream — surfaces HTTP errors clearly
- 🎨 Model picker auto-selects first available Ollama model on load — no more hardcoded `qwen2.5:7b` default
- 🎨 Selected chat model persists to `localStorage` across sessions

---

## [1.7.1] - 2026-05-06

### Added

- 🎨 Centralized CSS token system in `index.css` with light/dark variants
- 🎨 All hardcoded `#hex`, `rgb()`, `bg-white`, `bg-[#...]` Tailwind values replaced with `var(--color-*)` tokens
- 🎨 Added type-specific dark tokens: `--color-type-{note,article,video,image,audio,document,link}-{bg,text}`
- 🎨 Scrollbar colors use CSS variables
- 🎨 `::selection` dark mode override
- 🎨 Dark mode auto-application on load disabled — manual toggle only until fully polished
- 🧱 `<PageBox>` — `rounded-2xl` container with `var(--color-bg-card)` and dark mode baked in
- 🧱 `<BackButton>` — reusable brand-colored back navigation
- 🧱 `<Card>` — generic card base with consistent padding, radius, shadow, and dark mode
- ⚡ `transitions.css` with named durations: `--transition-fast: 150ms`, `--transition-base: 280ms ease-out`, `--transition-slow: 400ms ease-out`
- ⚡ `--ease-out`, `--ease-in-out`, `--ease-spring` tokens
- ⚡ Sidebar slide: `320ms` with `cubic-bezier(0.16, 1, 0.3, 1)` easing
- ⚡ Hamburger fade-in delay: `450ms` after sidebar closes
- 🗄️ `BaseService` generic class with `get()`, `get_or_404()`, `list()`, `create()`, `update()`, `delete()`
- 🗄️ `MemoService`: `list_by_workspace()`, `create_memo()`, `update_memo()` with safe relation replacement
- 🔒 `backend/core/security/sanitize.py` — unified input sanitization (`sanitize_workspace_id`, `sanitize_filename`, `escape_fts5_query`, `validate_url`, `sanitize_string`, `SafePath`)
- 🔒 `backend/core/security/upload.py` — `FileUploadHandler` with size limits, extension whitelist, magic byte validation, UUID-based filenames
- 📝 Installed `@mdxeditor/editor`
- 📝 `<MarkdownEditor>` component with plugins: headings, lists, quotes, thematic breaks, markdown shortcuts, bold/italic/underline toolbar
- 📝 Note-type memos: inline markdown editor in `MemoDetail` (click to edit, auto-save on blur)
- 🙏 SettingsPage "Built With" section listing open-source dependencies
- 🙏 README.md "Credits & Open Source" section

### Changed

- 🎨 Removed `bgColor` from Zustand store — background now pure CSS-driven
- 📐 Standardized inner content padding — no arbitrary `p-3`, `p-7` scattered around
- 📐 `AskMemoPage`: `rounded-2xl overflow-hidden` containers
- 📐 Back button moved above title in `MemoDetail`, inline style
- 🔍 Removed `Ctrl+K` kbd badge from search input
- 🔍 Placeholder text: `"Search memos…  Ctrl+K"`
- 🎴 Note cards show `content_raw` as fallback preview when `content_text` is empty
- ⬆️ `vite` 8.0.10 → 7.3.2 (bundler regression fix)
- ⬆️ `@vitejs/plugin-react` 6.0.1 → 4.7.0 (Vite 7 compatibility)

### Fixed

- 🐛 **Fixed `Prism is not defined` fatal error** — Vite 8's Rolldown bundler wrapped `prismjs` in an IIFE, scoping `var Prism` locally. `@lexical/code` referenced bare `Prism` as a free variable, causing a `ReferenceError` that killed the entire JS bundle before React could mount. Downgraded `vite` to 7.3.2 and `@vitejs/plugin-react` to 4.7.0 to restore Rollup-based bundling
- 🐛 **Fixed Ollama `/api/embed` 404 on older versions** — Added automatic fallback from modern `/api/embed` to legacy `/api/embeddings` endpoint in `ollama_client.py`. `embed()` and `embed_batch()` both retry with the legacy endpoint on 404
- 🐛 **Fixed memo sort 422 error** — `PUT /api/memos/{id}/sort` expected `sort_order` as a query parameter, but the frontend sent it in the JSON body. Changed the endpoint to accept a `SortUpdate` Pydantic model from the request body
- 🎨 **Removed all blur effects** — Removed `backdrop-blur-sm` from `MemoCard.tsx` drag handle per user preference (no blur anywhere)
- 🔒 All 13 API endpoints now use `sanitize_workspace_id()`
- 🔒 `ingest.py` refactored: removed inline sanitization, uses shared module
- 🔒 `main.py` `serve_file()` uses `SafePath.serve_path()`
- 🔒 `fts5.py` deduplicated: imports `escape_fts5_query` from `sanitize.py`

---

## [1.7.0] - 2026-05-05

### Open-Source Readiness

- **GitHub community files** — Added `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/FUNDING.yml`, and `.github/labels.yml`
- **Community standards** — New `CONTRIBUTING.md` (setup, style, PR workflow), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (reporting + scope), and `SUPPORT.md` (help channels + FAQ)
- **CI skeleton** — Backend test infrastructure (`pytest`, `pytest-asyncio`, `httpx`) in `backend/tests/`. Frontend test deps (`vitest`, `@testing-library/react`) added to `package.json`
- **Documentation** — New `docs/architecture.md`, `docs/deployment.md`, and `docs/faq.md`
- **EditorConfig** — Added `.editorconfig` for consistent cross-editor formatting

### Added

- **Inline memo editing** — MemoDetail page now supports inline editing for title, source URL, tags, collections, content, and notes. Toggle edit mode with the pencil icon
- **User notes / annotations** — Every memo has a private `notes` field (textarea, auto-saved) that is included in embeddings for RAG retrieval
- **Sortable drag & drop** — Memo cards can be reordered within the grid via `@dnd-kit/sortable`. New `PUT /api/memos/{id}/sort` endpoint with `sort_order` persistence
- **Rich link preview** — Article/link memos display favicon, domain, description, thumbnail, and collapsible extracted content in MemoDetail
- **Delete button on MemoCards** — Red `×` appears on hover after a 3-second delay to prevent accidental deletion
- **Dynamic version** — Settings page now shows live version from `/api/health` instead of hardcoded string
- **Rotating greeting** — Dashboard greeting cycles through 10 variations on each page refresh (was once-per-day)

### UX Polish

- **Dark mode foundation** — CSS variable system (`--color-bg-*`, `--color-text-*`) with `html.dark` overrides. Applied across Dashboard, Sidebar, Settings, Search, and Layout
- **Flash-of-light-mode fix** — Inline script in `index.html` applies `dark` class before React hydrates, eliminating FOUC
- **Prominent drag handles** — Grip icon now has dark `bg-[#202020]/80` with `backdrop-blur-sm` for visibility on any card background
- **Ctrl+K search positioning** — Fixed absolute positioning so it no longer overlaps the grid on short viewports
- **Back button styling** — MemoDetail back arrow matches brand color and has hover state

### Infrastructure

- **Environment-driven config** — Removed all hardcoded personal paths/domains. `docker-compose.yml` is clean; local overrides go in `docker-compose.override.yml` (gitignored)
- **Chrome extension config** — API URL is now configurable via an options page (`options.html`) reading from `chrome.storage.sync`. Default: `http://localhost:8091/api`
- **CORS override** — `CORS_ORIGINS` accepts comma-separated env var override for custom domains
- **Demo data seeding** — `seed_data.py` generates 19 rich memos across 4 collections for fresh installs

### Fixed

- **`update_memo()` MissingGreenlet crash** — Replaced async `.clear()` with synchronous `= []` on pre-loaded relationships via `selectinload`
- **`update_memo()` collections/tags persistence** — Collections and tags are now properly replaced on update (not just appended)
- **Hamburger visibility** — Toggle button now visible on all pages including Settings and MemoDetail

---

## [1.6.6] - 2026-05-05

### Security

- **Path traversal fix** — `workspace_id` in file uploads is now sanitized (whitelist `a-zA-Z0-9_-`) preventing `../../` attacks
- **File upload validation** — Max 50MB limit, magic-byte content validation, rejected executable types
- **Secure file serving** — `/files/` static mount replaced with `/api/files/:path` endpoint that verifies memo ownership before serving
- **FTS5 query escaping** — User search terms are escaped before passing to SQLite FTS5 `MATCH`, preventing syntax errors and injection

### Fixed

- **Card detail navigation** — ALL card types now navigate to `/memo/:id` detail view with an "Open Original" button for external links (previously video/link/article cards bypassed detail)
- **`@general` RAG bypass** — Fixed `lstrip("@general")` bug that was stripping individual characters instead of the substring
- **Memo update collections/tags** — `update_memo()` now properly persists `collection_ids` and `tags` changes
- **YouTube subtitle extraction** — Transcript result is now used as `content_text` instead of being discarded
- **Search silent failures** — Exceptions in hybrid search are now logged instead of silently swallowed
- **Chat history over-fetch** — Replaced `.all()[-6:]` with `.order_by(...).limit(6)` SQL-level pagination
- **Async blocking I/O** — ChromaDB operations, PDF parsing, DOCX parsing, image reading, and yt-dlp subprocess now run in threadpool/async subprocess
- **Chrome extension error handling** — Added `response.ok` check before streaming

### Changed

- **Inline search bar** — Replaced centered `SearchModal` popup with a real search input in the Dashboard header. Type directly, see dropdown results, `Ctrl+K` to focus, `Escape` to clear
- **Dedicated Docker port** — Default access URL changed from `localhost:80` to `localhost:8091`. No hosts file or port conflicts needed
- **Removed dead UI** — Hidden Voice tab, Share/Tag/More buttons in MemoDetail until implemented

---

## [1.6.5] - 2026-05-05

### Sidebar & Navigation

- **Push sidebar layout** — Sidebar is now a true flex push layout (`width: 0 ↔ 240px`) instead of an absolute overlay. Main content shrinks naturally when sidebar opens. Removed `backdrop-blur-sm` overlay entirely.
- **Global hamburger menu** — Moved the sidebar toggle from Dashboard to `Layout.tsx` so it's accessible on **all pages** (Dashboard, AskMemo, MemoDetail, Settings).

### Collections Enhancement

- **Collection emoji & description** — Collections now support an emoji icon (default 📁) and an optional description. Backend schema updated with `emoji` and `description` columns.
- **Collection creation modal** — New modal for creating collections with name, emoji picker, description textarea, and color swatches. Reached via the "+" button in the sidebar Collections section.
- **Collection quick edit** — Hovering a collection in the sidebar reveals a pencil icon. Clicking it opens the same modal pre-filled for updating.
- **Sidebar collection display** — Collections now render as `emoji + title` instead of folder icon + name.

### Memo Cards

- **Note card body preview** — Note cards now show `content_text` (the actual body) as the primary preview, falling back to `description` only when body is empty.
- **Drag & drop into collections** — Memo cards are now draggable (grip handle appears on hover). Drop a card onto any sidebar collection to add it. Droppable targets highlight in red on hover. Powered by `@dnd-kit/core`.

### Tooling & Repo

- **`.claude/` added to `.gitignore`** — Keeps Claude local config (skills, plugins, settings) out of the repository while preserving it locally.

---

## [1.6.0] - 2026-05-05

### Infrastructure & Reliability

- **Multi-host Ollama fallback** — `OLLAMA_HOSTS` env var supports comma-separated fallback endpoints. The backend automatically tries localhost, Docker Desktop bridge (`host.docker.internal`), and GPU nodes (`ollama_gpu0`, `ollama_gpu1`) until one responds. Working host is cached for 30s to avoid repeated health checks.
- **Docker Compose fully completed to spec** — Added the missing `nginx` reverse proxy service on port 80 that the v1.5 spec described but was never implemented. API and web containers now use `expose` instead of `ports` — only nginx is publicly accessible.
- **Healthchecks & startup ordering** — `openmemo-api` has an HTTP healthcheck on `/api/health`. `openmemo-web` waits for `service_healthy` before starting, eliminating race conditions where nginx proxies to a still-booting backend.
- **Linux Docker compatibility** — Added `extra_hosts: ["host.docker.internal:host-gateway"]` for native Linux Docker setups where `host.docker.internal` does not resolve by default.
- **Expanded CORS origins** — Added `http://127.0.0.1:3000`, `http://localhost:80`, and `http://localhost` to prevent CORS rejections when accessing via alternate origins.

### AI & Search

- **Vision model updated** — Default vision model changed from `llava:13b` to `gemma3:4b` (smaller, faster, better availability).
- **FTS5 full-text search implemented** — The spec claimed hybrid search (semantic + FTS5) existed, but the code only used `ilike` substring matching. Now properly implements:
  - SQLite FTS5 virtual table (`memos_fts`) with auto-sync triggers
  - Dedicated `backend/api/search.py` router
  - Graceful fallback to `ilike` if FTS5 is unavailable
  - FTS5 index auto-rebuilds on first run

### Design

- **Replicate-inspired design system** — Complete frontend visual overhaul based on the [Replicate DESIGN.md](https://getdesign.md/replicate/design-md) (clean white canvas, code-forward aesthetic):
  - **Color:** Brand accent shifted from amber `#D97706` to Replicate Red `#ea2804`. Primary text is now `#202020` (near-black) on pure white.
  - **Typography:** Added `Inter` for body text and `JetBrains Mono` for code/technical elements via Google Fonts.
  - **Shapes:** Pill-shaped geometry (`rounded-full`) for badges, tags, buttons, active states, and icons.
  - **Buttons:** Primary CTAs are dark solid (`#202020` bg, white text) with `rounded-full`. Secondary actions use outlined pills.
  - **Code blocks:** Dark `#24292e` background with JetBrains Mono, matching GitHub's code aesthetic.
  - **Links:** Dotted underline decoration (Replicate signature pattern) for external/source links.
  - **Borders:** Subtle `#e5e5e5` borders that darken to `#202020` on hover for interactive cards.
  - **Components updated:** Sidebar, Dashboard, MemoCard, MemoGrid, MemoDetail, AskMemoPage, AskMemoPanel, AddMemoModal, SearchModal, Layout.

### Documentation

- **New `docs/INSTALL.md`** — Comprehensive installation and troubleshooting guide covering:
  - Development vs Docker production modes
  - Ollama endpoint configuration matrix (native / Docker Desktop / Linux / GPU nodes)
  - Troubleshooting matrix for 8 common issues
  - Windows-specific notes (PowerShell, WSL2)
- **New `docs/CHANGELOG.md`** — This file. Versioning starts at 1.6.0.
- **Updated `README.md`** — Reflects new Docker architecture, multi-host Ollama, design overhaul, and points to full install guide.

### Tooling

- **Impeccable skill installed** at `.claude/skills/impeccable/SKILL.md` — Design quality commands (`/impeccable audit`, `/impeccable polish`, `/impeccable critique`, etc.) and anti-pattern rules for ongoing UI improvements.
- **Replicate `DESIGN.md`** dropped at project root — Design system document that AI coding agents can read for consistent UI generation.

---

## [1.5.0] - 2026-05-05 (Original Release)

### Added

- Streaming SSE for chat — replaces WebSocket proposal from v1.0 spec
- Background task queue for embeddings — ingestion returns 202 Accepted immediately
- Hybrid search at API level — ChromaDB semantic + SQLite full-text merged & re-ranked
- `@` prefix RAG bypass — general knowledge fallback without vector retrieval
- File-type routing in ingestion pipeline — MIME/extension dispatch to correct extractor
- Docker-compose with nginx reverse proxy (spec only — not fully implemented until 1.6.0)
- TypeScript throughout frontend — strict mode, 0 `tsc` errors

---

## Versioning Notes

- **1.5.0** was the original as-built spec release.
- **1.6.0** is the first properly versioned release after addressing all spec-to-code gaps, infrastructure fixes, and the design overhaul.
- Future releases will follow semver: `MAJOR.MINOR.PATCH`.
