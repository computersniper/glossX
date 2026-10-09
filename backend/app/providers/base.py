"""Provider interface + shared message rendering.

Internal message format is OpenAI-style: a list of ``{"role", "content"}`` dicts
plus a separate ``system`` string. Each provider adapts that to its transport.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, AsyncIterator

try:
    import tiktoken

    _TOKEN_ENCODING = tiktoken.get_encoding("cl100k_base")
except Exception:  # pragma: no cover - optional in packaged installs
    _TOKEN_ENCODING = None

Message = dict  # {"role": "user"|"assistant"|"system", "content": str}
_RUNTIME_OPTIONS: ContextVar[dict[str, Any]] = ContextVar(
    "gloss_provider_runtime_options", default={}
)


class ProviderSessionUnavailableError(RuntimeError):
    """A persisted provider conversation can no longer be resumed."""


@contextmanager
def provider_runtime_options(**options: Any):
    """Temporarily override transport details without changing its public API."""
    merged = {**_RUNTIME_OPTIONS.get(), **{k: v for k, v in options.items() if v is not None}}
    token = _RUNTIME_OPTIONS.set(merged)
    try:
        yield
    finally:
        _RUNTIME_OPTIONS.reset(token)


def runtime_option(name: str, default: Any = None) -> Any:
    return _RUNTIME_OPTIONS.get().get(name, default)


def estimate_text_tokens(text: str) -> int:
    """Return a clearly-labelled best-effort token estimate.

    Local Codex CLI executions do not currently expose usage in their machine
    readable output.  We use the same broadly useful tokenizer as the feature
    prompt budgeter when it is available, with a conservative character
    fallback for minimal installations.  Callers must retain whether a value
    came from this function rather than presenting it as provider billing data.
    """
    if not text:
        return 0
    if _TOKEN_ENCODING is not None:
        return len(_TOKEN_ENCODING.encode(text))
    return max(1, len(text) // 4)


def message_text(messages: list[Message]) -> str:
    """Flatten text message content for an approximate input-token count."""
    parts: list[str] = []
    for message in messages:
        content = message.get("content") or ""
        if isinstance(content, list):
            content = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        parts.append(str(content))
    return "\n".join(parts)


def render_transcript(messages: list[Message]) -> str:
    """Flatten a conversation into a single text prompt (for the claude CLI).

    Mirrors the claude_proxy behaviour: a lone user turn is passed verbatim,
    otherwise turns are labelled and a trailing ``[Assistant]:`` cue is appended.
    """
    convo: list[str] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if isinstance(content, list):  # multimodal -> keep text blocks
            content = "\n".join(
                b.get("text", "")
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
        if role in ("system", "developer"):
            continue  # system handled separately
        elif role == "assistant":
            convo.append(f"[Assistant]:\n{content}")
        else:
            convo.append(f"[User]:\n{content}")
    if len(convo) == 1 and convo[0].startswith("[User]:\n"):
        return convo[0][len("[User]:\n") :]
    return "\n\n".join(convo) + "\n\n[Assistant]:"


def split_system(messages: list[Message], system: str | None) -> tuple[str, list[Message]]:
    """Pull any system/developer messages into the system string."""
    sys_parts = []
    if system:
        sys_parts.append(system)
    rest = []
    for m in messages:
        if m.get("role") in ("system", "developer"):
            c = m.get("content") or ""
            if c:
                sys_parts.append(c)
        else:
            rest.append(m)
    return "\n\n".join(sys_parts), rest


class Provider:
    """Abstract LLM provider."""

    name = "base"

    async def test_connection(self) -> str:
        """Run the smallest provider request that proves the connection works."""
        text, _ = await self.complete(
            "You are a connectivity check. Reply with exactly: OK",
            [{"role": "user", "content": "ping"}],
        )
        return (text or "").strip()

    async def stream(
        self, system: str, messages: list[Message], model: str | None = None
    ) -> AsyncIterator[str]:
        """Yield text deltas. Default: chunk the non-stream completion."""
        text, _ = await self.complete(system, messages, model)
        # emit in modest chunks so the UI feels live
        step = 24
        for i in range(0, len(text), step):
            yield text[i : i + step]

    async def complete(
        self, system: str, messages: list[Message], model: str | None = None
    ) -> tuple[str, dict]:
        """Return (text, usage_dict). Must be implemented by subclasses."""
        raise NotImplementedError
