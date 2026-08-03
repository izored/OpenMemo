"""Mesh API (ADR-024). Two-way device sync.

Every route here is behind `require_enabled`, so the whole surface 404s until
the user switches Mesh on in Settings → Mesh — indistinguishable from an
endpoint that was never built.

Phase 1 ships the gate and a status probe only. Pairing, the device list and the
sync socket land in later phases; this exists so the frontend has something real
to talk to and so the gating is proven before anything depends on it.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.config import settings
from backend.core.mesh import require_enabled

router = APIRouter(prefix="/api/mesh", tags=["mesh"])


@router.get("/status", dependencies=[Depends(require_enabled)])
async def mesh_status() -> dict:
    """What this device knows about its Mesh. 404s while Mesh is off.

    `paired` is hardcoded False until phase 8 brings the device list — the shape
    is stable now so the Settings pane can be built against it, but it must not
    pretend to know something it cannot yet.
    """
    return {
        "enabled": True,
        "paired": False,
        "device_name": None,
        "peers": [],
        "app_version": settings.VERSION,
    }


class ResolveBody(BaseModel):
    choice: Literal["local", "remote", "both"]
    # "do the same for the other 6" — forty conflicts from a mass import is one
    # decision, not forty modals (§7).
    apply_to_all: bool = False


@router.get("/conflicts", dependencies=[Depends(require_enabled)])
async def list_conflicts() -> dict:
    """Everything waiting on a decision. Nothing here has been applied."""
    from backend.core.mesh.apply import open_conflicts

    items = await open_conflicts()
    return {"conflicts": items, "count": len(items)}


@router.post("/conflicts/{conflict_id}/resolve", dependencies=[Depends(require_enabled)])
async def resolve(conflict_id: str, body: ResolveBody) -> dict:
    """Settle one conflict, or all of them with the same choice."""
    from backend.core.mesh.apply import resolve_all, resolve_conflict

    if body.apply_to_all:
        return {"ok": True, "resolved": await resolve_all(body.choice)}

    result = await resolve_conflict(conflict_id, body.choice)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("reason", "not found"))
    return result


@router.get("/history", dependencies=[Depends(require_enabled)])
async def history(limit: int = 50) -> dict:
    """Recent sync sessions — Settings → Mesh → History (§13)."""
    from backend.core.mesh.journal import batches

    return {"batches": await batches(limit=limit)}


@router.get("/history/{tbl}/{row_id}", dependencies=[Depends(require_enabled)])
async def row_history(tbl: str, row_id: str) -> dict:
    """What Mesh did to one memo — shown inline on the memo itself, which is
    where the question actually gets asked (§13)."""
    from backend.core.mesh.journal import for_row

    entries = await for_row(tbl, row_id)
    return {"entries": [vars(e) for e in entries]}


@router.post("/history/{batch_id}/undo", dependencies=[Depends(require_enabled)])
async def undo(batch_id: str) -> dict:
    """Reverse a sync session. Metadata only; media re-pulls from its magnet."""
    from backend.core.mesh.journal import undo_batch

    return {"reverted": await undo_batch(batch_id)}


# ── pairing (§2) ─────────────────────────────────────────────────────────────

class JoinBody(BaseModel):
    code: str


@router.post("/pair/start", dependencies=[Depends(require_enabled)])
async def start_pairing() -> dict:
    """Mint a Mesh code for this device and adopt it.

    Returns the words ONCE. They are not retrievable afterwards on a platform
    without a keychain, which the UI must say plainly rather than offering a
    "show again" that quietly fails.
    """
    from backend.core.mesh import clock, pairing

    code = pairing.generate_code()
    result = pairing.store_code(code)
    await pairing.register_device(await clock.device_id(), "This device", is_primary=True)
    await pairing.set_primary(await clock.device_id())
    return {
        "code": code,
        "words": code.split(),
        "in_keychain": result["in_keychain"],
        "uri": pairing.pairing_uri(code),
    }


@router.post("/pair/join", dependencies=[Depends(require_enabled)])
async def join_mesh(body: JoinBody) -> dict:
    """Adopt someone else's code. A bad code fails here, loudly."""
    from backend.core.mesh import clock, pairing

    try:
        pairing.store_code(body.code)
    except pairing.PairingError as exc:
        # 400 with the real reason: "a word is mistyped" is actionable in a way
        # that "pairing failed" never is.
        raise HTTPException(status_code=400, detail=str(exc))

    await pairing.register_device(await clock.device_id(), "This device")
    return {"ok": True}


@router.get("/pair/qr", dependencies=[Depends(require_enabled)])
async def pairing_qr(host: str | None = None, port: int | None = None):
    """The QR for the CURRENT code. 404 when this device has no words to show —
    a joined device stores the seed, and seeds are one-way."""
    from fastapi.responses import Response

    from backend.core.mesh import pairing

    code = pairing.reveal_code()
    if not code:
        raise HTTPException(status_code=404, detail="No code to show on this device")
    svg = pairing.qr_svg(pairing.pairing_uri(code, host=host, port=port))
    return Response(content=svg, media_type="image/svg+xml")


@router.get("/pair/code", dependencies=[Depends(require_enabled)])
async def reveal() -> dict:
    """The words, for the reveal panel. `available: false` is normal, not an
    error — a device that joined a Mesh never had them."""
    from backend.core.mesh import pairing

    code = pairing.reveal_code()
    return {"available": bool(code), "code": code, "words": code.split() if code else []}


@router.get("/devices", dependencies=[Depends(require_enabled)])
async def list_devices() -> dict:
    from backend.core.mesh import clock, pairing

    mine = await clock.device_id()
    return {
        "devices": [
            {**vars(d), "is_this_device": d.device_id == mine}
            for d in await pairing.devices()
        ],
        "this_device": mine,
    }


@router.post("/devices/{device_id}/revoke", dependencies=[Depends(require_enabled)])
async def revoke_device(device_id: str) -> dict:
    """Stop syncing with a device.

    Best-effort by nature, and the UI says so: a device that never reconnects
    never learns it was removed and still holds the code. Truly cutting it off
    means a new code and re-pairing (§3).
    """
    from backend.core.mesh import pairing

    if not await pairing.revoke(device_id):
        raise HTTPException(status_code=404, detail="Unknown device")
    return {"ok": True, "note": "This device stops syncing once it reconnects."}


@router.post("/devices/{device_id}/primary", dependencies=[Depends(require_enabled)])
async def make_primary(device_id: str) -> dict:
    """Hand over the primary role — one write, no migration (§3)."""
    from backend.core.mesh import pairing

    await pairing.set_primary(device_id)
    return {"ok": True, "primary": device_id}


class SyncBody(BaseModel):
    host: str
    port: int = 8770


@router.post("/sync", dependencies=[Depends(require_enabled)])
async def sync_now(body: SyncBody) -> dict:
    """Dial a peer and run one exchange.

    Manual for now: discovery (§2 tier 1) will call this on its own once it
    lands. Until then this is how two machines are told about each other, and it
    is what the convergence harness drives.
    """
    from backend.core.mesh.client import sync_with

    try:
        report = await sync_with(body.host, body.port)
    except Exception as exc:
        # A peer being unreachable is the normal case, not an error worth a 500.
        raise HTTPException(status_code=503, detail=f"Could not reach that device: {exc}")

    return {
        "ok": True,
        "batch_id": report.batch_id,
        "rows_applied": report.rows_applied,
        "conflicts": report.conflicts,
        "skipped": report.skipped,
    }
