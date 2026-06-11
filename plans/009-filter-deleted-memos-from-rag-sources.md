# Plan 009: RAG never cites soft-deleted memos, even when a Chroma purge failed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/core/rag.py backend/api/memos.py backend/api/search.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (complements 007)
- **Category**: bug
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

Deleting a memo marks `is_deleted=True` first, then purges its Chroma embeddings;
a purge failure is only printed, and the only re-sync is a manual reindex endpoint.
Meanwhile `rag_chat` builds its source list straight from Chroma metadata with no
`is_deleted` check. So a failed purge leaves "ghost" vectors that Ask Memo will
retrieve and cite, and clicking the citation 404s. `search.py` already filters
deleted rows when it hydrates results; RAG must do the same. Cheap, defensive fix.

## Current state

- Delete path prints on purge failure and relies on a manual sweep:
  ```python
  # backend/api/memos.py (delete_memo)
  memo.is_deleted = True
  memo.deleted_at = datetime.utcnow()
  await db.commit()
  try:
      from backend.core.embedder import delete_memo_embeddings
      await delete_memo_embeddings(memo_id)
  except Exception as e:
      print(f"Embedding purge failed for {memo_id}: {e}")   # ← ghost left behind
  ```
- The reindex that would clean ghosts is **manual only**:
  `@router.post("/reindex")` in `backend/api/maintenance.py:116`.
- `rag_chat` hydrates sources from Chroma metadata with NO liveness check:
  ```python
  # backend/core/rag.py:63-80
  sources = await search_similar(query=query, workspace_id=..., collection_id=..., memo_id=...)
  yield {
      "type": "sources",
      "data": [
          {
              "memo_id": s["metadata"].get("memo_id"),
              "title": s["metadata"].get("title", "Untitled"),
              "domain": s["metadata"].get("source_domain", ""),
              "snippet": s["document"][:200],
              "distance": s["distance"],
          }
          for s in sources           # ← may include deleted memos
      ],
  }
  ...
  if not sources:
      yield {"type": "token", "data": NO_CONTEXT_MESSAGE}
      return
  context = build_context_prompt(sources)
  ```
- Contrast: `backend/api/search.py` filters `Memo.is_deleted == False` when it
  loads rows for both the semantic and FTS branches (e.g. the
  `select(Memo).where(Memo.id.in_(...), Memo.is_deleted == False)` calls). RAG is
  the one retrieval path that doesn't.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_rag_excludes_deleted.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/core/rag.py` (filter retrieved sources against live memo rows)
- `backend/tests/test_rag_excludes_deleted.py` (create)

**Out of scope**:
- `backend/api/memos.py` delete path — leave the purge as best-effort; this plan
  defends the *read* side. (Making delete transactional is a separate concern.)
- `backend/core/embedder.py` / `search_similar` internals.
- `backend/api/search.py` — already correct; do not touch.

## Git workflow

- Branch: `advisor/009-filter-deleted-memos-from-rag-sources`
- One commit, conventional style:
  `fix(rag): drop soft-deleted memos from retrieved sources so Ask Memo can't cite ghosts`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Filter retrieved sources by live (non-deleted) memo ids

In `rag_chat` (`backend/core/rag.py`), after `sources = await search_similar(...)`
and before yielding/`build_context_prompt`, drop any source whose `memo_id` is
absent or belongs to a deleted memo. Query the DB once for the set of live ids
among the retrieved ones:

```python
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo
from sqlalchemy import select

retrieved_ids = {s["metadata"].get("memo_id") for s in sources if s["metadata"].get("memo_id")}
if retrieved_ids:
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(Memo.id).where(
                Memo.id.in_(retrieved_ids),
                (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
            )
        )
        live_ids = {r[0] for r in rows}
    sources = [s for s in sources if s["metadata"].get("memo_id") in live_ids]
```

Place this so that the existing `if not sources:` short-circuit (which yields
`NO_CONTEXT_MESSAGE`) still runs *after* filtering — i.e. if filtering empties the
list, the user gets the honest "no context" reply instead of a cited ghost. Read
the surrounding lines and insert the filter immediately after `search_similar`
returns, before the `sources`-is-used block.

Match the existing deleted-filter idiom used in `backend/api/memos.py:list_memos`
(`(Memo.is_deleted == False) | (Memo.is_deleted == None)`) so NULL legacy rows are
treated as live.

**Verify**: `grep -n "is_deleted" backend/core/rag.py` → shows the new filter.
`python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 2: Test that deleted memos are excluded from RAG sources

Create `backend/tests/test_rag_excludes_deleted.py`. Monkeypatch
`backend.core.rag.search_similar` to return a fixed list of fake Chroma hits (two
memo ids), insert two memo rows where one is `is_deleted=True`, then drive
`rag_chat` and assert the `sources` event only contains the live memo id.

- Patch `search_similar` to return
  `[{"metadata":{"memo_id":"live"},"document":"...","distance":0.1},
    {"metadata":{"memo_id":"gone"},"document":"...","distance":0.2}]`.
- Insert `Memo(id="live", is_deleted=False, ...)` and `Memo(id="gone", is_deleted=True, ...)`
  via the conftest DB session.
- Also patch `ollama_client.chat` (or whatever `rag_chat` streams from) to a
  trivial async generator so no Ollama call happens — read `rag.py` to see the
  exact symbol to patch for token streaming.
- Iterate `rag_chat(...)`, capture the `sources` event, assert its ids == `{"live"}`.

Read `backend/tests/conftest.py` for DB fixtures and async mode first.

**Verify**: `pytest backend/tests/test_rag_excludes_deleted.py -v` → pass.

### Step 3: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_rag_excludes_deleted.py`: a deleted memo present in
  Chroma results is filtered out of the `sources` event; a live one survives.
- `search_similar` and the token-stream source are monkeypatched — no network.
- Verification: `pytest backend/tests/` → all pass.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `pytest backend/tests/` exits 0; `test_rag_excludes_deleted.py` passes
- [ ] `grep -n "is_deleted" backend/core/rag.py` shows the filter
- [ ] When filtering empties sources, the existing `NO_CONTEXT_MESSAGE` path still fires
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `rag_chat` no longer matches the excerpt (already refactored).
- You cannot identify the exact symbol `rag_chat` uses to stream tokens (to patch
  in the test) — report rather than guessing and hitting a real Ollama.
- The conftest provides no way to insert memo rows — report so the test approach
  can be decided.

## Maintenance notes

- This is the read-side defense. The write-side root cause (a purge that fails
  silently) is still real; `plans/007` adds embed-status plumbing and a periodic
  sweep could also re-purge. Track making delete fully transactional as a
  follow-up if ghost vectors keep appearing.
- One extra DB round-trip per RAG query. Negligible for a local single-user app;
  note it in case retrieval is ever batched/optimized.
- Reviewer should confirm NULL `is_deleted` legacy rows are treated as live (the
  `== None` branch), matching `list_memos`.
