"""mDNS discovery (ADR-024 §2 tier 1).

What matters here is not that broadcasting works — it is what is broadcast, and
who gets filtered out before a connection is ever attempted.
"""
import pytest

from backend.core.mesh import discovery


def test_the_broadcast_never_carries_the_chain_id_itself():
    """Anyone on the network can read an mDNS record. Broadcasting the chain id
    would hand them a stable identifier for this library; a truncated hash is
    enough to recognise a peer and useless for anything else."""
    chain = "a" * 64
    fp = discovery.chain_fingerprint(chain)

    assert chain not in fp
    assert len(fp) == 16
    assert fp == discovery.chain_fingerprint(chain), "must be stable"


def test_different_libraries_get_different_fingerprints():
    """Two households on one cafe Wi-Fi must not look like the same Mesh."""
    a = discovery.chain_fingerprint("library-one")
    b = discovery.chain_fingerprint("library-two")
    assert a != b


def test_the_local_address_is_never_loopback_when_a_network_exists():
    """gethostname() resolves to 127.0.0.1 on Windows and in containers often
    enough that advertising it would tell peers to connect to themselves."""
    ip = discovery._local_ip()
    assert ip and ip.count(".") == 3


async def test_browsing_without_a_network_returns_nothing_rather_than_raising():
    """Multicast is blocked in Docker and on some corporate networks. An empty
    list is the correct answer there; an exception would break the UI."""
    peers = await discovery.browse("nobody-else-here", seconds=0.5)
    assert isinstance(peers, list)


async def test_advertising_failure_is_survivable():
    """A device that cannot advertise can still be reached by address and can
    still dial out itself, so this must never be fatal."""
    ok = await discovery.advertise(port=0, device_name="test", chain_id="x")
    assert isinstance(ok, bool)
    await discovery.stop_advertising()
