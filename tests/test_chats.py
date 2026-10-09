"""Chat *session* management — creating/listing a conversation and reading its
messages. Creating a session does not call the LLM (only POST /api/chat does)."""


def test_chat_session_create_and_list(client, paper_id):
    assert client.get(f"/api/papers/{paper_id}/chats").json()["chats"] == []

    created = client.post(f"/api/papers/{paper_id}/chats", json={})
    assert created.status_code == 200
    chat = created.json()
    assert chat["id"]
    assert chat["paper_id"] == paper_id

    chats = client.get(f"/api/papers/{paper_id}/chats").json()["chats"]
    assert chat["id"] in [c["id"] for c in chats]


def test_new_chat_has_no_messages(client, paper_id):
    chat_id = client.post(f"/api/papers/{paper_id}/chats", json={}).json()["id"]
    r = client.get(f"/api/chats/{chat_id}/messages")
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert isinstance(msgs, list)
    assert msgs == []


def test_chat_title_can_be_edited(client, paper_id):
    chat_id = client.post(f"/api/papers/{paper_id}/chats", json={}).json()["id"]

    updated = client.patch(
        f"/api/chats/{chat_id}", json={"title": "  Attention mechanisms  "}
    )

    assert updated.status_code == 200
    assert updated.json()["title"] == "Attention mechanisms"
    listed = client.get(f"/api/papers/{paper_id}/chats").json()["chats"]
    assert listed[0]["title"] == "Attention mechanisms"


def test_chat_title_rejects_blank_value(client, paper_id):
    chat_id = client.post(f"/api/papers/{paper_id}/chats", json={}).json()["id"]

    response = client.patch(f"/api/chats/{chat_id}", json={"title": "   "})

    assert response.status_code == 422


def test_chat_rejects_unknown_session_before_calling_provider(client, paper_id):
    response = client.post(
        "/api/chat",
        json={
            "paper_id": paper_id,
            "chat_id": "missing-chat",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "chat not found"


def test_chat_rejects_session_from_another_paper(client, paper_id):
    chat_id = client.post(f"/api/papers/{paper_id}/chats", json={}).json()["id"]
    response = client.post(
        "/api/chat",
        json={
            "paper_id": "different-paper",
            "chat_id": chat_id,
            "messages": [{"role": "user", "content": "hello"}],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "chat does not belong to this paper"
