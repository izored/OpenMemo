"""The suite must never touch a real library.

On 2026-08-04 running these tests from a real checkout deleted 435 media files
— every video, song and upload in a live library. Nothing was malicious and no
test was wrong about its own subject: `conftest.py` isolated DATA_DIR and
DATABASE_URL but not FILES_DIR, so `test_backup_restore_safety.py` posted a
scope="full" restore and the endpoint did exactly what it is supposed to do —
empty the files directory before unpacking. It emptied the real one.

These tests are the tripwire. If an environment variable that points at user
data stops being redirected to a temp directory, the suite fails here, loudly,
instead of somewhere quiet and destructive.
"""
import os
import tempfile
from pathlib import Path

import pytest

from backend.config import settings

TEMP_ROOT = Path(tempfile.gettempdir()).resolve()
REPO_ROOT = Path(__file__).resolve().parents[2]


def _is_under_temp(p: Path) -> bool:
    try:
        p.resolve().relative_to(TEMP_ROOT)
        return True
    except ValueError:
        return False


@pytest.mark.parametrize(
    "name, value",
    [
        ("FILES_DIR", settings.FILES_DIR),
        ("DATA_DIR", settings.DATA_DIR),
    ],
)
def test_user_data_directories_are_throwaway(name, value):
    p = Path(str(value))
    assert _is_under_temp(p), (
        f"{name} resolves to {p.resolve()}, which is not a temp directory. "
        f"Tests write — and the restore endpoint DELETES — through this path. "
        f"Set it to a throwaway in conftest.py before running anything."
    )


@pytest.mark.parametrize("name", ["FILES_DIR", "DATA_DIR"])
def test_user_data_directories_are_not_inside_the_repo(name):
    p = Path(str(getattr(settings, name))).resolve()
    try:
        p.relative_to(REPO_ROOT)
    except ValueError:
        return  # outside the repo, which is what we want
    pytest.fail(
        f"{name} points inside the repository ({p}). The suite would operate on "
        f"real checked-out data; that is how the 2026-08-04 media loss happened."
    )


def test_the_database_is_not_a_real_library():
    url = settings.DATABASE_URL
    assert _is_under_temp(Path(url.split("///")[-1])), (
        f"DATABASE_URL points at {url}, outside a temp directory. Tests create, "
        f"mutate and delete rows."
    )
