"""The app-wide gate must not break what it is not meant to touch.

Every case here is a regression this branch actually introduced and a review
caught: the gate is the single thing every request passes through, so its
failure modes are total rather than local.

  * It declared `Request`, which cannot be injected into a WebSocket route, so
    every collab connection died with a TypeError — with enforcement OFF too.
  * It resolved identity before consulting the allowlist and regardless of the
    flag, so an unusable cookie 401'd `/api/auth/login` and `/api/auth/logout`:
    both exits from a bad cookie, leaving the browser stuck.
"""
import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient

from backend.services.auth_service import COOKIE_NAME, REQUIRE_AUTH_ENV

STALE_COOKIE = {COOKIE_NAME: "not.a.valid.jwt"}


@pytest.fixture
def client():
    from backend.server import app

    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")


# --- WebSockets --------------------------------------------------------------

def test_off_the_collab_websocket_still_connects(client, flag_off):
    """Live collaboration and WebSocket autosave must be untouched by merging."""
    with client.websocket_connect("/api/vault/collab/page-1?user_id=u1") as ws:
        assert ws is not None


def test_on_an_unauthenticated_websocket_is_refused(client, flag_on):
    """The socket persists CRDT updates, so leaving it open would keep a write
    path alive while the HTTP API was closed."""
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/vault/collab/page-1?user_id=attacker"):
            pass


def test_on_a_query_param_identity_does_not_open_the_socket(client, flag_on):
    """`_resolve_user_id` falls back to the query param and then to "anon", both
    caller-controlled."""
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/vault/collab/page-1?user_id=ismael-legacy"):
            pass


# --- an unusable cookie must not lock the user out ---------------------------

@pytest.mark.parametrize("flag", ["off", "on"])
def test_logout_works_with_an_unusable_cookie(client, monkeypatch, flag):
    """Logout exists to clear a bad cookie; gating it on the cookie deadlocks."""
    if flag == "on":
        monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    else:
        monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    r = client.post("/api/auth/logout", cookies=STALE_COOKIE)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("flag", ["off", "on"])
def test_login_is_reachable_with_an_unusable_cookie(client, monkeypatch, flag):
    """A 401 for wrong credentials is fine; being blocked by the gate is not —
    it would leave no way back in short of clearing cookies by hand."""
    if flag == "on":
        monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    else:
        monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    r = client.post(
        "/api/auth/login",
        json={"email": "nobody@corp.com", "password": "whatever12"},
        cookies=STALE_COOKIE,
    )
    assert "Cal autenticació" not in r.text, "blocked by the gate, not by credentials"


def test_on_the_liveness_probe_ignores_a_stale_cookie(client, flag_on):
    """The allowlist is consulted before identity, so a bad cookie is irrelevant."""
    assert client.get("/api/health", cookies=STALE_COOKIE).status_code == 200
