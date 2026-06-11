# Plan 007: Failed memo embeddings are recorded and retryable instead of failing silently

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/api/ingest.py backend/api/memos.py backend/db/models.py backend/db/database.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (pairs well after 006)
- **Category**: bug
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

When embedding a memo fails (Ollama down, Chroma unreachable), the error is caught
and printed, the memo keeps `is_processed=False`, and **nothing tells the user or
retries**. The memo silently never appears in RAG/search and there is no recovery
short of editing it again. Separately, the two task-spawn sites use raw
`asyncio.create_task` whose exceptions vanish entirely. This plan records a
per-memo embed status, exposes a retry endpoint, and makes background dispatch
exception-safe.

## Current state

- `backend/api/ingest.py:184-210` — the embed task swallows failures:
  ```python
  # backend/api/ingest.py:184
  async def process_memo(memo_id: str):
      """Background task to embed memo content."""
      from backend.core.embedder import embed_memo
      async with AsyncSessionLocal() as db:
          memo = await db.get(Memo, memo_id)
          if not memo or not memo.content_text:
              return
          try:
              text_to_embed = memo.content_text
              if memo.notes:
                  text_to_embed += f"\n\n--- Notes ---\n{memo.notes}"
              chunk_ids = await embed_memo(memo_id=memo.id, text=text_to_embed, metadata={...})
              memo.embedding_ids = chunk_ids
              memo.is_processed = True
              memo.updated_at = datetime.utcnow()
              await db.commit()
          except Exception as e:
              print(f"Error processing memo {memo_id}: {e}")   # ← only signal
  ```
- Two fire-and-forget dispatch sites lose exceptions even before `process_memo`'s
  own try/except:
  ```python
  # backend/api/memos.py:604  (after editing memo content)
  asyncio.create_task(process_memo(memo_id))
  # backend/api/memos.py:723  (restore_memo)
  asyncio.create_task(process_memo(memo_id))
  ```
  (Ingest routes use FastAPI `BackgroundTasks`; these two use `create_task`.)
- `backend/db/models.py` — `Memo` has `is_processed` (bool) and `embedding_ids`.
  There is **no** field for an embed error/status yet.
- Migrations are manual, idempotent, in `backend/db/database.py:_run_migrations()`
  using `PRAGMA table_info(memos)` guards (see existing `notes`, `pinned`,
  `is_deleted` additions there for the exact pattern). CLAUDE.md: always check the
  column exists before `ALTER TABLE`.
- The list/detail API already returns `is_processed` (e.g. `backend/api/memos.py:209`).

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_embed_status.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/db/models.py` (add an `embed_status` column to `Memo`)
- `backend/db/database.py` (idempotent migration for the new column)
- `backend/api/ingest.py` (`process_memo` records status; add a safe dispatch helper)
- `backend/api/memos.py` (use the safe dispatch helper; add a retry endpoint;
  expose `embed_status` in responses)
- `backend/tests/test_embed_status.py` (create)

**Out of scope**:
- `backend/core/embedder.py` — do not change embedding internals; treat `embed_memo`
  as a black box that may raise.
- ChromaDB client code.
- Frontend — surfacing the status/retry button in UI is a follow-up (note it).

## Git workflow

- Branch: `advisor/007-surface-and-retry-embed-failures`
- Commit per logical unit (model+migration, then task logic, then endpoint+tests)
  or one cohesive commit. Conventional style:
  `fix(ingest): record embed failures and add a retry path instead of silent drops`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add an `embed_status` column to the Memo model

In `backend/db/models.py`, add to `Memo` a nullable string column:

```python
# "" / None = never attempted; "ok" = embedded; "error" = last attempt failed
embed_status: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
```

Match the exact `Mapped[...]`/`mapped_column(...)` style already used by
neighboring columns in the file (read two or three existing column definitions and
copy their form — do not introduce a different declaration style).

**Verify**: `grep -n "embed_status" backend/db/models.py` → shows the column.

### Step 2: Idempotent migration

In `backend/db/database.py` `_run_migrations()`, add, following the existing
guarded pattern:

```python
if "embed_status" not in columns:
    await db.execute("ALTER TABLE memos ADD COLUMN embed_status TEXT")
    await db.commit()
```

(`columns` is already computed from `PRAGMA table_info(memos)` at the top of that
function — reuse it; do not re-query.)

**Verify**: `python -c "from backend.main import app; print('OK')"` → `OK`
(running the app triggers `init_db` → migrations on a real boot; the import smoke
at least confirms no syntax error).

### Step 3: Record success/failure in `process_memo`

Rewrite the try/except so the failure path persists `embed_status="error"` and the
success path sets `embed_status="ok"` alongside `is_processed=True`:

```python
try:
    ...
    chunk_ids = await embed_memo(...)
    memo.embedding_ids = chunk_ids
    memo.is_processed = True
    memo.embed_status = "ok"
    memo.updated_at = datetime.utcnow()
    await db.commit()
