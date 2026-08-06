# Music relay: audit + independence plan

Audit of every file that touches the lossless music relay, and what it would
take to stop depending on `spotbye/SpotiFLAC`'s community service.

Done 2026-08-06 against openMemo 3.8.0 and `spotbye/SpotiFLAC` @ main
(pushed 2026-07-18, 10.3k stars, MIT). Live probes against the relay included.

---

## Part 1 — Audit

### The surface, confirmed

| File | Role | Verdict |
|---|---|---|
| `backend/core/music_relay.py` | Session lifecycle, challenge flow, `SPOTIFLAC-HMAC-V1` signing | Faithful port of upstream `community_session.go`. Signing verified line-by-line against the Go original. |
| `backend/core/spotiflac.py` | Download chain + inlined third-party constants | Correct, one dead constant (below) |
| `backend/core/apple_music.py` | Apple front-end, imports `_community_flac_url` | Same relay path, second entry point |
| `backend/core/app_settings.py:155` | Session secret storage + strip list | **Clean.** `music_relay` is popped from `get_settings()`, pinned by a test |
| `backend/api/settings.py:450–512` | 4 relay routes | See findings 4 and 5 |
| `backend/main.py:506` | `/session-grant` top-level callback | Correct — the relay refuses any other path |
| `nginx.conf:54` | `location = /session-grant` | Correct |
| `backend/api/ingest.py` | 12 refs, background localize tasks | Fine |
| `backend/refetch_missing_media.py` | Bulk driver | Fine |
| `frontend/src/lib/api.ts:596–612` | 3 calls + type | Fine |
| `frontend/src/pages/SettingsPage.tsx:315` | Sends `window.location.origin` as `callback_base` | See finding 4 |
| `backend/tests/test_music_relay.py` | 11 cases | Good. Covers signature, secret non-disclosure, nonce, expiry, unissued state |

The secret-leak precedent from `mesh_secret` does **not** repeat. `music_relay`
is stripped, and `test_the_secret_never_crosses_the_api` holds the line.

### Findings

**1. `_COMMUNITY_API_KEY` is dead code sent on every request.** *(spotiflac.py:46, 371)*

`gh api search/code repo:spotbye/SpotiFLAC x-api-key` → **0 hits**. Upstream's
`community_apikey.go` no longer contains a key at all — it is now just
`communityUserAgent()` and `setCommunityRequestHeaders()`. Live probe: an
unsigned POST with no `x-api-key` returns `428 Verification session required`,
not a missing-key error. The key does nothing. Remove the constant and the
header.

**2. The `app_version()` puzzle is solved — and the current docstring is half right.**

Decoding the challenge JWT the relay mints (`/bootstrap`, payload is the first
dot-segment) shows exactly what it stores:

| sent `app_version` | stored in challenge |
|---|---|
| `openMemo/3.8.0` | `unknown` |
| `3.8.0` | `3.8.0` |
| `1.9.9` | `1.9.9` |
| `unknown` | `unknown` |

The relay does not reject unrecognised apps. It preserves a **bare semver
verbatim** and normalises anything else to `unknown`. The four-hour 401 was
caused by the **slash** in `openMemo/3.8.0`, not by claiming a version.

Keep returning `"unknown"` — it is the honest value for a client that is not a
SpotiFLAC build. But the docstring and the test comment should state the actual
rule, so the next person doesn't rediscover it the hard way in either direction.

**3. `User-Agent: "SpotiFLAC"`** *(spotiflac.py:373)* — a deliberate
impersonation of the upstream client. The relay gates on the signature, not the
UA, so this is not load-bearing. Worth making a conscious choice about rather
than inheriting it.

**4. `callback_base` is caller-supplied, and openMemo's API has no auth.**
*(music_relay.py:157)*

Validation is scheme + netloc only. Anyone who can reach the API can start a
verification pointed at a host they control. It is **not** a straight bypass —
the attacker still needs the user to open and complete a human challenge, so it
is phishing-equivalent. Upstream sidesteps it entirely by binding the callback
to `127.0.0.1:<ephemeral port>` picked server-side; openMemo cannot, because the
browser is remote.

Cheap fix: reject a `callback_base` whose host is not the request's own `Host` /
`X-Forwarded-Host`.

**5. `_pending` grows on unauthenticated input, and each entry costs an outbound
call.** Entries are small and expire in 15 min, so memory is not the issue — the
real effect is that `/verify/start` is an unauthenticated **amplifier** for
outbound requests to the relay. A per-process cap or a simple rate limit closes
it.

