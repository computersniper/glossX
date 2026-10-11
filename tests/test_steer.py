"""Messages sent while a turn runs: steer joins the running turn before its
next model call; leftovers come back to the client when the turn ends."""
import asyncio

from app.harness import engine
from app.harness.manager import SessionManager
from app.providers import registry


def test_steer_joins_the_running_turn(client, monkeypatch):
    calls = []
    gate = asyncio.Event()

    class Fake:
        async def stream(self, system, messages, model):
            calls.append([m["content"] for m in messages if m["role"] == "user"])
            if len(calls) == 1:
                await gate.wait()  # the user steers while the first answer streams
                yield "first answer"
            else:
                yield "answer that saw the steer"

    monkeypatch.setitem(registry._PROVIDERS, "steer_contract", Fake())
    manager = SessionManager()
    snap = manager.create(provider="steer_contract", mode="ask")
    rt = manager._rt(snap["id"])
    events = []
    original = rt.emit
    rt.emit = lambda name, payload: (events.append(name), original(name, payload))

    async def run():
        started = await manager.send_message(snap["id"], "summarize the paper")
        assert started["started"]
        await asyncio.sleep(0.05)
        steered = await manager.steer_message(snap["id"], "focus on the method only")
        assert steered["steered"] and steered["pending"] == 1
        gate.set()
        await rt.task
    asyncio.run(run())
    assert len(calls) == 2 and any("focus on the method only" in c for c in calls[1])
    users = [m for m in rt.session["messages"] if m["type"] == "user"]
    assert [u["text"] for u in users] == ["summarize the paper", "focus on the method only"]
    assert users[1].get("steer") and "steer.queued" in events and "steer.returned" not in events
    assistants = [m["text"] for m in rt.session["messages"] if m["type"] == "assistant"]
    assert assistants[-1] == "answer that saw the steer"


def test_steer_when_idle_is_a_plain_send_and_leftovers_return(client, monkeypatch):
    class Fake:
        async def stream(self, system, messages, model):
            yield "ok"

    monkeypatch.setitem(registry._PROVIDERS, "steer_idle", Fake())
    manager = SessionManager()
    snap = manager.create(provider="steer_idle", mode="ask")
    rt = manager._rt(snap["id"])

    async def run():
        res = await manager.steer_message(snap["id"], "hello")
        assert res["started"]
        await rt.task
    asyncio.run(run())
    # a steer that arrives after the last model call goes back to the client
    events = []
    rt.emit = lambda name, payload: events.append((name, payload))
    rt.pending_steer = [{"text": "late", "attachments": []}]
    engine.finish_turn(rt, {"stop_reason": "completed"})
    returned = [p for n, p in events if n == "steer.returned"]
    assert returned and returned[0]["items"][0]["text"] == "late" and not rt.pending_steer
