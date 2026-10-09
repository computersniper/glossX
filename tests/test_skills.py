"""Skills discovery + run guards. Listing/validation are deterministic; actually
*running* a skill invokes the LLM and lives in the gated suite."""


def test_skills_list_shape(client):
    r = client.get("/api/skills")
    assert r.status_code == 200
    body = r.json()
    skills = body.get("skills", body)
    assert isinstance(skills, list)
    # Every discovered skill must expose a stable id (the client runs skills by
    # id, never by path).
    for s in skills:
        assert s.get("id")


def test_run_unknown_skill_is_rejected_without_llm(client):
    """A bogus skill id must be refused up front (only discovered skills run),
    not forwarded to a provider."""
    r = client.post("/api/skills/run", json={"skill_id": "definitely-not-a-real-skill-xyz"})
    assert r.status_code in (400, 404)


def test_run_skill_requires_skill_id(client):
    r = client.post("/api/skills/run", json={})
    assert r.status_code == 422
