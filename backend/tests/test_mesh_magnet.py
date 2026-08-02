"""Magnets, covers and the fetch policy (ADR-024 §1, §8).

Two properties this has to get right: the peer is always available as a last
resort so a dead source never loses media, and structure arrives before media so
the library never looks broken while it fills.
"""
import pytest
from sqlalchemy import text

from backend.core.mesh import magnet
from backend.core.mesh.sync_state import mesh_schema_init
from backend.db.database import AsyncSessionLocal, init_db


@pytest.fixture(autouse=True)
async def _fresh():
    await init_db()
    await mesh_schema_init()
    async with AsyncSessionLocal() as db:
        for t in ("mesh_magnets", "memos", "collections", "workspaces"):
            await db.execute(text(f"DELETE FROM {t}"))
        await db.commit()
    yield


async def _memo(mid, **cols):
    fields = {"id": mid, "type": "note", "title": mid}
    fields.update(cols)
    keys = ", ".join(fields)
    binds = ", ".join(f":{k}" for k in fields)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"INSERT INTO memos ({keys}) VALUES ({binds})"), fields)
        await db.commit()


# -- building a magnet -------------------------------------------------------

def test_a_music_memo_lists_provider_then_origin_then_peer():
    """Source order IS the preference: best quality first, the original link
    next, the other machine last."""
    m = magnet.build_for_memo(
        {"file_path": "D:/files/default/abc.flac", "source_url": "https://music.apple.com/x",
         "type": "audio", "audio_kind": "music"},
        provider="qobuz", quality="24",
    )
    assert [s.kind for s in m.sources] == ["qobuz", "origin", "peer"]
    assert m.blob == "abc.flac"


def test_a_memo_with_no_source_can_only_come_from_the_peer():
    """This is the 1.58 GB that exists nowhere else — voice memos, screenshots,
    uploads. For these the peer is the only path, not the last one."""
    m = magnet.build_for_memo(
        {"file_path": "/files/default/voice.m4a", "source_url": None,
         "type": "audio", "audio_kind": "voice"},
    )
    assert [s.kind for s in m.sources] == ["peer"]


@pytest.mark.parametrize("row", [
    {"file_path": "", "source_url": "https://x"},
    {"file_path": None, "source_url": "https://x"},
    {"source_url": "https://x"},
])
def test_a_memo_with_no_file_has_no_magnet(row):
    assert magnet.build_for_memo(row) is None


def test_the_peer_is_always_present_as_a_last_resort():
    """Non-negotiable (§1). If refetch were the only path, a pulled YouTube
    video would mean losing media the other machine still has."""
    for row in [
        {"file_path": "a.mp4", "source_url": "https://youtube.com/x", "type": "video"},
        {"file_path": "b.flac", "source_url": "https://music.apple.com/y",
         "type": "audio", "audio_kind": "music"},
        {"file_path": "c.jpg", "source_url": None, "type": "image"},
    ]:
        m = magnet.build_for_memo(row, provider="qobuz")
        assert m.sources[-1].kind == "peer", f"no peer fallback for {row}"


def test_a_magnet_survives_the_round_trip():
    m = magnet.build_for_memo(
        {"file_path": "x/y/track.flac", "source_url": "https://s", "type": "audio",
         "audio_kind": "music"}, provider="qobuz", quality="24")
    back = magnet.Magnet.from_json(m.to_json())
    assert back.blob == m.blob
    assert [s.kind for s in back.sources] == [s.kind for s in m.sources]


@pytest.mark.parametrize("junk", [None, "", "not json", '{"no":"blob"}'])
def test_a_broken_magnet_decodes_to_nothing_rather_than_exploding(junk):
    assert magnet.Magnet.from_json(junk) is None


# -- backfill ----------------------------------------------------------------

async def test_backfill_covers_existing_memos_once():
    await _memo("m1", file_path="D:/files/default/a.flac", source_url="https://s",
                type="audio", audio_kind="music")
    await _memo("m2", file_path="D:/files/default/b.mp4", source_url="https://v",
                type="video")
    await _memo("m3", title="no file at all")

    assert await magnet.backfill() == 2, "only memos with files get magnets"
    assert await magnet.backfill() == 0, "backfill must be idempotent"
    assert (await magnet.get("m1")).blob == "a.flac"
    assert await magnet.get("m3") is None


