# 025 — Instagram videos save as thumbnails, not videos

Status: in progress (2026-08-03)
Branch: `claude/telegram-instagram-video-bug-fea4f8`

## Symptom

Share an Instagram reel to the Telegram bot → openMemo saves a still image
(the poster frame) and never downloads the video.

## Root cause (verified live, not inferred)

`core/extractor._instagram_resolve` has a 5-tier ladder. On this install:

| Tier | Path | State today |
|------|------|-------------|
| 1 | guest media-info API, anonymous | **blocked** — IP not trusted, non-JSON shell |
| 2 | guest media-info API + cookie jar | **disabled** — `data/yt_cookies.txt` does not exist |
| 3 | gallery-dl + cookies | **disabled** — same missing jar |
| 4 | headless render → largest image | **the only tier that runs** |
| 5 | needs-login link memo | not reached |

Tier 4 hardcodes `"type": "image"` and returns the largest *image* on the page.
A reel therefore becomes an image memo of its poster frame. Auto-download only
fires for `type == "video"` (`api/ingest.py`), so no video is ever pulled.

Verified in the running container:

```
_instagram_resolve("https://www.instagram.com/reel/DbV_pTDAByT/")
  → type: image | title: Instagram post | thumb: …cdninstagram.com/v/t51…jpg
```

And the fix is viable — the network sniffer already sees the real file with no
login at all:

```
sniff_media(same reel) → media_url: …cdninstagram.com/o1/v/t2/… (video/mp4, progressive)
```

## Secondary defects found

1. **Tier 3 (gallery-dl) types every entry `image`** — a reel pulled through
   gallery-dl returns an `.mp4` URL that is then stored as `thumbnail_path`;
   `_download_thumb` rejects non-image content types, so the memo keeps a
   remote, expiring mp4 URL as its "thumbnail".
2. **yt-dlp is tried first when localizing Instagram** — it is login-walled on
   every IG post, so every IG video download burns a doomed yt-dlp run before
   falling back to the sniffer that actually works.
3. **`_is_instagram_video_path()` is dead code** — defined + tested, never
   called. It is the exact `/reel|/reels|/tv` guard tier 4 was missing.

## Known limitation (out of scope, documented)

A carousel containing video slides stays `type=image`. Slides keep a signed
`video_url` that expires and is never localized (`cache_gallery` downloads
images only). The frontend does not play slide videos yet (`types/index.ts`
calls `video_url` a future inline-play upgrade), so today this is cosmetic.

## Data impact (main DB, 2026-08-03)

| Bucket | Count |
|--------|-------|
| IG memos, `type=video`, file downloaded | 36 |
| **IG `/reel/` memos saved as `type=image`, no file** | **12** |
| IG `/p/` memos saved as `type=image`, no file | 10 (photo *or* video — probe) |
| IG `type=video`, no file (1 error, 1 never queued) | 2 |

## Fix

1. `core/sniff_media.sniff_media(want_image=True)` — one browser pass reports
   both the video seen on the wire **and** the largest rendered still. Stays
   host-blind; every return gains `main_image`.
2. `core/extractor._instagram_resolve` tier 4 → media-aware: sniff decides
   video vs photo. Video → `type="video"` with the poster as thumbnail.
   `render_page` stays as a last-resort still grab.
3. Tier 3 (gallery-dl) types each entry by its URL extension; a single video
   entry becomes a video memo with no thumbnail (localize extracts a frame).
4. `localize_media.SNIFF_FIRST_HOSTS += "instagram.com"` — sniffer first,
   yt-dlp still the fallback for cookie users.
5. `backend/backfill_instagram_videos.py` — probe every stuck IG memo, flip
   real videos to `type=video`, download them. `--dry-run` by default.
6. Tests in `backend/tests/test_instagram.py`.

## Review

Two-pass bug review after implementation (see PR / CHANGELOG).
