"""Shared helpers for feature endpoints: token budgeting + structured JSON calls."""
from __future__ import annotations

from typing import Any

from ..json_utils import extract_json
from ..providers import registry

try:
    import tiktoken

    _ENC = tiktoken.get_encoding("cl100k_base")
except Exception:  # pragma: no cover - tiktoken optional at runtime
    _ENC = None


def count_tokens(text: str) -> int:
    if _ENC is None:
        return max(1, len(text) // 4)
    return len(_ENC.encode(text))


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    if _ENC is None:
        return text[: max_tokens * 4]
    toks = _ENC.encode(text)
    if len(toks) <= max_tokens:
        return text
    return _ENC.decode(toks[:max_tokens])


_JSON_INSTR = (
    "\n\nRespond with ONLY a single valid JSON object — no prose, no markdown "
    "fences — conforming to this shape:\n{shape}"
)


async def json_complete(
    system: str,
    user: str,
    shape: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    retries: int = 1,
) -> Any:
    """Run a completion that must return JSON; parse tolerantly, retry once."""
    sys = system + _JSON_INSTR.format(shape=shape)
    last_text = ""
    for attempt in range(retries + 1):
        text, _ = await registry.complete(
            sys, [{"role": "user", "content": user}], provider=provider, model=model
        )
        last_text = text
        parsed = extract_json(text)
        if parsed is not None:
            return parsed
        # nudge harder on retry
        sys = system + _JSON_INSTR.format(shape=shape) + "\n\nReturn JSON only."
    raise ValueError(f"model did not return parseable JSON: {last_text[:300]}")


async def text_complete(
    system: str, user: str, *, provider: str | None = None, model: str | None = None
) -> str:
    text, _ = await registry.complete(
        system, [{"role": "user", "content": user}], provider=provider, model=model
    )
    return text
