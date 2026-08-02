"""The isolated Mesh listener (ADR-024 §2 isolation).

The owner's requirement, and the one that shapes this file: **openMemo itself
never goes online.** Only a narrow metadata channel does.

So this is not a route on the application. It is a **separate ASGI app with a
separate routing table, on a separate port**, whose entire URL space is one
WebSocket endpoint. There is no `/api` to walk to, no static files, no SPA
fallback — not because they are blocked, but because they were never mounted.
A path traversal here has nowhere to go.

Consequences of that choice, worth stating because they are easy to erode later:

* Adding a convenience route to this app puts it on the network. Do not.
* The app's own port keeps its unauthenticated-by-design local API
  (`docs/DECISIONS.md`) and must never be exposed. Reaching another network is
  the overlay's job (§2 tier 2), never a port forward.
* Bind is loopback + the overlay interface. Never `0.0.0.0` by default: a laptop
  that joins a café network should not start listening on it.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Awaitable

from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

DEFAULT_PORT = 8770

# Loopback only unless the user opts into more. The overlay (§2 tier 2) hands
# this machine a private address; binding that is an explicit act, not a default.
DEFAULT_HOST = "127.0.0.1"

_server: Any = None
_task: asyncio.Task | None = None


async def _refuse(_request) -> PlainTextResponse:
    """Anything that is not the sync socket.

    404 with no detail: a probe on this port learns that something answers and
    nothing else. It must never hint at the application behind it.
    """
    return PlainTextResponse("Not Found", status_code=404)


def build_app(handler: Callable[[WebSocket], Awaitable[None]]) -> Starlette:
    """The entire Mesh URL space: one socket, and a catch-all that refuses.

    Written as an explicit allowlist so that adding a second route is a visible,
    deliberate act rather than something that happens by importing a router.
    """
    async def _endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        try:
            await handler(websocket)
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("mesh: session failed")
            try:
                await websocket.close(code=1011)
            except RuntimeError:
                pass

    return Starlette(
        routes=[
            WebSocketRoute("/mesh", _endpoint),
            Route("/{path:path}", _refuse, methods=["GET", "POST", "PUT", "DELETE", "PATCH"]),
        ]
    )


async def start(
    handler: Callable[[WebSocket], Awaitable[None]],
    *,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
) -> None:
    """Start the listener. Idempotent; only called while Mesh is enabled."""
    global _server, _task
    if _task is not None and not _task.done():
        return

    import socket

    import uvicorn

    # Claim the port ourselves first. uvicorn calls sys.exit(1) from INSIDE the
    # serve task when a bind fails, which no try/except around start() can catch
    # — it took down a whole test run before this check existed. A busy Mesh
    # port must never be able to stop the app, because the app does not need
    # Mesh to work.
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((host, port))
    except OSError as exc:
        probe.close()
        logger.warning(
            "mesh: port %s:%d is already in use (%s) — the metadata channel is "
            "not listening. openMemo is unaffected.", host, port, exc,
        )
        return
    finally:
        if probe.fileno() != -1:
            probe.close()

    config = uvicorn.Config(
        build_app(handler),
        host=host,
        port=port,
        log_level="warning",
        # No access log: it would record peer addresses and frame sizes for a
        # channel whose whole point is that it reveals as little as possible.
        access_log=False,
    )
    _server = uvicorn.Server(config)

    async def _serve() -> None:
        """Belt and braces: even with the probe above, a race between closing it
        and uvicorn binding could still lose. SystemExit from a background task
        must not escape into the app."""
        try:
            await _server.serve()
        except SystemExit:
            logger.warning("mesh: the listener could not start; continuing without it")

    _task = asyncio.create_task(_serve())
    logger.info("mesh: listening on %s:%d (metadata channel only)", host, port)


async def stop() -> None:
    global _server, _task
    if _server is not None:
        _server.should_exit = True
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
    _server, _task = None, None


def is_running() -> bool:
    return _task is not None and not _task.done()
