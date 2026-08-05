"""Leaving a Mesh, as a named choice rather than a force flag.

Starting over used to be `?replace=true`, which you only met by hitting an
error — that reads as an override, not a decision. This is the decision, and it
has to be honest about the one thing it cannot do: make the other device forget
you. There is no server to tell, and it may be asleep.
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
    from sqlalchemy import text

    from backend.core.app_settings import update_settings
    from backend.core.mesh import sync_state
    from backend.db.database import AsyncSessionLocal

    update_settings({"mesh_enabled": True})
    await sync_state.mesh_schema_init()

    async def _clear():
        async with AsyncSessionLocal() as db:
            await db.execute(text("DELETE FROM mesh_devices"))
            await db.commit()

    await _clear()
    yield
    await _clear()
    update_settings({"mesh_enabled": False})


@pytest.mark.asyncio
async def test_leaving_forgets_the_code_and_the_devices(client):
    from backend.core.mesh import keystore, pairing, secret

    client.post("/api/mesh/pair/start")
    assert pairing.reveal_code()
    old_root = keystore.get(secret.SECRET_KEY)

    body = client.post("/api/mesh/leave").json()

    assert body["left"] is True
    assert pairing.reveal_code() is None
    assert client.get("/api/mesh/devices").json()["devices"] == []
    # The root is deleted and a fresh one minted on the next read — leaving
    # produces an unpaired openMemo, not a broken one. What matters is that the
    # OLD root is gone, so the previous Mesh cannot be rejoined by accident.
    assert keystore.get(secret.SECRET_KEY) != old_root


@pytest.mark.asyncio
async def test_leaving_does_not_touch_a_single_memo(client):
    """Leaving is about which devices talk to each other. Anyone who confuses
    it with "delete my library" has been failed by the wording, so the code had
    better not confuse them further."""
    resp = client.post("/api/memos", json={"type": "note", "title": f"keep me {uuid.uuid4().hex[:6]}"})
    memo_id = resp.json()["id"]

    client.post("/api/mesh/pair/start")
    client.post("/api/mesh/leave")

    assert client.get(f"/api/memos/{memo_id}").status_code == 200


@pytest.mark.asyncio
async def test_a_fresh_identity_comes_back_after_leaving(client):
    """The next root is new, so this install is an unpaired openMemo again —
    able to Start or Join without the old Mesh following it around."""
    from backend.core.mesh import secret

    client.post("/api/mesh/pair/start")
    before = secret.chain_id()

    client.post("/api/mesh/leave")
    after = secret.chain_id()

    assert before != after


@pytest.mark.asyncio
async def test_starting_is_unblocked_once_you_have_left(client):
    """The guard counts registered devices. Leaving clears them, so the whole
    point — start over cleanly — actually works."""
    from backend.core.mesh import pairing

    await pairing.register_device(uuid.uuid4().hex[:8], "Laptop")
    assert client.post("/api/mesh/pair/start").status_code == 409

    client.post("/api/mesh/leave")
    assert client.post("/api/mesh/pair/start").status_code == 200


@pytest.mark.asyncio
async def test_the_device_list_says_which_os_each_one_is(client):
    """Two machines both called "This device" are otherwise indistinguishable.
    The column has been written since the table existed and never surfaced."""
    client.post("/api/mesh/pair/start")
    devices = client.get("/api/mesh/devices").json()["devices"]

    assert devices
    assert "platform" in devices[0]
    assert devices[0]["platform"]
