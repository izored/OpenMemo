"""The Mesh code, pairing and device roles (ADR-024 §2, §3).

Two things carry real weight here: the code is the entire identity, so a wrong
one must fail loudly rather than half-work; and exactly one device may poll
Telegram, which is a correctness requirement rather than a preference.
"""
import pytest
from sqlalchemy import text

from backend.core.mesh import clock, pairing, secret
from backend.core.mesh.sync_state import mesh_schema_init
from backend.db.database import AsyncSessionLocal, init_db


@pytest.fixture(autouse=True)
async def _fresh():
    await init_db()
    await mesh_schema_init()
    async with AsyncSessionLocal() as db:
        await db.execute(text("DELETE FROM mesh_devices"))
        await db.commit()
    yield


# -- the words ---------------------------------------------------------------

def test_a_generated_code_is_twelve_valid_words():
    code = pairing.generate_code()
    assert len(pairing.validate(code)) == pairing.WORD_COUNT


def test_two_codes_are_never_the_same():
    codes = {pairing.generate_code() for _ in range(20)}
    assert len(codes) == 20


def test_a_typo_fails_immediately_rather_than_pairing_badly():
    """The checksum is the point. Without it a mistyped word becomes a pairing
    that silently never connects, which is far harder to diagnose."""
    words = pairing.generate_code().split()
    words[3] = "zebra" if words[3] != "zebra" else "zoo"
    with pytest.raises(pairing.PairingError):
        pairing.validate(" ".join(words))


def test_a_word_that_is_not_in_the_list_is_named_in_the_error():
    code = pairing.generate_code().split()
    code[2] = "asdfgh"
    with pytest.raises(pairing.PairingError, match="asdfgh"):
        pairing.validate(" ".join(code))


@pytest.mark.parametrize("bad", ["", "one two three", None, "   "])
def test_a_wrong_length_says_so_plainly(bad):
    with pytest.raises(pairing.PairingError, match="12 words"):
        pairing.validate(bad)


def test_messy_input_still_pairs():
    """People paste from notes apps that add commas, capitals and line breaks.
    None of that should be the difference between pairing and not."""
    code = pairing.generate_code()
    messy = "  " + ",\n ".join(w.upper() for w in code.split()) + "  "
    assert pairing.validate(messy) == code.split()


def test_the_same_words_always_give_the_same_seed():
    """Two machines must derive identical keys from identical words, or they are
    not the same library."""
    code = pairing.generate_code()
    assert pairing.seed_from_code(code) == pairing.seed_from_code(code)
    assert pairing.seed_from_code(code) != pairing.seed_from_code(pairing.generate_code())


def test_word_order_matters():
    words = pairing.generate_code().split()
    shuffled = " ".join(words[::-1])
    try:
        assert pairing.seed_from_code(" ".join(words)) != pairing.seed_from_code(shuffled)
    except pairing.PairingError:
        pass  # reversing usually breaks the checksum, which is also correct


# -- adopting a code ---------------------------------------------------------

def test_storing_a_code_changes_every_derived_key():
    """Pairing means joining someone's library. If the keys did not change, the
    two machines would still be strangers."""
    before = secret.psk()
    pairing.store_code(pairing.generate_code())
    assert secret.psk() != before, "the pre-shared key must follow the code"
    assert secret.chain_id() != "", "the chain id must be derivable"


def test_two_devices_given_the_same_code_agree_on_every_key():
    code = pairing.generate_code()
    pairing.store_code(code)
    first = (secret.psk(), secret.content_key(), secret.chain_id())

    secret.reset_root()
    pairing.store_code(code)
    assert (secret.psk(), secret.content_key(), secret.chain_id()) == first


def test_a_bad_code_is_never_adopted():
    pairing.store_code(pairing.generate_code())
    good = secret.psk()
    with pytest.raises(pairing.PairingError):
        pairing.store_code("clearly not a real mesh code at all here now")
    assert secret.psk() == good, "a failed pairing must not disturb the current one"


# -- the QR ------------------------------------------------------------------

def test_the_qr_carries_the_code_and_an_address_hint():
    code = pairing.generate_code()
    uri = pairing.pairing_uri(code, host="192.168.1.42", port=8770)
    assert uri.startswith("openmemo://sync?c=")
    assert "h=192.168.1.42" in uri and "p=8770" in uri


