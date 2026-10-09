"""Request-validation contract: malformed requests are rejected with a 4xx
(never a 500) *before* any provider or network call happens."""

import pytest


@pytest.mark.parametrize(
    "path, payload",
    [
        ("/api/explain", {}),            # missing required 'selection'
        ("/api/chat", {}),               # missing required 'messages'
        ("/api/skills/run", {}),         # missing required 'skill_id'
    ],
)
def test_missing_required_field_is_422(client, path, payload):
    r = client.post(path, json=payload)
    assert r.status_code == 422


def test_upload_without_file_is_422(client):
    r = client.post("/api/papers/upload")
    assert r.status_code == 422


def test_empty_import_is_client_error(client):
    """Import with nothing to fetch is a client error, not a server crash."""
    r = client.post("/api/papers/import", json={})
    assert 400 <= r.status_code < 500


def test_ai_actions_on_unknown_paper_are_404(client):
    """Structured actions bound to a paper must 404 on a missing paper before
    reaching a provider."""
    missing = "no-such-paper-id"
    assert client.post(f"/api/papers/{missing}/summarize", json={}).status_code == 404
    assert client.get(f"/api/papers/{missing}/pages").status_code == 404
    assert client.get(f"/api/papers/{missing}/fulltext").status_code == 404
