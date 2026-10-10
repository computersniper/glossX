"""Provider registry — pick the active LLM provider from config or an override."""
from __future__ import annotations

import asyncio
import hashlib
import time
from contextlib import contextmanager
from contextvars import ContextVar

from ..config import load_config, resolve_feature_settings
from ..library import store
from .anthropic_api import AnthropicProvider
from .base import (
    Provider,
    ProviderSessionUnavailableError,
    estimate_text_tokens,
    message_text,
    provider_runtime_options,
    split_system,
)
from .local_claude import LocalClaudeProvider
from .local_codex import LocalCodexProvider
from .openai_api import OpenAIProvider

_PROVIDERS: dict[str, Provider] = {
    "local_claude": LocalClaudeProvider(),
    "local_codex": LocalCodexProvider(),
    "anthropic": AnthropicProvider(),
    "openai": OpenAIProvider(),
}
_STATUSES: dict[str, dict] = {}
_USAGE_CONTEXT: ContextVar[dict | None] = ContextVar("gloss_usage_context", default=None)
_FEATURE_CONTEXT: ContextVar[dict | None] = ContextVar(
    "gloss_feature_context", default=None
)
_PAPER_SESSION_LOCKS: dict[tuple[str, str, str], asyncio.Lock] = {}
# Optional per-run meter (GlossX agent budget). It must expose
# ``before_llm_call()`` (may raise to refuse the call) and
# ``after_llm_call(tokens_est: int)``.
_CALL_METER: ContextVar[object | None] = ContextVar("gloss_call_meter", default=None)


@contextmanager
def call_meter(meter: object | None):
    """Count every provider call made in this context against ``meter``."""
    token = _CALL_METER.set(meter)
    try:
        yield
    finally:
        _CALL_METER.reset(token)


def _meter_before() -> None:
    meter = _CALL_METER.get()
    if meter is not None:
        meter.before_llm_call()  # type: ignore[attr-defined]


def _meter_after(system: str, messages: list[dict], text: str) -> None:
    meter = _CALL_METER.get()
    if meter is not None:
        tokens = estimate_text_tokens(system + "\n" + message_text(messages))
        tokens += estimate_text_tokens(text or "")
        meter.after_llm_call(tokens)  # type: ignore[attr-defined]


@contextmanager
def usage_context(
    task_type: str,
    *,
    paper_id: str | None = None,
    plugin_id: str | None = None,
):
    """Attach a feature/task label to provider calls made in this context."""
    token = _USAGE_CONTEXT.set(
        {"task_type": task_type, "paper_id": paper_id, "plugin_id": plugin_id}
    )
    try:
        yield
    finally:
        _USAGE_CONTEXT.reset(token)


@contextmanager
def feature_context(
    *,
    paper_id: str | None,
    context_mode: str = "full",
    effort: str | None = None,
):
    """Apply per-feature provider options for calls nested in this context."""
    token = _FEATURE_CONTEXT.set(
        {
            "paper_id": paper_id,
            "context_mode": context_mode,
            "effort": effort,
        }
    )
    try:
        yield
    finally:
        _FEATURE_CONTEXT.reset(token)


def _paper_fingerprint(paper_id: str) -> str | None:
    parsed = store.load_parsed(paper_id)
    text = str((parsed or {}).get("full_text") or "")
    if not text:
        return None
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _without_repeated_paper(messages: list[dict]) -> list[dict]:
    """Replace paper payloads with a small resume instruction."""
    prepared: list[dict] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, str) or "=== PAPER ===" not in content:
            prepared.append(message)
            continue
        instructions, _, _paper = content.partition("=== PAPER ===")
        prepared.append(
            {
                **message,
                "content": (
                    instructions.rstrip()
                    + "\n\nThe full paper is already present in this shared "
                    "provider session. Use that paper as the source of truth."
                ),
            }
        )
    return prepared


def _contains_full_paper(messages: list[dict]) -> bool:
    return any(
        isinstance(message.get("content"), str)
        and "=== PAPER ===" in message["content"]
        for message in messages
    )


