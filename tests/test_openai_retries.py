"""Transient provider failures recover without replaying partial generations.

MockTransport exercises real HTTP request/stream processing without network,
model calls or billing. Retries are observable and cancellation stays prompt.
"""
from __future__ import annotations

import asyncio
from email.utils import formatdate
import json

import httpx
import pytest

from app.providers import openai_api
from app.providers.base import capture_stream_usage, native_tools, progress_sink


def _install(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(openai_api.httpx, "AsyncClient", lambda **kw: original(
        transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(openai_api, "_cfg", lambda: {
        "base_url": "https://example.invalid", "api_key": "private-test-key"})


def _sse(event):
    return ("data: " + json.dumps(event) + "\n\n").encode()


def _success(stream):
    if stream:
        return httpx.Response(200, content=_sse({"choices": [{"delta": {"content": "answer"}}]}))
    return httpx.Response(200, json={"choices": [{"message": {"content": "answer"}}],
                                    "usage": {"prompt_tokens": 10, "completion_tokens": 2}})


async def _call(stream):
    provider = openai_api.OpenAIProvider()
    if stream:
        return "".join([part async for part in provider.stream("rules", [{"role": "user", "content": "question"}])])
    return (await provider.complete("rules", [{"role": "user", "content": "question"}]))[0]


@pytest.fixture
def waits(monkeypatch):
    recorded = []

    async def sleep(delay):
        recorded.append(delay)

    monkeypatch.setattr(openai_api.asyncio, "sleep", sleep)
    monkeypatch.setattr(openai_api.random, "uniform", lambda *_: 0)
    return recorded


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_transient_http_error_recovers_and_reports_retry(monkeypatch, waits, stream, status):
    requests = []
    progress = []

    def handler(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(status, json={"error": "do not echo private-test-key"})
        return _success(stream)

    _install(monkeypatch, handler)
    with progress_sink(progress.append):
        assert asyncio.run(_call(stream)) == "answer"
    assert len(requests) == 2 and requests[0] == requests[1]
    assert waits == [1]
    assert len(progress) == 1 and f"HTTP {status}" in progress[0]["text"]
    assert "private-test-key" not in progress[0]["text"]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("status", [400, 401, 402, 403, 404, 422])
def test_permanent_http_error_is_not_retried(monkeypatch, waits, stream, status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, json={"error": "permanent failure"})

    _install(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError) as raised:
        asyncio.run(_call(stream))
    assert raised.value.response.status_code == status
    assert len(requests) == 1 and not waits


@pytest.mark.parametrize("stream", [False, True])
def test_exhaustion_has_three_attempts(monkeypatch, waits, stream):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(429)

    _install(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(_call(stream))
    assert len(requests) == 3 and waits == [1, 2]


@pytest.mark.parametrize("retry_after", ["3", formatdate(1_800_000_003, usegmt=True)])
def test_retry_after_seconds_and_http_date_are_honored(monkeypatch, waits, retry_after):
    requests = []
    monkeypatch.setattr(openai_api.time, "time", lambda: 1_800_000_000)

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": retry_after})
        return _success(True)

    _install(monkeypatch, handler)
    assert asyncio.run(_call(True)) == "answer"
    assert waits == [3]


@pytest.mark.parametrize("retry_after", ["31", "inf", formatdate(1_800_000_060, usegmt=True)])
def test_long_retry_after_fails_instead_of_retrying_early(monkeypatch, waits, retry_after):
    requests = []
    monkeypatch.setattr(openai_api.time, "time", lambda: 1_800_000_000)

    def handler(request):
        requests.append(request)
        return httpx.Response(429, headers={"Retry-After": retry_after})

    _install(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(_call(True))
    assert len(requests) == 1 and waits == []


@pytest.mark.parametrize("retry_after", ["not-a-delay", "-1", "nan"])
def test_invalid_retry_after_uses_bounded_backoff(monkeypatch, waits, retry_after):
    requests = []

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(503, headers={"Retry-After": retry_after})
        return _success(False)

    _install(monkeypatch, handler)
    assert asyncio.run(_call(False)) == "answer"
    assert waits == [1]


@pytest.mark.parametrize("stream", [False, True])
def test_connection_error_before_response_can_recover(monkeypatch, waits, stream):
    requests = []

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            raise httpx.ConnectError("connection refused", request=request)
        return _success(stream)

    _install(monkeypatch, handler)
    assert asyncio.run(_call(stream)) == "answer"
    assert len(requests) == 2 and waits == [1]


@pytest.mark.parametrize("stream", [False, True])
def test_bad_protocol_configuration_is_not_retried(monkeypatch, waits, stream):
    requests = []

    def handler(request):
        requests.append(request)
        raise httpx.UnsupportedProtocol("bad endpoint", request=request)

    _install(monkeypatch, handler)
    with pytest.raises(httpx.UnsupportedProtocol):
        asyncio.run(_call(stream))
    assert len(requests) == 1 and not waits


class BrokenStream(httpx.AsyncByteStream):
    def __init__(self, prefix, error_type=httpx.ReadError):
        self.prefix = prefix
        self.error_type = error_type
        self.closed = False

    async def __aiter__(self):
        yield self.prefix
        raise self.error_type("connection dropped")

    async def aclose(self):
        self.closed = True


@pytest.mark.parametrize("event", [
    {"choices": [{"delta": {"content": "partial answer"}}]},
    {"choices": [{"delta": {"reasoning_content": "thinking"}}]},
    {"choices": [{"delta": {"role": "assistant"}}]},
    {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {
        "name": "fs_read", "arguments": '{"path":"paper.md"}'}}]}}]},
    {"usage": {"prompt_tokens": 12, "completion_tokens": 1}, "choices": []},
])
def test_no_replay_after_any_generation_data(monkeypatch, waits, event):
    requests = []
    broken = BrokenStream(_sse(event))
    emitted = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, stream=broken)

    _install(monkeypatch, handler)

    async def run():
        with capture_stream_usage() as usage:
            async for part in openai_api.OpenAIProvider().stream("rules", []):
                emitted.append(part)

    with pytest.raises(httpx.ReadError):
        asyncio.run(run())
    assert len(requests) == 1 and waits == [] and broken.closed
    if "content" in (event.get("choices") or [{}])[0].get("delta", {}):
        assert emitted == ["partial answer"]


