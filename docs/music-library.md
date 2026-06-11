# Music Library

openMemo already knows the difference between a voice note and a song (ADR-005). The Music library gives songs a home. One page for everything you collect by ear: playlists pulled straight from YouTube Music, single tracks, uploads. All local, all yours.

This doc is the spec for Music Experience V2 (entry OPNMMO-0023). It covers the UX, the data model, the playlist ingestion flow, and what we deliberately left out.

## The idea, improved

The original ask: a Music section in the sidebar, a music collection page, a music filter on the dashboard, and yt-dlp playlist ingestion from the new-memo panel.

What we added on top:

- **A real play queue.** Playing a playlist actually plays through it. Next and previous controls land in the sidebar player. Without this, a playlist is just a folder.
- **Playlist order is preserved.** Tracks keep the order the playlist had at the source.
- **Per-track resilience.** A playlist download is N independent track downloads. One dead video does not kill the other 39. Failed tracks stay as remote memos and can be retried from their detail page.
- **Progress you can watch.** The playlist card shows live download progress, computed from the database. Survives a server restart.
- **Drag a track onto a playlist card** to file it, same gesture as sidebar collections.
- **Not just YouTube.** SoundCloud sets and Bandcamp albums are playlists too. One detection helper, host-agnostic per ADR-001.
- **Download is opt-in.** A playlist can be pulled as remote track memos only, like any music app: a download chip per tile, a Download all button on the playlist page. Or flip the toggle and it downloads everything up front.
- **Every feed stays clean.** Tracks born from a playlist ingest live inside their playlist, full stop. They never flood All Memos, the type tabs, or the Music library. The library lists only the songs you saved one by one: a liked-songs shelf, not a dump of every playlist you ever pulled. And filing a library song into a playlist does not steal it from the library: it lives in both, like every music app you know.
- **Playlists are editable, no drag required.** An "Add to playlist" popover lives on every music surface (card actions, memo detail, the sidebar player) with membership ticks and inline new-playlist creation. Tiles in the playlist view carry a remove chip and reorder by drag. Touch works everywhere.
- **The player behaves like a player.** Shuffle (current track pinned, source order restorable), an Up-next popover showing the live queue (jump or drop tracks), and continue-listening: a reload restores track, queue and position, paused.

## Data model

Playlists are collections. No new table, one new column.

- `collections.kind` — `'standard'` (default) or `'playlist'`. Additive migration, NULL backfilled to `'standard'`.
- `collections.source_url` — the playlist URL it was pulled from. Nullable. Kept for provenance and a future re-sync.

The collections API filters by kind server-side. `GET /api/collections` returns standard collections only, so the sidebar, the collections page, and every collection picker hide playlists with zero frontend changes. `?kind=playlist` returns playlists. `?kind=all` returns everything.

Tracks are plain audio memos (`type=audio`, `audio_kind=music`) linked to the playlist through the existing `memo_collections` table. Playlist ingest stamps them `playlist_born` (additive boolean column, existing playlist members backfilled). They keep their detail pages and stay searchable, but the list feeds (dashboard, type tabs, Music library) exclude any memo that is playlist-born AND still belongs to a playlist-kind collection. Both halves matter: a standalone song you file into a playlist by hand is not born there, so it stays in the library too; delete a playlist and its born tracks lose the membership, so they resurface in the library instead of vanishing forever.

Playlist order rides on `recency_at`: track i gets `now - i` seconds at ingest, so the default recency sort returns playlist order for free. Same trick drag-to-reorder already uses.

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

## The Music page

`/music`, reached from the sidebar item right under Ask Memo.

Three zones, in the visual language of the dashboard:

- **Header.** Eyebrow, title, sub. Same `om-header` skeleton as Today. Adding music goes through the global FAB and New Memo panel, no extra chrome.
- **Playlists.** A horizontal row of playlist cards. Each card is a 2x2 collage of the first four track covers, name, track count, a play button that queues the whole playlist, and a progress bar while tracks are downloading. Cards accept memo-card drops, same as sidebar collections.
- **Library.** The songs you saved one by one, in the standard masonry grid. Playlist-born tracks are not here; they live behind their playlist card. The header carries a debounced search box, a sort pill (Recent / Title / Artist), and Play all + Shuffle that queue exactly the filtered view. Music cards render full-bleed: square artwork edge to edge, title on a bottom gradient, no body bar.

