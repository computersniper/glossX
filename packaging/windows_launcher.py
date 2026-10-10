"""Native Windows entry point for the self-contained GlossX desktop app."""

from __future__ import annotations

import argparse
import ctypes
import logging
import multiprocessing
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any


APP_NAME = "GlossX"
APP_VERSION = "1.0.2"
STARTUP_TIMEOUT_SECONDS = 30
MIN_FALLBACK_PORT = 1024
EXIT_REQUEST_EVENT = "glossx:close-request"


def _exit_confirmation_enabled() -> bool:
    from app.config import load_config

    return bool(load_config().get("confirm_exit", True))


def _disable_future_exit_confirmation() -> None:
    from app.config import save_config

    save_config({"confirm_exit": False})


class DesktopBridge:
    """Coordinate the native close button with the React confirmation dialog."""

    def __init__(self) -> None:
        self._window: Any | None = None
        self._allow_close = False
        self._prompt_open = False
        self._lock = threading.Lock()

    def bind(self, window: Any) -> None:
        self._window = window

    def on_closing(self) -> bool | None:
        with self._lock:
            if self._allow_close or not _exit_confirmation_enabled():
                return None
            # If React has not loaded yet, do not trap the user in a window that
            # cannot display the custom confirmation dialog.
            if self._window is None or not self._window.events.loaded.is_set():
                return None
            if not self._prompt_open:
                self._prompt_open = True
                threading.Thread(
                    target=self._dispatch_close_request,
                    name="glossx-close-prompt",
                    daemon=True,
                ).start()
        # pywebview cancels a closing event when a handler returns False.
        return False

    def _dispatch_close_request(self) -> None:
        try:
            assert self._window is not None
            self._window.evaluate_js(
                f"window.dispatchEvent(new CustomEvent('{EXIT_REQUEST_EVENT}'))"
            )
        except Exception:
            logging.exception("Could not display the GlossX exit confirmation")
            with self._lock:
                self._prompt_open = False

    def cancel_exit(self) -> bool:
        with self._lock:
            self._prompt_open = False
        return True

    def confirm_exit(self, dont_ask_again: bool = False) -> bool:
        if dont_ask_again:
            try:
                _disable_future_exit_confirmation()
            except Exception:
                logging.exception("Could not disable future exit confirmations")
        with self._lock:
            self._allow_close = True
            self._prompt_open = False
        if self._window is not None:
            self._window.destroy()
        return True


def _ensure_standard_streams() -> None:
    """Give windowed PyInstaller builds safe sinks for CLI-only arguments."""
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")


def _resource_root() -> Path:
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root:
        return Path(frozen_root)
    return Path(__file__).resolve().parent.parent


def _prepare_imports() -> None:
    root = _resource_root()
    backend = root / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    os.environ.setdefault("GLOSS_FRONTEND_DIST", str(root / "frontend" / "dist"))


def _configure_logging() -> Path:
    from app.config import CACHE_DIR

    log_dir = CACHE_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "desktop.log"
    logging.basicConfig(
        filename=log_path,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        encoding="utf-8",
    )
    return log_path


def _show_error(message: str) -> None:
    if sys.platform == "win32":
        ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10)
    else:
        print(f"{APP_NAME}: {message}", file=sys.stderr)


def _port_available(host: str, port: int) -> bool:
    probe_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    try:
        with socket.create_connection((probe_host, port), timeout=0.4):
            return False
    except OSError:
        return True


def _select_available_port(host: str, preferred_port: int) -> int:
    """Use the preferred port when possible, otherwise pick the next free one."""
    candidates = range(preferred_port, 65536)
    if preferred_port > MIN_FALLBACK_PORT:
        candidates = (*candidates, *range(MIN_FALLBACK_PORT, preferred_port))

    for port in candidates:
        if _port_available(host, port):
            return port
    raise RuntimeError("GlossX could not find an available local port.")


def _health_url(url: str) -> str:
    return f"{url}/api/health"


def _wait_until_ready(url: str, server_thread: threading.Thread) -> bool:
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline and server_thread.is_alive():
        try:
            with urllib.request.urlopen(_health_url(url), timeout=1) as response:
                if response.status == 200:
                    return True
        except OSError:
            time.sleep(0.1)
    return False


def _start_server(app: Any, host: str, port: int) -> tuple[Any, threading.Thread]:
    import uvicorn

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=False,
        log_config=None,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="glossx-backend", daemon=True)
    thread.start()
    return server, thread


def _stop_server(server: Any, server_thread: threading.Thread) -> None:
    server.should_exit = True
    server_thread.join(timeout=10)


