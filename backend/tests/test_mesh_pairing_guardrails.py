"""The two ways pairing goes wrong, and how openMemo now catches them.

Both are silent by nature, which is what makes them worth code:

  Start on BOTH computers   — each mints its own root, so they filter each
                              other out and report "no devices found" forever.
  Start again after pairing — mints a new root while the other device keeps the
                              old one. They stop recognising each other on the
                              spot, with no error on either side.
"""
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
async def mesh_on():
    """Mesh enabled, and an EMPTY device table.

    The suite shares one throwaway database, and these tests are all about how
    many devices are registered — a row left behind by the test above turns
    "the first start is never in the way" into a failure that only happens when
    the file is run whole."""
    from sqlalchemy import text

    from backend.core.app_settings import update_settings
    from backend.core.mesh import sync_state
    from backend.db.database import AsyncSessionLocal

    update_settings({"mesh_enabled": True})
    await sync_state.mesh_schema_init()

    async def _clear() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(text("DELETE FROM mesh_devices"))
            await db.commit()

    await _clear()
    yield
    await _clear()
    update_settings({"mesh_enabled": False})


async def _register(name: str) -> str:
    from backend.core.mesh import pairing

    device_id = uuid.uuid4().hex[:8]
    await pairing.register_device(device_id, name)
    return device_id


@pytest.mark.asyncio
async def test_starting_again_with_a_paired_device_is_refused(client):
    """The refusal names the device it would cut loose. "Are you sure?" without
    saying what breaks is a dialog people click through."""
    await _register("Laptop")

    resp = client.post("/api/mesh/pair/start")
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "Laptop" in detail
    assert "existing code" in detail


@pytest.mark.asyncio
async def test_it_can_still_be_forced_when_that_is_what_you_mean(client):
    """Starting over is legitimate — after losing a machine, say. It just has
    to be asked for."""
    await _register("Laptop")

    resp = client.post("/api/mesh/pair/start?replace=true")
    assert resp.status_code == 200
    assert len(resp.json()["words"]) == 12


@pytest.mark.asyncio
async def test_the_first_start_is_never_in_the_way(client):
    """A Mesh with only this machine in it has nothing to orphan."""
    resp = client.post("/api/mesh/pair/start")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_a_revoked_device_does_not_block_starting_over(client):
    """Revoking is how you say "that machine is gone". Starting fresh after
    that is the expected next step, not a mistake to guard."""
    from backend.core.mesh import pairing

    dead = await _register("Old laptop")
    await pairing.revoke(dead)

    assert client.post("/api/mesh/pair/start").status_code == 200


@pytest.mark.asyncio
async def test_discover_explains_a_stranger_mesh_instead_of_saying_nothing(client, monkeypatch):
    """Start pressed on both machines: peers empty, and an openMemo on the
    network that is not in this Mesh. Silence is the unhelpful answer."""
    from backend.core.mesh import discovery

    async def _scan(*_a, **_k):
        return [], 1

    monkeypatch.setattr(discovery, "scan", _scan)
    body = client.get("/api/mesh/discover").json()

    assert body["others_on_network"] == 1
    assert "different Mesh" in body["note"]
    assert "Join a Mesh" in body["note"]


@pytest.mark.asyncio
async def test_no_openmemos_at_all_still_suggests_pairing_by_address(client, monkeypatch):
    """Docker's bridge eats multicast. That is not a stranger-Mesh problem and
    must not be reported as one."""
    from backend.core.mesh import discovery

    async def _scan(*_a, **_k):
        return [], 0

    monkeypatch.setattr(discovery, "scan", _scan)
    body = client.get("/api/mesh/discover").json()

    assert body["others_on_network"] == 0
    assert "by address" in body["note"]