except Exception as e:
    print(f"Error processing memo {memo_id}: {e}")
    memo.embed_status = "error"
    memo.updated_at = datetime.utcnow()
    await db.commit()        # persist the error state so the UI/retry can see it
```

**Verify**: `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 4: Make background dispatch exception-safe and unified

Add a small helper in `backend/api/ingest.py` and use it at both `memos.py` call
sites so a task that raises before/around `process_memo` cannot vanish:

```python
def schedule_processing(memo_id: str) -> None:
    """Fire-and-forget embed with a done-callback so exceptions are logged,
    not swallowed by the event loop."""
    task = asyncio.create_task(process_memo(memo_id))
    def _log(t: asyncio.Task) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc:
            print(f"process_memo task failed for {memo_id}: {exc!r}")
    task.add_done_callback(_log)
```

Replace `asyncio.create_task(process_memo(memo_id))` at `backend/api/memos.py:604`
and `:723` with `schedule_processing(memo_id)` (import it from
`backend.api.ingest`). Keep `process_memo` itself unchanged in signature.

**Verify**: `grep -n "asyncio.create_task(process_memo" backend/api/memos.py` →
returns nothing; `grep -n "schedule_processing" backend/api/memos.py` → 2 call sites.

### Step 5: Add a retry endpoint

In `backend/api/memos.py`, add a route that re-runs embedding for a memo whose last
attempt failed:

```python
@router.post("/{memo_id}/reembed")
async def reembed_memo(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Re-run embedding for a memo (e.g. after Ollama was down)."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if not memo.content_text:
        raise HTTPException(status_code=400, detail="Memo has no content to embed")
    from backend.api.ingest import schedule_processing
    schedule_processing(memo_id)
    return {"status": "scheduled", "memo_id": memo_id}
```

Also add `"embed_status": memo.embed_status` (and the same in the list payload at
`backend/api/memos.py:~209`) so clients can see the state. Read the surrounding
dict to place the key consistently with the others.

**Verify**: `grep -n "reembed\|embed_status" backend/api/memos.py` → shows the
endpoint and the two response keys. `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 6: Tests

Create `backend/tests/test_embed_status.py`. Use the TestClient pattern from
`backend/tests/test_smoke.py` and monkeypatch `embed_memo` to control success vs
failure:

- **Failure path**: monkeypatch `backend.core.embedder.embed_memo` to raise; call
  `process_memo(memo_id)` for a memo with content; assert the memo row ends with
  `embed_status == "error"` and `is_processed` still falsy.
- **Success path**: monkeypatch `embed_memo` to return `["c1","c2"]`; after
  `process_memo`, assert `embed_status == "ok"`, `is_processed` truthy,
  `embedding_ids == ["c1","c2"]`.
- **Retry endpoint**: `POST /api/memos/{id}/reembed` on a content-bearing memo →
  200 `{"status":"scheduled"}`; on a missing memo → 404.

Creating a memo row in the test: reuse whatever fixture/helper `conftest.py`
provides for a DB session/memo; if none exists, insert a minimal `Memo` via the
async session the conftest exposes. Read `conftest.py` first.

**Verify**: `pytest backend/tests/test_embed_status.py -v` → pass.

### Step 7: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_embed_status.py` covering failure→`error`,
  success→`ok`, and the retry endpoint (200 + 404).
- Model structure on `backend/tests/test_smoke.py` + `conftest.py` fixtures.
- Verification: `pytest backend/tests/` → all pass.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `pytest backend/tests/` exits 0; `test_embed_status.py` passes
- [ ] `grep -n "asyncio.create_task(process_memo" backend/api/memos.py` returns nothing
- [ ] `embed_status` appears in the Memo model, the migration, and both list+detail responses
- [ ] `POST /api/memos/{id}/reembed` exists and returns 404 for unknown ids
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `process_memo` no longer matches the excerpt (already refactored).
- The Memo model uses a declaration style you can't safely match — report it.
- `conftest.py` offers no way to create/inspect a memo row and building one is
  non-trivial — report so the test approach can be decided.
- `embed_memo`'s signature differs from `embed_memo(memo_id=..., text=..., metadata=...)`.

## Maintenance notes

- **Follow-up (frontend, deferred)**: surface `embed_status === "error"` in the UI
  with a "Retry" button calling `POST /api/memos/{id}/reembed`. Out of scope here.
- A periodic sweep could auto-reembed `embed_status == "error"` memos when Ollama
  comes back; consider after this lands.
- Reviewer should confirm the failure path actually commits the `"error"` state
  (the bug was precisely that nothing was persisted).
- Pairs with `plans/009` (ghost vectors) — both concern DB/Chroma consistency.
