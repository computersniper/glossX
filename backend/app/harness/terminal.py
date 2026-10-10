"""Owned, persistent shells for explicit local workspace terminal connections."""
from __future__ import annotations

import asyncio
import codecs
import os
import shutil
import signal
import sys
import uuid
import base64
from pathlib import Path

from ..platform_support import subprocess_group_options, terminate_process_tree
from . import workspace

POWERSHELL_BOOTSTRAP = r'''
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$pending = ''
Write-Output '__GLOSSX_TERMINAL_READY__'
while ($null -ne ($line = [Console]::ReadLine())) {
    $pending += $line + [Environment]::NewLine
    $tokens = $null; $errors = $null
    [System.Management.Automation.Language.Parser]::ParseInput($pending, [ref]$tokens, [ref]$errors) > $null
    if (@($errors | Where-Object { $_.IncompleteInput }).Count) { continue }
    try { Invoke-Expression $pending | Out-Default } catch { Write-Error $_ }
    $pending = ''
}
'''


class TerminalSession:
    def __init__(self, key: str, cwd: Path):
        self.id = uuid.uuid4().hex
        self.key = key
        self.cwd = cwd
        self.process = None
        self.master = None
        self.job = None
        self.shell = None
        self.powershell = False
        self.pty = os.name != 'nt'
        self._close_task = None
        self.output_task = None

    async def start(self):
        env = dict(os.environ)
        env.pop('BASH_ENV', None)
        env.pop('ENV', None)
        env['PYTHONIOENCODING'] = 'utf-8'
        if os.name == 'nt':
            self.shell = shutil.which('powershell.exe') or shutil.which('cmd.exe')
            if not self.shell:
                raise RuntimeError('No PowerShell or cmd shell is installed')
            powershell = Path(self.shell).name.lower() == 'powershell.exe'
            self.powershell = powershell
            encoded = base64.b64encode(POWERSHELL_BOOTSTRAP.encode('utf-16-le')).decode('ascii')
            args = [self.shell, '-NoLogo', '-NoProfile', '-OutputFormat', 'Text', '-EncodedCommand', encoded] if powershell else [self.shell, '/D', '/Q']
            self.process = await asyncio.create_subprocess_exec(
                *args, cwd=self.cwd, env=env, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                **subprocess_group_options(),
            )
            from .browser.job import BrowserJob
            self.job = BrowserJob()
            self.job.assign(self.process.pid)
            if powershell:
                async with asyncio.timeout(10):
                    while True:
                        line = await self.process.stdout.readline()
                        if b'__GLOSSX_TERMINAL_READY__' in line:
                            break
                        if not line:
                            raise RuntimeError('PowerShell exited before terminal initialization')
        else:
            import fcntl
            import pty
            import termios
            self.shell = shutil.which('bash') or shutil.which('zsh') or shutil.which('sh')
            if not self.shell:
                raise RuntimeError('No POSIX shell is installed')
            name = Path(self.shell).name
            args = [self.shell, '--noprofile', '--norc', '-i'] if name == 'bash' else [self.shell, '-f', '-i'] if name == 'zsh' else [self.shell, '-i']
            master, slave = pty.openpty()
            self.master = master
            os.set_blocking(master, False)

            def controlling_terminal():
                # Only one syscall after fork; modules are imported beforehand.
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)

            try:
                self.process = await asyncio.create_subprocess_exec(
                    *args, cwd=self.cwd, env=env, stdin=slave, stdout=slave, stderr=slave,
                    start_new_session=True, preexec_fn=controlling_terminal,
                )
            finally:
                os.close(slave)

    def ready(self):
        return {'type': 'ready', 'id': self.id, 'shell': self.shell,
                'cwd': str(self.cwd), 'pty': self.pty, 'platform': sys.platform,
                'interrupt_mode': 'signal' if self.pty else 'close',
                'note': '' if self.pty else 'Windows uses shell pipes; interrupt stops this terminal. Reconnect to start a new shell.'}

    async def write(self, text: str):
        if os.name == 'nt':
            text = text.replace('\r\n', '\n').replace('\n', '\r\n')
        data = text.encode('utf-8')
        if self.process is None or self.process.returncode is not None:
            raise RuntimeError('Terminal shell has exited')
        if self.master is None:
            self.process.stdin.write(data)
            await self.process.stdin.drain()
            return
        loop = asyncio.get_running_loop()
        while data:
            try:
                size = os.write(self.master, data)
                data = data[size:]
            except BlockingIOError:
                future = loop.create_future()
                loop.add_writer(self.master, lambda: future.done() or future.set_result(None))
                try:
                    await future
                finally:
                    loop.remove_writer(self.master)

    async def read(self):
        if self.master is None:
            return await self.process.stdout.read(4096)
        loop = asyncio.get_running_loop()
        while True:
            try:
                return os.read(self.master, 4096)
            except BlockingIOError:
                future = loop.create_future()
                loop.add_reader(self.master, lambda: future.done() or future.set_result(None))
                try:
                    await future
                finally:
                    loop.remove_reader(self.master)
            except OSError:
                return b''  # PTY returns EIO when the last slave closes.

    async def output(self):
        decoder = codecs.getincrementaldecoder('utf-8')('replace')
        while data := await self.read():
            text = decoder.decode(data)
            if text:
                yield {'type': 'output', 'data': text}
        tail = decoder.decode(b'', final=True)
        if tail:
            yield {'type': 'output', 'data': tail}
        code = await self.process.wait()
        yield {'type': 'exit', 'code': code}

    async def interrupt(self):
        if self.pty and self.master is not None:
            await self.write('\x03')
            return True
        # CREATE_NO_WINDOW shells have no console for CTRL_BREAK. Do not claim
        # pipe bytes interrupt children: stop the owned tree instead.
        await self.close()
        return False

    def resize(self, cols: int, rows: int):
        if self.master is not None:
            import fcntl
            import struct
            import termios
            fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    async def close(self):
        if self._close_task is None:
            self._close_task = asyncio.create_task(self._close())
        try:
            await asyncio.shield(self._close_task)
        except asyncio.CancelledError:
            await self._close_task
            raise

    async def _close(self):
        if self.output_task is not None and self.output_task is not asyncio.current_task():
            self.output_task.cancel()
            await asyncio.gather(self.output_task, return_exceptions=True)
        if self.job is not None:
            self.job.close()
            self.job = None
        if self.process is not None:
            if os.name != 'nt':
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await terminate_process_tree(self.process)
        if self.master is not None:
            os.close(self.master)
            self.master = None


class TerminalManager:
    def __init__(self):
        self.sessions: dict[str, TerminalSession] = {}
        self.closed = False

    def has_active(self, project_id: str | None):
        key = workspace.key_for(project_id)
        return any(session.key == key for session in self.sessions.values())

    async def open(self, project_id: str | None):
        if self.closed:
            raise RuntimeError('Terminal service is stopping')
        key = workspace.key_for(project_id)
        if workspace.is_relocating(project_id):
            raise workspace.WorkspaceBusyError('Workspace relocation is in progress')
        if project_id:
            from ..agent import projects
            projects.get(project_id)
        session = TerminalSession(key, workspace.root_for(project_id))
        # Register before the first await so relocation cannot race shell launch.
        self.sessions[session.id] = session
        try:
            await session.start()
            return session
        except BaseException:
            await self.remove(session)
            raise

    async def remove(self, session):
        try:
            await session.close()
        finally:
            self.sessions.pop(session.id, None)

    async def close(self):
        self.closed = True
        await asyncio.gather(*(self.remove(session) for session in list(self.sessions.values())))