**6. Replay is properly closed.** `_pending.pop(state)` makes a grant single-use
on our side, and the unissued-state rejection is tested.

**7. A `401` is not handled — only `428` is.** *(spotiflac.py:380)*

Upstream `doCommunityRequest` treats **401 and 428 alike**: clear the stored
credentials, retry once. openMemo special-cases 428 with a good message, but a
401 (signature drift — clock skew, a rotated scheme) falls through to the
generic path and lands a raw relay string in the memo. Add 401 to the same
branch and clear the session so the next attempt re-verifies instead of
re-failing.

**8. Track matching is materially weaker than upstream — this one bites users.**
*(spotiflac.py:285 `_qobuz_track_match`)*

openMemo takes `items[0]` from a 5-result search with no scoring. Upstream's
`scoreQobuzSearchCandidate` scores title, artist and album, and applies a
**-2000 penalty on artist mismatch**. When the ISRC lookup misses and the chain
falls back to `"title artist"` text search, openMemo can silently download a
cover, a remix, or a karaoke version and tag it as the real track. Not a relay
bug, but it lives on the relay path and it is the most likely source of "this
FLAC is the wrong recording".

**9. Privacy, quantified.** Per download the relay operator learns: this
install id, at this time, wanted this Qobuz track id. Over a library that is a
full listening history tied to a stable identifier. Inherent to using someone
else's relay — and the strongest argument for Part 2.

---

## Part 2 — Independence

### The discovery

**SpotiFLAC already ships an escape hatch, and tries it first.**

`backend/qobuz_api.go:63` `getQobuzCustomDownloadURL` + `app.go:1441`
`CheckCustomQobuzAPI` implement a user-configured "custom Qobuz instance":

```
GET {base}/api/download-music?track_id=<id>&quality=<5|6|7|27>
→ 200 {"success": true, "data": {"url": "https://…flac"}}
```

No signing. No session. No API key. And in `GetDownloadURL` (qobuz.go:372) the
custom instance is tried **before** the community relay. Upstream's own design
says: bring your own backend, the community service is the fallback for people
who have none.

`SetCustomAPIURL` rejects anything not `https://`. Worth copying.

### What the relay actually provides

Everything about the relay is now fully understood and portable — the AES-GCM
endpoint obfuscation (re-derived independently during this audit; all four
hostnames decrypt to what openMemo has inlined), the HMAC signing scheme, the
challenge/exchange flow. None of that is the dependency.

