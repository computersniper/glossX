"""Local `codex` CLI provider (ChatGPT subscription auth — no API key).

Uses `codex exec` non-interactively as a plain LLM in a clean, read-only working
directory (no AGENTS.md to leak). One-shot features remain ephemeral, while the
paper chat feature can opt into a persisted Codex session and resume it by ID.
The final message is captured via `--output-last-message`; model + reasoning
effort are configurable and passed through the standard codex flags.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import tempfile
from typing import AsyncIterator

from ..config import ensure_codex_sandbox, load_config
from ..platform_support import (
    resolve_cli_command,
    subprocess_group_options,
    terminate_process_tree,
)
from .base import (
    Message,
    Provider,
    ProviderSessionUnavailableError,
    render_transcript,
    runtime_option,
)


def _cfg() -> dict:
    return load_config()["providers"]["local_codex"]


# Benign warnings the CLI prints on every run; they never explain a failure.
_NOISE_MARKERS = ("failed to load models cache",)


def _failure_detail(err: bytes, out: bytes, prompt: str, limit: int = 1500) -> str:
    """Return the part of a failed ``codex exec`` run that explains the failure.

    The CLI echoes its whole banner and the user prompt to stderr before the
    actual error, so a plain head-truncation shows only the (long) prompt.
    Drop the echoed prompt and banner, prefer explicit error lines, and keep
    the tail of the remaining output.
    """
    text = err.decode(errors="replace")
    if prompt:
        text = text.replace(prompt, "")
    lines = [line.rstrip() for line in text.splitlines()]
    banner_ends = [i for i, line in enumerate(lines) if line.strip() == "--------"]
    if len(banner_ends) >= 2:
        lines = lines[banner_ends[1] + 1:]
    lines = [
        line for line in lines
        if line.strip() and line.strip() != "user"
        and not any(marker in line for marker in _NOISE_MARKERS)
    ]
    errors = [line for line in lines if "error" in line.lower()]
    tail = "\n".join(lines[-12:])
    out_tail = out.decode(errors="replace").strip()[-500:]
    parts = []
    if errors:
        parts.append("\n".join(dict.fromkeys(errors[-6:])))
    if tail and tail not in parts[0:1]:
        parts.append(tail)
    if out_tail:
        parts.append(out_tail)
    detail = "\n".join(parts).strip()
    return detail[-limit:] if detail else "no error output"


class CodexSessionUnavailableError(ProviderSessionUnavailableError):
    """Raised when a previously recorded Codex session can no longer be resumed."""


def _thread_id_from_jsonl(output: bytes) -> str | None:
    for raw_line in output.splitlines():
        try:
            event = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if event.get("type") == "thread.started":
            thread_id = event.get("thread_id")
            if isinstance(thread_id, str) and thread_id:
                return thread_id
    return None


def _session_is_unavailable(detail: str) -> bool:
    text = detail.lower()
    direct_markers = (
        "session not found",
        "thread not found",
        "no saved session",
        "no rollout found",
        "could not find session",
        "could not find rollout",
        "unknown session",
        "invalid session id",
    )
    return any(marker in text for marker in direct_markers)


def _materialize_message_images(messages: list[Message]) -> list[str]:
    """Write data-URL attachments to temporary PNGs accepted by `codex --image`."""
    paths: list[str] = []
    prefix = "data:image/png;base64,"
    try:
        for message in messages:
            for attachment in message.get("attachments") or []:
                data_url = attachment.get("image_data_url") or ""
                if not data_url.startswith(prefix):
                    continue
                fd, path = tempfile.mkstemp(prefix="gloss-chat-image-", suffix=".png")
                paths.append(path)
                with os.fdopen(fd, "wb") as image_file:
                    image_file.write(base64.b64decode(data_url[len(prefix):], validate=True))
        return paths
    except Exception:
        for path in paths:
            try:
                os.unlink(path)
            except OSError:
                pass
        raise


class LocalCodexProvider(Provider):
    name = "local_codex"

    async def test_connection(self) -> str:
        """Check subscription login without launching a full Codex inference."""
        cmd = resolve_cli_command("codex") + ["login", "status"]
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(ensure_codex_sandbox()),
                **subprocess_group_options(),
            )
            try:
                out, err = await asyncio.wait_for(proc.communicate(), timeout=20)
            except asyncio.TimeoutError:
                await terminate_process_tree(proc)
                raise RuntimeError("codex login status timed out after 20s")
            detail = (out or err).decode(errors="replace").strip()
            if proc.returncode != 0:
                raise RuntimeError(detail or f"codex login status exited {proc.returncode}")
            return detail or "Codex is signed in"
        finally:
            if proc is not None and proc.returncode is None:
                await terminate_process_tree(proc)

    async def complete(
        self, system: str, messages: list[Message], model: str | None = None
    ) -> tuple[str, dict]:
        text, usage, _ = await self._run_completion(
            system, messages, model, persist_session=False
        )
        return text, usage

    async def complete_session(
        self,
        system: str,
        messages: list[Message],
        model: str | None = None,
        *,
        session_id: str | None = None,
    ) -> tuple[str, dict, str]:
        """Create or resume a persisted Codex session for a paper chat."""
        text, usage, resolved_session_id = await self._run_completion(
            system,
            messages,
            model,
            persist_session=True,
            session_id=session_id,
        )
        if not resolved_session_id:
            raise RuntimeError("codex CLI did not report a session id")
        return text, usage, resolved_session_id

    async def _run_completion(
        self,
        system: str,
        messages: list[Message],
        model: str | None,
        *,
        persist_session: bool,
        session_id: str | None = None,
    ) -> tuple[str, dict, str | None]:
        cfg = _cfg()
        model = model or cfg.get("model", "")
        effort = runtime_option("effort", cfg.get("effort", ""))
        timeout = float(cfg.get("timeout", 600))
        sandbox = str(ensure_codex_sandbox())

        # codex has no separate system-prompt flag; fold it into the instructions.
        transcript = render_transcript(messages)
        prompt = f"{system}\n\n{transcript}" if system else transcript

        fd, out_path = tempfile.mkstemp(prefix="gloss-codex-", suffix=".txt")
        os.close(fd)
        image_paths = _materialize_message_images(messages)
        cmd = resolve_cli_command("codex") + ["exec"]
        if session_id:
            cmd += [
                "resume",
                "--skip-git-repo-check",
                "--json",
                "-o", out_path,
            ]
        else:
            cmd += [
                "--skip-git-repo-check",
                "-s", "read-only",
                "-C", sandbox,
                "-o", out_path,
            ]
            if persist_session:
                cmd.append("--json")
            else:
                cmd.append("--ephemeral")
        if model:
            cmd += ["-m", model]
        if effort:
            cmd += ["-c", f"model_reasoning_effort={effort}"]
        for image_path in image_paths:
            cmd += ["-i", image_path]
        if session_id:
            cmd += [session_id, "-"]
        else:
            cmd.append("-")

        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **subprocess_group_options(),
            )
            try:
                out, err = await asyncio.wait_for(
                    proc.communicate(prompt.encode()), timeout=timeout
                )
            except asyncio.TimeoutError:
                await terminate_process_tree(proc)
                raise RuntimeError(f"codex CLI timed out after {timeout}s")
            if proc.returncode != 0:
                detail = _failure_detail(err, out, prompt)
                if session_id and _session_is_unavailable(detail):
                    raise CodexSessionUnavailableError(detail)
                raise RuntimeError(f"codex CLI exited {proc.returncode}: {detail}")
            try:
                with open(out_path, "r", encoding="utf-8") as f:
                    text = f.read().strip()
            except OSError:
                text = ""
            if not text:
                detail = _failure_detail(err, out, prompt)
                raise RuntimeError(f"codex CLI produced no output: {detail}")
            resolved_session_id = _thread_id_from_jsonl(out) or session_id
            return (
                text,
                {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                resolved_session_id,
            )
        finally:
            if proc is not None and proc.returncode is None:
                await terminate_process_tree(proc)
            try:
                os.unlink(out_path)
            except OSError:
                pass
            for image_path in image_paths:
                try:
                    os.unlink(image_path)
                except OSError:
                    pass

    async def stream(
        self, system: str, messages: list[Message], model: str | None = None
    ) -> AsyncIterator[str]:
        # codex exec isn't a token stream; fall back to chunking the completion.
        text, _ = await self.complete(system, messages, model)
        step = 24
        for i in range(0, len(text), step):
            yield text[i : i + step]
