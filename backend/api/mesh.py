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
