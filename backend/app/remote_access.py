"""Access from other devices (the GlossX mobile app) to this computer's backend.

The phone and tablet apps do not run Claude Code or Codex themselves: they open
this backend over the local network and drive the CLIs installed here.

Requests from this computer (loopback) are always allowed, so the desktop app
and ``npm start`` in a local browser are unchanged. A request from any other
address must carry the pairing code, as

* ``?token=<code>`` on a page load (the mobile app's first navigation), which
  also sets an HttpOnly cookie so the SPA's relative ``/api`` calls, PDF loads
  and EventSource streams carry it from then on;
* the ``gloss_token`` cookie;
* an ``X-Gloss-Token`` or ``Authorization: Bearer`` header.

``GLOSS_REMOTE_AUTH=off`` turns the check off (a trusted network behind your own
auth proxy). ``GLOSS_ACCESS_TOKEN`` pins the code instead of the generated one.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import os
import secrets
import socket
import threading
from http.cookies import SimpleCookie
from typing import Any
from urllib.parse import parse_qs

from . import config

STATE_PATH = config.DATA_DIR / "remote_access.json"
DEFAULT_PORT = 8010
COOKIE = "gloss_token"
# no 0/o/1/l/i: the code is read off one screen and typed on another
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_lock = threading.Lock()


def _new_token() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def _normalize(code: str) -> str:
    return "".join(ch for ch in code.lower() if ch.isalnum())


def load_state() -> dict[str, Any]:
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            state = {}
    except (OSError, ValueError):
        state = {}
    state.setdefault("enabled", False)
    state.setdefault("port", DEFAULT_PORT)
    return state


def _write_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def token() -> str:
    """The pairing code; generated on first use and kept across restarts."""
    pinned = os.environ.get("GLOSS_ACCESS_TOKEN", "").strip()
    if pinned:
        return pinned
    with _lock:
        state = load_state()
        if not state.get("token"):
            state["token"] = _new_token()
            _write_state(state)
        return state["token"]


def update(enabled: bool | None = None, port: int | None = None, rotate: bool = False) -> dict[str, Any]:
    with _lock:
        state = load_state()
        if enabled is not None:
            state["enabled"] = bool(enabled)
        if port is not None:
            state["port"] = int(port)
        if rotate or not state.get("token"):
            state["token"] = _new_token()
        _write_state(state)
        return state


def auth_enabled() -> bool:
    return os.environ.get("GLOSS_REMOTE_AUTH", "").strip().lower() not in {"off", "0", "false", "no"}


def is_local(host: str | None) -> bool:
    if not host:
        return False
    if host == "testclient":  # Starlette's TestClient
        return True
    try:
        return ipaddress.ip_address(host.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def valid(code: str | None) -> bool:
    if not code:
        return False
    return hmac.compare_digest(_normalize(code).encode(), _normalize(token()).encode())


def lan_addresses() -> list[str]:
    """IPv4 addresses other devices on the network can try, best first."""
    found: list[str] = []
    try:
        # no packet is sent; this only asks the OS which interface routes out
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            found.append(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out: list[str] = []
    for ip in found:
        try:
            parsed = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if parsed.is_loopback or parsed.is_link_local or ip in out:
            continue
        out.append(ip)
    return out


def launch_target(host: str, port: int, host_explicit: bool) -> tuple[str, int]:
    """Where the desktop backend should listen: on the network at a stable port
    once "Allow mobile devices" is on, otherwise exactly as requested."""
    if host_explicit or not load_state().get("enabled"):
        return host, port
    return "0.0.0.0", int(load_state().get("port") or DEFAULT_PORT)


def _headers(scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}


class RemoteAuthMiddleware:
    """Pure ASGI so streaming responses and WebSockets pass through untouched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"} or not auth_enabled():
            return await self.app(scope, receive, send)
        client = scope.get("client")
        if is_local(client[0] if client else None):
            return await self.app(scope, receive, send)

        headers = _headers(scope)
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        from_query = (query.get("token") or [None])[0]
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get("cookie", ""))
        except Exception:
            pass
        bearer = headers.get("authorization", "")
        candidates = [
            headers.get("x-gloss-token"),
            bearer[7:] if bearer.lower().startswith("bearer ") else None,
            cookie[COOKIE].value if COOKIE in cookie else None,
            from_query,
        ]
        if not any(valid(c) for c in candidates):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4401})
                return
            body = b'{"detail":"GlossX: pairing code required for devices other than this computer"}'
            await send({"type": "http.response.start", "status": 401, "headers": [
                (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
            ]})
            await send({"type": "http.response.body", "body": body})
            return

        if scope["type"] != "http" or not valid(from_query):
            return await self.app(scope, receive, send)

        # remember the code so the page's own requests don't need it
        set_cookie = f"{COOKIE}={_normalize(token())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000".encode()

        async def send_with_cookie(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), (b"set-cookie", set_cookie)]}
            await send(message)

        await self.app(scope, receive, send_with_cookie)
