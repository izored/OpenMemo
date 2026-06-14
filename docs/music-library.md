# Music Library

openMemo already knows the difference between a voice note and a song (ADR-005). The Music library gives songs a home. One page for everything you collect by ear: playlists pulled straight from YouTube Music, tracks and playlists from Spotify and Apple Music in lossless FLAC, single tracks, uploads. All local, all yours.

This doc is the spec for Music Experience V2 (entry OPNMMO-0023). It covers the UX, the data model, the playlist ingestion flow, the Spotify and Apple Music → FLAC pipelines (ADR-017, ADR-019), and what we deliberately left out.

## The idea, improved

The original ask: a Music section in the sidebar, a music collection page, a music filter on the dashboard, and yt-dlp playlist ingestion from the new-memo panel.

What we added on top:

- **A real play queue.** Playing a playlist actually plays through it. Next and previous controls land in the sidebar player. Without this, a playlist is just a folder.
- **Playlist order is preserved.** Tracks keep the order the playlist had at the source.
- **Per-track resilience.** A playlist download is N independent track downloads. One dead video does not kill the other 39. Failed tracks stay as remote memos and can be retried from their detail page.
- **Progress you can watch.** The playlist card shows live download progress, computed from the database. Survives a server restart.
- **Drag a track onto a playlist card** to file it, same gesture as sidebar collections.
- **Not just YouTube.** SoundCloud sets and Bandcamp albums are playlists too. One detection helper, host-agnostic per ADR-001.
- **Download is opt-in, and pausable.** A playlist can be pulled as remote track memos only, like any music app: a download chip per tile, a Download all button on the playlist page. Or flip the toggle and it downloads everything up front. A bulk "Download all" pass can be paused: the header swaps to Pause download while the pass runs, the track in flight finishes (a download can't be cut mid-fetch), the rest reset to remote, and Download all comes back to resume.
- **The playing playlist is visible.** On the hub, the playlist or album feeding the player wears an accent tint and keeps its corner badge pinned, showing a pause icon. Tapping it pauses or resumes without opening the playlist. Every other card still shows play and starts fresh. Albums get the same treatment, since they are the same card.
- **Playlists carry a name and a description.** The playlist hero has an edit pencil: rename inline and add a description. The description seeds from the source link on import (YouTube, SoundCloud, Spotify, Apple Music, where the provider has one) and is editable either way.
- **Every feed stays clean.** Tracks born from a playlist ingest live inside their playlist, full stop. They never flood All Memos, the type tabs, or the Music library. The library lists only the songs you saved one by one: a liked-songs shelf, not a dump of every playlist you ever pulled. And filing a library song into a playlist does not steal it from the library: it lives in both, like every music app you know.
- **Playlists are editable, no drag required.** An "Add to playlist" popover lives on every music surface (card actions, memo detail, the sidebar player) with membership ticks and inline new-playlist creation. Tiles in the playlist view carry a remove chip and reorder by drag. Touch works everywhere.
- **The player behaves like a player.** Shuffle (current track pinned, source order restorable), an Up-next popover showing the live queue (jump or drop tracks), and continue-listening: a reload restores track, queue and position, paused.

## Data model

Playlists are collections. No new table, one new column.

- `collections.kind` — `'standard'` (default) or `'playlist'`. Additive migration, NULL backfilled to `'standard'`.
- `collections.source_url` — the playlist URL it was pulled from. Nullable. Kept for provenance and a future re-sync.
- `collections.music_kind` — `'album'` or `'playlist'` (NULL reads as playlist). What the source actually was: Spotify `/album/` links and YouTube `OLAK5uy_` list ids are albums. Backfilled from `source_url` at startup. Albums show a single cover and an "Album" label; playlists keep the 4-cover collage.
- `collections.description` — an optional blurb shown under the playlist title. The column already existed for standard collections; playlists now use it too. It seeds from the source link on import (where the provider carries one) and the user can rewrite or clear it. No migration.
- `memos.audio_album` — the album a track belongs to (music only). Set at ingest for album sources, or from the Qobuz match when a Spotify download resolves. Shown in the big player and the OS media overlay.

The collections API filters by kind server-side. `GET /api/collections` returns standard collections only, so the sidebar, the collections page, and every collection picker hide playlists with zero frontend changes. `?kind=playlist` returns playlists. `?kind=all` returns everything.

Tracks are plain audio memos (`type=audio`, `audio_kind=music`) linked to the playlist through the existing `memo_collections` table. Playlist ingest stamps them `playlist_born` (additive boolean column, existing playlist members backfilled). They keep their detail pages and stay searchable, but the list feeds (dashboard, type tabs, Music library) exclude any memo that is playlist-born AND still belongs to a playlist-kind collection. Both halves matter: a standalone song you file into a playlist by hand is not born there, so it stays in the library too; delete a playlist and its born tracks lose the membership, so they resurface in the library instead of vanishing forever.

Playlist order rides on `recency_at`: track i gets `now - i` seconds at ingest, so the default recency sort returns playlist order for free. Same trick drag-to-reorder already uses.

## Adding music

The Music page has its own add surface, separate from the global New Memo panel — `MusicAddModal`, the same bottom-right glass panel and slide-in gesture, opened by the **Add music** button or the FAB on `/music`. It is fixed-height so it never jumps as content changes. Three tabs:

- **Link.** Paste any track or playlist URL. A Spotify *or Apple Music* link previews its cover, title, and (for albums/playlists) track count, then resolves to lossless FLAC (below). A YouTube / SoundCloud / Bandcamp playlist link goes down the existing playlist flow; any other audio link saves like a normal audio memo.
- **Upload.** Drop audio files straight into the library as music memos (`audio_kind=music`).
- **Playlist.** Name an empty playlist and land on it, ready for drag-and-drop.

A gear in the header opens a settings drawer with the auto-download-linked-audio toggle (`auto_download_audio`). Lossless quality is **not** a user choice: the chain always asks for hi-res (24-bit) and downgrades to 16-bit CD on its own when a release has no hi-res master (see "Quality is automatic" below). `music_quality` defaults to `24` and is no longer surfaced.

## Spotify → lossless FLAC

Spotify is not a yt-dlp source and has no public download, but people paste Spotify links and want lossless. So openMemo ports the account-free chain from the open-source [SpotiFLAC](https://github.com/spotbye/SpotiFLAC) project into `backend/core/spotiflac.py` (ADR-017). The whole chain needs no Spotify login:

1. **Metadata** comes from the public `open.spotify.com/embed/<kind>/<id>` page — its `__NEXT_DATA__` JSON carries title, artist, cover, and the track list for albums and playlists. No token, no TOTP.
2. **ISRC** is resolved through song.link (Odesli), falling back to Deezer's public API.
3. **A Qobuz track id** comes from the signed Qobuz public API (embedded default app credentials, MD5 request signature), searched by ISRC then by "title artist".
4. **The FLAC URL** comes from the SpotiFLAC community endpoint (`/api/dl`), which returns a *direct* Qobuz stream — no DRM, no transcode. It is streamed to `FILES_DIR`, magic-byte checked (`fLaC`).
5. **Tags are written after download.** The CDN serves the file with zero tags and no art, so openMemo writes Vorbis tags (title, artist, album) plus embedded cover art with mutagen. The album name comes from the Qobuz search match — the only link in the chain that has it. It also lands on the memo as `audio_album`.

Only Qobuz is wired today, because its community provider returns an undecrypted FLAC. The Tidal and Amazon community providers return encrypted DASH / MP4 (CENC) that would need an MP4 decryptor plus ffmpeg; the resolver is provider-shaped and `music_provider` exists so they can be added without a migration.

**Where the bytes come from.** The community relay (`qbz-foss.spotbye.qzz.io`, run by the SpotiFLAC project, not Qobuz) holds a real Qobuz account; it logs in and returns a **signed, time-limited URL on `streaming-qobuz-std.akamaized.net`** — Qobuz's own master FLAC on Akamai. The audio streams Qobuz CDN → disk; it never passes through the relay. It is a single hobbyist-run dependency, so lossless is treated as a bonus, never load-bearing — if it disappears, ingest fails per track (retryable) and nothing else breaks.

**Quality is automatic (hi-res → CD).** The chain always asks for 24-bit. The relay does **not** fall back server-side — a hi-res request for a CD-only release returns HTTP 400 — so `_community_flac_url` catches that one case, drops to 16-bit, and retries. Result: every track gets the best quality it actually has, with no user setting and no error. The relay also rate-limits (429, `Retry-After`), handled by bounded backoff.

Ingestion mirrors the yt-dlp playlist flow exactly (`POST /api/ingest/spotify`, with `/probe` for the preview):

- A **track** becomes one music memo (`source_url` = `open.spotify.com/track/<id>`).
- An **album or playlist** becomes a playlist-kind collection plus one music memo per track, same dedupe/reuse rules as the yt-dlp path.

The crucial reuse: a Spotify track source is detected inside the shared `localize_memo_task`, which routes it to the FLAC resolver instead of yt-dlp. So the per-track download chip, the playlist's **Download all**, and playlist auto-download all handle Spotify with no extra wiring — the same single-seam win the rest of Music V2 is built on. Status rides the same `pending → processing → done | error`.

The community endpoint is shared and rate-limited; the resolver ports SpotiFLAC's `Retry-After` backoff, and playlist downloads stay sequential. Even so, bigger albums can trip the 429 window — so the playlist downloader takes a second pass at every still-errored track after a 90-second cooldown, which empirically clears it. Stubborn tracks stay retryable per memo. The embed track list caps around 50 entries for very large playlists — the cost of the no-account path.

## Apple Music → lossless FLAC

Apple Music is a **second front-end onto the exact same chain** (ADR-019). The insight from ADR-017 is that only the first two steps are platform-specific: once a track has an ISRC, the Qobuz → community → FLAC → tag back half is platform-neutral. So `backend/core/apple_music.py` adds only the new half and imports the rest of `spotiflac.py` verbatim — **the audio still comes from Qobuz**, never Apple.

1. **Metadata** comes from the public `music.apple.com` page — its `<script id="serialized-server-data">` JSON carries the playlist/album title, cover, and the full tracklist (title, artist, album, cover, canonical track URL). No MusicKit token. Apple prefers a flat `artistName`; on an album page the per-track items share the album's single header artwork, so a single-track save backfills album + cover from the header.
2. **ISRC** resolves through the *same* `_resolve_isrc` — it feeds any URL (Apple included) to song.link, falling back to Deezer.
3–5. **Qobuz id, FLAC URL, and tagging are identical** — the same imported helpers the Spotify path uses.

Ingestion mirrors the Spotify endpoints exactly (`POST /api/ingest/apple` + `/probe`), reusing the same request bodies: a track → one music memo (`source_url` = the canonical Apple URL, which carries `?i=`); an album/playlist → a playlist collection + one memo per track. Apple track sources are detected beside Spotify ones in `localize_memo_task`, so every download affordance handles them with no extra wiring.

Where Apple differs from Spotify: the no-auth page serializes far more of a long playlist — a 67-track test playlist came through **67 of 67** (Spotify's embed caps near 50). Very long lists may still truncate; pulling the full list of an arbitrarily long playlist would need Apple's authenticated amp-api (a MusicKit developer JWT), deliberately out of scope for the no-account path.

## Playlist ingestion

The flow, end to end:

1. You paste a URL in the new-memo panel. A cheap client-side heuristic (`lib/playlistUrl.ts`) spots playlist-shaped URLs: `list=` on YouTube hosts, `/sets/` on SoundCloud, `/album/` on Bandcamp.
2. The panel probes the backend (`POST /api/ingest/playlist/probe`). yt-dlp enumerates the playlist with `--flat-playlist` — metadata only, no downloads, capped at 100 entries so a YouTube Mix can't enumerate forever.
3. The panel asks: **the whole playlist, or just this one?** "Just this one" is always the default. Ingesting a hundred tracks is a deliberate pick, never an accident.
4. "Just this one" goes down the normal `/ingest/url` path, untouched.
5. "Whole playlist" hits `POST /api/ingest/playlist`. The backend creates the playlist collection plus one audio memo per track (title, artist, thumbnail from the flat probe). A "Download tracks to this device now" toggle (off by default) decides what happens next: on, a background worker downloads tracks one at a time with the existing yt-dlp audio pipeline; off, tracks stay remote and you pull them later, per track or all at once. Sequential on purpose: kind to the host, kind to your disk.
6. The panel closes and takes you to the Music page, where the new playlist card is waiting (and filling up, if you chose to download).

Status rides on the per-memo `localize_status` the Make-it-local pipeline already uses: `pending → processing → done | error`. Progress is a COUNT query, not an in-memory job. Restart the server mid-playlist and finished tracks stay finished; pending ones can be retried per track.

Paste it twice, get it once. The probe tells the panel when a playlist collection with the same source URL already exists ("Already in your Music"), and the ingest endpoint returns the existing collection (`status: 'exists'`) instead of minting a duplicate. Tracks dedupe too: a song already in your library (same source URL) is linked to the new playlist, never re-created. One memo, two memberships, one download. Its `playlist_born` flag stays untouched, so a standalone song reused this way keeps its library spot.

Artist comes from the flat entry's artist or uploader field, with YouTube's " - Topic" suffix stripped. That is source metadata, not a domain fallback, so ADR-010 holds. Cookies (ADR-012) apply to private playlists for free.

The playlist's description seeds the same way: the yt-dlp probe, the Spotify embed, and the Apple Music page each return the source's blurb (where it has one), and the three playlist-collection creators write it to `collections.description`. No source blurb means an empty field the user can fill from the hero edit pencil.

## The Music page

`/music`, reached from the sidebar item right under Collections.

The hub reads like a music app's home (ADR-018): a featured row up top, themed rails below it, the full library at the bottom. Every rail scrolls sideways.

- **Header.** Eyebrow, title, sub. Same shared `PageHeader` as every page, plus an **Add music** action in the rail. On `/music` both that button and the global FAB open the music-specific add panel (see "Adding music" above), not the generic New Memo panel.
- **Hero rail.** Big full-bleed cards. First card is **Favourite Songs** — a brand-gradient heart card that queues every liked track in one tap (hover button shuffles instead). "Every liked track" means the whole library, *including* songs you liked from inside a playlist: the liked queue hits the server's `liked` filter, which bypasses the playlist-born feed exclusion (OPNMMO-0041), so a like made on a playlist track still lands here. After it, the newest saves of any kind: artwork edge to edge, a gradient veil at the bottom carrying the kind eyebrow (Album / Playlist), the name, and the track count, with a play button on hover. Albums show their single cover; playlists stretch their 4-up collage.
- **Albums.** A rail of album cards — single cover, "N tracks · Album" eyebrow, hover play, drop target, live download progress. The whole section hides when no albums exist.
- **Playlists.** Same rail for playlist-kind collections, with the 2x2 collage art, the inline **New playlist** creation flow, and the empty state pointing at Add music. Cards accept memo-card drops, same as sidebar collections.
- **Library.** The songs you saved one by one, in the standard masonry grid. Playlist-born tracks are not here; they live behind their playlist card. The header carries a debounced search box, a **branded sort dropdown** (Recent / Title / Artist — a custom `LibrarySort` popover, not a native `<select>`: caret spacing, themed menu, active tick, close on Escape or outside-click), and Play all + Shuffle that queue exactly the filtered view. Music cards render full-bleed: square artwork edge to edge, title on a bottom gradient, no body bar.

On the album and playlist rails, the card currently feeding the player is marked: an accent tint, a pinned corner badge, and a pause icon in place of play. Tapping that card toggles play/pause instead of restarting the queue; every other card starts fresh. Same for the hero rail.

Scroll is split by axis (ADR-018): a vertical wheel over a rail scrolls the page smoothly like everywhere else, while sideways input — trackpad swipe or shift+wheel — slides the rail itself. A flick past a rail's edge never triggers the browser's back gesture. The sideways scrollbar that shows on a smaller desktop screen is branded with the accent (contrast-corrected via `--accent-ink`, in both Firefox and Chromium), and the rails carry enough padding that a card's hover lift and drop shadow are not clipped by the scroll container (OPNMMO-0032 / OPNMMO-0041).

Click a playlist card and you get the playlist view (`/music/:id`): a boxed hero that names the playlist (artwork — collage for playlists, single cover for albums — an "Album · N tracks" / "Playlist · N tracks" eyebrow, play-all, shuffle, Download all, source link, delete), a "Back to Music" button above it, and the tracks as full-bleed cover tiles. The hero title carries an edit pencil (rename inline, write a description) and shows the description under the title, clamped to three lines so a long one never pushes the controls off-screen. While a bulk "Download all" pass is running, Download all becomes a Pause download button. Each tile carries its number, its title on a gradient, play on hover, a remove chip (pull the song out, nothing gets deleted), and a download / retry chip when the track is still remote or failed. Tiles reorder by drag; the order persists through the recency stagger. Click a ready tile to play; the queue picks up from that track. Deleting a playlist removes the collection, never the tracks: born tracks move back to the library.

## Visual design: playlist tiles

Full-bleed square tiles (`om-mtile`) are the building block of every playlist view. Design decisions:

- **Artist above title.** The artist name sits in the smaller, dimmer line above; the song title is the larger, bolder anchor at the bottom. This mirrors the reading order of most music apps and treats the artist as context, not the headline.
- **Track position on hover only.** The position badge (e.g. "71") is hidden at rest and fades in on hover. Showing it permanently on every tile added visual noise without helping playback. You need the number when you are navigating the list, not when you are glancing at art.
- **Play overlay on hover.** The play badge covers the tile on hover and when the track is active. It does not compete with the art at rest.
- **Remove chip opens a confirm overlay.** Tapping the × does not remove the track immediately. A small overlay covers the tile with two choices: **Delete** (permanently removes the memo) and **Remove** (pulls it out of this playlist; playlist-born tracks resurface in the library, dragged-in ones stay there). Same visual language as the card-level confirm dialog.
- **Remove chip on hover only (touch: always visible).** Destructive actions stay out of the way until you reach for them.
- **Bottom gradient cap.** `linear-gradient(to top, rgba(0,0,0,0.74), transparent)` gives enough contrast for white text without covering the art. Two lines maximum: artist (10px, 75% opacity) and title (12px bold, 2-line clamp).
- **Liked tracks get a wide tile.** A liked song shows a small filled heart above the artist line and spans two grid columns (1×2), so favourites jump out while scanning a long playlist. The column span lives on the sortable wrapper (the real grid cell); the tile flattens to roughly 2:1 and the cover recrops via `object-fit: cover`. Like from the big player's heart button; the hero's **Play liked** queues only those tracks.

## Visual design: big player

The sidebar big player (`om-sb-player-big`) fills the sidebar with album art and a transport cluster in the bottom third. Layout order from top to bottom in the body:

1. **Transport row.** Shuffle, previous, position counter (e.g. "44 / 101"), next, heart. The heart likes the playing track (the `liked` flag, not pin). The counter is mono, 9px, centered in a fixed-width slot sized to the longest position string, so skipping tracks never nudges the buttons. The up-next button is hidden for now.
2. **Scrubber.** The seek bar with current / total timestamps lives between the transport row and the title, so your eye moves from "where am I in the queue" to "where am I in this track" to "what track is this."
3. **Title (with volume).** The `VolumeControl` wraps the track title so the volume knob lives inline with the marquee, saving vertical space.
4. **Album — artist.** A dimmer mono line under the title ("HIT ME HARD AND SOFT — Billie Eilish"), aligned with the title text and sliding with the same auto Marquee when it overflows. Fed by `audio_album` / `audio_artist`; absent fields just drop out of the line.

The corner cluster (ADR-010) is a right-side column: play in the top-right corner, pin to its left, repeat under play, add-to-playlist under repeat — all on the same 8px rhythm. Satellites stay out of the artwork's center.

Rationale for scrubber placement: the scrubber is not a navigation control (that is the transport row). Separating them prevents accidental scrub when reaching for skip, and keeps the title reachable right below the seek bar.

The Add-to-playlist popover anchors inside the player (overlaying the artwork) because the big layout uses `overflow: hidden` to round its corners, which clips any above-the-player popover. Z-index 65 (menu) + 64 (backdrop) stacks above all player controls while keeping backdrop-tap-to-dismiss working.

## Visual design: small player

The small player (the default on desktop) is the cover-thumbnail row with a scrubber and a transport that can pack up to seven controls into the ~236px rail. It used to lay out in fixed pixels and run off the edge with a full queue (the old "drop to 90% zoom" workaround). It is now a **size container** (`container: sbplayer / inline-size`): as the rail narrows, two `@container` steps tighten the gaps and control sizes and, below ~200px, drop the trailing track-length label so the scrubber keeps a usable bar; the transport wraps as a last resort. Scoped to the small layout (`:not(.om-sb-player-big)`), so the big player is untouched (OPNMMO-0037, ADR-009 #5).

## Dashboard filter

The old Audio tab lumped voice notes and music together. It splits into two:

- **Music** → `type=audio` + `audio_kind=music`
- **Voice** → `type=audio` + `audio_kind=voice`

`GET /api/memos` grows an `audio_kind` param. Saved tab order reconciles automatically (removed ids drop, new ids append). It also takes a `liked=true` param (Favourite Songs) that returns every liked track and **skips** the playlist-born exclusion, so a song liked inside a playlist is still reachable (OPNMMO-0041).

## Play queue

The shared audio player (one `<audio>` element, ADR-005) learns a queue:

- `playQueue(tracks, startIndex, { shuffle })` loads a list and starts at a track, optionally shuffled.
- `next()` / `prev()` / `jumpTo(i)` / `removeAt(i)`, exposed with `queueIndex` / `queueLength` / `queueTracks`.
- Shuffle keeps the playing track at position 0 and reorders the rest; the source order is kept aside so toggling off restores it with your place intact.
- On track end: repeat-one wins if set, otherwise auto-advance, stop at the end.
- Playing a single track anywhere clears the queue. No hidden state.
- The whole player state (track, queue, order, position) snapshots to localStorage and restores PAUSED on reload. Never autoplay.

The sidebar player shows previous / next / shuffle and the Up-next popover only while a queue is live.

## Out of scope, on purpose

- **A full playlist editor page.** Creation happens inline (the "New playlist" row in the Add-to-playlist popover) and editing happens in place: drag-reorder, remove chips, and an edit pencil in the hero for the name and description. A dedicated edit screen is not planned.
- **Video playlists.** A playlist ingests as music (audio-only download). Saving a whole playlist as video memos is a different feature.
- **Re-sync.** `source_url` is stored so a future "pull new tracks" can exist. It does not exist yet.
- **Duration column.** We do not store track duration; probing per row is waste. The active track shows time in the player.

## Decision record

See ADR-015 in `docs/DECISIONS.md`: playlists are collections with a kind, never a parallel table. ADR-017: Spotify links resolve to lossless FLAC through a no-account provider chain, dispatched from the same `localize_memo_task` seam, with the Music page owning its own add panel. ADR-018: the hub is a rails-first surface (hero, albums, playlists, library) where every sideways rail owns the horizontal wheel axis and leaves the vertical one to the page. And ADR-019: Apple Music is a second SpotiFLAC front-end — a URL parser plus a metadata reader — that imports the neutral Qobuz back half verbatim, so the audio source never changes.
