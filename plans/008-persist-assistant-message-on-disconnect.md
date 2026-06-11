# Plan 008: A streamed chat answer is saved even when the client disconnects mid-stream

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/api/chat.py`
> If `backend/api/chat.py` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

The chat endpoint saves the assistant's message to the database only *after* the
entire token stream completes. If the client disconnects mid-stream (closed tab,
navigation, flaky network), the server cancels the generator and the save block
never runs — so the user's question is persisted but the answer is lost. On reload
the session shows a question with no reply, and the next turn's history is missing
that exchange. Saving whatever was generated (in a `finally`) makes chat history
durable.

## Current state

- `backend/api/chat.py:93-129` — the streaming generator accumulates the full
  response and saves only at the end:
  ```python
  # backend/api/chat.py:93-129
  async def event_stream():
      full_response = ""
      sources_data = None
      try:
          async for chunk in rag_chat(...):
              if chunk["type"] == "sources":
                  sources_data = chunk["data"]
                  yield f"data: {json.dumps({'type': 'sources', 'data': sources_data})}\n\n"
              elif chunk["type"] == "token":
                  full_response += chunk["data"]
                  yield f"data: {json.dumps({'type': 'token', 'data': chunk['data']})}\n\n"
      except Exception as e:
          yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
          return

      # Save assistant message  ← only reached if the stream finished cleanly
      async with (await _get_session()) as save_db:
          assistant_msg = Message(
              id=str(uuid.uuid4()),
              session_id=session_id,
              role="assistant",
              content=full_response,
              sources_json=sources_data,
          )
          save_db.add(assistant_msg)
          await save_db.commit()

      yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"
  ```
- `_get_session()` (`backend/api/chat.py:142`) returns a fresh `AsyncSessionLocal()`
  specifically for the post-stream save (the request-scoped `db` from `Depends`
  is gone by then).
- On client disconnect, Starlette throws `asyncio.CancelledError` *into* the
  generator at the `yield`, so neither the normal save nor the `except Exception`
  (CancelledError is not an `Exception` subclass in 3.12) runs. A `finally` does
  run during generator cleanup.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_chat_persist.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/api/chat.py` (the `event_stream` generator + its save logic)
- `backend/tests/test_chat_persist.py` (create)

**Out of scope**:
- `backend/core/rag.py` — the generator source; do not change it.
- The session/message schema in `backend/db/models.py`.
- Frontend chat code.

## Git workflow

- Branch: `advisor/008-persist-assistant-message-on-disconnect`
- One commit, conventional style:
  `fix(chat): persist the assistant reply even when the client disconnects mid-stream`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Move the save into a `finally` so partial answers are kept

Restructure `event_stream` so the assistant message is written in a `finally`
block that runs on normal completion, on error, and on cancellation. Guard against
saving an empty string (nothing generated). Target shape:

```python
async def event_stream():
    full_response = ""
    sources_data = None
    saved = False

    async def _persist():
        nonlocal saved
        if saved or not full_response.strip():
            return
        saved = True
        async with (await _get_session()) as save_db:
            save_db.add(Message(
                id=str(uuid.uuid4()),
                session_id=session_id,
                role="assistant",
                content=full_response,
                sources_json=sources_data,
            ))
            await save_db.commit()

    try:
        async for chunk in rag_chat(...):   # keep the existing args
            if chunk["type"] == "sources":
                sources_data = chunk["data"]
                yield f"data: {json.dumps({'type': 'sources', 'data': sources_data})}\n\n"
            elif chunk["type"] == "token":
                full_response += chunk["data"]
                yield f"data: {json.dumps({'type': 'token', 'data': chunk['data']})}\n\n"
        await _persist()
        yield f"data: {json.dumps({'type': 'done', 'session_id': session_id})}\n\n"
    except Exception as e:
        await _persist()   # save whatever we got, then report the error
        yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
    finally:
        await _persist()   # covers CancelledError on client disconnect
```

Key properties: `_persist` is idempotent (`saved` flag) so the three call sites
don't double-write; empty responses are not saved; the `finally` catches the
disconnect/cancel path.

**Verify**: `python -c "from backend.main import app; print('OK')"` → `OK`.
`grep -n "finally" backend/api/chat.py` → shows the new finally inside `event_stream`.

### Step 2: Test that a completed stream saves exactly one assistant message

Create `backend/tests/test_chat_persist.py`. Monkeypatch `backend.core.rag.rag_chat`
to an async generator you control (so no Ollama is needed), then exercise the save:

- **Happy path**: patch `rag_chat` to yield a `sources` chunk then two `token`
  chunks; drive `event_stream` to completion (iterate it fully); assert exactly one
  assistant `Message` row exists for the session with the concatenated content.
- **Disconnect path**: patch `rag_chat` to yield one token then raise
  `asyncio.CancelledError` (or `aclose()` the generator after one token); assert an
  assistant `Message` was still saved with the partial content, and that it was
  saved only once.
- **Empty path**: patch `rag_chat` to raise before any token; assert NO assistant
  message row is created (don't persist empty).

To reach `event_stream`, call the route via `TestClient` if feasible, or import and
drive the generator directly. Driving the generator directly is more reliable for
the cancellation case: get the `StreamingResponse` body iterator, consume one item,
then call its `aclose()` to simulate disconnect, and assert the DB state. Read
`backend/tests/conftest.py` for the DB/session fixtures and the async test mode
before writing.

**Verify**: `pytest backend/tests/test_chat_persist.py -v` → pass.

### Step 3: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_chat_persist.py`: happy path (one row, full
  content), disconnect (partial content saved once), empty (no row).
- `rag_chat` is monkeypatched to an async generator — no network.
- Verification: `pytest backend/tests/` → all pass.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `pytest backend/tests/` exits 0; `test_chat_persist.py` passes
- [ ] The assistant-save runs in a `finally` and is idempotent (no double-write)
- [ ] Empty responses are not persisted
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `event_stream` no longer matches the excerpt (already refactored).
- Driving the generator for the cancellation test proves impossible with the
  available fixtures — report the blocker; do not ship without a disconnect test.
- `Message` model lacks `sources_json` or `session_id` (schema drift).

## Maintenance notes

- Consider marking partially-saved replies (e.g. a `partial` flag) so the UI can
  show "(interrupted)" — deferred, not in scope.
- Reviewer should focus on the idempotency of `_persist` (the `saved` flag) and
  that `CancelledError` is genuinely covered by `finally`, not by `except Exception`.
- If `plans/008` and a future "regenerate" feature both touch this generator,
  re-check the save-once guarantee.
