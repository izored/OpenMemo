"""Mesh feature gate (ADR-024 §0, plan 024 phase 1).

The whole point of the gate is that an install which never enables Mesh carries
zero surface area. These tests pin that: off by default, invisible when off,
and reachable the moment it is on.
"""
import pytest
from fastapi.testclient import TestClient

from backend.core import mesh
from backend.core.app_settings import get_settings, update_settings


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _restore_flag():
    before = bool(get_settings().get("mesh_enabled", False))
    yield
    update_settings({"mesh_enabled": before})


def test_mesh_is_off_by_default():
    """A fresh install must not have Mesh on. This is the whole contract."""
    assert mesh.is_enabled() is False


def test_routes_404_while_disabled(client):
    """404, not 403: a disabled feature should look like one that was never
    built. A 403 advertises the endpoint and invites probing on a LAN port."""
    update_settings({"mesh_enabled": False})
    r = client.get("/api/mesh/status")
    assert r.status_code == 404
    assert "mesh" not in r.text.lower(), "a disabled feature must not name itself"


def test_routes_open_once_enabled(client):
    update_settings({"mesh_enabled": True})
    r = client.get("/api/mesh/status")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["paired"] is False, "must not claim a pairing that does not exist yet"


def test_flag_flips_live_without_restart(client):
    """is_enabled() reads settings each call rather than caching. A stale cache
    would mean sync continuing quietly after the user switched it off."""
    update_settings({"mesh_enabled": True})
    assert client.get("/api/mesh/status").status_code == 200
    update_settings({"mesh_enabled": False})
    assert client.get("/api/mesh/status").status_code == 404


def test_flag_is_persisted_through_the_settings_api(client):
    r = client.put("/api/settings", json={"mesh_enabled": True})
    assert r.status_code == 200
    assert get_settings()["mesh_enabled"] is True
    assert client.get("/api/settings").json()["mesh_enabled"] is True


def test_every_setting_default_is_writable_through_the_api():
    """There are TWO allowlists: `_DEFAULTS` in app_settings.py and the
    `SettingsPatch` model in api/settings.py. A key present in the first but
    missing from the second is dropped **silently** — the PUT still returns 200,
    so a Settings toggle appears to work and changes nothing.

    That bug was hit while adding mesh_enabled. This pins it so the next person
    adding a setting fails a test instead of shipping a dead switch.
    """
    from backend.api.settings import SettingsPatch
    from backend.core.app_settings import _DEFAULTS

    # Server-managed keys are deliberately not writable through the generic PUT.
    # Each one is owned by a dedicated route that validates far more than a bool.
    SERVER_MANAGED = {
        "bg_image_ext",  # set by the background-image upload route, from the file
    }

    model_fields = set(SettingsPatch.model_fields)
    missing = sorted(set(_DEFAULTS) - model_fields - SERVER_MANAGED)
    assert not missing, (
        f"settings present in _DEFAULTS but not in SettingsPatch, so writes to "
        f"them are silently dropped: {missing}"
    )


def test_mesh_key_material_never_crosses_the_settings_api():
    """`mesh_secret` is the root every Mesh key is derived from, and
    `mesh_code_words` is the same secret in typeable form. Either one lets a
    caller join the Mesh and read what crosses it.

    core/mesh/secret.py has always said this "must never be readable through
    the settings API". Nothing enforced it: GET /api/settings returned the full
    64 hex characters to anyone who could reach the local API.
    """
    from fastapi.testclient import TestClient

    from backend.core.app_settings import _LOCK, _read, _write_raw
    from backend.main import app

    with _LOCK:
        current = _read()
        current["mesh_secret"] = "de" * 32
        current["mesh_code_words"] = "abandon " * 11 + "about"
        _write_raw(current)

    try:
        with TestClient(app) as client:
            body = client.get("/api/settings").json()
        assert "mesh_secret" not in body
        assert "mesh_code_words" not in body
        assert "de" * 32 not in str(body)
    finally:
        with _LOCK:
            current = _read()
            current.pop("mesh_secret", None)
            current.pop("mesh_code_words", None)
            _write_raw(current)
