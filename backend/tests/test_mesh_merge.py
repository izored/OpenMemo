"""The merge engine (ADR-024 §6, §7, §10).

This decides whether the user keeps their work, so the bar is higher than
"passes": every case is also run with the two devices swapped, and both runs
must produce the same values. A merge that depends on which machine happens to
be asking is not a merge.
"""
import pytest

from backend.core.mesh import merge
from backend.core.mesh.clock import HLC

OLD = str(HLC(1_700_000_000_000, 0, "aaaaaaaa"))
NEW = str(HLC(1_700_000_009_000, 0, "bbbbbbbb"))


def both_ways(*, local, remote, base=None, local_hlc=OLD, remote_hlc=NEW):
    """Merge A-against-B and B-against-A, assert they agree, return one result.

    The invariant the whole feature rests on: both machines reach the same
    library without talking to each other about who goes first.
    """
    forward = merge.merge_row(
        local=local, remote=remote, base=base,
        local_hlc=local_hlc, remote_hlc=remote_hlc,
    )
    backward = merge.merge_row(
        local=remote, remote=local, base=base,
        local_hlc=remote_hlc, remote_hlc=local_hlc,
    )
    assert forward.values == backward.values, (
        f"merge is not symmetric:\n  forward={forward.values}\n  backward={backward.values}"
    )
    assert {c.field for c in forward.conflicts} == {c.field for c in backward.conflicts}
    return forward


# ── the common case: different fields, no argument ───────────────────────────

def test_edits_to_different_fields_both_survive():
    """Tier 2 of §7, and the reason the dialogue stays rare."""
    base = {"id": "m1", "title": "Trip", "notes": ""}
    r = both_ways(
        local={"id": "m1", "title": "Trip to Rome", "notes": ""},
        remote={"id": "m1", "title": "Trip", "notes": "book the train"},
        base=base,
    )
    assert r.values["title"] == "Trip to Rome"
    assert r.values["notes"] == "book the train"
    assert not r.has_conflicts, "different fields must never ask the user"


def test_identical_values_are_not_a_change():
    r = both_ways(
        local={"id": "m1", "title": "same"},
        remote={"id": "m1", "title": "same"},
        base={"id": "m1", "title": "same"},
    )
    assert r.rules["title"] == merge.RULE_UNCHANGED
    assert not r.has_conflicts


# ── the case that must ask ───────────────────────────────────────────────────

def test_same_prose_edited_on_both_sides_raises_a_conflict():
    r = both_ways(
        local={"id": "m1", "notes": "the bass is incredible"},
        remote={"id": "m1", "notes": "check the bassline at 2:14"},
        base={"id": "m1", "notes": ""},
    )
    assert [c.field for c in r.conflicts] == ["notes"]
    c = r.conflicts[0]
    assert c.base_value == ""
    assert {c.local_value, c.remote_value} == {
        "the bass is incredible", "check the bassline at 2:14",
    }


def test_machine_fields_never_raise_a_conflict():
    """Two transcripts of the same audio are both valid. Asking a human to pick
    is noise, so §7 tier 1 resolves silently."""
    r = both_ways(
        local={"id": "m1", "content_text": "transcript A"},
        remote={"id": "m1", "content_text": "transcript B"},
        base={"id": "m1", "content_text": ""},
    )
    assert not r.has_conflicts
    assert r.values["content_text"] in {"transcript A", "transcript B"}


# ── §10 carve-out: absence is not an edit ────────────────────────────────────

@pytest.mark.parametrize("field", ["content_text", "ai_summary", "transcript_lang"])
@pytest.mark.parametrize("empty", [None, ""])
def test_nothing_never_beats_something(field, empty):
    """A device that has not transcribed yet must not wipe a peer that has, just
    because it touched the row more recently."""
    r = both_ways(
        local={"id": "m1", field: "20 minutes of Whisper output"},
        remote={"id": "m1", field: empty},
        local_hlc=OLD, remote_hlc=NEW,       # the empty side is NEWER
    )
    assert r.values[field] == "20 minutes of Whisper output"
    assert r.rules[field] == merge.RULE_NON_NULL


# ── §10 carve-out: summaries merge per key ───────────────────────────────────

def test_summaries_generated_on_different_devices_are_unioned():
    """Plain last-writer-wins would keep one dict and silently bin an expensive
    Ollama run."""
    r = both_ways(
        local={"id": "m1", "summaries": {"essay": "an essay"}},
        remote={"id": "m1", "summaries": {"insights": "some insights"}},
        base={"id": "m1", "summaries": {}},
    )
    assert r.values["summaries"] == {"essay": "an essay", "insights": "some insights"}
    assert r.rules["summaries"] == merge.RULE_UNION


def test_summaries_union_keeps_untouched_keys():
    r = both_ways(
        local={"id": "m1", "summaries": {"essay": "kept", "timestamp": "local"}},
        remote={"id": "m1", "summaries": {"essay": "kept", "insights": "remote"}},
        base={"id": "m1", "summaries": {"essay": "kept"}},
    )
    assert r.values["summaries"] == {
        "essay": "kept", "timestamp": "local", "insights": "remote",
    }


# ── per-device state never crosses ───────────────────────────────────────────

@pytest.mark.parametrize("field", sorted(merge.LOCAL_ONLY))
def test_local_only_fields_are_never_merged(field):
    """Where a file sits on this disk is not a fact about the library, and the
    extension can differ after a refetch (§1)."""
    r = both_ways(
        local={"id": "m1", field: "local-value"},
        remote={"id": "m1", field: "remote-value"},
    )
    assert field not in r.values


# ── deletion ─────────────────────────────────────────────────────────────────

