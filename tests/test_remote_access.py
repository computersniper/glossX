"""Mobile access: other devices need the pairing code, this computer does not."""
from __future__ import annotations

import pytest


@pytest.fixture()
def phone(client):
    """A client that looks like a phone on the local network."""
    from fastapi.testclient import TestClient
    from app.main import app

    async def from_lan(scope, receive, send):
        await app({**scope, "client": ("192.168.1.23", 50123)}, receive, send)

    # not entered as a context manager: the `client` fixture already runs the lifespan
    yield TestClient(from_lan)


def test_local_requests_need_no_code(client):
    assert client.get("/api/health").status_code == 200


def test_remote_requests_without_code_are_refused(phone):
    r = phone.get("/api/health")
    assert r.status_code == 401
    assert phone.get("/api/papers").status_code == 401


def test_remote_page_load_with_code_sets_cookie(client, phone):
    code = client.get("/api/remote").json()["token"]
    r = phone.get(f"/api/health?token={code}")
    assert r.status_code == 200
    assert "gloss_token=" in r.headers.get("set-cookie", "")
    # the cookie carries later relative requests
    assert phone.get("/api/papers").status_code == 200


def test_remote_header_and_dashless_code(client, phone):
    code = client.get("/api/remote").json()["token"]
    phone.cookies.clear()
    assert phone.get("/api/health", headers={"X-Gloss-Token": code.replace("-", "").upper()}).status_code == 200
    assert phone.get("/api/health", headers={"Authorization": f"Bearer {code}"}).status_code == 200
    assert phone.get("/api/health", headers={"X-Gloss-Token": "wrong-code1"}).status_code == 401


def test_cors_preflight_passes(phone):
    r = phone.options("/api/health", headers={"Origin": "capacitor://localhost", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200


def test_only_this_computer_sees_or_changes_settings(client, phone):
    code = client.get("/api/remote").json()["token"]
    headers = {"X-Gloss-Token": code}
    assert phone.get("/api/remote", headers=headers).status_code == 403
    assert phone.post("/api/remote", json={"enabled": True}, headers=headers).status_code == 403


def test_enable_and_rotate(client, phone):
    before = client.get("/api/remote").json()
    after = client.post("/api/remote", json={"enabled": True, "rotate_token": True}).json()
    assert after["enabled"] is True and after["token"] != before["token"]
    phone.cookies.clear()
    assert phone.get("/api/health", headers={"X-Gloss-Token": before["token"]}).status_code == 401
    assert phone.get("/api/health", headers={"X-Gloss-Token": after["token"]}).status_code == 200
    client.post("/api/remote", json={"enabled": False})


def test_launch_target_follows_setting(client):
    from app import remote_access

    client.post("/api/remote", json={"enabled": False})
    assert remote_access.launch_target("127.0.0.1", 51234, False) == ("127.0.0.1", 51234)
    client.post("/api/remote", json={"enabled": True, "port": 8123})
    assert remote_access.launch_target("127.0.0.1", 51234, False) == ("0.0.0.0", 8123)
    assert remote_access.launch_target("127.0.0.1", 51234, True) == ("127.0.0.1", 51234)
    client.post("/api/remote", json={"enabled": False, "port": 8010})