# -- covers: structural, irreplaceable, first --------------------------------

async def test_a_missing_cover_is_noticed():
    """Covers live outside files/, so the magnet design missed them entirely
    until this was caught. They have no source, so the peer is the only path."""
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "INSERT INTO workspaces (id, name, kind, cover_ext) "
            "VALUES ('sp1', 'Fitness', 'space', 'jpg')"))
        await db.commit()

    missing = await magnet.missing_covers()
    assert any(c["row_id"] == "sp1" and c["tbl"] == "workspaces" for c in missing)


async def test_a_row_without_a_cover_is_not_reported_missing():
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "INSERT INTO workspaces (id, name, kind) VALUES ('sp2', 'Plain', 'space')"))
        await db.commit()
    assert not any(c["row_id"] == "sp2" for c in await magnet.missing_covers())


def test_covers_resolve_to_the_directories_the_app_already_uses():
    p = magnet.cover_path("workspaces", "sp1", "jpg")
    assert p is not None and p.name == "sp1.jpg" and p.parent.name == "space_covers"

    p = magnet.cover_path("collections", "c1", "png")
    assert p is not None and p.parent.name == "playlist_covers"

    assert magnet.cover_path("memos", "m1", "jpg") is None, "memos have no covers"


# -- the fetch plan ----------------------------------------------------------

async def test_covers_come_before_any_media():
    """A Space without its cover looks broken in a way a track without audio
    does not, so structure leads."""
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "INSERT INTO workspaces (id, name, kind, cover_ext) "
            "VALUES ('sp1', 'Fitness', 'space', 'jpg')"))
        await db.commit()
    await _memo("m1", source_url="https://s", type="audio")
    await magnet.put("m1", magnet.Magnet(blob="a.flac"))

    plan = await magnet.fetch_plan()
    assert plan[0]["kind"] == "cover"
    assert plan[0]["priority"] < min(
        p["priority"] for p in plan if p["kind"] == "media"
    )


async def test_the_default_policy_fetches_the_newest_twenty_eagerly():
    """Enough that the device is immediately useful; not a 24 GB pairing event."""
    for i in range(30):
        await _memo(f"m{i:02d}", source_url="https://s", type="audio")
        await magnet.put(f"m{i:02d}", magnet.Magnet(blob=f"{i}.flac"))

    plan = await magnet.fetch_plan(magnet.FETCH_RECENT)
    media = [p for p in plan if p["kind"] == "media"]
    assert len(media) == magnet.EAGER_RECENT
    assert all(p["priority"] == magnet.PRIORITY_RECENT for p in media)


async def test_keeping_everything_queues_the_long_tail_as_backfill():
    """The rest still comes, but must always yield to something opened."""
    for i in range(25):
        await _memo(f"m{i:02d}", source_url="https://s", type="audio")
        await magnet.put(f"m{i:02d}", magnet.Magnet(blob=f"{i}.flac"))

    media = [p for p in await magnet.fetch_plan(magnet.FETCH_EVERYTHING)
             if p["kind"] == "media"]
    assert len(media) == 25
    assert sum(1 for p in media if p["priority"] == magnet.PRIORITY_BACKFILL) == 5


async def test_fetch_on_open_still_brings_the_covers():
    """Even the laziest policy must not leave the library looking broken."""
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "INSERT INTO workspaces (id, name, kind, cover_ext) "
            "VALUES ('sp1', 'Fitness', 'space', 'jpg')"))
        await db.commit()
    await _memo("m1", source_url="https://s", type="audio")
    await magnet.put("m1", magnet.Magnet(blob="a.flac"))

    plan = await magnet.fetch_plan(magnet.FETCH_ON_OPEN)
    assert [p["kind"] for p in plan] == ["cover"]


async def test_memos_that_already_have_their_file_are_not_queued():
    await _memo("have", file_path="D:/files/default/x.flac", type="audio")
    await magnet.put("have", magnet.Magnet(blob="x.flac"))
    assert not [p for p in await magnet.fetch_plan() if p.get("memo_id") == "have"]
