"""OpenAI-compatible endpoints get the harness tools as native functions; their
tool calls come back as <tool_call> blocks. A bare JSON argument object at the
end of a message is recovered or reported to the model."""
import asyncio
import json

import httpx

from app.harness import protocol
from app.providers import openai_api
from app.providers.base import native_tools

TOOLS = [{"name": "web_search", "description": "search", "parameters": {"type": "object", "properties": {
    "query": {"type": "string"}, "source": {"type": "string"}, "k": {"type": "integer"}}, "required": ["query"]}},
    {"name": "todo_write", "description": "todos", "parameters": {"type": "object", "properties": {
        "todos": {"type": "array", "description": "no items given"}}, "required": ["todos"]}},
    {"name": "skill.not-a-function-name", "description": "x", "parameters": {"type": "object", "properties": {}}}]


def _sse(*events):
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n"


def _run(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(openai_api.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(openai_api, "_cfg", lambda: {"base_url": "https://example.invalid"})

    async def go():
        with native_tools(TOOLS):
            return "".join([c async for c in openai_api.OpenAIProvider().stream("sys", [{"role": "user", "content": "hi"}])])
    return asyncio.run(go())


def test_native_tool_calls_become_protocol_blocks(monkeypatch):
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        return httpx.Response(200, content=_sse(
            {"choices": [{"delta": {"content": "Checking the venue."}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "web_search", "arguments": '{"query": "\\"MECPE\\" venue'}}]}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '", "k": 5}'}}]}}]},
        ))
    out = _run(monkeypatch, handler)
    names = [t["function"]["name"] for t in seen[0]["tools"]]
    assert names == ["web_search", "todo_write"]  # names OpenAI would reject stay text-only
    assert seen[0]["tools"][1]["function"]["parameters"]["properties"]["todos"]["items"] == {}
    text, calls = protocol.parse_message(out)
    assert text == "Checking the venue."
    assert [(c.name, c.arguments) for c in calls] == [("web_search", {"query": '"MECPE" venue', "k": 5})]


def test_endpoint_without_function_calling_falls_back_to_text(monkeypatch):
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        if "tools" in body:
            return httpx.Response(400, json={"error": "tools are not supported"})
        return httpx.Response(200, content=_sse({"choices": [{"delta": {"content": "plain answer"}}]}))
    assert _run(monkeypatch, handler) == "plain answer"
    assert "tools" in seen[0] and "tools" not in seen[-1]


def test_bare_argument_object_is_recovered_or_reported():
    tools = {t["name"]: t["parameters"] for t in TOOLS}
    text, call = protocol.recover_bare_call('先查一下。{"query":"MECPE venue","source":"all","k":5}', tools)
    assert text == "先查一下。" and call.name == "web_search" and call.error is None
    # the relay mangled the quotes: tell the model instead of showing the JSON
    text, call = protocol.recover_bare_call('先查一下。{"query":""MECPE" venue","source":"all","k":5}', tools)
    assert text == "先查一下。" and call.error and "web_search" in call.error
    # an answer that just ends in JSON is left alone
    assert protocol.recover_bare_call('结果：{"title": "x", "year": 2020}', tools) == ('结果：{"title": "x", "year": 2020}', None)
