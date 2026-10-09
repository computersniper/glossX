"""Provider-backed endpoints (summarize / notes / mind-map / explain / translate
/ chat / auto-highlight).

These call a real LLM, so they are gated behind ``GLOSS_TEST_LLM=1`` and are
skipped by default (including in CI). Assertions are intentionally loose — the
*content* is model-dependent; we only pin the observable contract: a 2xx and a
non-empty response.
"""

import pytest

pytestmark = pytest.mark.llm


def _nonempty(resp):
    assert resp.status_code == 200, resp.text
    assert resp.text.strip(), "expected a non-empty response body"


def test_summarize_returns_content(client, paper_id):
    _nonempty(client.post(f"/api/papers/{paper_id}/summarize", json={}))


def test_notes_returns_markdown(client, paper_id):
    r = client.post(f"/api/papers/{paper_id}/notes", json={})
    _nonempty(r)


def test_mindmap_returns_content(client, paper_id):
    _nonempty(client.post(f"/api/papers/{paper_id}/mindmap", json={}))


def test_explain_selection(client, paper_id):
    r = client.post(
        "/api/explain",
        json={"paper_id": paper_id, "selection": "the Transformer"},
    )
    _nonempty(r)


def test_translate_text(client, paper_id):
    r = client.post(
        "/api/translate",
        json={"paper_id": paper_id, "text": "We propose a new model.", "language": "中文"},
    )
    _nonempty(r)


def test_chat_stream(client, paper_id):
    r = client.post(
        "/api/chat",
        json={
            "paper_id": paper_id,
            "messages": [{"role": "user", "content": "In one word, what is this paper about?"}],
        },
    )
    _nonempty(r)


def test_autohighlight_creates_highlights(client, paper_id):
    r = client.post(f"/api/papers/{paper_id}/autohighlight", json={})
    assert r.status_code == 200, r.text
    # Auto-highlights are stored like manual ones and should be retrievable.
    listed = client.get(f"/api/papers/{paper_id}/highlights")
    assert listed.status_code == 200