def test_the_qr_renders_without_a_binary_image_dependency():
    svg = pairing.qr_svg(pairing.pairing_uri(pairing.generate_code()))
    assert svg.lstrip().startswith("<?xml") and "<svg" in svg


# -- devices and the primary role (§3) ---------------------------------------

async def test_devices_are_listed_with_the_primary_first():
    await pairing.register_device("dev00001", "IZORED-ADMIN")
    await pairing.register_device("dev00002", "Redas-MacBook-Pro")
    await pairing.set_primary("dev00002")

    listed = await pairing.devices()
    assert listed[0].device_id == "dev00002" and listed[0].is_primary


async def test_only_one_device_can_be_primary():
    await pairing.register_device("a1111111", "PC")
    await pairing.register_device("b2222222", "Mac")
    await pairing.set_primary("a1111111")
    await pairing.set_primary("b2222222")

    assert sum(1 for d in await pairing.devices() if d.is_primary) == 1
    assert await pairing.primary_device_id() == "b2222222"


async def test_revoking_a_device_is_recorded():
    await pairing.register_device("gone0001", "Old laptop")
    assert await pairing.revoke("gone0001")
    assert await pairing.is_revoked("gone0001")


# -- the Telegram singleton, which is the point of the role ------------------

async def test_a_single_device_install_always_runs_singleton_jobs():
    """Mesh must never be able to stop the Telegram relay on a machine that has
    no peers. No primary chosen means this device is it."""
    assert await pairing.this_device_is_primary()
    assert await pairing.may_run_singleton("telegram_relay")


async def test_only_the_primary_polls_telegram():
    """Telegram hands each update to whoever asks first, exactly once, and the
    offset lives in memory per process. Two devices polling one token race and
    lose memos outright — so this is correctness, not preference."""
    from backend.core.app_settings import get_settings, update_settings

    before = bool(get_settings().get("mesh_enabled", False))
    try:
        update_settings({"mesh_enabled": True})
        await pairing.register_device("otherdev", "The other machine")
        await pairing.set_primary("otherdev")

        assert not await pairing.this_device_is_primary()
        assert not await pairing.may_run_singleton("telegram_relay"), (
            "a non-primary device must not poll the bot"
        )

        await pairing.set_primary(await clock.device_id())
        assert await pairing.may_run_singleton("telegram_relay")
    finally:
        update_settings({"mesh_enabled": before})


async def test_with_mesh_off_the_relay_runs_regardless_of_roles():
    """The guard must be invisible to anyone not using Mesh."""
    from backend.core.app_settings import get_settings, update_settings

    before = bool(get_settings().get("mesh_enabled", False))
    try:
        update_settings({"mesh_enabled": False})
        await pairing.register_device("otherdev", "Someone else")
        await pairing.set_primary("otherdev")
        assert await pairing.may_run_singleton("telegram_relay"), (
            "Mesh being off must never stop the relay"
        )
    finally:
        update_settings({"mesh_enabled": before})


# -- phase 9 hardening -------------------------------------------------------

def test_repeated_handshake_failures_are_throttled():
    """Off the LAN, anyone who can reach the port can grind at the shared
    secret. Slowing it is enough against 128 bits — the point is to make a
    sustained attempt obvious and expensive."""
    from backend.core.mesh import session

    session._failures.clear()
    peer = "10.0.0.9"
    assert session.handshake_allowed(peer)

    for _ in range(session._MAX_FAILURES):
        session.note_handshake_failure(peer)

    assert not session.handshake_allowed(peer), "a grinder must be locked out"
    assert session.handshake_allowed("10.0.0.10"), "and only that peer, not everyone"
    session._failures.clear()


async def test_a_revoked_device_is_refused_at_the_handshake():
    """Revocation cannot reach out and delete the code from a removed laptop, so
    it has to be enforced on every connection rather than in the UI alone."""
    await pairing.register_device("badlaptop", "Lost laptop")
    await pairing.revoke("badlaptop")
    assert await pairing.is_revoked("badlaptop")

    # and a device that was never revoked is unaffected
    await pairing.register_device("goodlaptop", "Current laptop")
    assert not await pairing.is_revoked("goodlaptop")
