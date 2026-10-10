"""Cache accounting, stable history and safe transport resume contracts."""
from __future__ import annotations

import asyncio
import copy
import json
import sqlite3

from app.harness import context, engine, permissions
from app.harness.session import new_session, Runtime, public_message
from app.harness.tools import ToolSpec
from app.library import store
from app.providers import registry
from app.providers.base import anthropic_usage, normalize_usage, capture_stream_usage
from app.providers.local_codex import _usage_from_jsonl
from app.providers.anthropic_api import AnthropicProvider


def _session():
    return new_session(title="cache", project_id=None, mode="ask", provider=None, model=None, context_limit=120000)


def test_exact_provider_usage_and_missing_fallback():
    events = b'noise\n' + json.dumps({"type": "turn.completed", "usage": {
        "input_tokens": 22029, "cached_input_tokens": 9856, "output_tokens": 5, "reasoning_output_tokens": 2}}).encode()
    usage = normalize_usage(_usage_from_jsonl(events))
    assert (usage["input_tokens"], usage["cached_input_tokens"], usage["reasoning_tokens"], usage["exact"]) == (22029, 9856, 2, True)
    claude = normalize_usage(anthropic_usage({"input_tokens": 10, "cache_read_input_tokens": 20, "cache_creation_input_tokens": 30, "output_tokens": 4}))
    assert (claude["input_tokens"], claude["cached_input_tokens"], claude["cache_write_tokens"]) == (60, 20, 30)
    missing = normalize_usage({}, "rules", [{"role": "user", "content": "hello"}], "answer")
    assert missing["input_tokens"] > 0 and missing["output_tokens"] > 0 and not missing["exact"]
    assert normalize_usage({"input_tokens": 0, "output_tokens": 0, "exact": True})["exact"]


def test_prompt_prefix_survives_mode_scope_day_todos_branch(monkeypatch):
    session = _session()
    monkeypatch.setattr(context, "instructions", lambda _: [("Global", "global rules"), ("Project", "project rules")])
    monkeypatch.setattr(context.store, "get_paper", lambda _: {"title": "Paper", "year": "2026"})
    table = {name: ToolSpec(name, name, {}, category, None) for name, category in [("z_write", "write"), ("a_read", "read")]}
    session["messages"] = [{"id": "u1", "type": "user", "text": "first"}]
    first_sys = context.system_prompt(session, table, workspace_root=None)
    first_msgs = copy.deepcopy(context.provider_messages(session))
    session["messages"].append({"type": "assistant", "text": "answer"})
    session.update(mode="auto", scope_papers=["paper"], todos=[{"content": "task", "status": "pending"}], branch="experiment")
    monkeypatch.setattr(context.time, "strftime", lambda _: "2099-01-01")
    session["messages"].append({"id": "u2", "type": "user", "text": "second"})
    second_sys = context.system_prompt(session, dict(reversed(list(table.items()))), workspace_root=None)
    second_msgs = context.provider_messages(session)
    assert first_sys == second_sys
    assert context.HOST_RULE in first_sys and first_sys.index("a_read:") < first_sys.index("z_write:")
    assert first_msgs == second_msgs[:len(first_msgs)]
    assert "2099-01-01" not in first_sys and "2099-01-01" in second_msgs[-1]["content"]
    assert "experiment" in second_msgs[-1]["content"] and "MODE: auto" in second_msgs[-1]["content"]
    assert "_prompt_item" not in public_message(session["messages"][0])
    assert not permissions.mode_allows("ask", table["z_write"].category)


