"""Same-origin, local-client WebSocket access to an explicit user's shell."""
from __future__ import annotations

import asyncio
import ipaddress
from contextlib import suppress
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=['terminal'])


def local_client(websocket):
    client = websocket.client.host if websocket.client else ''
    test_client = client == 'testclient'
    try:
        if not test_client and not ipaddress.ip_address(client).is_loopback:
            return False
    except ValueError:
        return False
    host = websocket.url.hostname
    if host not in {'localhost', '127.0.0.1', '::1'} and not (test_client and host == 'testserver'):
        return False
    origin = websocket.headers.get('origin')
    if origin:
        parsed = urlsplit(origin)
        expected_scheme = 'https' if websocket.url.scheme == 'wss' else 'http'
        expected_port = websocket.url.port or (443 if expected_scheme == 'https' else 80)
        try:
            origin_port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        except ValueError:
            return False
        if parsed.scheme != expected_scheme or parsed.hostname != host or origin_port != expected_port:
            return False
    return True


@router.websocket('/api/workspace/{project_id}/terminal')
async def terminal(websocket: WebSocket, project_id: str):
    if not local_client(websocket):
        await websocket.close(code=1008, reason='Terminal requires a local same-origin client')
        return
    await websocket.accept()
    manager = websocket.app.state.terminals
    session = None
    pump = None
    try:
        session = await manager.open(None if project_id == 'default' else project_id)
        await websocket.send_json(session.ready())

        async def output():
            async for message in session.output():
                await websocket.send_json(message)
            await websocket.close(code=1000)

        pump = asyncio.create_task(output())
        session.output_task = pump
        while True:
            message = await websocket.receive_json()
            kind = message.get('type')
            if kind == 'input':
                data = message.get('data')
                if not isinstance(data, str) or len(data) > 65536:
                    raise ValueError('Terminal input must be text of at most 65536 characters')
                await session.write(data)
            elif kind == 'interrupt':
                if not await session.interrupt():
                    break
            elif kind == 'resize':
                cols, rows = int(message.get('cols', 100)), int(message.get('rows', 30))
                if not (20 <= cols <= 500 and 5 <= rows <= 200):
                    raise ValueError('Invalid terminal dimensions')
                session.resize(cols, rows)
            elif kind == 'close':
                break
            else:
                raise ValueError('Unknown terminal input type')
    except WebSocketDisconnect:
        pass
    except (ValueError, LookupError, OSError, RuntimeError) as error:
        with suppress(RuntimeError, WebSocketDisconnect):
            await websocket.send_json({'type': 'error', 'message': str(error)})
    finally:
        if pump is not None:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
        if session is not None:
            await manager.remove(session)
        with suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close(code=1000)
