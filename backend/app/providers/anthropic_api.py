"""Anthropic Messages API provider (needs an API key)."""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from ..config import load_config
from .base import Message, Provider


def _cfg() -> dict:
    return load_config()["providers"]["anthropic"]


class AnthropicProvider(Provider):
    name = "anthropic"

    def _headers(self) -> dict:
        return {
            "x-api-key": _cfg().get("api_key", ""),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _body(self, system: str, messages: list[Message], model: str | None, stream: bool) -> dict:
        c = _cfg()
        msgs = []
        for message in messages:
            if message.get("role") in ("system", "developer"):
                continue
            text = message.get("content") or ""
            attachments = message.get("attachments") or []
            content: str | list[dict] = text
            if attachments and message.get("role") != "assistant":
                content = []
                for attachment in attachments:
                    data_url = attachment.get("image_data_url") or ""
                    if not data_url.startswith("data:image/png;base64,"):
                        continue
                    content.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": data_url.split(",", 1)[1],
                        },
                    })
                content.append({"type": "text", "text": text})
            msgs.append({
                "role": "assistant" if message.get("role") == "assistant" else "user",
                "content": content,
            })
        body = {
            "model": model or c.get("model", "claude-sonnet-4-5"),
            "max_tokens": 4096,
            "messages": msgs,
            "stream": stream,
        }
        if system:
            body["system"] = system
        return body

    async def complete(self, system, messages, model=None):
        c = _cfg()
        async with httpx.AsyncClient(timeout=c.get("timeout", 300), trust_env=False) as client:
            r = await client.post(
                f"{c.get('base_url', 'https://api.anthropic.com').rstrip('/')}/v1/messages",
                headers=self._headers(),
                json=self._body(system, messages, model, stream=False),
            )
            r.raise_for_status()
            data = r.json()
        text = "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )
        u = data.get("usage", {})
        usage = {
            "prompt_tokens": u.get("input_tokens", 0),
            "completion_tokens": u.get("output_tokens", 0),
            "total_tokens": u.get("input_tokens", 0) + u.get("output_tokens", 0),
        }
        return text, usage

    async def stream(self, system, messages, model=None) -> AsyncIterator[str]:
        c = _cfg()
        async with httpx.AsyncClient(timeout=c.get("timeout", 300), trust_env=False) as client:
            async with client.stream(
                "POST",
                f"{c.get('base_url', 'https://api.anthropic.com').rstrip('/')}/v1/messages",
                headers=self._headers(),
                json=self._body(system, messages, model, stream=True),
            ) as r:
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
                    if evt.get("type") == "content_block_delta":
                        d = evt.get("delta", {})
                        if d.get("type") == "text_delta":
                            yield d.get("text", "")
