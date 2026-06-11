# Plan 001: Full-text search uses the real FTS5 ranker instead of silently falling back to substring matching

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/db/fts5.py backend/core/security/sanitize.py backend/api/search.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

`search_fts5()` in `backend/db/fts5.py` calls a function named `escape_fts5_query`
that is **not imported and not defined in that module**. The only escaper defined
there is `_escape_fts5`. Every FTS5 search raises `NameError`, which is swallowed
by a broad `except Exception` in `backend/api/search.py`, so hybrid search
silently degrades to a slow `ILIKE '%term%'` substring scan with no ranking. The
FTS5 ranked path has never actually run in production. One-identifier fix restores
real full-text ranking.

## Current state

- `backend/db/fts5.py` — FTS5 helpers. Imports at the top do NOT include any
  escaper:
  ```python
  # backend/db/fts5.py:1-4
  """SQLite FTS5 full-text search helpers."""
  import asyncio
  from sqlalchemy import text
  from backend.db.database import AsyncSessionLocal, engine
  ```
  A local escaper is defined:
  ```python
  # backend/db/fts5.py:54
  def _escape_fts5(query: str) -> str:
      """Escape FTS5 special characters and wrap terms in quotes for literal matching."""
      query = re.sub(r'["*\-\(\)]', ' ', query)
      query = re.sub(r'\s+', ' ', query).strip()
      if not query:
          return ""
      terms = query.split()
      return " ".join(f'"{term}"' for term in terms)
  ```
  But the search function calls an undefined name:
  ```python
  # backend/db/fts5.py:67-71
  async def search_fts5(query: str, workspace_id: str, limit: int = 20) -> list[dict]:
      """Search memos using FTS5. Returns list of {memo_id, rank}."""
      escaped = escape_fts5_query(query)   # ← NameError: not defined, not imported
      if not escaped:
          return []
  ```

- `backend/core/security/sanitize.py:94` — a **canonical** `escape_fts5_query` already
  exists and is exported from `backend/core/security/__init__.py` (`__all__`
  lists `escape_fts5_query`). It is functionally equivalent to `_escape_fts5`
  (strips FTS5 control chars, normalizes whitespace, wraps each term in quotes):
  ```python
  # backend/core/security/sanitize.py:94-111
  def escape_fts5_query(query: str) -> str:
      """Escape FTS5 special characters and wrap terms in quotes for literal matching."""
      if not query or not query.strip():
          return ""
      query = _FTS5_SPECIAL_CHARS_RE.sub(" ", query)
      query = re.sub(r"\s+", " ", query).strip()
      if not query:
          return ""
      terms = query.split()
      return " ".join(f'"{term}"' for term in terms)
  ```

- `backend/api/search.py:10` already imports `from backend.db.fts5 import search_fts5`
  and calls it at line 66 inside a `try/except Exception` (line 115) that prints
  `Full-text search error: {e}` and falls back to `ILIKE`. This is why the bug
  is invisible: the NameError is caught and printed, not surfaced.

**Decision**: reuse the canonical, already-tested `escape_fts5_query` from the
security module rather than the duplicate `_escape_fts5`. This both fixes the bug
and removes a divergent copy.

## Commands you will need

| Purpose | Command (run from project root) | Expected on success |
|---------|--------------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK`, exit 0 |
| Backend tests | `pytest backend/tests/` | all pass, exit 0 |
| New test only | `pytest backend/tests/test_fts5_escape.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope** (the only files you should modify):
- `backend/db/fts5.py`
- `backend/tests/test_fts5_escape.py` (create)

**Out of scope** (do NOT touch):
- `backend/core/security/sanitize.py` — the canonical escaper is correct; do not edit it.
- `backend/api/search.py` — the fallback `try/except` stays; we are fixing the FTS5 path, not the fallback.
- The FTS5 table/trigger DDL in `fts5.py:7-48` — unrelated and working.

## Git workflow

- Branch: `advisor/001-fix-fts5-undefined-function`
- One commit. Conventional-commit style matching repo `git log` (e.g.
  `fix(search): call the real FTS5 escaper instead of an undefined name`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Import the canonical escaper and use it

In `backend/db/fts5.py`, add the import near the top imports (after the existing
`from backend.db.database import ...` line):

```python
from backend.core.security import escape_fts5_query
```

The call at line 69 (`escaped = escape_fts5_query(query)`) now resolves to the
imported function — no other change to `search_fts5` needed.

Then delete the now-unused duplicate `_escape_fts5` function (lines 54–64) and
its lone `import re` at line 51 **only if `re` is not used elsewhere in the file**
(grep first — see verify).

**Verify**:
- `grep -n "escape_fts5_query\|_escape_fts5\|import re" backend/db/fts5.py` →
  shows the new import and the call; shows NO remaining `_escape_fts5` definition;
  shows `import re` removed **only if** the next grep is empty.
- `grep -n "re\." backend/db/fts5.py` → if this returns matches, KEEP `import re`.
- `python -c "from backend.main import app; print('OK')"` → prints `OK`.

### Step 2: Add a regression test for the escaper wiring

Create `backend/tests/test_fts5_escape.py`. Model its structure on the existing
`backend/tests/test_smoke.py` (same import style, plain `def` tests, no DB needed
for the escape test). The test must prove the name resolves and behaves:

```python
from backend.db import fts5
from backend.core.security import escape_fts5_query


def test_search_fts5_uses_the_imported_escaper():
    # Regression: fts5.search_fts5 referenced an undefined `escape_fts5_query`.
    # The name must now resolve to the canonical escaper.
    assert fts5.escape_fts5_query is escape_fts5_query


def test_escaper_wraps_terms_and_strips_control_chars():
    assert escape_fts5_query("hello world") == '"hello" "world"'
    assert escape_fts5_query("") == ""
    # FTS5 control characters must not leak through into a MATCH expression.
    out = escape_fts5_query('foo* "bar"')
    assert "*" not in out
```

**Verify**: `pytest backend/tests/test_fts5_escape.py -v` → all tests pass.

### Step 3: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_fts5_escape.py`, structured like
  `backend/tests/test_smoke.py`.
- Cases: (1) `fts5.escape_fts5_query` is the canonical function (the exact
  regression — proves the NameError can't recur); (2) escaper wraps terms and
  strips control characters.
- Verification: `pytest backend/tests/` → all pass including the 2+ new tests.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `pytest backend/tests/` exits 0; `test_fts5_escape.py` exists and passes
- [ ] `grep -n "def _escape_fts5" backend/db/fts5.py` returns nothing
- [ ] `grep -n "from backend.core.security import escape_fts5_query" backend/db/fts5.py` returns the import
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `fts5.py` no longer contains `escaped = escape_fts5_query(query)` at/near line 69
  (the code drifted — someone may have already fixed this differently).
- `escape_fts5_query` is missing from `backend/core/security/__init__.py`'s exports.
- Removing `_escape_fts5` breaks an import elsewhere
  (`grep -rn "_escape_fts5" backend/` returns hits outside `fts5.py`).

## Maintenance notes

- There are now two escapers no longer (the duplicate is gone). If FTS5 syntax
  needs change, edit only `backend/core/security/sanitize.py`.
- Reviewer should confirm the `import re` decision in Step 1 was made by the grep,
  not by guessing.
- Follow-up deferred: the broad `except Exception: print(...)` in
  `backend/api/search.py` still hides errors. That observability gap is real but
  out of scope here — it belongs with a structured-logging pass.