def test_old_usage_ledger_migration_preserves_records(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    monkeypatch.setattr(store, "DB_PATH", path)
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE ai_usage(id TEXT PRIMARY KEY,task_type TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,paper_id TEXT,plugin_id TEXT,prompt_tokens INTEGER NOT NULL DEFAULT 0,completion_tokens INTEGER NOT NULL DEFAULT 0,total_tokens INTEGER NOT NULL DEFAULT 0,estimated INTEGER NOT NULL DEFAULT 0,created_at REAL NOT NULL)")
        db.execute("INSERT INTO ai_usage VALUES ('old','chat','openai',NULL,NULL,NULL,100,10,110,0,1)")
    store.init_db()
    store.init_db()
    store.record_ai_usage(task_type="chat", provider="openai", model=None, paper_id=None, plugin_id=None,
                          prompt_tokens=200, completion_tokens=20, total_tokens=220, estimated=False, cached_input_tokens=150, cache_write_tokens=20)
    summary = store.ai_usage_summary()
    assert summary["total"]["tasks"] == 2 and summary["total"]["prompt_tokens"] == 300
    assert summary["total"]["cached_input_tokens"] == 150 and summary["total"]["cache_hit_rate"] == 0.5
    assert summary["by_provider"][0]["provider"] == "openai" and len(summary["by_day"]) == 2
    assert next(row for row in summary["recent"] if row["id"] == "old")["cached_input_tokens"] == 0


def test_harness_resume_suffix_and_reset_fallback(monkeypatch):
    session = _session()
    calls = []
    class CLI:
        async def complete_session(self, system, messages, model, *, session_id=None):
            calls.append((system, copy.deepcopy(messages), model, session_id))
            if session_id == "gone":
                raise registry.ProviderSessionUnavailableError("thread not found")
            return "answer", {"input_tokens": 100, "cached_input_tokens": 80, "output_tokens": 1, "exact": True}, "thread"
    p = CLI()
    messages = [{"role": "user", "content": "first"}]
    async def call(model="test"):
        with registry.harness_session(session), capture_stream_usage() as usage:
            result = "".join([part async for part in registry._harness_stream(p, "local_codex", "stable system", messages, model)])
            assert result == "answer" and usage["cached_input_tokens"] == 80
    asyncio.run(call())
    messages.extend([{"role": "assistant", "content": "answer"}, {"role": "user", "content": "tool result"}])
    asyncio.run(call())
    assert calls[-1] == ("", [messages[-1]], "test", "thread")
    session["provider_thread"]["id"] = "gone"
    messages.extend([{"role": "assistant", "content": "answer"}, {"role": "user", "content": "third"}])
    asyncio.run(call())
    assert calls[-2][3] == "gone" and calls[-1][3] is None and calls[-1][1] == messages
    messages.extend([{"role": "assistant", "content": "answer"}, {"role": "user", "content": "fourth"}])
    asyncio.run(call("new-model"))
    assert calls[-1][3] is None
    session["context"]["compactions"] = 1
    asyncio.run(call("new-model"))
    assert calls[-1][3] is None


def test_anthropic_cache_breakpoints_do_not_change_text():
    body = AnthropicProvider()._body("identity\n\n# Tools\n- read", [{"role": "user", "content": "old"}, {"role": "assistant", "content": "answer"}, {"role": "user", "content": "new"}], "claude", False)
    assert len(body["system"]) == 2 and all(block["cache_control"] == {"type": "ephemeral"} for block in body["system"])
    assert body["messages"][-2]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert body["messages"][-1]["content"] == "new"


def test_session_meter_emits_exact_usage_and_persists_turn_note(monkeypatch):
    session = _session()
    class Manager:
        def inbox_changed(self, *_): pass
    rt = Runtime(session, Manager())
    emitted = []
    monkeypatch.setattr(rt, "emit", lambda name, data: emitted.append((name, data)))
    monkeypatch.setattr(rt, "persist", lambda: None)
    meter = engine.UsageMeter(session, rt)
    for _ in range(2):
        meter.before_llm_call()
        meter.after_usage({"input_tokens": 100, "cached_input_tokens": 75, "output_tokens": 10, "exact": True})
    assert session["usage"]["llm_calls"] == 2 and session["usage"]["cache_hit_rate"] == .75
    meter.turn["duration_seconds"] = 1.2
    engine.finish_turn(rt, {"message_id": "m_end", "usage": meter.turn})
    assert [name for name, _ in emitted].count("usage.updated") == 2
    note = next(m for m in session["messages"] if m.get("kind") == "turn_usage")
    assert note["usage"]["input_tokens"] == 200 and note["turn_id"] == "m_end"
