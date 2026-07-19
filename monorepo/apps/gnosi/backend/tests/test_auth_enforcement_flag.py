"""`GNOSI_REQUIRE_AUTH` — the reversible switch for phase 4.

Off (the default) nothing changes: an unauthenticated request still resolves to
the legacy account. On, only a credential the caller cannot mint counts, and the
public surface is the only way through without one.

The enforcement is an app-wide dependency rather than per-route gating, because
a survey found 50 routes that never touch `get_workspace_context` and would
otherwise have stayed open. These tests assert the switch from the outside: real
requests against the real app.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.services.auth_service import (
    LEGACY_USER_ID,
    REQUIRE_AUTH_ENV,
    get_user_id_or_legacy,
    require_auth_enabled,
)


@pytest.fixture
def client():
    from backend.server import app

    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def enforcement_on(monkeypatch):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    assert require_auth_enabled()


@pytest.fixture
def enforcement_off(monkeypatch):
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    assert not require_auth_enabled()


# --- the flag itself ---------------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("yes", True), ("on", True),
    ("0", False), ("false", False), ("", False), ("maybe", False),
])
def test_flag_parsing(monkeypatch, value, expected):
    monkeypatch.setenv(REQUIRE_AUTH_ENV, value)
    assert require_auth_enabled() is expected


def test_default_is_off(monkeypatch):
    """The whole point of the flag is that merging it changes nothing."""
    monkeypatch.delenv(REQUIRE_AUTH_ENV, raising=False)
    assert require_auth_enabled() is False


# --- identity resolution -----------------------------------------------------

def test_off_an_unauthenticated_request_is_the_legacy_account(enforcement_off):
    assert get_user_id_or_legacy(None, None) == LEGACY_USER_ID


def test_off_x_user_id_is_still_honoured(enforcement_off):
    assert get_user_id_or_legacy(None, "some-script") == "some-script"


def test_on_an_unauthenticated_request_is_rejected(enforcement_on):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        get_user_id_or_legacy(None, None)
    assert exc.value.status_code == 401


def test_on_x_user_id_is_ignored(enforcement_on):
    """The header is caller-controlled, so honouring it would defeat the flag."""
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        get_user_id_or_legacy(None, "ismael-legacy")
    assert exc.value.status_code == 401


def test_on_a_real_identity_still_passes(enforcement_on):
    assert get_user_id_or_legacy("real-user", None) == "real-user"


# --- end to end through the app ---------------------------------------------

def test_off_a_protected_route_is_reachable(client, enforcement_off):
    """`!= 401` is NOT enough here.

    The first version asserted only that, and a 500 satisfies it — the very
    assertion carrying the claim that merging changes nothing would have stayed
    green through a totally broken route. Anything 5xx now fails.

    The probe deliberately avoids `/api/vault/pages`: that route needs a
    configured vault, which a fresh worktree does not have (`config/params.yaml`
    is gitignored), so it answers 500 for reasons that have nothing to do with
    auth. Chasing that 500 as if it were a regression cost a long detour once
    already.
    """
    r = client.get("/api/ai/models")
    assert r.status_code < 500, r.text
    assert r.status_code != 401


def test_on_a_protected_route_returns_401(client, enforcement_on):
    r = client.get("/api/vault/pages")
    assert r.status_code == 401, r.text


def test_on_x_user_id_does_not_open_a_protected_route(client, enforcement_on):
    r = client.get("/api/vault/pages", headers={"X-User-ID": LEGACY_USER_ID})
    assert r.status_code == 401, r.text


def test_on_the_liveness_probe_stays_open(client, enforcement_on):
    """The watchdogs poll this with no credentials; 401 would restart-loop them."""
    r = client.get("/api/health")
    assert r.status_code != 401, r.text


def test_health_advertises_enforcement(client, enforcement_on):
    """The frontend gates <LoginPage> on this field (App.jsx): without it,
    personal mode renders the app shell and every call 401s silently."""
    assert client.get("/api/health").json()["require_auth"] is True


def test_health_advertises_enforcement_off(client, enforcement_off):
    assert client.get("/api/health").json()["require_auth"] is False


def test_on_config_is_gated_and_the_watchdog_does_not_use_it(client, enforcement_on):
    """`/api/config` is admin-gated at the router, so it can never be a probe.

    It was allowlisted and `native_watchdog.sh` polled it — the gate would have
    waved it through and `require_role("admin")` would have 401'd anyway,
    restart-looping the watchdog. The probe now targets /api/health.
    """
    assert client.get("/api/config").status_code == 401

    watchdog = (
        Path(__file__).resolve().parents[2] / "sh" / "native_watchdog.sh"
    ).read_text()
    assert "/api/health" in watchdog
    assert "5002/api/config" not in watchdog


def test_on_login_stays_reachable(client, enforcement_on):
    """You cannot present a session to the endpoint that issues one."""
    r = client.post("/api/auth/login", json={"email": "nobody@corp.com", "password": "whatever12"})
    # 401 for BAD CREDENTIALS is expected; what must not happen is being blocked
    # by the gate before the handler runs, which would make login impossible.
    assert r.status_code in (401, 422)
    assert "Cal autenticació" not in r.text


def test_on_workspace_creation_cannot_mint_an_account(client, enforcement_on):
    """The second header-driven account factory must be shut too."""
    r = client.post("/api/workspaces", json={"name": "ghost-ws"},
                    headers={"X-User-ID": "ghost-attacker"})
    assert r.status_code == 401, r.text
