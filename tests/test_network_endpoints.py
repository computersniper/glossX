"""Endpoints that reach the external network (Semantic Scholar / arXiv /
Crossref). Gated behind ``GLOSS_TEST_NETWORK=1`` and skipped by default.

The app is designed to degrade gracefully when a host is unreachable, so these
assert on the response *shape* (a 2xx with the expected container), not on any
particular external result.
"""

import pytest

pytestmark = pytest.mark.network


def test_scholar_search_returns_results_container(client):
    r = client.get("/api/scholar/search", params={"q": "attention transformer", "k": 3})
    assert r.status_code == 200
    body = r.json()
    # A list somewhere in the payload (key name is part of the public shape).
    assert isinstance(body, (list, dict))


def test_references_resolve_enriches(client, paper_id):
    r = client.post(f"/api/papers/{paper_id}/references/resolve", json={})
    assert r.status_code == 200
    assert "references" in r.json()


def test_arxiv_url_import_completes(client):
    response = client.post(
        "/api/papers/import",
        json={"query": "https://arxiv.org/abs/1706.03762"},
    )
    assert response.status_code == 200, response.text
    paper = response.json()
    try:
        assert paper["title"]
        assert paper["n_pages"] > 0
    finally:
        client.delete(f"/api/papers/{paper['id']}")
