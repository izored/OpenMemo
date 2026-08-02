"""Mesh — two-way device sync (ADR-024).

A package rather than a module because the feature grows across phases. The
public surface stays `backend.core.mesh`, so callers never learn the internals:

    from backend.core.mesh import is_enabled, require_enabled

Modules:
  _gate      the feature flag every phase checks (§0)
  clock      hybrid logical clock (§5)
  changelog  the change log and its triggers (§4)
  merge      the merge engine (§6, §7, §10)
  journal    the Mesh log, snapshots and rollback (§13)
"""
from backend.core.mesh._gate import SETTING_KEY, is_enabled, require_enabled
from backend.core.mesh.sync_state import apply_enabled_state, mesh_schema_init

__all__ = [
    "SETTING_KEY",
    "is_enabled",
    "require_enabled",
    "apply_enabled_state",
    "mesh_schema_init",
]
