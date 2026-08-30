# Cookies for restricted "Make it local" downloads

Status: built + verified on branch `worktree-cookies-guide`. See ADR-012 for the why.

## What it is

Age-restricted / private / login-gated videos fail "Make it local" because yt-dlp
runs anonymously on the server. This feature lets the user hand openMemo a browser
`cookies.txt`, which yt-dlp then uses (`--cookies`) to fetch the video as them, and
replaces the dead-end failure with a guided in-app walkthrough.

The detail-page **embed** for age-restricted YouTube stays broken (the platform
blocks those in an iframe); only the **download** path is unlocked. Once local, the
file plays normally.

## How it works

### Backend
- `core/app_settings.py` — jar at `DATA_DIR/yt_cookies.txt`. Helpers `get_cookies_path()`,
  `cookies_present()`, `save_cookies()`, `delete_cookies()`. `get_settings()` appends a
  computed `yt_cookies_present` (the jar itself is never serialized).
- `api/settings.py` — `POST /api/settings/cookies` (multipart, Netscape-format validation,
  5 MB cap, atomic write) and `DELETE /api/settings/cookies`.
- `core/localize_media.py` — `_cookie_args()` returns `--cookies <path>` when present,
  spliced into `_run_ytdlp` + `_get_thumbnail_url`. One provider-agnostic point (ADR-001):
  every video/audio host benefits, not just YouTube.
- `core/headless.py` — `_netscape_cookies_for(domain)` reads the SAME jar, narrows it to
  the domain being rendered (and its parent, so `shop.example.com` picks up cookies scoped
  to `.example.com`) and converts it to Playwright cookie dicts. One upload therefore
  serves downloads AND page rendering: a site that only opens up for a signed-in session
  renders for openMemo the way it does in the user's own browser. Applied AFTER the
  headless module's own per-domain jar so a real session wins over a cached `cf_clearance`.
  A `0` expiry (Netscape for "session cookie") becomes Playwright's `-1`; passing `0`
  through would hand it an already-expired cookie. Lines beginning `#HttpOnly_` are
  DATA, not comments - that prefix is how every exporter marks an httpOnly cookie,
  and a login session is httpOnly almost by definition, so treating it as a comment
  discards precisely the cookies this exists for. Trailing tabs are preserved too:
  a cookie with an empty value ends in one, and `.strip()` would eat the field and
  drop the row to six columns.
- `db/models.py` + `main.py` — new `Memo.localize_error` (Text) captured in `api/ingest.py`
  on failure, cleared on retry (`api/memos.py`) and success. Additive PRAGMA migration.

### Frontend
- `components/GuideModal.tsx` — reusable centered step popup (steps = data; any step can
  render a live control). `components/GuideHost.tsx` mounts it once from `Layout.tsx`,
  driven by `activeGuide` in `stores/appStore.ts` (`openGuide`/`closeGuide`).
- `lib/guides.tsx` — the `yt-cookies` guide: 6 steps (why → how safe → install exporter →
  sign in → export → upload).
- `components/CookiesUpload.tsx` — self-contained drag-drop upload / replace / remove;
  reads `yt_cookies_present`, invalidates the `['settings']` query.
- `pages/MemoDetail.tsx` — `MakeItLocalPanel` error branch: smart copy from `localize_error`
  + "Follow these steps" (opens the guide) + Try again.
- `pages/SettingsPage.tsx` — "Cookies for restricted downloads" management row.
- `lib/api.ts` — `settingsApi.uploadCookies()/deleteCookies()`, `AppSettings.yt_cookies_present`.

## Storage & privacy
- File: `DATA_DIR/yt_cookies.txt` (a Docker volume in the container deployment). Git-ignored.
- Never logged, never returned by the API (only the boolean flag).
- The only network egress of any cookie is yt-dlp → the video host, same as a browser on play.
  No openMemo server exists; nothing is collected or phoned home.
- Encryption at rest is deferred on purpose (ADR-012 §6): a local key is obfuscation, and
  DPAPI does not exist in the Linux container. Plaintext-under-git-ignored-volume for now.

## Status / task list
Done (code-complete, verified via build + dev stack):
- Backend cookies storage/API, yt-dlp injection, `localize_error` capture.
- GuideModal framework + 6-step cookies guide + CookiesUpload.
- Failure-block rewrite, Settings row, ADR-012, changelog [2.3.0].
- Copy/type pass: title 30px, body 16px, brand voice (openMemo), Docker-volume wording,
  "just this one site" specificity, big-file copy, 5 MB cap, "Remove" labeled.

Remaining:
- **Equalize the safety step height** — it renders ~518px vs ~340px on other steps, so the
  card still jumps on that one step. Options: raise min-height to the tallest, fixed-height +
  internal scroll, or trim the safety copy.
- **Re-add the cookies row** into the new bento `SettingsPage` after merging `origin/main`
  (PR #42 rewrote that file). The cookies row was authored against the pre-bento layout.
- **Cookie encryption / file-permission hardening** — parked (ADR-012 §6).

## What might break / watch for
- **Merge conflict with `main` (f3abb76):** PR #42 rewrote `SettingsPage.tsx`, `openmemo.css`,
  `AppearancePanel.tsx`, and added **ADR-011** + CHANGELOG entries. On merge, resolve:
  `SettingsPage.tsx` (take the new bento, re-insert the cookies row), `docs/DECISIONS.md`
  (keep ADR-012 above the incoming ADR-011), `docs/CHANGELOG.md` (keep [2.3.0] on top).
- **Dev backend has no `--reload`:** backend code changes need a manual restart of the :8099
  process to take effect.
- **`.om-hint-readable` forces `font-size:12px !important`** — do not reuse it for guide body
  text; GuideModal styles the body inline instead.
- **dnd-kit card click (`distance:8`)** — unrelated here, but relevant to the upcoming
  thumbnail-pen feature (OPNMMO-0017): a button on the card must not break card click/drag.

## Testing
- Backend: `pytest backend/tests/`; upload a real `cookies.txt`, confirm
  `GET /api/settings` → `yt_cookies_present:true`, retry localize on a restricted URL → `done`.
- Frontend: `npm run build` + `npm run lint`; dev stack FE :3000 → BE :8099; open a memo whose
  localize errored → new copy + Follow these steps → walk guide → upload → Try again succeeds.
