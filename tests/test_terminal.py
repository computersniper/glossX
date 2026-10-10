"""Real persistent shells, socket admission, workspace migration and cleanup."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from starlette.websockets import WebSocketDisconnect

from app.harness import workspace
from app.harness.terminal import TerminalSession, TerminalManager


def receive_until(socket, needle):
    text = ''
    for _ in range(60):
        message = socket.receive_json()
        assert message['type'] not in {'error', 'exit'}, message
        if message['type'] == 'output':
            text += message['data']
            if needle in text:
                return text
    pytest.fail(f'Terminal did not print {needle!r}: {text!r}')


def test_websocket_persistent_shell_cwd_unicode_and_disconnect(client):
    from app.main import app
    root = workspace.root_for(None)
    (root / 'terminal-child').mkdir(exist_ok=True)
    with client.websocket_connect('/api/workspace/default/terminal', headers={'origin': 'http://testserver'}) as socket:
        ready = socket.receive_json()
        assert ready['type'] == 'ready'
        assert ready['cwd'] == str(root)
        assert ready['pty'] == (os.name != 'nt')
        assert app.state.terminals.has_active(None)
        socket.send_json({'type': 'input', 'data': 'cd terminal-child\n'})
        socket.send_json({'type': 'input', 'data': 'echo GLOSSX终端_READY\npwd\n'})
        text = receive_until(socket, 'terminal-child')
        if 'GLOSSX终端_READY' not in text:
            text += receive_until(socket, 'GLOSSX终端_READY')
        assert 'GLOSSX终端_READY' in text
        socket.send_json({'type': 'resize', 'cols': 100, 'rows': 30})
        socket.send_json({'type': 'close'})
        with pytest.raises(WebSocketDisconnect):
            while True:
                socket.receive_json()
    assert not app.state.terminals.has_active(None)


@pytest.mark.parametrize('headers', [{'origin': 'https://evil.example'}, {'origin': 'null'}, {'host': 'evil.example', 'origin': 'http://evil.example'}])
def test_cross_origin_or_untrusted_host_cannot_launch_shell(client, headers):
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect('/api/workspace/default/terminal', headers=headers):
            pytest.fail('Untrusted WebSocket was accepted')
    assert error.value.code == 1008


def test_terminal_refuses_relocating_workspace(client):
    workspace.begin_relocation('default')
    try:
        with client.websocket_connect('/api/workspace/default/terminal') as socket:
            message = socket.receive_json()
            assert message['type'] == 'error'
            assert 'relocation' in message['message']
    finally:
        workspace.end_relocation('default')


def test_real_shell_close_and_manager_shutdown(tmp_path):
    async def check():
        manager = TerminalManager()
        session = TerminalSession('default', tmp_path)
        manager.sessions[session.id] = session
        await session.start()
        process = session.process
        assert process.returncode is None
        await manager.close()
        assert process.returncode is not None
        assert not manager.has_active(None)
        with pytest.raises(RuntimeError, match='stopping'):
            await manager.open(None)
    asyncio.run(check())


@pytest.mark.skipif(os.name == 'nt', reason='PTY shells are POSIX only')
def test_pty_shell_starts_under_uvloop(tmp_path):
    # uvicorn[standard] serves the app on uvloop, whose child setup differs
    # from asyncio's; the shell must still get the PTY as its terminal.
    uvloop = pytest.importorskip('uvloop')

    async def check():
        session = TerminalSession('default', tmp_path)
        await session.start()
        try:
            await session.write('tty; echo uvloop-$((40+2))\n')
            text = ''
            for _ in range(100):
                text += (await asyncio.wait_for(session.read(), 5)).decode('utf-8', 'replace')
                if 'uvloop-42' in text:
                    break
            assert 'uvloop-42' in text and '/dev/pts/' in text, text
        finally:
            await session.close()
    uvloop.run(check())
