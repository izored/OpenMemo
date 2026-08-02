"""The merge engine (ADR-024 §6, §7, §10).

Pure functions. No database, no network, no clock — every input arrives as an
argument. That is deliberate: this is the part that decides whether the user
keeps their work, so it has to be exhaustively testable without standing up two
machines, and every case has to be runnable in both directions to prove it
converges.

**Three-way, not two-way.** Comparing local against remote cannot tell "you
edited the title and I edited the tags" apart from "we both set the title". Both
look like *different*. So the merge takes a `base` — the row as it stood when the
two devices last agreed — and diffs each side against it. Then "who touched what"
is a fact rather than a guess, and the common case (each side edited different
fields) merges silently instead of asking.

Where `base` comes from is the protocol's problem (§5), not this module's.

Field policy, from §7's three tiers:

* `LOCAL_ONLY` — never crosses the wire at all. Where a file happens to live on
  this disk is not a fact about the library.
* `MACHINE` — transcripts and AI output. Expensive to make, cheap to move, and
  never worth asking a human about. Absence never beats presence (§10).
* `HUMAN` — the words someone typed. The only tier that can raise a conflict.
* everything else — plain last-writer-wins, silently.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.core.mesh.clock import parse as parse_hlc

# Per-device state. Never synced: the memo row carries the magnet (§1), and each
# device records where its own copy landed and how far it has got with it.
LOCAL_ONLY: frozenset[str] = frozenset({
    "file_path", "thumbnail_path",
    "localize_status", "localize_error",
    "embedding_ids", "embed_status",
})

# Machine-generated. Never prompts. Absence never beats presence, because a
# device that has not transcribed yet must not overwrite a peer that has —
# not-done is not an edit (§10).
MACHINE: frozenset[str] = frozenset({
    "content_text", "ai_summary", "summaries", "video_description",
    "transcript_status", "transcript_lang", "transcript_source",
})

# Human-authored prose. The only fields that can reach the dialogue (§7).
HUMAN: frozenset[str] = frozenset({
    "title", "description", "content_raw", "notes", "name",
})

# Merged key-by-key rather than as one value. `summaries` is a dict keyed by
# mode: generate "essay" on one device and "insights" on the other, and plain
# last-writer-wins keeps one dict and silently discards an expensive Ollama run.
DICT_UNION: frozenset[str] = frozenset({"summaries"})

RULE_UNCHANGED = "unchanged"
RULE_LOCAL = "local"
RULE_REMOTE = "remote"
RULE_LWW = "lww"
RULE_UNION = "union"
RULE_NON_NULL = "non-null"
RULE_CONFLICT = "conflict"


@dataclass
class Conflict:
    """A field both sides genuinely edited, needing the user (§7)."""

    field: str
    local_value: Any
    remote_value: Any
    base_value: Any = None


@dataclass
class MergeResult:
    values: dict[str, Any] = field(default_factory=dict)
    rules: dict[str, str] = field(default_factory=dict)
    conflicts: list[Conflict] = field(default_factory=list)

    @property
    def has_conflicts(self) -> bool:
        return bool(self.conflicts)


def _is_empty(v: Any) -> bool:
    """Absence, for the non-null rule. An empty string counts: a transcript of
    "" is not a transcript, and treating it as content would let a blank field
    beat a real one."""
    return v is None or v == "" or v == {} or v == []


def _merge_dict_field(
    local: Any, remote: Any, base: Any, remote_newer: bool
) -> tuple[Any, str]:
    """Union two dicts key by key, so work done on either device survives.

    `remote_newer` settles the case where BOTH sides regenerated the same key.
    Without it the union kept whichever side happened to be called "local",
    which is different on each machine — so the two libraries would drift apart
    permanently and silently, with no conflict ever raised. Machine output, so
    it resolves by order rather than by asking.
    """
    if not isinstance(local, dict) or not isinstance(remote, dict):
        # One side is not a dict (legacy row, or cleared). Fall back to
        # preferring whatever is actually there.
        if _is_empty(local):
            return remote, RULE_NON_NULL
        if _is_empty(remote):
            return local, RULE_NON_NULL
        return remote, RULE_LWW

    base = base if isinstance(base, dict) else {}
    out = dict(local)
    rule = RULE_UNCHANGED if local == remote else RULE_UNION
    for key, remote_value in remote.items():
        if key not in out:
            out[key] = remote_value
        elif out[key] != remote_value:
            base_value = base.get(key)
            if base_value == out[key]:
                out[key] = remote_value          # only the remote moved
            elif base_value == remote_value:
                pass                             # only the local moved
            elif remote_newer:
                out[key] = remote_value          # both moved: order decides
    return out, rule


def merge_row(
    *,
    local: dict[str, Any] | None,
    remote: dict[str, Any] | None,
    base: dict[str, Any] | None = None,
    local_hlc: str | None = None,
    remote_hlc: str | None = None,
) -> MergeResult:
    """Merge one row. Symmetric: swapping the sides yields the same values.

    `local_hlc` / `remote_hlc` order the two versions when a genuine
    last-writer-wins decision is needed. They are compared, never trusted as
    wall-clock truth (§5).
    """
    result = MergeResult()

    # Deletion is a whole-row decision, so it is settled before any field is
    # considered. A tombstone that is newer than the surviving edit wins;
    # an edit newer than the tombstone resurrects the row deliberately.
    if local is None and remote is None:
        return result
    if local is None:
        result.values = {k: v for k, v in remote.items() if k not in LOCAL_ONLY}
        result.rules = {k: RULE_REMOTE for k in result.values}
        return result
    if remote is None:
        result.values = {k: v for k, v in local.items() if k not in LOCAL_ONLY}
        result.rules = {k: RULE_LOCAL for k in result.values}
        return result

    remote_newer = _remote_is_newer(local_hlc, remote_hlc)
    base = base or {}

    for key in sorted(set(local) | set(remote)):
        if key in LOCAL_ONLY:
            continue

        lv = local.get(key)
        rv = remote.get(key)

        if lv == rv:
            result.values[key] = lv
            result.rules[key] = RULE_UNCHANGED
            continue

        if key in DICT_UNION:
            merged, rule = _merge_dict_field(lv, rv, base.get(key), remote_newer)
            result.values[key] = merged
            result.rules[key] = rule
            continue

        if key in MACHINE:
            # Absence never beats presence — see §10. Only when both sides have
            # something does this become an ordinary ordering question.
            if _is_empty(lv) and not _is_empty(rv):
                result.values[key], result.rules[key] = rv, RULE_NON_NULL
            elif _is_empty(rv) and not _is_empty(lv):
                result.values[key], result.rules[key] = lv, RULE_NON_NULL
            else:
                result.values[key] = rv if remote_newer else lv
                result.rules[key] = RULE_LWW
            continue

        bv = base.get(key)
        # Tier 2 of §7: with a base we can tell who actually moved, so if only
        # one side did there is nothing to arbitrate. This is what keeps the
        # dialogue rare — two people working on different parts of the same memo
        # never collide. Without a base every difference looks like a conflict,
        # so the shortcut is skipped rather than guessed.
        if base:
            local_changed = lv != bv
            remote_changed = rv != bv
            if local_changed and not remote_changed:
                result.values[key], result.rules[key] = lv, RULE_LOCAL
                continue
            if remote_changed and not local_changed:
                result.values[key], result.rules[key] = rv, RULE_REMOTE
                continue

        if key in HUMAN:
            # Both sides edited the same prose. The only case a human decides.
            result.conflicts.append(
                Conflict(field=key, local_value=lv, remote_value=rv, base_value=bv)
            )
            result.values[key] = rv if remote_newer else lv
            result.rules[key] = RULE_CONFLICT
            continue

        result.values[key] = rv if remote_newer else lv
        result.rules[key] = RULE_LWW

    return result


def _remote_is_newer(local_hlc: str | None, remote_hlc: str | None) -> bool:
    """Order two versions. Missing stamps lose to present ones, and if neither
    side has one the local value stands — never invent an ordering."""
    if not remote_hlc:
        return False
    if not local_hlc:
        return True
    return parse_hlc(remote_hlc) > parse_hlc(local_hlc)


def merge_link(
    *,
    local_present: bool,
    remote_present: bool,
    local_hlc: str | None,
    remote_hlc: str | None,
) -> tuple[bool, str]:
    """Membership in a collection or a tag. Returns (present, rule).

    An OR-set with tombstones rather than a plain union: a union can never
    express removal, so untagging on one device would be undone by the other on
    every single sync. The newer action wins, so a removal beats an older add
    and an add beats an older removal.
    """
    if local_present == remote_present:
        return local_present, RULE_UNCHANGED
    return (
        (remote_present, RULE_REMOTE)
        if _remote_is_newer(local_hlc, remote_hlc)
        else (local_present, RULE_LOCAL)
    )
