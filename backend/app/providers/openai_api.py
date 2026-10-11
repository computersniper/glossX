"""OpenAI-compatible provider.

Works against real OpenAI, or ANY OpenAI-compatible endpoint — including the
local claude_proxy at http://127.0.0.1:8899/v1. ``trust_env=False`` so localhost
calls don't get routed through the box's SOCKS/HTTP proxy env vars.
"""
from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator

import httpx

from ..config import load_config
from .base import Message, Provider, normalize_usage, offered_tools, report_progress, report_stream_usage

_FUNCTION_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _schema(value: Any) -> Any:
    """OpenAI rejects an array schema without ``items``; fill them in."""
    if isinstance(value, dict):
        out = {k: _schema(v) for k, v in value.items()}
        if out.get("type") == "array" and "items" not in out:
            out["items"] = {}
        return out
    if isinstance(value, list):
        return [_schema(v) for v in value]
    return value


def _functions(tools: list[dict] | None) -> list[dict]:
    """The harness tools as OpenAI function tools. Models trained on native
    function calling (GPT) otherwise tend to emit a bare JSON argument object
    with the tool name lost, which the harness cannot run."""
    out = []
    for tool in tools or []:
        name = str(tool.get("name") or "")
        if not _FUNCTION_NAME.match(name):
            continue  # still callable through the text protocol
        params = tool.get("parameters") or {}
        if not isinstance(params, dict) or params.get("type") != "object":
            params = {"type": "object", "properties": {}}
        out.append({"type": "function", "function": {
            "name": name, "description": str(tool.get("description") or "")[:1000], "parameters": _schema(params)}})
    return out[:128]


def _calls_as_text(calls: dict[int, dict]) -> str:
    """Native tool calls rendered as the harness's ``<tool_call>`` blocks."""
    blocks = []
    for _, call in sorted(calls.items()):
        if not call.get("name"):
            continue
        raw = call.get("arguments") or ""
        try:
            args = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            args = raw  # the protocol parser reports invalid arguments to the model
        blocks.append("<tool_call>" + json.dumps({"name": call["name"], "arguments": args}, ensure_ascii=False) + "</tool_call>")
    return ("\n" + "\n".join(blocks)) if blocks else ""


def _usage(raw: dict) -> dict:
    return {**raw, "cached_input_tokens": (raw.get("prompt_tokens_details") or {}).get("cached_tokens", 0),
            "reasoning_tokens": (raw.get("completion_tokens_details") or {}).get("reasoning_tokens", 0),
            "exact": "prompt_tokens" in raw}


def _cfg() -> dict:
    return load_config()["providers"]["openai"]


def _has_images(messages: list[dict]) -> bool:
    return any(isinstance(m.get("content"), list) and any(p.get("type") == "image_url" for p in m["content"]) for m in messages)


class OpenAIProvider(Provider):
    name = "openai"

    def _url(self) -> str:
        base = _cfg().get("base_url", "https://api.openai.com/v1").rstrip("/")
        return f"{base}/chat/completions"

    def _headers(self) -> dict:
        key = _cfg().get("api_key", "") or "sk-none"
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _messages(self, system: str, messages: list[Message]) -> list[dict]:
        out = []
        if system:
            out.append({"role": "system", "content": system})
        for m in messages:
            text = m.get("content") or ""
            attachments = m.get("attachments") or []
            content: str | list[dict] = text
            if attachments and m.get("role") not in ("system", "developer", "assistant"):
                content = [{"type": "text", "text": text}]
                content.extend(
                    {
                        "type": "image_url",
                        "image_url": {"url": attachment["image_data_url"]},
                    }
                    for attachment in attachments
                    if attachment.get("image_data_url")
                )
            if m.get("role") in ("system", "developer"):
                out.append({"role": "system", "content": text})
            else:
                out.append({"role": m.get("role", "user"), "content": content})
        return out

    async def complete(self, system, messages, model=None):
        c = _cfg()
        body = {
            "model": model or c.get("model", "gpt-4o-mini"),
            "messages": self._messages(system, messages),
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=c.get("timeout", 300), trust_env=False) as client:
            r = await client.post(self._url(), headers=self._headers(), json=body)
            r.raise_for_status()
            data = r.json()
        text = data["choices"][0]["message"].get("content") or ""
        u = data.get("usage", {}) or {}
        usage = normalize_usage(_usage(u), system, messages, text)
        return text, usage

    async def stream(self, system, messages, model=None) -> AsyncIterator[str]:
        c = _cfg()
        body = {
            "model": model or c.get("model", "gpt-4o-mini"),
            "messages": self._messages(system, messages),
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        functions = _functions(offered_tools())
        if functions:
            body["tools"] = functions
            body["tool_choice"] = "auto"
        calls: dict[int, dict] = {}
        async with httpx.AsyncClient(timeout=c.get("timeout", 300), trust_env=False) as client:
            for attempt in range(4):
                async with client.stream(
                    "POST", self._url(), headers=self._headers(), json=body
                ) as r:
                    if attempt < 3 and r.status_code in (400, 422):
                        error_body = await r.aread()
                        if b"stream_options" in error_body and "stream_options" in body:
                            # Older compatible servers can still stream; label
                            # missing usage as estimated rather than break chat.
                            body.pop("stream_options", None)
                            continue
                        if "tools" in body:
                            # an endpoint without function calling: the text protocol still works
                            body.pop("tools", None)
                            body.pop("tool_choice", None)
                            continue
                        if _has_images(body["messages"]):
                            # a text-only model: the images' text lines still name the files
                            body["messages"] = self._messages(system, [{k: v for k, v in m.items() if k != "attachments"} for m in messages])
                            continue
                        r.raise_for_status()
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            evt = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        if evt.get("usage"):
                            report_stream_usage(_usage(evt["usage"]))
                        delta = (evt.get("choices") or [{}])[0].get("delta") or {}
                        thinking = delta.get("reasoning_content") or delta.get("reasoning")
                        if isinstance(thinking, str) and thinking:
                            report_progress("thinking", thinking)
                        for tc in delta.get("tool_calls") or []:
                            slot = calls.setdefault(int(tc.get("index") or 0), {"name": "", "arguments": ""})
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] += fn["name"]
                            if isinstance(fn.get("arguments"), str):
                                slot["arguments"] += fn["arguments"]
                        piece = delta.get("content")
                        if piece:
                            yield piece
                    tail = _calls_as_text(calls)
                    if tail:
                        yield tail
                    break
