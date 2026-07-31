# Keeping personal data out of GitHub

**Rule (mandatory): no personal data — cookies, sessions, passwords, tokens,
databases — ever reaches the public GitHub repo.** Every commit is combed
through automatically; the rule is enforced, not just documented.

## What counts as personal data here

- The cookie / session jar: `data/yt_cookies.txt` (Instagram + yt-dlp session).
- The app settings JSON: `data/app_settings.json` (Telegram bot token, allowed
  user id, hidden passcode).
- The database: `data/openmemo.db` (all your memos).
- Anything else under `data/` or `files/`, `.env`, `secrets/`.

## Two layers of protection

### 1. `.gitignore` (already in place)
`data/`, `files/`, `*.db`, `yt_cookies.txt`, `.env`, `secrets/` are ignored, so
these files are never staged in normal use.

### 2. The pre-commit comb-through (enforcement)
`scripts/check_secrets.py` runs on **every commit** via `.githooks/pre-commit`
and **blocks** the commit if it finds:
- a forbidden path staged (a cookie jar, `*.db`, `app_settings.json`, anything
  under `data/`, `.env`, `secrets/`) — catches a `git add -f` mistake that
  bypasses `.gitignore`;
- a high-confidence secret signature in staged content (a private key, a
  Netscape cookie-jar header, an Instagram session cookie line, a Telegram bot
  token, an AWS key).

Enable the hook once per clone:

```bash
git config core.hooksPath .githooks
```

## Before every merge to `main`

Run a full audit over everything tracked (not just this commit):

```bash
python scripts/check_secrets.py --all
```

It must print `Secret check clean`. Also sanity-check by hand:

```bash
git ls-files | grep -iE "cookie|\.db$|app_settings|\.env$|secret|session" 
```

The only matches should be **code and docs** (e.g. `app_settings.py`,
`instagram_login.py`, this file) — never an actual cookie jar, database, or
settings file. If a real secret file shows up, it was force-added: remove it with
`git rm --cached <file>` and re-run the audit.

## False positives

If the scanner flags a legitimate file (e.g. a new doc that describes these
patterns), add its path to `_ALLOW_PATHS` in `scripts/check_secrets.py`.
