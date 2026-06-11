# Plan 012: The memo list endpoint truncates content in SQL instead of fetching full text per row

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/api/memos.py`
> If `backend/api/memos.py` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

`GET /api/memos` loads the full `content_text` for every row via `load_only`, then
throws away all but the first 400 chars in Python (`m.content_text[:400]`). For a
large library each paginated page pulls megabytes of article/transcript text out of
SQLite only to discard ~99% of it, inflating query time, memory, and response size.
Truncating in SQL (or only fetching a preview column) keeps the list endpoint
lean. Pure efficiency, no behavior change to clients.

## Current state

`frontend`-facing list endpoint `list_memos` in `backend/api/memos.py`:

```python
# backend/api/memos.py:114-127 — query loads the full content_text column
query = select(Memo).options(
    load_only(
        Memo.id, Memo.type, Memo.title, Memo.description, Memo.content_text,  # ← full text
        Memo.source_url, Memo.source_domain, Memo.source_favicon,
        Memo.thumbnail_path, Memo.file_path, Memo.ai_summary, Memo.notes,
        Memo.sort_order, Memo.pinned, Memo.hidden, Memo.audio_kind,
        Memo.audio_artist, Memo.is_processed,
        Memo.created_at, Memo.updated_at, Memo.recency_at,
    ),
    selectinload(Memo.collections),
    selectinload(Memo.tags),
)
...
# backend/api/memos.py:196 — truncated in Python after the full fetch
"content_text": (m.content_text[:400] if m.content_text else None),
```

The single-memo endpoint `GET /api/memos/{memo_id}` (a few lines below, around
line 230) is the one that returns full content and must stay unchanged.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_list_content_preview.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/api/memos.py` — the `list_memos` query + its response dict only
- `backend/tests/test_list_content_preview.py` (create)

**Out of scope**:
- `GET /api/memos/{memo_id}` (the detail endpoint) — must keep returning full `content_text`.
- The response **shape**: the `content_text` key in the list response must remain a
  string truncated to ≤400 chars (clients depend on it). We change how it's
  produced, not what it looks like.
- Search endpoints.

## Git workflow

- Branch: `advisor/012-truncate-list-content-in-sql`
- One commit, conventional style:
  `perf(memos): truncate list content_text in SQL instead of fetching it whole`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the full-column load with a SQL-truncated preview

In `list_memos`, stop loading the full `content_text` column. Two acceptable
approaches — prefer (A) for the smallest diff:

**(A) Add a computed preview column to the select, drop `content_text` from `load_only`.**
Use SQLAlchemy `func.substr`:

```python
from sqlalchemy import func   # confirm it's imported; it is used elsewhere in this file

content_preview = func.substr(Memo.content_text, 1, 400).label("content_preview")

query = select(Memo, content_preview).options(
    load_only(
        Memo.id, Memo.type, Memo.title, Memo.description,   # content_text removed
        Memo.source_url, Memo.source_domain, Memo.source_favicon,
        Memo.thumbnail_path, Memo.file_path, Memo.ai_summary, Memo.notes,
        Memo.sort_order, Memo.pinned, Memo.hidden, Memo.audio_kind,
        Memo.audio_artist, Memo.is_processed,
        Memo.created_at, Memo.updated_at, Memo.recency_at,
    ),
    selectinload(Memo.collections),
    selectinload(Memo.tags),
)
```

Because the select now returns `(Memo, preview)` rows, the result iteration
changes from `memos = result.scalars().all()` to iterating tuples. Update the
count and fetch logic accordingly: the existing `count_query` uses
`query.subquery()` — confirm it still works with the extra column (it should,
since count wraps a subquery), and change the row loop to unpack `(m, preview)`.
The response line becomes:

```python
"content_text": preview,    # already ≤400 chars from SQL, may be None
```

**(B)** If mixing entity + scalar columns complicates the `selectinload`/sort code
too much, the simpler fallback: keep `load_only` WITHOUT `content_text`, and set
`"content_text": None` in the list payload, fetching previews lazily is NOT
desired — so only choose (B) if the team is fine dropping the inline preview.
**Default to (A).**

Read the surrounding `_apply_sort(query)`, `count_query`, and the `for m in memos`
loop carefully before editing — the sort helper appends `ORDER BY` and must still
apply to the augmented select.

**Verify**: `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 2: Test the preview is correct and capped

Create `backend/tests/test_list_content_preview.py`. Insert (via conftest DB
fixtures) a memo whose `content_text` is longer than 400 chars, call
`GET /api/memos` through the TestClient, and assert:
- the returned item's `content_text` is non-null,
- its length is ≤ 400,
- it equals the first 400 chars of the original content.

Also insert a memo with `content_text=None` and assert its list `content_text` is
`None` (no crash). Read `backend/tests/conftest.py` for fixtures first.

**Verify**: `pytest backend/tests/test_list_content_preview.py -v` → pass.

### Step 3: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_list_content_preview.py`: long content → ≤400-char
  preview equal to the head; null content → null preview.
- Verification: `pytest backend/tests/` → all pass.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `grep -n "content_text\[:400\]" backend/api/memos.py` returns nothing (Python truncation gone)
- [ ] `func.substr(Memo.content_text, 1, 400)` (or equivalent) is used in the list query
- [ ] `GET /api/memos/{memo_id}` still returns full `content_text` (unchanged)
- [ ] `pytest backend/tests/` exits 0; new test passes
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- Adding the scalar column breaks `_apply_sort`, the `count_query`, or the
  `selectinload` eager loads in a way that isn't a small mechanical fix — report
  and consider fallback (B).
- The list query no longer matches the excerpt (already refactored).
- The single-memo endpoint would have to change to keep the list working — that
  means the approach is wrong; report.

## Maintenance notes

- If more preview-only fields are added later (e.g. a description snippet), apply
  the same SQL-truncation approach rather than fetching full columns.
- Reviewer should confirm the detail endpoint still returns full content and that
  the list `content_text` value is still a ≤400-char string for existing clients.
- `func.substr` is SQLite-native; if the DB backend ever changes, revisit.