@pytest.mark.parametrize("prefix", [b"", b": keepalive\n\n", b'data: {"choices": [{"delta": {"content": "par'])
@pytest.mark.parametrize("error_type", [httpx.ReadError, httpx.ReadTimeout, httpx.ConnectError])
def test_accepted_stream_is_not_replayed_even_before_complete_sse_data(monkeypatch, waits, prefix, error_type):
    requests = []
    broken = BrokenStream(prefix, error_type)

    def handler(request):
        requests.append(request)
        return httpx.Response(200, stream=broken) if len(requests) == 1 else _success(True)

    _install(monkeypatch, handler)
    with pytest.raises(error_type):
        asyncio.run(_call(True))
    assert len(requests) == 1 and waits == [] and broken.closed


@pytest.mark.parametrize("error_type", [httpx.ReadTimeout, httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError])
def test_complete_does_not_repeat_a_possibly_accepted_request(monkeypatch, waits, error_type):
    requests = []

    def handler(request):
        requests.append(request)
        raise error_type("response unavailable", request=request)

    _install(monkeypatch, handler)
    with pytest.raises(error_type):
        asyncio.run(_call(False))
    assert len(requests) == 1 and not waits


def test_retry_allowance_survives_capability_fallback(monkeypatch, waits):
    bodies = []
    statuses = iter([429, 400, 503, 429])

    def handler(request):
        bodies.append(json.loads(request.content))
        status = next(statuses)
        return httpx.Response(status, json={"error": "unknown parameter stream_options"})

    _install(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(_call(True))
    assert len(bodies) == 4 and waits == [1, 2]
    assert "stream_options" in bodies[1] and "stream_options" not in bodies[2]


def test_capability_fallbacks_still_work_after_transient_error(monkeypatch, waits):
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        if len(bodies) == 1:
            return httpx.Response(503)
        if "stream_options" in body:
            return httpx.Response(400, json={"error": "unknown parameter stream_options"})
        if "tools" in body:
            return httpx.Response(422, json={"error": "tools are not supported"})
        if isinstance(body["messages"][0]["content"], list):
            return httpx.Response(400, json={"error": "image input is not supported"})
        return _success(True)

    _install(monkeypatch, handler)

    async def run():
        with native_tools([{"name": "fs_read", "parameters": {"type": "object", "properties": {}}}]):
            return "".join([c async for c in openai_api.OpenAIProvider().stream("", [{
                "role": "user", "content": "image.png", "attachments": [{"image_data_url": "data:image/png;base64,AA=="}]}])])

    assert asyncio.run(run()) == "answer"
    assert len(bodies) == 5 and waits == [1]
    assert bodies[-1]["messages"][0]["content"] == "image.png"


@pytest.mark.parametrize("stream", [False, True])
def test_cancelling_backoff_does_not_send_next_request(monkeypatch, stream):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(429)

    _install(monkeypatch, handler)

    async def run():
        sleeping = asyncio.Event()

        async def sleep(delay):
            sleeping.set()
            await asyncio.Future()

        monkeypatch.setattr(openai_api.asyncio, "sleep", sleep)
        task = asyncio.create_task(_call(stream))
        await asyncio.wait_for(sleeping.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert len(requests) == 1
