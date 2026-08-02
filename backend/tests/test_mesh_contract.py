"""The Mesh contract sweep.

Mesh is ~2,200 lines that must never become a tax on the rest of openMemo. Two
promises hold that line, and this module is where both are enforced rather than
remembered:

1. **Disabled means inert.** Not "mostly harmless" — no triggers, no listener,
   no routes, nothing written.
2. **Changing core openMemo cannot silently break Mesh.** Add a column, a table
   or a setting and the relevant test here fails with instructions, instead of
   Mesh quietly skipping data months later.

Run this first when a Mesh test fails after an unrelated change. It is the sweep.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.core.app_settings import get_settings, update_settings
from backend.core.mesh import changelog, merge, server
from backend.core.mesh.sync_state import apply_enabled_state, mesh_schema_init
from backend.db.database import AsyncSessionLocal, init_db
from backend.db.models import Base


@pytest.fixture(autouse=True)
async def _restore_flag():
    before = bool(get_settings().get("mesh_enabled", False))
    await init_db()
    await mesh_schema_init()
    yield
    update_settings({"mesh_enabled": before})
    await apply_enabled_state(before)


# -- promise 1: disabled means inert -----------------------------------------

async def test_disabled_mesh_installs_no_triggers():
    await apply_enabled_state(False)
    assert await changelog.installed_trigger_count() == 0


async def test_disabled_mesh_records_nothing_when_the_app_writes():
    """The strongest form of the promise: use openMemo normally with Mesh off
    and the change log must stay exactly where it was."""
    await apply_enabled_state(False)
    before = await changelog.latest_seq()

    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "INSERT INTO memos (id, type, title) VALUES ('inert1', 'note', 'x')"
        ))
        await db.commit()
        await db.execute(text("UPDATE memos SET title = 'y' WHERE id = 'inert1'"))
        await db.commit()
        await db.execute(text("DELETE FROM memos WHERE id = 'inert1'"))
        await db.commit()

    assert await changelog.latest_seq() == before, (
        "a disabled Mesh must not record a single write"
    )


async def test_disabled_mesh_opens_no_port():
    await apply_enabled_state(False)
    assert not server.is_running()


def test_disabled_mesh_exposes_no_routes():
    from backend.main import app

    update_settings({"mesh_enabled": False})
    with TestClient(app) as c:
        assert c.get("/api/mesh/status").status_code == 404


# -- promise 2: core changes cannot silently break Mesh ----------------------

def test_every_table_is_classified():
    """A new table must be a deliberate sync decision, not an oversight.

    If this fails you added a table. Put it in SYNCED_TABLES (it is library
    data), LINK_TABLES (it is a membership pair), or NOT_SYNCED with the reason.
    """
    known = set(changelog.SYNCED_TABLES) | set(changelog.LINK_TABLES) | set(changelog.NOT_SYNCED)
    actual = set(Base.metadata.tables)

    unclassified = actual - known
    assert not unclassified, (
        f"table(s) {sorted(unclassified)} have no sync decision. Add each to "
        f"SYNCED_TABLES, LINK_TABLES, or NOT_SYNCED (with a reason) in "
        f"backend/core/mesh/changelog.py"
    )
    stale = known - actual
    assert not stale, f"Mesh references table(s) that no longer exist: {sorted(stale)}"


def test_every_synced_table_still_has_the_key_mesh_assumes():
    """Triggers use NEW.id / OLD.id, and link tables use their declared pair.
    A renamed key would break the trigger at write time, not here."""
    for tbl in changelog.SYNCED_TABLES:
        cols = {c.name for c in Base.metadata.tables[tbl].columns}
        assert "id" in cols, f"{tbl} lost its id column; the Mesh trigger assumes it"

    for tbl, (left, right) in changelog.LINK_TABLES.items():
        cols = {c.name for c in Base.metadata.tables[tbl].columns}
        assert {left, right} <= cols, (
            f"{tbl} no longer has {left}/{right}; update LINK_TABLES"
        )


def test_merge_policy_covers_every_synced_column():
    """A column with no policy silently defaults to newest-wins, which is wrong
    for machine-generated fields and dangerous for per-device ones."""
    classified = merge.LOCAL_ONLY | merge.MACHINE | merge.HUMAN | merge.DICT_UNION
    from backend.tests.test_mesh_merge import PLAIN_LWW_MEMO

    columns = {c.name for c in Base.metadata.tables["memos"].columns}
    unaccounted = columns - classified - PLAIN_LWW_MEMO
    assert not unaccounted, (
        f"new memos column(s) {sorted(unaccounted)} need a merge policy — see "
        f"backend/core/mesh/merge.py"
    )


def test_settings_written_by_mesh_are_actually_writable():
    """There are two settings allowlists; a key in one but not the other is
    dropped silently and the toggle appears to work while doing nothing."""
    from backend.api.settings import SettingsPatch

    assert "mesh_enabled" in SettingsPatch.model_fields


# -- the coupling budget -----------------------------------------------------

CORE_FILES_TOUCHING_MESH = {
    "backend/main.py",              # start schema + match triggers to the flag
    "backend/api/settings.py",      # the toggle has to install/drop triggers
    "backend/core/app_settings.py", # the flag's default
    "backend/api/backup.py",        # restore must not inherit another machine's identity
    "backend/core/jobs.py",         # one comment: the queue is deliberately NOT gated
}


def test_mesh_stays_out_of_the_rest_of_the_codebase():
    """The whole feature is ~2,200 lines, and only a handful reach into core
    openMemo. That ratio is the point: Mesh must be removable and must not
    become a tax on every other feature.

    If this fails, a new file started depending on Mesh. Either move the logic
    into backend/core/mesh/, or add the file here with a one-line reason.
    """
    import pathlib

    root = pathlib.Path("backend")
    offenders = []
    for path in root.rglob("*.py"):
        rel = path.as_posix()
        if "/mesh" in rel or "/tests/" in rel or rel.endswith("api/mesh.py"):
            continue
        if "mesh" in path.read_text(encoding="utf-8").lower() and rel not in CORE_FILES_TOUCHING_MESH:
            offenders.append(rel)

    assert not offenders, (
        f"{offenders} now depend on Mesh. Keep Mesh self-contained: move the "
        f"logic into backend/core/mesh/, or add the file to "
        f"CORE_FILES_TOUCHING_MESH with a reason."
    )
