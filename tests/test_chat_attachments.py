"""PDF-region image attachments persist and reach multimodal providers safely."""

from __future__ import annotations

import base64
import shutil
import sqlite3

from app.features import chat as chat_feature
from app.library import store
from app.providers import anthropic_api, local_claude, openai_api
from app.routers import ai


PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(
    b"\x89PNG\r\n\x1a\nminimal-test-image"
).decode()


def _attachment() -> dict:
    return {
        "id": "region-1",
        "kind": "pdf_region",
        "page": 1,
        "image_data_url": PNG_DATA_URL,
        "extracted_text": "Accuracy rises from 81% to 87%.",
        "bounds": [10.0, 20.0, 140.0, 90.0],
    }


def test_init_db_migrates_legacy_message_attachments(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy-messages.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT,
                role TEXT,
                content TEXT,
                created_at REAL
            )"""
        )
        connection.execute(
            "INSERT INTO messages VALUES ('m1','c1','user','hello',1)"
        )

    monkeypatch.setattr(store, "DB_PATH", db_path)
    store.init_db()

    with sqlite3.connect(db_path) as connection:
        columns = [row[1] for row in connection.execute("PRAGMA table_info(messages)")]
        attachments = connection.execute(
            "SELECT attachments FROM messages WHERE id='m1'"
        ).fetchone()[0]
    assert "attachments" in columns
    assert attachments == "[]"


def test_chat_endpoint_persists_pdf_region_attachment(client, paper_id, monkeypatch):
    chat_id = client.post(f"/api/papers/{paper_id}/chats", json={}).json()["id"]
    captured = {}

    async def fake_chat_stream(_paper_id, messages, **kwargs):
        captured["messages"] = messages
        yield "I can see the selected result."

    monkeypatch.setattr(ai.chat_feat, "chat_stream", fake_chat_stream)
    response = client.post(
        "/api/chat",
        json={
            "paper_id": paper_id,
            "chat_id": chat_id,
            "messages": [{
                "role": "user",
                "content": "What does this show?",
                "attachments": [_attachment()],
            }],
        },
    )

    assert response.status_code == 200, response.text
    assert captured["messages"][0]["attachments"][0]["page"] == 1
    saved = client.get(f"/api/chats/{chat_id}/messages").json()["messages"]
    assert saved[0]["attachments"][0]["image_data_url"] == PNG_DATA_URL
    assert saved[0]["attachments"][0]["extracted_text"].startswith("Accuracy")
    assert saved[1]["attachments"] == []


def test_chat_attachment_rejects_non_image_data(client, paper_id):
    response = client.post(
        "/api/chat",
        json={
            "paper_id": paper_id,
            "messages": [{
                "role": "user",
                "content": "bad image",
                "attachments": [{**_attachment(), "image_data_url": "data:text/plain;base64,SGk="}],
            }],
        },
    )
    assert response.status_code == 422


def test_attachment_text_is_added_to_retrieval_and_text_only_context():
    prepared = chat_feature._with_attachment_context([
        {"role": "user", "content": "Explain this", "attachments": [_attachment()]}
    ])
    assert "PDF page 2" in prepared[0]["content"]
    assert "Accuracy rises" in prepared[0]["content"]
    assert prepared[0]["attachments"][0]["image_data_url"] == PNG_DATA_URL


def test_api_providers_emit_native_image_blocks(monkeypatch):
    message = {"role": "user", "content": "Explain", "attachments": [_attachment()]}
    openai_messages = openai_api.OpenAIProvider()._messages("system", [message])
    assert openai_messages[-1]["content"][1] == {
        "type": "image_url",
        "image_url": {"url": PNG_DATA_URL},
    }

    monkeypatch.setattr(
        anthropic_api,
        "_cfg",
        lambda: {"model": "test-model"},
    )
    anthropic_body = anthropic_api.AnthropicProvider()._body(
        "system", [message], None, False
    )
    image = anthropic_body["messages"][0]["content"][0]
    assert image["type"] == "image"
    assert image["source"]["media_type"] == "image/png"
    assert image["source"]["data"] == PNG_DATA_URL.split(",", 1)[1]


def test_local_claude_materializes_image_for_read_tool():
    directory, paths = local_claude._materialize_message_images([
        {"role": "user", "content": "Explain", "attachments": [_attachment()]}
    ])
    try:
        assert directory
        assert len(paths) == 1
        with open(paths[0], "rb") as image_file:
            assert image_file.read().startswith(b"\x89PNG")
        suffix = local_claude._image_prompt_suffix(paths)
        assert paths[0] in suffix
        assert "Read tool" in suffix
    finally:
        if directory:
            shutil.rmtree(directory, ignore_errors=True)
