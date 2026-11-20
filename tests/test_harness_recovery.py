"""A transient provider failure must not discard a research session's tools.

These tests exercise the real HTTP session API and native OpenAI provider with
a local MockTransport. No external request or model inference is performed.
"""
import json
import time

import httpx
import pytest

from app.providers import openai_api


def _sse(event):
    return f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n"


def _session(client, monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(openai_api.httpx, "AsyncClient", lambda **kw: original(
        transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(openai_api, "_cfg", lambda: {
        "base_url": "https://provider.invalid", "model": "test-model", "timeout": 2,
    })
    # Keep the integration test fast without changing status classification.
    monkeypatch.setattr(openai_api.random, "uniform", lambda *_: 0)
    project = client.post("/api/agent/projects", json={"name": "Recovery test"}).json()
    from pathlib import Path
    (Path(project["workspace"]["path"]) / "note.md").write_text(
        "The registered held-out accuracy is 82 percent.", encoding="utf-8")
    response = client.post("/api/sessions", json={
        "project_id": project["id"], "provider": "openai", "model": "test-model", "mode": "ask",
    })
    assert response.status_code == 200, response.text
    sid = response.json()["id"]
    response = client.post(f"/api/sessions/{sid}/messages", json={
        "text": 'Read note.md and return JSON with the registered accuracy in "answer".',
    })
    assert response.status_code == 200, response.text
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        session = client.get(f"/api/sessions/{sid}").json()
        if session["status"] == "idle":
            return session
        time.sleep(.02)
    pytest.fail("session did not finish")


def test_rate_limit_recovery_preserves_native_tool_execution(client, monkeypatch):
    requests = []
    final = {"answer": "82 percent", "citations": [{"paper": "note.md", "quote":
             "The registered held-out accuracy is 82 percent."}]}

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"error": "rate limited"})
        if len(requests) == 2:
            return httpx.Response(200, text=_sse({"choices": [{"delta": {"tool_calls": [{
                "index": 0, "function": {"name": "fs_read", "arguments": '{"path":"note.md"}'},
            }]}}]}))
        assert len(requests) == 3
        assert "The registered held-out accuracy is 82 percent." in json.dumps(body["messages"])
        return httpx.Response(200, text=_sse({"choices": [{"delta": {"content": json.dumps(final)}}]}))

    session = _session(client, monkeypatch, handler)
    assert len(requests) == 3
    assert requests[0] == requests[1]  # retry the same model/tool schema, not a new task
    calls = [m for m in session["messages"] if m.get("type") == "tool_call"]
    assert len(calls) == 1 and calls[0]["tool"] == "fs_read" and calls[0]["status"] == "done"
    reply = next(m for m in reversed(session["messages"]) if m.get("type") == "assistant")
    assert json.loads(reply["text"]) == final


def test_payment_failure_stops_without_replaying_the_session(client, monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(402, json={"error": "Insufficient Balance"})

    session = _session(client, monkeypatch, handler)
    assert len(requests) == 1
    assert not any(m.get("type") == "tool_call" for m in session["messages"])
    assert any("402" in str(m) for m in session["messages"])
