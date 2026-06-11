# Plan 010: Chat SSE stream readers are aborted when the view unmounts, ending zombie requests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- frontend/src/pages/AskMemoPage.tsx frontend/src/components/AskMemoPanel.tsx frontend/src/lib/api.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

Both chat surfaces start reading a streaming response with `resp.body.getReader()`
and no `AbortController` and no unmount cleanup. If the user navigates away or
closes the panel while a reply is streaming, the fetch keeps running, the reader
keeps consuming, and the backend keeps generating tokens for a client nobody is
watching. Wiring an `AbortController` that aborts on unmount stops the request
immediately and frees both ends.

## Current state

- `frontend/src/pages/AskMemoPage.tsx:96-150` — starts a stream with no abort:
  ```tsx
  // AskMemoPage.tsx ~96-117
  const resp = await chatApi.stream({ query: userMsg.content, session_id: sessionId || undefined, model: chatModel });
  if (!resp.ok) { ... throw new Error(...); }
  const reader = resp.body?.getReader();
  const decoder = new TextDecoder();
  if (reader) {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ...
    }
  }
  ```
- `frontend/src/components/AskMemoPanel.tsx:44-103` — same pattern, also no abort:
  ```tsx
  // AskMemoPanel.tsx ~44-57
  const resp = await chatApi.stream({ query: userMsg.content, session_id: sessionId || undefined, memo_id: memoId, collection_id: collectionId, model: chatModel });
  ...
  const reader = resp.body?.getReader();
  ```
- `frontend/src/lib/api.ts` — `chatApi.stream(...)` is the single fetch wrapper for
  the chat stream. **Read it** to see its exact signature and whether it already
  forwards a `signal`/`RequestInit`. It must accept an `AbortSignal` for this plan;
  if it doesn't, Step 1 adds that parameter (api.ts is the single source for fetch
  calls per the repo convention — do not fetch directly from the components).

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---------|----------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Typecheck+build | `npm run build` | exit 0 |
| Test | `npm test` | all pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `frontend/src/lib/api.ts` (let `chatApi.stream` accept an `AbortSignal`)
- `frontend/src/pages/AskMemoPage.tsx`
- `frontend/src/components/AskMemoPanel.tsx`

**Out of scope**:
- Backend chat endpoint (a separate plan, `plans/008`, makes the server save the
  partial reply on disconnect — these are complementary).
- Any other component.

## Git workflow

- Branch: `advisor/010-abort-sse-readers-on-unmount`
- One commit, conventional style:
  `fix(chat): abort the SSE reader on unmount to stop zombie chat requests`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Let `chatApi.stream` forward an AbortSignal

In `frontend/src/lib/api.ts`, find `chatApi.stream`. Add an optional `signal?: AbortSignal`
parameter and pass it into the underlying `fetch(..., { ..., signal })`. Keep the
existing call shape backward-compatible (optional arg). If the function takes a
single options object, add `signal` to that object's type instead. Match the
existing typing/style in api.ts.

**Verify**: `grep -n "stream" frontend/src/lib/api.ts` → shows `signal` plumbed
into the fetch. `npm run build` (from `frontend/`) → exit 0.

### Step 2: Abort on unmount in AskMemoPage

In `frontend/src/pages/AskMemoPage.tsx`:
- Add a ref to hold the controller: `const streamAbortRef = useRef<AbortController | null>(null);`
  (ensure `useRef` is imported).
- In the send handler, before starting: abort any in-flight stream, then create a
  fresh controller and pass its signal:
  ```tsx
  streamAbortRef.current?.abort();
  const controller = new AbortController();
  streamAbortRef.current = controller;
  const resp = await chatApi.stream({ ... }, controller.signal);
  ```
- Add an unmount cleanup effect:
  ```tsx
  useEffect(() => () => streamAbortRef.current?.abort(), []);
  ```
- In the `catch`, ignore abort errors so a deliberate cancel doesn't render as a
  chat error:
  ```tsx
  if ((e as Error)?.name === 'AbortError') return;
  ```
  Place this as the first line of the existing `catch` block.

**Verify**: `grep -n "AbortController\|AbortError\|streamAbortRef" frontend/src/pages/AskMemoPage.tsx`
→ shows controller, unmount effect, and AbortError guard. `npm run build` → exit 0.

### Step 3: Same wiring in AskMemoPanel

Apply the identical pattern in `frontend/src/components/AskMemoPanel.tsx`
(controller ref, abort-before-start, unmount effect, AbortError guard in its
`catch`). Its `catch` currently sets the last assistant message to
`'Error: ' + message`; guard it so an abort does NOT overwrite the message:

```tsx
} catch (e) {
  if ((e as Error)?.name === 'AbortError') return;   // user navigated away — not an error
  setMessages((prev) => { ... existing error handling ... });
}
```

**Verify**: `grep -n "AbortController\|AbortError" frontend/src/components/AskMemoPanel.tsx`
→ shows both. `npm run build` → exit 0.

### Step 4: Full frontend checks

**Verify** (from `frontend/`): `npm run lint` → 0; `npm run build` → 0; `npm test` → all pass.

## Test plan

- No unit test is required (these are integration-level lifecycle behaviors and the
  repo has no component-test harness yet — that gap is `plans/018`). The
  verification is: typecheck/build/lint clean, and a manual smoke per Maintenance
  notes.
- If `plans/018` (frontend component tests) has already landed when you execute
  this, add a test that renders `AskMemoPanel`, starts a stream against a mocked
  `chatApi.stream`, unmounts, and asserts `controller.abort` was called. Otherwise
  skip — do not block on building a harness here.

## Done criteria

ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm test` passes
- [ ] `chatApi.stream` accepts and forwards an `AbortSignal`
- [ ] Both `AskMemoPage.tsx` and `AskMemoPanel.tsx` create a controller, abort on unmount, and ignore `AbortError`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `chatApi.stream`'s signature is so different that adding a signal cleanly is
  unclear — report what you found.
- Either component no longer matches its excerpt (already refactored).
- Adding the unmount effect introduces a TypeScript error you can't resolve
  without touching out-of-scope files.

## Maintenance notes

- Manual smoke: open Ask Memo, send a question, navigate away mid-stream; the
  network request should show as cancelled in devtools and no error toast should
  appear.
- Pairs with `plans/008`: server saves the partial reply, client stops streaming —
  together they make mid-stream navigation clean on both ends.
- Reviewer should confirm the AbortError guard is the FIRST statement in each
  `catch`, so it can't be shadowed by the error-rendering code.