The dependency is one thing: **the operator holds Qobuz subscriber auth
tokens.** Qobuz `track/getFileUrl` requires an authenticated subscriber. The
public `app_id`/`app_secret` unlock search and metadata only. The reference
implementation of that endpoint shape
([audio-music-streamer/Qobuz-DL-API](https://github.com/audio-music-streamer/Qobuz-DL-API),
Next.js) needs exactly `QOBUZ_APP_ID`, `QOBUZ_SECRET`, and
`QOBUZ_AUTH_TOKENS` — an array of user tokens.

### The three honest options

**A. Self-host against your own Qobuz account.** *(recommended)*
Run the instance yourself, sign in with your own subscription, point openMemo at
it. No third party, no challenge, no 6-hour expiry, no 503s, and no listening
history leaving the machine. Cost: a Qobuz subscription.

**B. Run a relay without an account.** Not possible, and not worth pursuing.
There is no auth-free source of lossless Qobuz streams. "Replicating the relay"
without an account means replicating the token-sharing, which is precisely the
part that is the operator's exposure rather than ours. Declining to build this.

**C. A different source.** Tidal (`tdl-oss`) and Amazon (`amz-oss`) exist
upstream but hand back DASH/CENC-encrypted streams needing `mp4ff_decrypt` plus
ffmpeg — more code, same account problem. Deezer's FLAC path needs an ARL. No
free lunch anywhere.

### Option A′ — skip the middle service entirely *(better; verified 2026-08-06)*

The custom-instance route (option A) means running a Next.js app whose only job
is to hold a Qobuz token and sign requests. **openMemo can do both itself.**

Probed live against the public Qobuz API, no account used:

| Probe | Result |
|---|---|
| Scrape `open.qobuz.com` for credentials | Works. Returns `712109809` / `589be88e…` — **identical to openMemo's hardcoded pair**, so they are current, not stale |
| `track/getFileUrl` signed with openMemo's **existing** `_qobuz_signature` | **HTTP 200** |
| Same call, deliberately wrong secret (control) | `400 Invalid Request Signature parameter` |
| `user/login` with invalid credentials | `401 Invalid username/email and password combination` |

The control proves it: **`_qobuz_signature` already signs `getFileUrl`
correctly, unchanged.** The generic scheme openMemo ported for `track/search`
(normalise path, sorted params, ts, secret) is the same one `getFileUrl` uses.
No new crypto.

What a token-less `getFileUrl` returns, at every quality:

```
asked  5 -> format_id=5 duration=30s mime=audio/mpeg 44.1kHz/16bit
asked  6 -> format_id=5 duration=30s mime=audio/mpeg 44.1kHz/16bit
asked  7 -> format_id=5 duration=30s mime=audio/mpeg 44.1kHz/16bit
asked 27 -> format_id=5 duration=30s mime=audio/mpeg 44.1kHz/16bit
```

Always a **30-second MP3 preview**, whatever you ask for. So the
`X-User-Auth-Token` header is the entire difference between a snippet and a full
FLAC — and it is the *only* thing openMemo is missing.

**Failure is already safe.** With no/expired token the response is MP3, and the
existing `fLaC` magic-byte sniff rejects it before it lands on disk. Checking
`format_id != 5` on the JSON is cleaner still — fail before downloading.

#### What to build

| Change | File | Size |
|---|---|---|
| Store `qobuz_user_auth_token` — **a secret**, so it joins the `get_settings()` strip list next to `music_relay` | `core/app_settings.py` | ~20 lines |
| `user/login` (unsigned: `email` + `md5(password)` + `app_id`) → token. Store the token, **never the password** | `core/qobuz_account.py` (new) | ~40 lines |
| `_qobuz_file_url()` — `track/getFileUrl` with `X-User-Auth-Token`, reusing `_qobuz_call` | `core/spotiflac.py` | ~35 lines |
| Try direct first, fall back to the relay | `core/spotiflac.py` `_community_flac_url` | ~15 lines |
| Quality map: relay `24`/`16` → Qobuz `27`→`7`→`6` | `core/spotiflac.py` | ~10 lines |
| Sign-in row + connected/expired state | `SettingsPage.tsx`, `api.ts` | ~70 lines |

Apple and Spotify both inherit it from the one branch, since `apple_music.py`
imports `_community_flac_url`.

Result: no third party, no challenge, no 6-hour session, no 503s, no track ids
leaving the machine, and hi-res above what the relay's `16`/`24` exposes.

#### Assessment of the two sources (2026-08-06)

**The gist** ([vitiko98](https://gist.github.com/vitiko98/bb89fd203d08e285d06abf40d96db592))
is ten lines: print `app_id` and `secrets` from `qobuz_dl.bundle.Bundle`, with
the note *"the first usually works"*. That plural, and that hedge, are the whole
point — the `play.qobuz.com` bundle yields **several candidate secrets** and you
must brute-test them against a real endpoint to find the live one.

**openMemo does not have that problem.** Scraped just now:

| Web app | app_id | secret | Shape |
|---|---|---|---|
| `open.qobuz.com` | `712109809` | `589be88e…` | **One pair, inline in the bundle** |
| `play.qobuz.com` | — | — | Not inline; needs the seed/timezone/info/extras dance → many candidates |

openMemo and SpotiFLAC use the first. streamrip and qobuz-dl use the second.
Nearly every broken-secret issue in those trackers is about the second path.

**The Reddit thread** (r/Piracy `1g268d5`, Oct 2024, archived) could not be
fetched here — blocked at raw fetch, browser pane and WebFetch alike — but was
supplied in full by the user and is assessed below.

#### What that thread actually is

A **shared-credential distribution channel**, not a technical discussion. One
commenter posts rotating `user_id` + `user_auth_token` pairs for Qobuz premium
accounts in Japan, New Zealand, the UK, Canada and Mexico, sourced from the
"Firehawk52" rentry list. Stated outright in the thread:

> Yes you need a premium account that's why you go to the Firehawk rentry for
> the id and token

Those are **other people's subscriptions**. That is option B from the section
above — the token-sharing path — and it stays declined: openMemo will not ship,
embed, or be designed around third-party account credentials. Practically it is
also the worst option on offer; the thread is a two-year record of exactly how
badly it works.

Every failure reported in it is a **borrowed account dying**, not a protocol
problem:

| Symptom in thread | Cause |
|---|---|
| "it worked for a day and stopped" | shared token rate-limited or revoked |
| "ends on the 25th Jan" / "ends Feb 28" | trial accounts expiring |
| "artists names are in JP" | catalog + metadata scoped to the *account's* region |
| "frozen because of too much traffic… unfrozen after some time" | many users hammering one credential |

**None of that applies to a subscription you own.** No shared-load freezing, no
expiry date, no regional metadata mismatch. The thread is evidence against
credential sharing, not against the direct path.

#### What the thread does confirm — and it is useful

**1. Token binding, from the authoritative source.** The thread quotes the
QBDLX-MOD 1.2.7.0 changelog verbatim, which is the same text surfaced via
streamrip #751 — but it carries a second half that matters:

> To accommodate this change, a new Settings screen was added where the user can
> optionally enter the AppId and AppSecret, in case they want to use a User Auth
> Token **not** generated by the most current Web Player… For User Auth Tokens
> obtained via the method explained in the Wiki in combination with the **latest
> Qobuz Web Player, these 2 new settings fields can be left empty** so that
> QobuzDownloaderX-MOD will automatically retrieve those values from the current
> Web Player, as before.

So a token minted by the **current** web player pairs automatically with the
app_id/secret scraped from that **same** player. That is precisely openMemo's
design: scrape `open.qobuz.com`, have the user paste a token captured from
`open.qobuz.com`, and they match with no manual entry. Add an optional manual
app_id/secret override for a token from any other player — the same escape hatch
QBDLX-MOD shipped in 1.2.7.0.

**2. The 30-second failure mode, observed in the wild.** From the thread:

> I'm only getting 30 second song downloads from this — did the license expire?

That is exactly what the probe here returned for an unauthenticated request:
`format_id=5`, `duration=30`, `audio/mpeg`, at every quality asked for. The
predicted failure mode is the real-world one, which makes the guard concrete:
**reject `format_id == 5` before downloading**, and let the existing `fLaC`
magic-byte sniff catch anything that slips past. openMemo shows "your Qobuz
session is no longer valid" instead of silently filling a library with 30-second
MP3s named `.flac`.

**3. Multiple app_ids exist across players and regions** — `950096963` (old),
`579939560` (a later one) and openMemo's `712109809` all appear in the wild.
Confirms the "capture as a matched set, do not hardcode" decision.

#### What the thread does not show

**No bans.** Two years of an archived, heavily-used credential-sharing thread
with not one report of Qobuz terminating an account over third-party API use.
The churn is expiry and rate-limiting of shared logins. That is consistent with
the earlier search finding, and it is the closest thing to evidence available —
though it says nothing about what happens to an account that is *identifiable*
and used at volume.

#### The finding that changes the design

streamrip #751, 2024-10-12, quoting the qbdlx-mod 1.2.7.0 changelog:

> Qobuz recently updated their Web Player to version 7.2.0-b082e and this version
> now uses a new AppId (app_id) and corresponding secret. Together with this
> change, Qobuz implemented a change so that **logging into an app with a given
> AppId, generates a User Auth Token that only works in combination with that
> specific App's values.**

**A `user_auth_token` is bound to the `app_id` that minted it.** So a token
lifted from `play.qobuz.com` will *not* work against openMemo's `712109809`.
The token, the app_id and the secret are one matched set.

Design consequence: **do not hardcode the app_id for the download path.** Store
`{app_id, secret, token}` together as a captured credential set, and tell the
user to take the token from `open.qobuz.com` specifically — the same app whose
pair openMemo scrapes.

#### Correction: email + password is dead

Offered as an option in the previous pass. It no longer works, and has not since
April 2026:

| Source | Date | State |
|---|---|---|
| streamrip [#954](https://github.com/nathom/streamrip/issues/954) | 2026-04-03 | **open** — `user/login` → `401 User authentication is required` with valid credentials |
| streamrip [#956](https://github.com/nathom/streamrip/issues/956) | 2026-04-05 | open, duplicate of #954 |
| streamrip [#854](https://github.com/nathom/streamrip/issues/854) | 2025-05-24 | Qobuz moved to a token login method |
| qobuz-dl [#328](https://github.com/vitiko98/qobuz-dl/issues/328), [#329](https://github.com/vitiko98/qobuz-dl/issues/329) | 2026-04 | same failure, independently |

Reported on #954 by a user who resolved it (2026-04-03):

> Don't use email/pw to login. Login with Qobuz token works.

And the maintainer's fix branch replaced the password flow with *"automatic
Qobuz token capture in a managed browser"*. Even streamrip now captures a token
from a browser session rather than logging in over the API.

Confirmed independently here: `user/login` with invalid credentials answers
`401 Invalid username/email and password combination` — the endpoint is alive,
so the April 2026 failure is Qobuz refusing the *flow*, not the endpoint being
gone.

**Token paste is not the safer of two options. It is the only one that works.**

#### Reliability outlook — the honest trade

This surface moves, and it has moved three times in two years:

| When | What broke |
|---|---|
| Oct 2024 | Web Player 7.2.0 rotated app_id + secret; tokens became app-bound |
| May 2025 | Qobuz switched to a token login method |
| Apr 2026 | `user/login` started rejecting valid credentials; cloud migration also broke Qobuz's **own** apps ("official Apps can't search, download or play many tracks") |

So the choice is not "direct is strictly better". It is:

- **Relay** — someone else absorbs every rotation, at the cost of a third-party
  dependency, a 6-hour session, 503s, and your track ids leaving the machine.
- **Direct** — no dependency and no privacy leak, but **you own the maintenance**
  the next time Qobuz moves.

openMemo's `open.qobuz.com` pair is the more stable of the two known paths and
signs `getFileUrl` successfully today. That is a real advantage, not a
guarantee. Keeping the relay as fallback is what makes direct safe to ship.

#### Ban risk

No credible evidence found of Qobuz terminating accounts over third-party API
use. Searches surfaced license revocations on *purchased* downloads and a
crackdown on AI-generated *uploads* — both unrelated. Absence of evidence is not
safety, and it is your own paid account carrying the risk.

#### Two things to decide with open eyes

- **Credential input mode.** Email + password (openMemo logs in, stores only the
  token) is friendlier. Pasting a `user_auth_token` from a browser session means
  openMemo never touches the password at all. The second is safer; the first is
  what people expect.
- **Terms.** A Qobuz *streaming* subscription does not grant download rights —
  `intent=stream` is for playback. Qobuz also *sells* downloads, and
  `intent=download` is the legitimate path for tracks the account has purchased.
  Worth knowing which one this is pointed at. Unusual API patterns can get an
  account flagged, and it is the user's own account at stake.

### Recommended shape: two tiers

Ship the custom-instance setting. openMemo becomes *capable* of independence for
anyone who wants it, the community relay stays the default so nothing breaks,
and the design matches upstream so the two stay compatible.

| Change | File | Size |
|---|---|---|
| `music_qobuz_url` setting (not a secret — plain settings, https-only) | `core/app_settings.py` | ~15 lines |
| Try custom instance first, fall back to relay | `core/spotiflac.py` `_community_flac_url` | ~30 lines |
| Probe route (`CheckCustomQobuzAPI` shape: known track id, expect `success` + `data.url`) | `api/settings.py` | ~25 lines |
| Settings row: URL field + Test button + status dot | `SettingsPage.tsx` | ~50 lines |

Both entry points are covered by the one branch, since `apple_music.py` imports
`_community_flac_url`.

One branch, and Apple + Spotify both gain independence.

### Worth doing regardless — port `scrapeQobuzOpenCredentials`

openMemo hardcodes `app_id=712109809` / `app_secret=589be88e…`. Upstream treats
those as a **fallback** and refreshes them daily: fetch
`https://open.qobuz.com/track/1`, find the `main.js` bundle, regex
`app_id:"(\d{9})",app_secret:"([a-f0-9]{32})"`, validate with a known-ISRC
search, cache 24h *(qobuz_api.go:127–196, 302–350)*.

When Qobuz rotates those, upstream self-heals and openMemo's metadata search
breaks with no recovery path. ~40 lines, no dependency on any of the above.

---

## Suggested order

1. Remove the dead `x-api-key` — one line, zero risk *(finding 1)*
2. Handle 401 like 428 *(finding 7)*
3. Port candidate scoring *(finding 8 — the one users actually feel)*
4. Port credential scraping — self-healing, independent of everything else
5. Custom-instance setting — the actual independence
6. Pin `callback_base` to the request host *(finding 4)*
7. Correct the `app_version` docstring and test comment *(finding 2)*
