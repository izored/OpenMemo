# Plan 003: The image-proxy endpoint validates URLs through `validate_url` to close the SSRF hole

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/main.py backend/core/security/sanitize.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

`GET /api/proxy/image` fetches an arbitrary user-supplied URL server-side with
redirects enabled, and only checks `url.startswith("http")`. That lets a caller
make the backend fetch internal addresses it could not reach directly
(`http://127.0.0.1:11434` Ollama, the LAN router admin page, cloud metadata
endpoints), and the result can be cached to disk — server-side request forgery.
The ingest path already routes user URLs through `validate_url`; this endpoint
skips it. The fix is to call the existing validator (and harden it for private
hosts).

## Current state

- `backend/main.py:293-341` — the endpoint:
  ```python
  # backend/main.py:293-302
  @app.get("/api/proxy/image")
  async def proxy_image(url: str, memo_id: str | None = None):
      """Proxy a remote image with browser headers to bypass hotlink protection.
      Optionally caches the result and updates the memo's thumbnail_path."""
      import httpx
      from starlette.responses import StreamingResponse
      from backend.api.ingest import _download_thumb, _thumb_headers, THUMBS_DIR

      if not url.startswith("http"):           # ← only check today
          raise HTTPException(status_code=400, detail="Invalid URL")
      ...
      # later: httpx.AsyncClient(timeout=15, follow_redirects=True, ...).get(url)
  ```
- `backend/core/security/sanitize.py:119-145` — the validator already used by
  ingest. It enforces http/https scheme + a netloc, but its private-IP block is a
  **no-op today** (comment says "kept simple for local-first app"):
  ```python
  # backend/core/security/sanitize.py:142-145
      # Reject localhost / private IPs in production
      # (kept simple for local-first app; can be tightened later)

      return url
  ```
  `validate_url` is exported from `backend/core/security/__init__.py` and raises
  `HTTPException(status_code=400, ...)` on bad input.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_proxy_image_ssrf.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/main.py` (the `proxy_image` endpoint only)
- `backend/core/security/sanitize.py` (implement the private-host block in `validate_url`)
- `backend/tests/test_proxy_image_ssrf.py` (create)

**Out of scope**:
- Any other route in `main.py`.
- `backend/api/ingest.py` — it already calls `validate_url`; do not change it
  (the hardened `validate_url` benefits it for free).
- The thumbnail caching / `_download_thumb` internals.

## Git workflow

- Branch: `advisor/003-fix-proxy-image-ssrf`
- One commit, conventional style:
  `fix(security): validate proxy/image URLs and block private hosts (SSRF)`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Route the proxy URL through `validate_url`

In `proxy_image`, replace the weak `if not url.startswith("http")` check with a
call to the shared validator. Add the import at the top of the function's imports
block:

```python
from backend.core.security import validate_url
...
url = validate_url(url)   # raises HTTPException(400) on bad scheme / missing host / private target
```

This replaces (does not supplement) the `startswith("http")` line. Keep the rest
of the function unchanged.

**Verify**: `grep -n "validate_url\|startswith(\"http\")" backend/main.py` →
shows the `validate_url(url)` call inside `proxy_image` and the old `startswith`
check removed. `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 2: Implement the private-host block in `validate_url`

Make the empty "reject localhost / private IPs" comment real. After the netloc
check in `validate_url`, resolve the host and reject loopback / private / link-local
/ reserved targets. Use the stdlib only:

```python
import ipaddress, socket
...
host = parsed.hostname or ""
# Block obvious local names outright.
if host in {"localhost", "0.0.0.0"} or host.endswith(".local"):
    raise HTTPException(status_code=400, detail="URL host is not allowed")
# Resolve and reject private / loopback / link-local / reserved IPs.
try:
    infos = socket.getaddrinfo(host, None)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(status_code=400, detail="URL host is not allowed")
except socket.gaierror:
    raise HTTPException(status_code=400, detail="URL host could not be resolved")
```

Place this guard so it runs for every `validate_url` caller. Keep imports at the
top of `sanitize.py` (add `ipaddress` and `socket` if not already imported — grep
first).

**Important caveat to note in the commit body, not to fix here**: this validates
the host at check time; a server that returns a redirect to a private address can
still bypass it because `proxy_image` uses `follow_redirects=True`. Mitigating
redirect-based SSRF fully is deferred (see Maintenance notes); this plan closes
the direct-URL hole, which is the reported finding.

**Verify**: `python -c "from backend.core.security import validate_url; validate_url('https://example.com')"` →
no error. `python -c "from backend.core.security import validate_url; validate_url('http://127.0.0.1:11434')"` →
raises (non-zero exit / traceback mentioning "not allowed").

### Step 3: Tests

Create `backend/tests/test_proxy_image_ssrf.py`. Unit-test `validate_url`
directly (no network needed):

- `validate_url("http://127.0.0.1:11434")` raises `HTTPException` (status 400).
- `validate_url("http://localhost/x")` raises.
- `validate_url("http://192.168.1.1/admin")` raises.
- `validate_url("https://example.com/pic.png")` returns the URL unchanged.
- `validate_url("file:///etc/passwd")` raises (scheme check, already present).

Use `pytest.raises(HTTPException)` — import it from `fastapi`. Model test layout
on `backend/tests/test_smoke.py`.

**Verify**: `pytest backend/tests/test_proxy_image_ssrf.py -v` → pass.

### Step 4: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_proxy_image_ssrf.py`.
- Cases: loopback, `localhost`, RFC1918 private, bad scheme all rejected; public
  https allowed. These lock in both the SSRF block and the existing scheme rules.
- Verification: `pytest backend/tests/` → all pass.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `grep -n "startswith(\"http\")" backend/main.py` no longer shows it inside `proxy_image`
- [ ] `validate_url("http://127.0.0.1:11434")` raises `HTTPException`
- [ ] `validate_url("https://example.com")` returns without error
- [ ] `pytest backend/tests/` exits 0; new SSRF tests pass
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `proxy_image` in `main.py` no longer matches the excerpt (already refactored).
- Hardening `validate_url` breaks existing tests that pass private URLs on
  purpose (`pytest backend/tests/` fails on a pre-existing test) — report which.
- `validate_url` is not exported from `backend/core/security/__init__.py`.

## Maintenance notes

- **Deferred, on purpose**: redirect-following SSRF. `proxy_image` uses
  `follow_redirects=True`; a public URL that 302s to `http://127.0.0.1` still
  reaches it. Closing that requires either disabling redirects or re-validating
  each hop's resolved address with a custom transport. Track as a follow-up.
- Hardening `validate_url` now affects every caller (ingest, headless). Reviewer
  should sanity-check that legitimate public ingestion still works (e.g. a normal
  article URL).
- There is a TOCTOU gap between resolving the host here and httpx resolving it at
  fetch time. For a single-user local app this is acceptable; note it so a future
  multi-user mode revisits it.
