# Plan 006: SQLite runs in WAL mode with a busy timeout so concurrent writes stop deadlocking

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/db/database.py backend/api/backup.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

The async SQLite engine is created with default pragmas. SQLite's default rollback
journal allows only one writer and gives a busy connection no grace period, so the
app's many concurrent writers (ingest background tasks, transcription, playlist
downloads, plus foreground CRUD) intermittently hit `database is locked` and stall.
Turning on WAL journaling (readers don't block the writer) and a `busy_timeout`
(writers wait instead of erroring instantly) is the standard SQLite-concurrency fix
and removes a whole class of flaky stalls.

## Current state

- `backend/db/database.py:9-13` — engine created with no connect args / pragmas:
  ```python
  # backend/db/database.py
  engine = create_async_engine(
      settings.DATABASE_URL,
      echo=False,
      future=True,
  )
  ```
  `settings.DATABASE_URL` is `sqlite+aiosqlite:///.../data/openmemo.db`
  (see `backend/config.py:16`). The driver is `aiosqlite`.
- `init_db()` (same file) calls `Base.metadata.create_all` then `_run_migrations()`,
  which opens a separate `aiosqlite.connect(...)` for `ALTER TABLE` migrations.
- Backups: `backend/api/backup.py` snapshots the DB via `sqlite3.connect(...).backup()`
  and on restore disposes the engine and `shutil.copy2`s the file. **WAL adds
  `-wal` and `-shm` sidecar files**, so backup/restore must account for them
  (Step 3).

## Commands you will need

| Purpose | Command (from project root) | Expected on success |
|---------|-----------------------------|---------------------|
| Import smoke | `python -c "from backend.main import app; print('OK')"` | prints `OK` |
| Backend tests | `pytest backend/tests/` | all pass |
| New test only | `pytest backend/tests/test_sqlite_pragmas.py -v` | new tests pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/db/database.py`
- `backend/tests/test_sqlite_pragmas.py` (create)

**Out of scope** (read Maintenance notes — but do NOT change in this plan):
- `backend/api/backup.py` — WAL interaction is handled by checkpointing on
  shutdown/backup (Step 3 chooses the no-backup-change approach). If you find the
  backup genuinely broken by WAL, that is a STOP condition, not an edit target.
- Any ORM model or query.

## Git workflow

- Branch: `advisor/006-enable-sqlite-wal-busy-timeout`
- One commit, conventional style:
  `perf(db): enable SQLite WAL + busy_timeout to remove write-lock stalls`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Set pragmas on every new connection via an event listener

Default-mode pragmas like `journal_mode` and `busy_timeout` must be issued per
connection. The robust way with SQLAlchemy async is a `connect` event on the sync
engine underneath. Add to `backend/db/database.py` after the engine is created:

```python
from sqlalchemy import event

@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")      # ms; wait instead of erroring
    cursor.execute("PRAGMA synchronous=NORMAL")     # safe with WAL, much faster
    cursor.close()
```

Notes:
- `journal_mode=WAL` is persistent (a property of the database file) but
  re-issuing it per connection is harmless and guarantees it after a restore
  replaces the file.
- `busy_timeout` and `synchronous` are per-connection, so they must be set here.

**Verify**: `python -c "from backend.main import app; print('OK')"` → `OK`.

### Step 2: Verify the pragmas actually take effect

Create `backend/tests/test_sqlite_pragmas.py`. It must open a connection through
the app's engine and assert the pragmas. Use the async engine and an async test
(the repo uses `pytest-asyncio`; check `backend/tests/conftest.py` for the
configured mode and mirror it):

```python
import pytest
from sqlalchemy import text
from backend.db.database import engine


@pytest.mark.asyncio
async def test_wal_and_busy_timeout_enabled():
    async with engine.connect() as conn:
        journal = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
        busy = (await conn.execute(text("PRAGMA busy_timeout"))).scalar()
    assert str(journal).lower() == "wal"
    assert int(busy) >= 5000
```

If `conftest.py` sets `asyncio_mode = auto`, drop the `@pytest.mark.asyncio`
decorator to match the repo convention — read it first.

**Verify**: `pytest backend/tests/test_sqlite_pragmas.py -v` → pass.

### Step 3: Confirm backup/restore still works with WAL sidecar files

Do NOT change `backup.py` in this plan. Instead confirm the existing backup path
is WAL-safe:
- `backend/api/backup.py` uses `sqlite3.connect(src).backup(dst)` for creating
  backups — `.backup()` reads a consistent snapshot including WAL contents, so the
  produced `.db` is self-contained (no sidecar needed in the zip). ✓
- On restore it disposes the engine then `copy2`s a single `.db` file over the
  live one. After WAL is enabled, a stale `-wal`/`-shm` next to the replaced file
  could shadow it. Confirm whether restore already removes sidecars; if it does
  not and this is a real risk, **STOP and report** (it becomes a follow-up to
  `plans/002` rather than a silent edit here).

**Verify**: read `backup.py` restore path and record in your report whether `-wal`/`-shm`
cleanup exists. `pytest backend/tests/` → all pass.

### Step 4: Full backend test run

**Verify**: `pytest backend/tests/` → all pass, exit 0.

## Test plan

- New file `backend/tests/test_sqlite_pragmas.py` asserting `journal_mode=WAL`
  and `busy_timeout>=5000` on a real connection.
- Verification: `pytest backend/tests/` → all pass including the new test.

## Done criteria

ALL must hold:

- [ ] `python -c "from backend.main import app; print('OK')"` prints `OK`
- [ ] `pytest backend/tests/` exits 0; `test_sqlite_pragmas.py` passes
- [ ] `grep -n "journal_mode=WAL\|busy_timeout" backend/db/database.py` shows both pragmas
- [ ] The WAL/sidecar interaction with backup is documented in your report (Step 3)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The engine creation block no longer matches the excerpt.
- The pragma test reads back `delete` (not `wal`) — the listener isn't firing;
  report rather than hacking pragmas into random call sites.
- Step 3 reveals restore does not clean up `-wal`/`-shm` sidecars (potential data
  shadowing) — report it as a dependency for `plans/002`.

## Maintenance notes

- WAL leaves `openmemo.db-wal` and `openmemo.db-shm` beside the DB. `.gitignore`
  should already ignore the `data/` dir; confirm. Any future raw-file copy of the
  DB (outside `sqlite3.backup`) must include or checkpoint these.
- If a future feature does bulk imports, `busy_timeout` may need raising; 5s is a
  sane default for interactive use.
- Reviewer should confirm the pragma listener targets `engine.sync_engine`, not
  the async engine (a common mistake that silently no-ops).
