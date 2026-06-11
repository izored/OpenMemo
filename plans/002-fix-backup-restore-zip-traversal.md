# Plan 002: Backup restore rejects zip entries that escape the files directory (Zip-Slip)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/api/backup.py backend/core/security/sanitize.py`
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

The backup-restore endpoint unpacks a user-supplied zip and writes each entry
under `files/` to disk **without verifying the resolved path stays inside the
files directory**. A crafted backup whose entry name is
`files/../../../<somewhere>` writes outside the intended directory — classic
Zip-Slip arbitrary file write. The restore handler also deletes the existing
files directory *before* validating entries, so a malformed archive can both
destroy data and plant files elsewhere. The repo already ships a `SafePath`
containment helper used by the file-serving routes; restore must use the same
guard. This is the highest-severity finding in the audit.

## Current state

- `backend/api/backup.py` — backup/restore router. Module constants:
  ```python
  # backend/api/backup.py:19-21
  _META = "backup_meta.json"
  _DB = "openmemo.db"
  _FILES_PREFIX = "files/"
  ```
- The vulnerable loop is in `restore_backup` (`@router.post("/restore")`, def at
  line 80). After replacing the DB it does, for a `full`-scope backup:
  ```python
  # backend/api/backup.py (restore, ~lines 121-133)
  if scope == "full":
      files_dir.mkdir(parents=True, exist_ok=True)
      # Remove existing files but keep the thumbs cache directory structure.
      for item in files_dir.iterdir():
          if item.name != "thumbs":
              if item.is_dir():
                  shutil.rmtree(item, ignore_errors=True)
              else:
                  item.unlink(missing_ok=True)

      for name in names:
          if name.startswith(_FILES_PREFIX) and not name.endswith("/"):
              rel = name[len(_FILES_PREFIX):]
              dest = files_dir / rel               # ← no containment check
              dest.parent.mkdir(parents=True, exist_ok=True)
              dest.write_bytes(zf.read(name))
  ```
  `rel` can be `../../../etc/whatever`; `files_dir / rel` then resolves outside
  `files_dir`.

- The containment helper already exists and is exported:
  ```python
  # backend/core/security/__init__.py exports SafePath
  # SafePath(base_dir) wraps a root; it is used in backend/main.py:202 as
  #   _file_store = SafePath(settings.FILES_DIR)
  # for safe file serving (resolves a candidate path and rejects escapes).
  ```
  Read `backend/core/security/sanitize.py` to confirm `SafePath`'s exact method
  name and signature before using it (look for the class `SafePath` and how
  `backend/main.py` calls it around the `/api/files/{file_path}` route). Do NOT
  guess the method name — read it.

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_backup_restore_safety.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/api/backup.py`
- `backend/tests/test_backup_restore_safety.py` (create)

**Out of scope**:
- `backend/core/security/sanitize.py` — reuse `SafePath`, do not modify it.
- `create_backup` (lines 34–77) — the writer side is fine; only restore is unsafe.
- The DB-replacement logic (the `tempfile`/`engine.dispose()`/`shutil.copy2`
  block) — leave it as-is.

## Git workflow

- Branch: `advisor/002-fix-backup-restore-zip-traversal`
- One commit, conventional style:
  `fix(backup): reject zip entries that escape the files directory on restore`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a containment guard before each write

In `restore_backup`, replace the unsafe inner loop so every destination is
validated against `files_dir` before writing. Two acceptable implementations —
prefer (A):

**(A) Reuse `SafePath`** (matches repo convention in `backend/main.py`):
construct a `SafePath(files_dir)` once before the loop, and for each entry resolve
`rel` through it; on rejection, `raise HTTPException(status_code=400, detail="Backup contains an unsafe file path")`.
Use the exact method name you confirmed by reading `sanitize.py` / `main.py`.

**(B) Manual containment** (if `SafePath`'s API does not fit cleanly): resolve and
compare explicitly:

```python
files_root = files_dir.resolve()
for name in names:
    if name.startswith(_FILES_PREFIX) and not name.endswith("/"):
        rel = name[len(_FILES_PREFIX):]
        dest = (files_dir / rel).resolve()
        if not dest.is_relative_to(files_root):   # Python 3.9+; repo runs 3.12
            raise HTTPException(status_code=400, detail="Backup contains an unsafe file path")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zf.read(name))
```

`Path.is_relative_to` exists in Python 3.9+ and the repo targets 3.12 (CI uses
`python-version: "3.12"`), so it is available.

**Verify**: `python -c "from backend.main import app; print('OK')"` → prints `OK`.

### Step 2: Move the destructive directory-wipe AFTER validation (defense in depth)

The current code wipes `files_dir` before reading entries, so a malicious archive
destroys data even when it fails. Restructure so the wipe only happens once all
entries have passed the containment check. Minimal approach: first iterate `names`
and validate every `files/`-prefixed entry's resolved path (raising on any
escape), and only then perform the `files_dir.iterdir()` wipe and the writes.

If a full refactor is risky, an acceptable smaller version: keep one pass, but
validate the entry path *before* any `rmtree`/`unlink` runs in the loop body. The
guarantee to achieve: **no file is deleted or written until every entry name in
the archive has been confirmed safe.**

**Verify**: re-read the function; confirm by inspection that the wipe cannot run
before validation. `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 3: Add tests proving traversal is blocked and normal restore still works

Create `backend/tests/test_backup_restore_safety.py`. Use FastAPI's `TestClient`
the same way `backend/tests/test_smoke.py` does (read it for the fixture/client
pattern). Build in-memory zips with `zipfile` + `io.BytesIO`:

- **Malicious entry rejected**: a zip containing `backup_meta.json`
  (`{"scope":"full"}`), `openmemo.db` (a few bytes), and an entry named
  `files/../escape.txt` → POST to `/api/backup/restore` returns HTTP 400 and the
  file `escape.txt` does NOT appear outside the files dir.
- **Benign full restore still works**: a zip with a normal `files/sub/ok.txt`
  entry → succeeds (200) and the file lands under the files directory.

If wiring a full restore against the real settings dirs is too invasive for a
unit test, at minimum unit-test the path-validation logic by extracting it or by
asserting the 400 on the malicious archive. Keep the malicious-archive rejection
test non-negotiable.

**Verify**: `pytest backend/tests/test_backup_restore_safety.py -v` → pass.

### Step 4: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_backup_restore_safety.py`, modeled on
  `backend/tests/test_smoke.py`'s TestClient usage.
- Cases: malicious `files/../escape.txt` → 400, no file written outside the root;
  benign `files/sub/ok.txt` → restored under the files dir.
- Verification: `pytest backend/tests/` → all pass including new tests.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `pytest backend/tests/` exits 0; `test_backup_restore_safety.py` exists and passes
- [ ] The malicious-archive test asserts HTTP 400 AND that no out-of-root file was created
- [ ] By code inspection, no delete/write happens before path validation
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The restore loop in `backup.py` no longer matches the "Current state" excerpt.
- `SafePath` cannot be found in `backend/core/security/` or its method name is
  unclear from reading `main.py` — report what you found rather than guessing.
- Reordering the wipe turns out to require touching the DB-replacement block
  (out of scope) — report instead of editing it.

## Maintenance notes

- Any new code that unpacks user-supplied archives (future import feature, see the
  direction notes in `plans/README.md`) must reuse the same containment guard.
- Reviewer should confirm the guard runs for **every** written entry, including
  nested directories, and that `is_relative_to`/`SafePath` is applied to the
  *resolved* path, not the raw join.
- This is a security fix; the malicious-archive test is the regression anchor —
  do not let it be weakened in future refactors.