Click a playlist card and you get the playlist view (`/music/:id`): a boxed hero that names the playlist (collage, count, play-all, shuffle, Download all, source link, delete), a "Back to Music" button above it, and the tracks as full-bleed cover tiles. Each tile carries its number, its title on a gradient, play on hover, a remove chip (pull the song out, nothing gets deleted), and a download / retry chip when the track is still remote or failed. Tiles reorder by drag; the order persists through the recency stagger. Click a ready tile to play; the queue picks up from that track. Deleting a playlist removes the collection, never the tracks: born tracks move back to the library.

## Visual design: playlist tiles

Full-bleed square tiles (`om-mtile`) are the building block of every playlist view. Design decisions:

- **Artist above title.** The artist name sits in the smaller, dimmer line above; the song title is the larger, bolder anchor at the bottom. This mirrors the reading order of most music apps and treats the artist as context, not the headline.
- **Track position on hover only.** The position badge (e.g. "71") is hidden at rest and fades in on hover. Showing it permanently on every tile added visual noise without helping playback. You need the number when you are navigating the list, not when you are glancing at art.
- **Play overlay on hover.** The play badge covers the tile on hover and when the track is active. It does not compete with the art at rest.
- **Remove chip opens a confirm overlay.** Tapping the × does not remove the track immediately. A small overlay covers the tile with two choices: **Delete** (permanently removes the memo) and **Remove** (pulls it out of this playlist; playlist-born tracks resurface in the library, dragged-in ones stay there). Same visual language as the card-level confirm dialog.
- **Remove chip on hover only (touch: always visible).** Destructive actions stay out of the way until you reach for them.
- **Bottom gradient cap.** `linear-gradient(to top, rgba(0,0,0,0.74), transparent)` gives enough contrast for white text without covering the art. Two lines maximum: artist (10px, 75% opacity) and title (12px bold, 2-line clamp).

## Visual design: big player

The sidebar big player (`om-sb-player-big`) fills the sidebar with album art and a transport cluster in the bottom third. Layout order from top to bottom in the body:

1. **Transport row.** Shuffle, previous, position counter (e.g. "44 / 101"), next, up-next queue. The counter is mono, 9px, so it reads as data without competing with the track title.
2. **Scrubber.** The seek bar with current / total timestamps lives between the transport row and the title, so your eye moves from "where am I in the queue" to "where am I in this track" to "what track is this."
3. **Title (with volume).** The `VolumeControl` wraps the track title so the volume knob lives inline with the marquee, saving vertical space.

Rationale for scrubber placement: the scrubber is not a navigation control (that is the transport row). Separating them prevents accidental scrub when reaching for skip, and keeps the title reachable right below the seek bar.

The Add-to-playlist popover anchors inside the player (overlaying the artwork) because the big layout uses `overflow: hidden` to round its corners, which clips any above-the-player popover. Z-index 65 (menu) + 64 (backdrop) stacks above all player controls while keeping backdrop-tap-to-dismiss working.

## Dashboard filter

The old Audio tab lumped voice notes and music together. It splits into two:

- **Music** → `type=audio` + `audio_kind=music`
- **Voice** → `type=audio` + `audio_kind=voice`

`GET /api/memos` grows an `audio_kind` param. Saved tab order reconciles automatically (removed ids drop, new ids append).

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

- **A full playlist editor page.** Creation happens inline (the "New playlist" row in the Add-to-playlist popover) and editing happens in place (drag-reorder, remove chips). A dedicated edit screen is not planned.
- **Video playlists.** A playlist ingests as music (audio-only download). Saving a whole playlist as video memos is a different feature.
- **Re-sync.** `source_url` is stored so a future "pull new tracks" can exist. It does not exist yet.
- **Duration column.** We do not store track duration; probing per row is waste. The active track shows time in the player.

## Decision record

See ADR-015 in `docs/DECISIONS.md`: playlists are collections with a kind, never a parallel table.