def _run_headless(server: Any, server_thread: threading.Thread) -> int:
    try:
        while server_thread.is_alive():
            server_thread.join(timeout=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        _stop_server(server, server_thread)
    return 0


def _run_desktop(url: str, storage_path: Path) -> None:
    import webview

    storage_path.mkdir(parents=True, exist_ok=True)
    icon_path = _resource_root() / "packaging" / "gloss.ico"
    bridge = DesktopBridge()
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    window = webview.create_window(
        "GlossX · 旁注",
        url=url,
        js_api=bridge,
        width=1500,
        height=950,
        min_size=(1024, 720),
        resizable=True,
        background_color="#111820",
        text_select=True,
        zoomable=True,
    )
    bridge.bind(window)
    window.events.closing += bridge.on_closing
    start_options: dict[str, Any] = {
        "debug": False,
        "storage_path": str(storage_path),
    }
    if sys.platform == "win32":
        # Preserve the packaged Windows application's Edge WebView2 backend.
        start_options.update(gui="edgechromium", icon=str(icon_path))
    webview.start(**start_options)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="GlossX.exe",
        description="Start the GlossX desktop paper-reading companion.",
    )
    parser.add_argument("--host", default=os.environ.get("GLOSS_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("GLOSS_PORT", "8010"))
    )
    parser.add_argument(
        "--headless",
        "--no-window",
        "--no-browser",
        dest="headless",
        action="store_true",
        help="run only the local server (for diagnostics)",
    )
    parser.add_argument("--version", action="version", version=f"{APP_NAME} {APP_VERSION}")
    parser.add_argument("--browser-smoke", type=Path, metavar="REPORT", help="verify bundled CDP modules with an isolated browser profile")
    return parser


def _browser_smoke(report_path: Path) -> int:
    import asyncio
    import json
    import tempfile
    from app.harness.browser.process import BrowserProcess

    async def verify() -> dict:
        with tempfile.TemporaryDirectory(prefix="glossx-bundle-browser-") as temporary:
            browser = BrowserProcess(Path(temporary))
            process = None
            try:
                client = await browser.start()
                process = browser.process
                target = await client.call("Target.createTarget", {"url": "about:blank"})
                attached = await client.call("Target.attachToTarget", {"targetId": target["targetId"], "flatten": True})
                session_id = attached["sessionId"]
                await client.call("Runtime.evaluate", {"expression": "document.body.innerHTML='<h1>GlossX</h1><button>Bundle verified</button>'"}, session_id=session_id)
                tree = await client.call("Accessibility.getFullAXTree", session_id=session_id)
                assert any(node.get("name", {}).get("value") == "Bundle verified" for node in tree["nodes"]), "AX tree missing fixture button"
                frame = await client.call("Page.captureScreenshot", {"format": "png"}, session_id=session_id)
                assert len(frame.get("data", "")) > 100, "empty browser screenshot"
                result = {"browser": browser.executable.browser, "ax_nodes": len(tree["nodes"]), "screenshot_bytes_base64": len(frame["data"])}
            finally:
                await browser.close()
            assert process is not None and process.returncode is not None, "browser did not exit"
            result["process_exit_code"] = process.returncode
            return result

    try:
        result = {"ok": True, **asyncio.run(verify())}
    except Exception as exc:
        result = {"ok": False, "error": str(exc)}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if result["ok"] else 1


def main() -> int:
    multiprocessing.freeze_support()
    _ensure_standard_streams()
    args = _parser().parse_args()
    if not 1 <= args.port <= 65535:
        _show_error("Port must be between 1 and 65535.")
        return 2

    _prepare_imports()
    if args.browser_smoke:
        return _browser_smoke(args.browser_smoke)
    log_path = _configure_logging()

    try:
        from app.config import CACHE_DIR
        from app.main import app

        requested_port = args.port
        args.port = _select_available_port(args.host, requested_port)
        if args.port != requested_port:
            logging.info(
                "Port %s was occupied; starting GlossX on port %s instead",
                requested_port,
                args.port,
            )

        browser_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
        url = f"http://{browser_host}:{args.port}"
        server, server_thread = _start_server(app, args.host, args.port)
        if not _wait_until_ready(url, server_thread):
            _stop_server(server, server_thread)
            raise RuntimeError("The local GlossX server did not become ready in time.")

        if args.headless:
            return _run_headless(server, server_thread)

        try:
            _run_desktop(url, CACHE_DIR / "webview")
        finally:
            _stop_server(server, server_thread)
        return 0
    except Exception as exc:
        logging.exception("GlossX desktop startup failed")
        message = (
            f"GlossX could not start.\n\n{exc}\n\n"
            "Microsoft Edge WebView2 Runtime is required. "
            f"Details were written to:\n{log_path}"
        )
        if args.headless:
            print(message, file=sys.stderr)
        else:
            _show_error(message)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