async def _complete_in_shared_paper_session(
    provider_name: str,
    system: str,
    messages: list[dict],
    model: str | None,
    paper_id: str,
) -> tuple[tuple[str, dict], str, list[dict]]:
    fingerprint = _paper_fingerprint(paper_id)
    if not fingerprint:
        provider = get_provider(provider_name)
        return await provider.complete(system, messages, model), system, messages

    key = (paper_id, provider_name, fingerprint)
    lock = _PAPER_SESSION_LOCKS.setdefault(key, asyncio.Lock())
    async with lock:
        record = store.get_provider_session(paper_id, provider_name, fingerprint)
        session_id = record.get("session_id") if record else None
        if not session_id and not _contains_full_paper(messages):
            provider = get_provider(provider_name)
            return await provider.complete(system, messages, model), system, messages
        sent_messages = _without_repeated_paper(messages) if session_id else messages
        try:
            text, usage, resolved_id = await complete_in_session(
                system,
                sent_messages,
                provider=provider_name,
                model=model,
                session_id=session_id,
                record_usage=False,
            )
        except ProviderSessionUnavailableError:
            store.delete_provider_session(paper_id, provider_name, fingerprint)
            sent_messages = messages
            text, usage, resolved_id = await complete_in_session(
                system,
                messages,
                provider=provider_name,
                model=model,
                session_id=None,
                record_usage=False,
            )
        store.set_provider_session(
            paper_id, provider_name, fingerprint, resolved_id
        )
        return (text, usage), system, sent_messages


def _record_usage(
    *, provider: str, model: str | None, system: str, messages: list[dict], text: str,
    usage: dict | None,
) -> None:
    context = _USAGE_CONTEXT.get()
    if not context:
        return
    raw = usage or {}
    prompt = int(raw.get("prompt_tokens") or 0)
    completion = int(raw.get("completion_tokens") or 0)
    total = int(raw.get("total_tokens") or 0)
    exact = total > 0 or prompt > 0 or completion > 0
    if exact:
        total = total or prompt + completion
    else:
        prompt = estimate_text_tokens(system + "\n" + message_text(messages))
        completion = estimate_text_tokens(text)
        total = prompt + completion
    store.record_ai_usage(
        task_type=context["task_type"], provider=provider, model=model,
        paper_id=context.get("paper_id"), plugin_id=context.get("plugin_id"),
        prompt_tokens=prompt, completion_tokens=completion, total_tokens=total,
        estimated=not exact,
    )


def _record_status(name: str, connected: bool, error: str = "") -> None:
    _STATUSES[name] = {
        "status": "connected" if connected else "error",
        "connected": connected,
        "error": error[:400],
        "checked_at": time.time(),
    }


def provider_statuses() -> dict[str, dict]:
    return {
        name: dict(
            _STATUSES.get(
                name,
                {
                    "status": "unknown",
                    "connected": False,
                    "error": "",
                    "checked_at": None,
                },
            )
        )
        for name in _PROVIDERS
    }


def reset_status(name: str) -> None:
    _STATUSES.pop(name, None)


async def test_connection(name: str | None = None) -> dict:
    provider_name = name or load_config().get("provider", "local_claude")
    provider = get_provider(provider_name)
    started = time.monotonic()
    try:
        reply = await asyncio.wait_for(provider.test_connection(), timeout=30)
    except Exception as error:
        message = str(error) or type(error).__name__
        _record_status(provider_name, False, message)
        return {
            "ok": False,
            "provider": provider_name,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "error": message[:400],
        }
    _record_status(provider_name, True)
    return {
        "ok": True,
        "provider": provider_name,
        "latency_ms": int((time.monotonic() - started) * 1000),
        "reply": (reply or "").strip()[:200],
    }


def get_provider(name: str | None = None) -> Provider:
    name = resolve_provider_name(name)
    if name in _PROVIDERS and not is_enabled(name):
        raise RuntimeError(
            f"The '{name}' model provider is turned off in Settings. "
            "Turn it on or choose another provider."
        )
    return _PROVIDERS.get(name, _PROVIDERS["local_claude"])


def resolve_provider_name(name: str | None = None) -> str:
    if name:
        return name
    settings = _settings_for_current_feature(None, None)
    return settings["provider"]


def _settings_for_current_feature(
    provider: str | None, model: str | None
) -> dict:
    feature = _FEATURE_CONTEXT.get()
    if feature is not None:
        return {
            **feature,
            "provider": provider or load_config().get("provider", "local_claude"),
            "model": model,
        }
    usage = _USAGE_CONTEXT.get()
    if usage:
        feature_id = (
            f"plugin:{usage['plugin_id']}"
            if usage.get("plugin_id")
            else f"core.{usage['task_type']}"
        )
        overrides = {
            key: value
            for key, value in {"provider": provider, "model": model}.items()
            if value is not None
        }
        return {
            **resolve_feature_settings(feature_id, overrides),
            "paper_id": usage.get("paper_id"),
        }
    return {
        "provider": provider or load_config().get("provider", "local_claude"),
        "model": model,
        "effort": None,
        "context_mode": "full",
        "paper_id": None,
    }


