"""Finding the other machine on your network (ADR-024 §2 tier 1).

The plug-and-play half. The twelve words are typed once, ever; after that the
two machines find each other on any network they share, with no address to
remember and nothing to reconfigure when the router hands out new IPs.

**What is advertised, and what is not.** The TXT record carries a device name
and `hash(chain_id)` — never the chain id itself, never the code, never a memo.
Anyone sniffing your LAN learns that a machine runs openMemo and that it belongs
to *some* library; they cannot tell which, and they cannot join it.

Matching on the hash rather than a fixed service name is what makes this
zero-config: two machines holding the same words recognise each other, and two
different households on the same café Wi-Fi do not.

**Docker cannot do this**, and that is designed for rather than worked around.
Bridge networking blocks multicast and `network_mode: host` does not exist on
Docker Desktop, so a container will neither advertise nor browse. It does not
need to: it dials outward (`client.py`), and the desktop it dials is the machine
that never moves. Only one side ever has to be findable.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import socket
from dataclasses import dataclass

logger = logging.getLogger(__name__)

SERVICE_TYPE = "_openmemo._tcp.local."

# How long `browse()` listens before giving up. Long enough for a sleepy laptop
# to answer, short enough that a "look for my other computer" button does not
# feel broken.
BROWSE_SECONDS = 4.0

_aiozc = None
_registered = None


@dataclass
class Peer:
    name: str
    host: str
    port: int
    chain_hash: str


def chain_fingerprint(chain_id: str) -> str:
    """A short hash of the chain id, safe to broadcast.

    The chain id is already derived from the seed, but broadcasting it directly
    would let anyone on the network record a stable identifier for this library.
    A truncated hash is enough to recognise a peer and useless for anything else.
    """
    return hashlib.sha256(chain_id.encode()).hexdigest()[:16]


def _local_ip() -> str:
    """This machine's LAN address.

    Uses a UDP socket to a routable address rather than `gethostname()`, which
    on Windows and in containers frequently resolves to 127.0.0.1 — advertising
    that would tell peers to connect to themselves.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))     # no packet is sent; this only picks a route
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def advertise(*, port: int, device_name: str, chain_id: str) -> bool:
    """Announce this machine. Returns False when mDNS is unavailable.

    Never fatal: multicast is blocked in Docker and on some corporate networks,
    and openMemo must keep working when it is. A device that cannot advertise
    can still be reached by address, and can still dial out itself.
    """
    global _aiozc, _registered
    if _registered is not None:
        return True

    try:
        from zeroconf import ServiceInfo
        from zeroconf.asyncio import AsyncZeroconf

        ip = _local_ip()
        fingerprint = chain_fingerprint(chain_id)
        info = ServiceInfo(
            SERVICE_TYPE,
            f"{fingerprint}-{device_name}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(ip)],
            port=port,
            properties={
                "chain": fingerprint,
                "device": device_name,
                # Version so a future protocol change can be spotted before a
                # connection is attempted rather than after.
                "v": "1",
            },
            server=f"openmemo-{fingerprint}.local.",
        )
        _aiozc = AsyncZeroconf()
        await _aiozc.async_register_service(info)
        _registered = info
        logger.info("mesh: advertising on %s:%d as %s", ip, port, fingerprint)
        return True
    except Exception:
        logger.warning(
            "mesh: could not advertise on this network — pairing by address "
            "still works", exc_info=True,
        )
        return False


async def stop_advertising() -> None:
    global _aiozc, _registered
    if _aiozc is not None and _registered is not None:
        try:
            await _aiozc.async_unregister_service(_registered)
            await _aiozc.async_close()
        except Exception:
            logger.debug("mesh: advertise teardown failed", exc_info=True)
    _aiozc, _registered = None, None


async def browse(
    chain_id: str, *, seconds: float = BROWSE_SECONDS, own_port: int | None = None
) -> list[Peer]:
    """Look for machines in the same Mesh. Returns only matching peers.

    Filtering on the fingerprint here, rather than connecting and finding out,
    means a stranger's openMemo on the same café Wi-Fi is never even dialed.
    """
    wanted = chain_fingerprint(chain_id)
    found: dict[str, Peer] = {}

    try:
        from zeroconf import ServiceBrowser, ServiceStateChange
        from zeroconf.asyncio import AsyncZeroconf
    except ImportError:
        logger.warning("mesh: zeroconf unavailable; cannot browse")
        return []

    azc = AsyncZeroconf()
    loop = asyncio.get_running_loop()

    def _on_change(zeroconf, service_type, name, state_change) -> None:
        if state_change is not ServiceStateChange.Added:
            return

        def _resolve() -> None:
            info = zeroconf.get_service_info(service_type, name, timeout=2000)
            if not info or not info.addresses:
                return
            props = {
                k.decode(): v.decode()
                for k, v in (info.properties or {}).items()
                if k and v
            }
            if props.get("chain") != wanted:
                return           # a different library — never dialed
            host = socket.inet_ntoa(info.addresses[0])
            # Exclude ourselves by ENDPOINT, not by address. Filtering on IP
            # alone hides a second instance running on the same machine from the
            # first — which is both wrong and exactly what made this untestable
            # without two pieces of hardware.
            if host == _local_ip() and (own_port is None or info.port == own_port):
                return
            found[host] = Peer(
                name=props.get("device", "openMemo"),
                host=host, port=info.port or 0,
                chain_hash=props["chain"],
            )

        loop.run_in_executor(None, _resolve)

    try:
        ServiceBrowser(azc.zeroconf, SERVICE_TYPE, handlers=[_on_change])
        await asyncio.sleep(seconds)
    except Exception:
        logger.warning("mesh: browsing failed", exc_info=True)
    finally:
        try:
            await azc.async_close()
        except Exception:
            pass

    return list(found.values())
