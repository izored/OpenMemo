# A save that worked, reported as a failure

**2026-09-06. 20 Instagram memos saved with no video, while Telegram said
"Save failed" for every one of them.**

Written down because the bug itself was one missing line, and everything
expensive about it was the shape around that line. The shape is still there in
other places.

---

## What it looked like

The Telegram bot answered a batch of forwarded reels with:

```
⚠️ Save failed: name 'SCOPE_TIER_PAGE' is not defined
```

Eight in six minutes, twenty over the day. The natural reading is that nothing
saved and the links need re-sending.

That reading is wrong, and re-sending would have been the worst move available:
the memos were already in the library. Every one of the twenty was present, none
deleted, each with its thumbnail. What they did not have was the video.

## What actually happened

`ingest_url_core` reads a constant, `SCOPE_TIER_PAGE`, near the end of the save
path. The constant was only ever imported inside a *different* function further
down the file, so the name did not exist at module scope. Every call raised
`NameError` at that line.

The line sits **after** `await db.commit()`.

```
  db.commit()          <- the memo is now saved, permanently
  schedule(...)        <- follow-up jobs collected into a list
  ...
  SCOPE_TIER_PAGE      <- NameError
  return               <- never reached
```

The Telegram relay collects follow-up jobs during the save and hands them to the
durable queue only once `ingest_url_core` **returns**. Its comment said, in good
faith, "nothing is queued for a memo that failed to save". That is true for a
save that fails. This one did not fail. It committed, then raised, so the memo
was permanent and its download queue was thrown away with the stack frame.

Hence: memo present, thumbnail present, video absent, user told it all failed.

## Why nothing caught it

There was a test. It passed the whole time.

```python
src = inspect.getsource(ingest.ingest_url_core)
assert '(memo.resolve_tier or "") == SCOPE_TIER_PAGE' in src
```

It greps the source for a string. The string was there. The *import* was
missing, and no amount of reading the source for that line can tell you whether
the name behind it resolves.

When the fix was verified by putting the bug back, 26 of 27 tests in that file
went green against a save path that could not save.

## What changed

1. **The import moved to module scope** in `backend/api/ingest.py`.
   `backend/core/social.py` imports nothing but `__future__`, so there was never
   a cycle to dodge. The redundant function-local import was removed, because
   two ways to reach one constant is what hid the missing one.

2. **The optional step is guarded.** The re-resolve check is a best-effort
   retry. It now sits in its own `try`, logs with `log.exception`, and cannot
   take a committed save down with it. Anything after the commit runs on a memo
   that already exists and must be held to that standard.

3. **The relay says when it drops jobs.** If `ingest_url_core` raises with jobs
   already collected, the relay logs at error level that a memo may have
   committed with its follow-ups lost. It still does not queue them, because a
   genuinely failed save has no memo to work on, but it is no longer silent.

4. **A real test replaced the grep.** It walks the compiled bytecode of
   `ingest_url_core`, collects every `LOAD_GLOBAL`, and resolves each one
   against the module globals and builtins the way CPython would. Any global the
   function reads that does not exist fails the test by name. Verified by
   reintroducing the bug and watching it fail.

## Rules this leaves behind

**Nothing after a commit may raise.** The commit is the point where a failure
stops being "the operation did not happen" and starts being "the operation
happened and then lied about it". Code after it is cleanup and scheduling. Give
optional work its own `try`.

**A queue handed over after the fact inherits every raise in between.** The
collect-then-dispatch pattern in the relay is good: it stops a restart mid-batch
from losing work. Its cost is that the window between commit and return is a
window where jobs can evaporate. Keep that window boring.

**A test that greps source is not a test.** It proves a string is in a file. Ask
of any test: if the feature were completely broken, would this fail? Here the
answer was no, for the entire life of the test. Prefer executing the contract,
and prove a new test works by breaking the code and watching it go red.

**An error message a user sees is a claim about state.** "Save failed" told the
user to re-send twenty links that were already saved. When a failure is reported
after a commit, the message is wrong in the most costly direction available.

## If you are reading this because it happened to you

The memos are in your library. Search for them by their source link before
re-sending anything. If a memo has its picture but will not play, it needs its
video fetched again, not a re-save: open it and use the re-pull button in the
header, or Settings, Data safety for a batch.