def test_a_row_missing_on_one_side_is_carried_over():
    r = merge.merge_row(local=None, remote={"id": "m1", "title": "new memo"})
    assert r.values["title"] == "new memo"

    r = merge.merge_row(local={"id": "m1", "title": "mine"}, remote=None)
    assert r.values["title"] == "mine"


def test_two_missing_rows_produce_nothing():
    assert merge.merge_row(local=None, remote=None).values == {}


# ── membership (OR-set) ──────────────────────────────────────────────────────

def test_a_newer_removal_beats_an_older_add():
    """A plain union cannot express removal, so untagging on one device would be
    undone by the other on every sync, forever."""
    present, rule = merge.merge_link(
        local_present=True, remote_present=False,
        local_hlc=OLD, remote_hlc=NEW,
    )
    assert present is False
    assert rule == merge.RULE_REMOTE


def test_a_newer_add_beats_an_older_removal():
    present, _ = merge.merge_link(
        local_present=True, remote_present=False,
        local_hlc=NEW, remote_hlc=OLD,
    )
    assert present is True


def test_membership_agrees_from_both_sides():
    for lp, rp, lh, rh in [
        (True, False, OLD, NEW), (False, True, OLD, NEW),
        (True, False, NEW, OLD), (True, True, OLD, NEW),
    ]:
        a, _ = merge.merge_link(local_present=lp, remote_present=rp,
                                local_hlc=lh, remote_hlc=rh)
        b, _ = merge.merge_link(local_present=rp, remote_present=lp,
                                local_hlc=rh, remote_hlc=lh)
        assert a == b, f"membership disagreed for {(lp, rp, lh, rh)}"


# ── ordering ─────────────────────────────────────────────────────────────────

def test_newer_wins_a_plain_field():
    r = both_ways(
        local={"id": "m1", "sort_order": 1},
        remote={"id": "m1", "sort_order": 9},
        local_hlc=OLD, remote_hlc=NEW,
    )
    assert r.values["sort_order"] == 9


def test_a_missing_stamp_never_wins():
    """Never invent an ordering: without a stamp there is no evidence the remote
    is newer, so the local value stands."""
    r = merge.merge_row(
        local={"id": "m1", "sort_order": 1},
        remote={"id": "m1", "sort_order": 9},
        local_hlc=OLD, remote_hlc=None,
    )
    assert r.values["sort_order"] == 1


# ── the invariant, over many shapes ──────────────────────────────────────────

def test_convergence_holds_across_a_spread_of_shapes():
    """Swapping which device is 'local' must never change the outcome."""
    cases = [
        ({"id": "m", "title": "a"}, {"id": "m", "title": "b"}, {"id": "m", "title": "x"}),
        ({"id": "m", "pinned": True}, {"id": "m", "pinned": False}, None),
        ({"id": "m", "notes": "x", "liked": True},
         {"id": "m", "notes": "y", "liked": False},
         {"id": "m", "notes": "", "liked": False}),
        ({"id": "m", "summaries": {"a": 1}}, {"id": "m", "summaries": {"b": 2}}, None),
        ({"id": "m", "content_text": "t"}, {"id": "m", "content_text": None}, None),
        ({"id": "m", "is_deleted": True}, {"id": "m", "is_deleted": False}, None),
    ]
    for local, remote, base in cases:
        both_ways(local=local, remote=remote, base=base)


def test_the_same_summary_key_regenerated_on_both_sides_still_converges():
    """Review pass 1. The union kept whichever side happened to be called
    'local', so the two machines ended up with different summaries and stayed
    that way — a silent, permanent divergence rather than a visible conflict."""
    both_ways(
        local={"id": "m1", "summaries": {"essay": "version A"}},
        remote={"id": "m1", "summaries": {"essay": "version B"}},
        base={"id": "m1", "summaries": {"essay": "the original"}},
    )


# ── guard: new columns must be classified on purpose ─────────────────────────

def test_every_memo_column_has_a_deliberate_merge_policy():
    """Review pass 2. A column added later silently defaults to plain
    last-writer-wins, which is wrong for anything machine-generated (it would
    let an empty value beat a real transcript) and dangerous for anything
    per-device (it would sync one machine's file path onto the other).

    So the plain-LWW set is written down. Adding a column fails this test until
    someone decides which tier it belongs in.
    """
    from backend.db.models import Memo

    PLAIN_LWW = {
        # identity + provenance
        "id", "workspace_id", "type", "source_url", "source_domain", "source_favicon",
        # user-visible flags and ordering
        "pinned", "liked", "hidden", "sort_order", "card_size", "playlist_born",
        # audio metadata that arrives with the file
        "audio_kind", "audio_artist", "audio_album", "gallery",
        # lifecycle
        "is_processed", "is_deleted", "deleted_at",
        "created_at", "updated_at", "recency_at",
    }
    classified = merge.LOCAL_ONLY | merge.MACHINE | merge.HUMAN | merge.DICT_UNION
    columns = {c.name for c in Memo.__table__.columns}

    unaccounted = columns - classified - PLAIN_LWW
    assert not unaccounted, (
        f"new Memo column(s) {sorted(unaccounted)} have no merge policy. Add each to "
        f"LOCAL_ONLY (per-device state), MACHINE (generated, absence never wins), "
        f"HUMAN (can raise a conflict), or PLAIN_LWW here if newest-wins is right."
    )
    stale = PLAIN_LWW - columns
    assert not stale, f"PLAIN_LWW lists columns that no longer exist: {sorted(stale)}"


def test_local_only_and_machine_never_overlap():
    """A field cannot both never-cross-the-wire and be merged across devices."""
    assert not (merge.LOCAL_ONLY & merge.MACHINE)
    assert not (merge.LOCAL_ONLY & merge.HUMAN)
    assert not (merge.MACHINE & merge.HUMAN)
