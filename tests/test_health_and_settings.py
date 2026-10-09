"""Health and settings endpoints — pure metadata, no LLM or network."""


def test_health_reports_ok_and_provider(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    # The active provider must be one of the advertised providers.
    assert isinstance(body["providers"], list) and body["providers"]
    assert body["provider"] in body["providers"]


def test_settings_get_returns_config(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    body = r.json()
    cfg = body.get("config", body)
    assert cfg["confirm_exit"] is True
    assert "provider" in cfg
    assert isinstance(cfg.get("providers"), dict) and cfg["providers"]


def test_settings_patch_round_trips_language(client):
    r = client.post("/api/settings", json={"output_language": "English"})
    assert r.status_code == 200
    cfg = r.json().get("config", r.json())
    assert cfg["output_language"] == "English"

    # The change persists across a fresh GET.
    again = client.get("/api/settings").json()
    again_cfg = again.get("config", again)
    assert again_cfg["output_language"] == "English"


def test_settings_patch_round_trips_exit_confirmation(client):
    disabled = client.post("/api/settings", json={"confirm_exit": False})
    assert disabled.status_code == 200
    assert disabled.json()["config"]["confirm_exit"] is False
    assert client.get("/api/settings").json()["config"]["confirm_exit"] is False

    reenabled = client.post("/api/settings", json={"confirm_exit": True})
    assert reenabled.status_code == 200
    assert reenabled.json()["config"]["confirm_exit"] is True


def test_settings_never_leaks_api_key_in_clear(client):
    """A secret written via PATCH must not come back verbatim from the API."""
    secret = "sk-super-secret-do-not-leak-1234567890"
    patch = client.post(
        "/api/settings",
        json={"providers": {"anthropic": {"api_key": secret}}},
    )
    assert patch.status_code == 200
    assert secret not in patch.text

    got = client.get("/api/settings")
    assert got.status_code == 200
    assert secret not in got.text
