"""Settings for pairing the GlossX mobile app with this computer."""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import remote_access

router = APIRouter(prefix="/api/remote", tags=["remote"])


def _local_only(request: Request) -> None:
    if not remote_access.is_local(request.client.host if request.client else None):
        raise HTTPException(403, "Only this computer can change mobile access")


def _status(request: Request) -> dict:
    state = remote_access.load_state()
    server = request.scope.get("server") or (None, None)
    bound = os.environ.get("GLOSS_BIND_HOST", "")
    listening_port = server[1] or state["port"]
    # bound on all interfaces (npm start, or the desktop app with mobile access on)
    reachable = bound in {"0.0.0.0", "::"}
    port = listening_port if reachable else state["port"]
    addresses = remote_access.lan_addresses()
    return {
        "enabled": state["enabled"],
        "reachable": reachable,
        "restart_required": state["enabled"] and not reachable,
        "auth": remote_access.auth_enabled(),
        "port": port,
        "token": remote_access.token(),
        "addresses": addresses,
        "urls": [f"http://{ip}:{port}" for ip in addresses],
    }


@router.get("")
async def get_remote(request: Request):
    _local_only(request)
    return _status(request)


class RemotePatch(BaseModel):
    enabled: bool | None = None
    port: int | None = Field(default=None, ge=1024, le=65535)
    rotate_token: bool = False


@router.post("")
async def update_remote(body: RemotePatch, request: Request):
    _local_only(request)
    remote_access.update(enabled=body.enabled, port=body.port, rotate=body.rotate_token)
    return _status(request)
