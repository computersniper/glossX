"""Lazy Chromium process lifecycle, using a GlossX-owned (never user) profile."""
from __future__ import annotations

import asyncio
import re
import time
import os
import signal
import uuid
import shutil
from collections import deque
from pathlib import Path

from ...platform_support import subprocess_group_options, terminate_process_tree
from .cdp import CDPClient, CDPError
from .discovery import BrowserExecutable, discover


class BrowserProcess:
    def __init__(self, data_dir: Path, *, path: str | None = None, headed: bool = False,
                 idle_timeout: float = 300):
        self._profile_parent = data_dir.resolve() / "browser"
        # A fixed profile may hand off to a different running desktop instance
        # or retain bad startup state. Never share it or touch a personal profile.
        self.profile = self._profile_parent / f"profile-{os.getpid()}-{uuid.uuid4().hex[:12]}"
        self.path = path
        self.headed = headed
        self.idle_timeout = idle_timeout
        self.process: asyncio.subprocess.Process | None = None
        self.client: CDPClient | None = None
        self.executable: BrowserExecutable | None = None
        self._lock = asyncio.Lock()
        self._idle_task: asyncio.Task | None = None
        self._last_used = time.monotonic()
        self._leases = 0
        self.proxy_port = None
        self._stderr_task = None
        self._stderr_tail = deque(maxlen=30)
        self._job = None

    async def _drain_stderr(self, stream):
        while chunk := await stream.readline():
            self._stderr_tail.append(chunk.decode('utf-8', 'replace').strip()[:1000])

    def _startup_error(self, message):
        detail = '\n'.join(self._stderr_tail)[-6000:]
        return CDPError(message + (':\n' + detail if detail else ''))

    def touch(self):
        self._last_used = time.monotonic()

    def acquire(self):
        """An active operation/viewer prevents the idle watchdog closing CDP."""
        self._leases += 1
        self.touch()

    def release(self):
        self._leases = max(0, self._leases - 1)
        self.touch()

    async def start(self) -> CDPClient:
        async with self._lock:
            self.touch()
            if self.process is not None and self.process.returncode is None and self.client is not None and not self.client._closed:
                return self.client
            await self._stop()
            self.executable = await asyncio.to_thread(discover, self.path)
            if self.executable is None:
                raise CDPError("No browser found. Install Edge/Chrome/Chromium or set browser.path in GlossX settings.")
            await asyncio.to_thread(self.profile.mkdir, parents=True, exist_ok=True)
            port_file = self.profile / "DevToolsActivePort"
            await asyncio.to_thread(port_file.unlink, missing_ok=True)
            args = [str(self.executable.path), "--remote-debugging-port=0",
                    "--remote-debugging-address=127.0.0.1", f"--user-data-dir={self.profile}",
                    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                    "--disable-background-networking", "--disable-sync", "--disable-component-update",
                    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"]
            args += ["--disable-quic", "--disable-features=WebRtcAllowInputVolumeAdjustment,MediaRouter"]
            if self.proxy_port:
                args += [f"--proxy-server=http://127.0.0.1:{self.proxy_port}",
                         "--proxy-bypass-list=<-loopback>",
                         "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]
            if not self.headed:
                args.append("--headless=new")
            args.append("about:blank")
            try:
                self._stderr_tail.clear()
                self.process = await asyncio.create_subprocess_exec(
                    *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                    **subprocess_group_options(),
                )
                if os.name == 'nt':
                    from .job import BrowserJob
                    self._job = BrowserJob()
                    self._job.assign(self.process.pid)
                self._stderr_task = asyncio.create_task(self._drain_stderr(self.process.stderr))
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if self.process.returncode is not None:
                        await asyncio.sleep(0)
                        raise self._startup_error(f"Browser exited during startup (code {self.process.returncode})")
                    try:
                        lines = (await asyncio.to_thread(port_file.read_text, encoding="utf-8")).splitlines()
                        port = int(lines[0])
                        endpoint = lines[1]
                        if not 1 <= port <= 65535 or not re.fullmatch(r"/devtools/browser/[A-Za-z0-9-]+", endpoint):
                            raise ValueError("Invalid debugger endpoint")
                    except (OSError, ValueError, IndexError):
                        await asyncio.sleep(0.05)
                        continue
                    self.client = await CDPClient.open(f"ws://127.0.0.1:{port}{endpoint}")
                    self._idle_task = asyncio.create_task(self._watch_idle(), name="glossx-browser-idle")
                    return self.client
                raise self._startup_error("Browser startup timed out; check browser.path and profile permissions")
            except BaseException:
                # Includes cancelled launch: don't leave a child running.
                cleanup = asyncio.create_task(self._stop())
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError:
                    await cleanup
                raise

    async def _watch_idle(self):
        while True:
            await asyncio.sleep(max(0.05, min(30, self.idle_timeout / 2)))
            if not self._leases and time.monotonic() - self._last_used >= self.idle_timeout:
                async with self._lock:
                    if not self._leases and time.monotonic() - self._last_used >= self.idle_timeout:
                        await self._stop()
                        return

    async def _stop(self):
        task, self._idle_task = self._idle_task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        client, self.client = self.client, None
        process, self.process = self.process, None
        # terminate_process_tree uses communicate(), so relinquish ownership of
        # stderr before it starts draining subprocess pipes.
        stderr_task, self._stderr_task = self._stderr_task, None
        if stderr_task is not None:
            stderr_task.cancel()
            await asyncio.gather(stderr_task, return_exceptions=True)
        try:
            if client is not None:
                await client.close()
        finally:
            job, self._job = self._job, None
            if job is not None:
                job.close()
            if process is not None:
                if os.name != 'nt':
                    # The parent may already have exited while its pgid still
                    # contains renderers. The generic helper returns early then.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                await terminate_process_tree(process)

    async def close(self):
        async with self._lock:
            cleanup = asyncio.create_task(self._stop())
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                await cleanup
                raise
            finally:
                # Only remove this instance's random, explicitly owned folder.
                # Preserve legacy DATA/browser/profile and other live instances.
                resolved = self.profile.resolve()
                if resolved.parent == self._profile_parent and resolved.name.startswith(f'profile-{os.getpid()}-'):
                    await asyncio.to_thread(shutil.rmtree, resolved, True)
