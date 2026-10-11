"""Images attached from the workspace reach the model as images; a text-only
OpenAI-compatible endpoint falls back to the text line."""
import asyncio
import base64

from app.harness import workspace
from app.harness.manager import SessionManager
from app.providers import registry
from app.providers.base import image_data
from app.providers.openai_api import OpenAIProvider

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")


def test_workspace_image_is_sent_as_an_image(client, monkeypatch):
    seen = []

    class Fake:
        async def stream(self, system, messages, model):
            seen.append(messages)
            yield "a red dot"

    monkeypatch.setitem(registry._PROVIDERS, "image_contract", Fake())
    root = workspace.root_for(None)
    (root / "uploads").mkdir(parents=True, exist_ok=True)
    (root / "uploads" / "shot.png").write_bytes(PNG)
    (root / "uploads" / "notes.txt").write_text("hello notes", encoding="utf-8")
    manager = SessionManager()
    snap = manager.create(provider="image_contract", mode="ask")
    rt = manager._rt(snap["id"])

    async def run():
        await manager.send_message(snap["id"], "", [{"kind": "file", "ref": "uploads/shot.png"},
                                                     {"kind": "file", "ref": "uploads/notes.txt"}])
        await rt.task
    asyncio.run(run())
    user = next(m for m in seen[0] if m["role"] == "user")
    assert "uploads/shot.png" in user["content"] and "hello notes" in user["content"]
    (att,) = user["attachments"]
    assert image_data(att["image_data_url"]) == ("image/png", ".png", PNG)
    stored = next(m for m in rt.session["messages"] if m["type"] == "user")
    assert stored["attachments"][0]["image"] == "image/png" and stored["attachments"][0]["ok"]


def test_image_data_accepts_common_formats_only():
    jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8x").decode()
    assert image_data(jpeg)[:2] == ("image/jpeg", ".jpg")
    assert image_data("data:image/svg+xml;base64,AAAA") is None
    assert image_data("data:image/png;base64,***") is None


def test_text_only_endpoint_drops_the_images(monkeypatch):
    bodies = []

    class Resp:
        def __init__(self, status, lines=()):
            self.status_code, self._lines = status, lines

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def aread(self):
            return b'{"error": "image input is not supported"}'

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(self.status_code)

        async def aiter_lines(self):
            for line in self._lines:
                yield line

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url, headers=None, json=None):
            bodies.append({**json, "messages": list(json["messages"])})
            if any(isinstance(m["content"], list) for m in json["messages"]):
                return Resp(400)
            return Resp(200, ['data: {"choices":[{"delta":{"content":"text only"}}]}', "data: [DONE]"])

    import app.providers.openai_api as mod
    monkeypatch.setattr(mod.httpx, "AsyncClient", Client)
    monkeypatch.setattr(mod, "_cfg", lambda: {"base_url": "http://x/v1", "api_key": "k", "model": "m"})
    monkeypatch.setattr(mod, "offered_tools", lambda: None)
    url = "data:image/png;base64," + base64.b64encode(PNG).decode()

    async def run():
        return [p async for p in OpenAIProvider().stream("sys", [{"role": "user", "content": "look", "attachments": [{"image_data_url": url}]}])]
    out = asyncio.run(run())
    assert "".join(out) == "text only"
    assert isinstance(bodies[0]["messages"][1]["content"], list) and bodies[-1]["messages"][1]["content"] == "look"
