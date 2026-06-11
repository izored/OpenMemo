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

## Data model

Playlists are collections. No new table, one new column.

- `collections.kind` — `'standard'` (default) or `'playlist'`. Additive migration, NULL backfilled to `'standard'`.
- `collections.source_url` — the playlist URL it was pulled from. Nullable. Kept for provenance and a future re-sync.

The collections API filters by kind server-side. `GET /api/collections` returns standard collections only, so the sidebar, the collections page, and every collection picker hide playlists with zero frontend changes. `?kind=playlist` returns playlists. `?kind=all` returns everything.

Tracks are plain audio memos (`type=audio`, `audio_kind=music`) linked to the playlist through the existing `memo_collections` table. They show up in the dashboard, in search, in the library. Delete the playlist and the tracks survive, exactly like collections.

Playlist order rides on `recency_at`: track i gets `now - i` seconds at ingest, so the default recency sort returns playlist order for free. Same trick drag-to-reorder already uses.

## Playlist ingestion

The flow, end to end:

1. You paste a URL in the new-memo panel. A cheap client-side heuristic (`lib/playlistUrl.ts`) spots playlist-shaped URLs: `list=` on YouTube hosts, `/sets/` on SoundCloud, `/album/` on Bandcamp.
2. The panel probes the backend (`POST /api/ingest/playlist/probe`). yt-dlp enumerates the playlist with `--flat-playlist` — metadata only, no downloads, capped at 100 entries so a YouTube Mix can't enumerate forever.
3. The panel asks: **the whole playlist, or just this one?** A watch URL with a `list=` param defaults to "just this one". A pure playlist URL defaults to "whole playlist".
4. "Just this one" goes down the normal `/ingest/url` path, untouched.
5. "Whole playlist" hits `POST /api/ingest/playlist`. The backend creates the playlist collection plus one pending audio memo per track (title, artist, thumbnail from the flat probe), then a background worker downloads tracks one at a time with the existing yt-dlp audio pipeline. Sequential on purpose: kind to the host, kind to your disk.
6. The panel closes and takes you to the Music page, where the new playlist card is already filling up.

Status rides on the per-memo `localize_status` the Make-it-local pipeline already uses: `pending → processing → done | error`. Progress is a COUNT query, not an in-memory job. Restart the server mid-playlist and finished tracks stay finished; pending ones can be retried per track.

Artist comes from the flat entry's artist or uploader field, with YouTube's " - Topic" suffix stripped. That is source metadata, not a domain fallback, so ADR-010 holds. Cookies (ADR-012) apply to private playlists for free.

## The Music page

`/music`, reached from the sidebar item right under Ask Memo.

Three zones, in the visual language of the dashboard:

- **Header.** Eyebrow, title, sub. Same `om-header` skeleton as Today. An "Add music" button opens the new-memo panel.
- **Playlists.** A horizontal row of playlist cards. Each card is a 2x2 collage of the first four track covers, name, track count, a play button that queues the whole playlist, and a progress bar while tracks are still downloading. Cards accept memo-card drops, same as sidebar collections.
- **Library.** Every music memo, newest first, in the standard masonry grid. Cards keep their inline player and aurora.

Click a playlist card and you get the playlist view (`/music/:id`): collage hero, play-all, and a numbered track list. Click a row to play; the queue picks up from that track. Deleting a playlist removes the collection, never the tracks.

## Dashboard filter

The old Audio tab lumped voice notes and music together. It splits into two:

- **Music** → `type=audio` + `audio_kind=music`
- **Voice** → `type=audio` + `audio_kind=voice`

`GET /api/memos` grows an `audio_kind` param. Saved tab order reconciles automatically (removed ids drop, new ids append).

## Play queue

The shared audio player (one `<audio>` element, ADR-005) learns a queue:

- `playQueue(tracks, startIndex)` loads a list and starts at a track.
- `next()` / `prev()`, exposed with `queueIndex` / `queueLength`.
- On track end: repeat-one wins if set, otherwise auto-advance, stop at the end.
- Playing a single track anywhere clears the queue. No hidden state.

The sidebar player shows previous and next buttons only while a queue is live.

## Out of scope, on purpose

- **Manual playlist creation and editing.** Playlists are born from URLs for now. Drag-to-add works; create-empty and reorder come later.
- **Video playlists.** A playlist ingests as music (audio-only download). Saving a whole playlist as video memos is a different feature.
- **Re-sync.** `source_url` is stored so a future "pull new tracks" can exist. It does not exist yet.
- **Duration column.** We do not store track duration; probing per row is waste. The active track shows time in the player.

## Decision record

See ADR-014 in `docs/DECISIONS.md`: playlists are collections with a kind, never a parallel table.
