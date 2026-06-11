# Plan 004: CORS no longer grants credentialed all-method access to every Chrome extension

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/main.py backend/config.py chrome-extension/manifest.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

The CORS middleware allows any origin matching `chrome-extension://.*` with
`allow_credentials=True`, `allow_methods=["*"]`, and `allow_headers=["*"]`. That
means *any* extension installed in the same browser can read and mutate the entire
memo store (no auth exists by design). On a single-user machine the likelihood is
low, but the blast radius is the whole database and the fix is cheap: scope the
allowed extension origin to this project's own extension ID instead of a wildcard.

## Current state

- `backend/main.py:191-199` — the middleware:
  ```python
  # backend/main.py:191-199
  app.add_middleware(
      CORSMiddleware,
      allow_origins=settings.CORS_ORIGINS,
      # Browser extension fetches originate from chrome-extension://<id>.
      allow_origin_regex=r"chrome-extension://.*",
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  ```
- `chrome-extension/manifest.json` — this project's extension. Its stable
  extension ID is what the regex should be pinned to. The ID is derivable from the
  manifest's `key` field if present; otherwise it is assigned by Chrome at load
  time and the developer must read it from `chrome://extensions`. **You cannot
  invent the ID.** See Step 1 for how to handle this.
- `backend/config.py` — `CORS_ORIGINS` is a pydantic setting (list or
  comma-separated string), so configuration is the natural home for an allowed
  extension ID.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| Inspect manifest | `grep -n "\"key\"\|\"name\"\|version" chrome-extension/manifest.json` | shows fields |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/main.py` (the `add_middleware(CORSMiddleware, ...)` call only)
- `backend/config.py` (add an `EXTENSION_ORIGIN`/`EXTENSION_ID` setting)
- `backend/.env.example` (document the new setting)

**Out of scope**:
- `allow_origins=settings.CORS_ORIGINS` for localhost dev — leave intact.
- The extension's own code (`chrome-extension/*.js`).
- Auth — out of scope by project design (single-user local).

## Git workflow

- Branch: `advisor/004-tighten-cors-extension-origin`
- One commit, conventional style:
  `fix(security): scope CORS extension origin instead of wildcarding all extensions`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a configurable extension origin setting

In `backend/config.py`, add a setting (place it near `CORS_ORIGINS`):

```python
# Exact origin of the OpenMemo browser extension, e.g.
# "chrome-extension://abcdefghijklmnopabcdefghijklmnop". Empty disables
# extension CORS entirely. Set this from chrome://extensions after loading.
EXTENSION_ORIGIN: str = ""
```

Document it in `backend/.env.example` with a commented example line and a one-line
note that the value comes from `chrome://extensions` (the extension's ID).

**Verify**: `python -c "from backend.config import settings; print(repr(settings.EXTENSION_ORIGIN))"` →
prints `''` (default).

### Step 2: Use the scoped origin in the middleware

Replace the wildcard regex with a build that prefers the explicit origin and only
falls back to the wildcard when no ID is configured (so existing local setups keep
working until they set the ID). Target shape:

```python
_cors_origins = list(settings.CORS_ORIGINS)
if settings.EXTENSION_ORIGIN:
    _cors_origins.append(settings.EXTENSION_ORIGIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # Only fall back to the broad extension regex when no explicit extension
    # origin is configured. Set EXTENSION_ORIGIN to lock this down.
    allow_origin_regex=None if settings.EXTENSION_ORIGIN else r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Note: `settings.CORS_ORIGINS` may be a comma-separated string per the repo's
parsing (see `backend/config.py` and CLAUDE.md). If it is already normalized to a
list elsewhere, mirror that; if it can be a string here, split it the same way the
existing code does. Read `config.py` to see whether a validator already coerces it
to a list — reuse that, do not duplicate parsing.

**Verify**: `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 3: Confirm behavior both ways

- With `EXTENSION_ORIGIN` unset (default): app still imports, wildcard regex
  active (no regression for current users).
- With `EXTENSION_ORIGIN="chrome-extension://test"` in the environment: import
  succeeds, regex is `None`.

**Verify**:
`python -c "import os; os.environ['EXTENSION_ORIGIN']='chrome-extension://test'; from backend.main import app; print('OK')"` → `OK`.

### Step 4: Backend tests

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- No new test file is strictly required (CORS config is hard to unit-test
  meaningfully without an integration harness), but ADD a smoke assertion to
  `backend/tests/test_smoke.py`-style coverage if a config test already exists:
  assert `hasattr(settings, "EXTENSION_ORIGIN")`. Keep it minimal.
- Verification: `pytest backend/tests/` → all pass.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `settings.EXTENSION_ORIGIN` exists and defaults to `""`
- [ ] `backend/.env.example` documents `EXTENSION_ORIGIN`
- [ ] With `EXTENSION_ORIGIN` set, `allow_origin_regex` resolves to `None` (verified by reading the code path)
- [ ] `pytest backend/tests/` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The `add_middleware(CORSMiddleware, ...)` block no longer matches the excerpt.
- `CORS_ORIGINS` parsing is more complex than a list/CSV and reusing it cleanly is
  unclear — report what you found.
- You cannot determine whether `CORS_ORIGINS` arrives as a list or string at the
  middleware call site — report rather than guessing.

## Maintenance notes

- The real lockdown requires the operator to set `EXTENSION_ORIGIN` to the actual
  extension ID. The plan ships a safe-by-default *mechanism*; document in the
  release notes that users should set it.
- If the extension is ever published to the Chrome Web Store, its ID becomes
  stable and should be baked into `.env.example` as the recommended value.
- Reviewer should confirm localhost dev origins in `CORS_ORIGINS` still work
  (the appended extension origin must not replace them).
