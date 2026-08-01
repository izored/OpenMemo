"""Mesh API (ADR-024). Two-way device sync.

Every route here is behind `require_enabled`, so the whole surface 404s until
the user switches Mesh on in Settings → Mesh — indistinguishable from an
endpoint that was never built.

Phase 1 ships the gate and a status probe only. Pairing, the device list and the
sync socket land in later phases; this exists so the frontend has something real
to talk to and so the gating is proven before anything depends on it.
"""
from fastapi import APIRouter, Depends

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
