"""Cross-platform paths and local CLI command resolution for GlossX."""

from __future__ import annotations

import asyncio
import locale
import multiprocessing
import os
import re
import signal
import shutil
import subprocess
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path


# GlossX keeps its own data/cache folders so it can run next to an installed
# Gloss. ``GLOSS_DATA_DIR`` / ``GLOSS_CACHE_DIR`` still override these.
APP_DIR_NAME = "GlossX"

_WINDOWS_CREATE_NEW_PROCESS_GROUP = getattr(
    subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200
)
_WINDOWS_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)


class ProcessCancelledError(RuntimeError):
    """Raised when a caller requests cancellation of spawned blocking work."""


def _process_entry(send_connection, target: Callable, args: tuple) -> None:
    try:
        send_connection.send(("ok", target(*args)))
    except BaseException as error:
        try:
            send_connection.send(("error", error))
        except BaseException:
            send_connection.send(
                ("error_text", f"{type(error).__name__}: {error}")
            )
    finally:
        send_connection.close()


def run_in_process_with_timeout(
    target: Callable,
    args: tuple,
    timeout: float,
    cancel_event=None,
):
    """Run blocking work in a spawn process that can be killed or cancelled."""
    context = multiprocessing.get_context("spawn")
    receive_connection, send_connection = context.Pipe(duplex=False)
    process = context.Process(
        target=_process_entry,
        args=(send_connection, target, args),
        daemon=True,
    )
    process.start()
    send_connection.close()

    def stop_worker() -> None:
        if process.is_alive():
            process.terminate()
        process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)

    try:
        deadline = time.monotonic() + timeout
        while True:
            if cancel_event is not None and cancel_event.is_set():
                stop_worker()
                raise ProcessCancelledError("worker was cancelled")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                stop_worker()
                raise TimeoutError(f"worker timed out after {timeout:g}s")
            if receive_connection.poll(min(0.1, remaining)):
                break
        try:
            status, payload = receive_connection.recv()
        except EOFError as error:
            raise RuntimeError(
                f"worker exited without a result (exit code {process.exitcode})"
            ) from error
        process.join(5)
        if status == "ok":
            return payload
        if status == "error" and isinstance(payload, BaseException):
            raise payload
        raise RuntimeError(str(payload))
    finally:
        receive_connection.close()
        stop_worker()


def read_utf8_text(path: Path) -> str:
    """Read UTF-8 or text written with this install's legacy system encoding.

    Legacy encodings are inherently ambiguous: some CP1252 byte pairs are also
    valid GBK and decode to unrelated characters.  ``GLOSS_LEGACY_ENCODING``
    provides an explicit migration override when data moves between locales.
    """
    data = path.read_bytes()
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as utf8_error:
        encoding = os.environ.get("GLOSS_LEGACY_ENCODING") or locale.getencoding()
        if encoding.lower().replace("_", "-") in {"utf-8", "utf8", "utf-8-sig"}:
            raise utf8_error
        try:
            return data.decode(encoding)
        except LookupError as error:
            raise RuntimeError(
                f"Unknown GLOSS_LEGACY_ENCODING value: {encoding}"
            ) from error
        except UnicodeDecodeError:
            raise utf8_error


def _is_windows(platform_name: str) -> bool:
    return platform_name.startswith("win")


def subprocess_group_options(platform_name: str = sys.platform) -> dict:
    if _is_windows(platform_name):
        return {
            "creationflags": (
                _WINDOWS_CREATE_NEW_PROCESS_GROUP | _WINDOWS_CREATE_NO_WINDOW
            )
        }
    return {"start_new_session": True}


async def terminate_process_tree(process, platform_name: str = sys.platform) -> None:
    """Terminate a provider subprocess and its descendants, then reap it."""
    if process.returncode is not None:
        return
    if _is_windows(platform_name):
        killer = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(process.pid),
            "/T",
            "/F",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            creationflags=_WINDOWS_CREATE_NO_WINDOW,
        )
        await killer.wait()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            try:
                process.kill()
            except ProcessLookupError:
                pass
    try:
        await asyncio.wait_for(process.communicate(), timeout=5)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


def default_data_dir(
    platform_name: str = sys.platform,
    env: Mapping[str, str] = os.environ,
    home: Path | None = None,
) -> Path:
    home = home or Path.home()
    if _is_windows(platform_name):
        base = Path(env.get("LOCALAPPDATA") or home / "AppData" / "Local")
        return base / APP_DIR_NAME / "data"
    base = Path(env.get("XDG_DATA_HOME") or home / ".local" / "share")
    return base / APP_DIR_NAME


def default_cache_dir(
    platform_name: str = sys.platform,
    env: Mapping[str, str] = os.environ,
    home: Path | None = None,
) -> Path:
    home = home or Path.home()
    if _is_windows(platform_name):
        base = Path(env.get("LOCALAPPDATA") or home / "AppData" / "Local")
        return base / APP_DIR_NAME / "cache"
    base = Path(env.get("XDG_CACHE_HOME") or home / ".cache")
    return base / APP_DIR_NAME


def resolve_data_dir(
    platform_name: str,
    env: Mapping[str, str],
    home: Path,
    legacy_data_dir: Path,
) -> tuple[Path, bool]:
    explicit = env.get("GLOSS_DATA_DIR")
    if explicit:
        return Path(explicit).expanduser().resolve(), False

    try:
        if legacy_data_dir.is_dir() and any(legacy_data_dir.iterdir()):
            return legacy_data_dir.resolve(), True
    except OSError:
        pass

    return default_data_dir(platform_name, env, home).expanduser().resolve(), False


def venv_python(repo_root: Path, platform_name: str = sys.platform) -> Path:
    venv = repo_root / "backend" / ".venv"
    if _is_windows(platform_name):
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def _resolve_npm_node_shim(
    shim_path: Path, which: Callable[[str], str | None]
) -> list[str] | None:
    """Resolve a standard npm PowerShell/CMD shim without invoking a shell."""
    try:
        text = shim_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    match = re.search(
        r'(?:%dp0%|\$basedir)[\\/]+([^"\r\n]+?\.js)', text, re.IGNORECASE
    )
    if not match:
        return None
    relative_parts = [part for part in re.split(r"[\\/]", match.group(1)) if part]
    script = shim_path.parent.joinpath(*relative_parts)
    if not script.is_file():
        return None
    bundled_node = shim_path.parent / "node.exe"
    node = str(bundled_node) if bundled_node.is_file() else (which("node.exe") or which("node"))
    if not node:
        return None
    return [node, str(script)]


def resolve_cli_command(
    name: str,
    platform_name: str = sys.platform,
    env: Mapping[str, str] = os.environ,
    which: Callable[[str], str | None] = shutil.which,
) -> list[str]:
    path = which(name)
    if not path:
        raise FileNotFoundError(
            f"{name} CLI was not found on PATH. Install it and sign in before testing this provider."
        )

    suffix = Path(path).suffix.lower()
    if _is_windows(platform_name) and suffix in {".cmd", ".bat", ".ps1"}:
        resolved = _resolve_npm_node_shim(Path(path), which)
        if resolved:
            return resolved
        raise RuntimeError(
            f"{name} resolved to {path}, but Gloss could not safely resolve that Windows "
            "command shim. Reinstall the CLI with npm or put its executable on PATH."
        )
    return [path]