def all_providers() -> list[str]:
    """Every provider GlossX knows, whether or not it is switched on."""
    return list(_PROVIDERS.keys())


def is_enabled(name: str, cfg: dict | None = None) -> bool:
    """Providers are on unless the user switched them off in Settings."""
    providers = (cfg or load_config()).get("providers") or {}
    return (providers.get(name) or {}).get("enabled", True) is not False


def available() -> list[str]:
    """Providers the user can pick: the ones switched on in Settings."""
    cfg = load_config()
    return [name for name in _PROVIDERS if is_enabled(name, cfg)]


async def complete(
    system: str,
    messages: list[dict],
    *,
    provider: str | None = None,
    model: str | None = None,
) -> tuple[str, dict]:
    """Convenience: run a non-streaming completion on the active/selected provider."""
    settings = _settings_for_current_feature(provider, model)
    provider_name = settings["provider"]
    model = settings.get("model")
    p = get_provider(provider_name)
    sys, msgs = split_system(messages, system)
    feature = settings
    _meter_before()
    try:
        with provider_runtime_options(effort=feature.get("effort")):
            if (
                feature.get("context_mode") == "shared_session"
                and feature.get("paper_id")
                and callable(getattr(p, "complete_session", None))
            ):
                result, sent_sys, sent_msgs = await _complete_in_shared_paper_session(
                    provider_name,
                    sys,
                    msgs,
                    model,
                    feature["paper_id"],
                )
            else:
                result = await p.complete(sys, msgs, model)
                sent_sys, sent_msgs = sys, msgs
    except Exception as error:
        _record_status(provider_name, False, str(error) or type(error).__name__)
        raise
    _record_status(provider_name, True)
    _meter_after(sent_sys, sent_msgs, result[0])
    _record_usage(
        provider=provider_name, model=model, system=sent_sys, messages=sent_msgs,
        text=result[0], usage=result[1],
    )
    return result


async def stream(
    system: str,
    messages: list[dict],
    *,
    provider: str | None = None,
    model: str | None = None,
):
    settings = _settings_for_current_feature(provider, model)
    provider_name = settings["provider"]
    model = settings.get("model")
    p = get_provider(provider_name)
    sys, msgs = split_system(messages, system)
    feature = settings
    connected = False
    chunks: list[str] = []
    _meter_before()
    try:
        with provider_runtime_options(effort=feature.get("effort")):
            async for chunk in p.stream(sys, msgs, model):
                if not connected:
                    _record_status(provider_name, True)
                    connected = True
                chunks.append(chunk)
                yield chunk
    except Exception as error:
        _record_status(provider_name, False, str(error) or type(error).__name__)
        raise
    if not connected:
        _record_status(provider_name, True)
    _meter_after(sys, msgs, "".join(chunks))
    # The provider streaming contract only yields text, not a terminal usage
    # object. Record a tokenizer estimate rather than inventing exact values.
    _record_usage(
        provider=provider_name, model=model, system=sys, messages=msgs,
        text="".join(chunks), usage=None,
    )


async def complete_in_session(
    system: str,
    messages: list[dict],
    *,
    provider: str,
    model: str | None = None,
    session_id: str | None = None,
    record_usage: bool = True,
) -> tuple[str, dict, str]:
    """Run a provider-specific persisted session completion.

    Only providers that explicitly implement ``complete_session`` may use this
    path; regular completions continue through the stateless interface above.
    """
    settings = _settings_for_current_feature(provider, model)
    provider = settings["provider"]
    model = settings.get("model")
    p = get_provider(provider)
    complete_session = getattr(p, "complete_session", None)
    if complete_session is None:
        raise ValueError(f"provider {provider!r} does not support sessions")
    sys, msgs = split_system(messages, system)
    if record_usage:  # nested calls from complete() are metered there
        _meter_before()
    try:
        with provider_runtime_options(effort=settings.get("effort")):
            result = await complete_session(sys, msgs, model, session_id=session_id)
    except Exception as error:
        _record_status(provider, False, str(error) or type(error).__name__)
        raise
    _record_status(provider, True)
    if record_usage:
        _meter_after(sys, msgs, result[0])
        _record_usage(
            provider=provider, model=model, system=sys, messages=msgs,
            text=result[0], usage=result[1],
        )
    return result
