from __future__ import annotations

import asyncio
import base64
import hashlib
from typing import Any
from urllib.parse import parse_qs, urlparse, urlencode

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.api import microsoft_auth_routes


def _request(query: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/auth/microsoft/callback",
            "headers": [],
            "query_string": query.encode(),
        }
    )


def _config() -> microsoft_auth_routes.MicrosoftOAuthConfig:
    return {
        "client_id": "client",
        "client_secret": "secret",
        "redirect_uri": "http://localhost:5002/api/auth/microsoft/callback",
    }


class _Response:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.payload


def test_microsoft_login_records_state_and_encodes_authorization_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    microsoft_auth_routes._pending.clear()
    microsoft_auth_routes._pending["expired"] = microsoft_auth_routes.PendingAuth(
        0.0, "expired", _config()
    )
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", _config)
    monkeypatch.setattr(microsoft_auth_routes.secrets, "token_urlsafe", lambda _size: "state-1")
    monkeypatch.setattr(microsoft_auth_routes.time, "monotonic", lambda: 1000.0)

    response = asyncio.run(microsoft_auth_routes.login(_request("")))

    query = parse_qs(urlparse(response.headers["location"]).query)
    assert response.status_code == 307
    assert query["client_id"] == ["client"]
    assert query["state"] == ["state-1"]
    assert query["scope"] == [microsoft_auth_routes.SCOPES]
    assert "expired" not in microsoft_auth_routes._pending
    assert microsoft_auth_routes._pending["state-1"].created_at == 1000.0


def test_microsoft_callback_rejects_unknown_state() -> None:
    microsoft_auth_routes._pending.clear()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(microsoft_auth_routes.callback(_request("code=code&state=unknown")))

    assert exc_info.value.status_code == 400


def test_microsoft_callback_persists_normalized_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    microsoft_auth_routes._pending.clear()
    microsoft_auth_routes._pending["state-1"] = microsoft_auth_routes.PendingAuth(
        1000.0, "verifier", _config()
    )
    captured: dict[str, Any] = {}
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", _config)
    monkeypatch.setattr(
        microsoft_auth_routes.http,
        "post",
        lambda *_args, **_kwargs: _Response({"access_token": "access", "refresh_token": "refresh"}),
    )
    monkeypatch.setattr(
        microsoft_auth_routes.http,
        "get",
        lambda *_args, **_kwargs: _Response(
            {
                "mail": "user@example.test",
                "displayName": "Example User",
            }
        ),
    )
    monkeypatch.setattr(
        microsoft_auth_routes.integration_manager,
        "bulk_update",
        lambda payload: captured.update(payload),
    )

    response = asyncio.run(microsoft_auth_routes.callback(_request("code=code&state=state-1")))

    account = captured["mail_accounts"][0]
    assert response.headers["location"] == "/?auth=microsoft_success"
    assert account["id"] == "microsoft_user@example.test"
    assert account["token"] == "access"
    assert account["refresh_token"] == "refresh"
    assert "state-1" not in microsoft_auth_routes._pending


def test_microsoft_callback_detects_removed_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    microsoft_auth_routes._pending.clear()
    microsoft_auth_routes._pending["state-1"] = microsoft_auth_routes.PendingAuth(
        1000.0, "verifier", _config()
    )
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", lambda: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(microsoft_auth_routes.callback(_request("code=code&state=state-1")))

    assert exc_info.value.status_code == 400


@pytest.fixture(autouse=True)
def oauth_state(monkeypatch: pytest.MonkeyPatch):
    microsoft_auth_routes._pending.clear()
    monkeypatch.setattr(microsoft_auth_routes.time, "monotonic", lambda: 1000.0)
    yield
    microsoft_auth_routes._pending.clear()


def test_public_desktop_configuration_does_not_require_a_secret(monkeypatch):
    monkeypatch.setattr(
        microsoft_auth_routes,
        "get_env",
        lambda name, default=None: {
            "MICROSOFT_OAUTH_CLIENT_ID": "desktop-client",
        }.get(name, default),
    )
    assert microsoft_auth_routes._get_config() == {
        "client_id": "desktop-client",
        "client_secret": "",
        "redirect_uri": "http://localhost:5002/api/auth/microsoft/desktop/callback",
    }
    assert asyncio.run(microsoft_auth_routes.status())["configured"] is True


def test_missing_registration_displays_actionable_html(monkeypatch):
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", lambda: None)
    result = asyncio.run(microsoft_auth_routes.login(_request("")))
    assert result.status_code == 400
    assert result.headers["content-type"].startswith("text/html")
    assert "Tornar a Gnosi" in result.body.decode()
    assert not microsoft_auth_routes._pending


@pytest.mark.parametrize("secret", ["", "web-secret"])
def test_pkce_roundtrip_passes_uned_email_and_uses_matching_verifier(monkeypatch, secret):
    cfg = {**_config(), "client_secret": secret}
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", lambda: cfg)
    email = "student+alias@alumno.uned.es"
    started = asyncio.run(
        microsoft_auth_routes.login(
            _request(
                urlencode(
                    {
                        "login_hint": email,
                        "desktop": "true",
                        "ui_locales": "ca-ES",
                    }
                )
            )
        )
    )
    query = parse_qs(urlparse(started.headers["location"]).query)
    assert query["login_hint"] == [email]
    assert "prompt" not in query
    assert query["code_challenge_method"] == ["S256"]
    pending = microsoft_auth_routes._pending[query["state"][0]]
    assert 43 <= len(pending.code_verifier) <= 128
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(pending.code_verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    assert query["code_challenge"] == [expected]
    exchanged = {}
    saved = {}

    def post(*args, **kwargs):
        exchanged.update(kwargs["data"])
        return _Response({"access_token": "access", "refresh_token": "refresh"})

    monkeypatch.setattr(microsoft_auth_routes.http, "post", post)
    monkeypatch.setattr(
        microsoft_auth_routes.http, "get", lambda *a, **k: _Response({"mail": email})
    )
    monkeypatch.setattr(microsoft_auth_routes.integration_manager, "bulk_update", saved.update)
    callback_query = urlencode({"state": query["state"][0], "code": "authorization-code"})
    result = asyncio.run(microsoft_auth_routes.callback(_request(callback_query)))
    assert exchanged["code_verifier"] == pending.code_verifier
    assert exchanged.get("client_secret", "") == secret
    assert bool(secret) == ("client_secret" in exchanged)
    assert saved["mail_accounts"][0]["email"] == email
    assert "Compte de Microsoft connectat" in result.body.decode()
    assert "location" not in result.headers
    with pytest.raises(HTTPException):
        asyncio.run(microsoft_auth_routes.callback(_request(callback_query)))


def test_expired_callback_never_exchanges_a_code(monkeypatch):
    microsoft_auth_routes._pending["old"] = microsoft_auth_routes.PendingAuth(
        400.0, "verifier", _config()
    )
    monkeypatch.setattr(
        microsoft_auth_routes.http, "post", lambda *a, **k: pytest.fail("Expired code exchanged")
    )
    with pytest.raises(HTTPException):
        asyncio.run(microsoft_auth_routes.callback(_request("state=old&code=code")))
    assert "old" not in microsoft_auth_routes._pending


def test_cancelled_login_consumes_state_without_echoing_provider_description():
    microsoft_auth_routes._pending["cancelled"] = microsoft_auth_routes.PendingAuth(
        1000.0, "verifier", _config(), True, "ca"
    )
    result = asyncio.run(
        microsoft_auth_routes.callback(
            _request("state=cancelled&error=access_denied&error_description=private-info")
        )
    )
    assert "No s'ha connectat el compte" in result.body.decode()
    assert "private-info" not in result.body.decode()
    assert not microsoft_auth_routes._pending


@pytest.mark.parametrize("secret", ["", "web-secret"])
def test_refresh_omits_secret_for_public_clients(monkeypatch, secret):
    from backend.services import microsoft_mail_service

    captured = {}

    def post(*args, **kwargs):
        captured.update(kwargs["data"])
        return _Response({"access_token": "new-access"})

    monkeypatch.setattr(microsoft_mail_service.http, "post", post)
    monkeypatch.setattr(
        microsoft_auth_routes.integration_manager, "update_mail_account_token", lambda *a: None
    )
    result = microsoft_mail_service._refresh_token(
        {
            "client_id": "client",
            "client_secret": secret,
            "refresh_token": "refresh",
            "email": "student@alumno.uned.es",
        }
    )
    assert result == "new-access"
    assert bool(secret) == ("client_secret" in captured)


def test_default_redirect_follows_the_desktop_backend_port(monkeypatch):
    values = {"MICROSOFT_OAUTH_CLIENT_ID": "client", "BACKEND_PORT": "43123"}
    monkeypatch.setattr(
        microsoft_auth_routes, "get_env", lambda name, default=None: values.get(name, default)
    )
    assert (
        microsoft_auth_routes._get_config()["redirect_uri"]
        == "http://localhost:43123/api/auth/microsoft/desktop/callback"
    )
    values["MICROSOFT_OAUTH_REDIRECT_URI"] = "https://gnosi.example.test/callback"
    assert (
        microsoft_auth_routes._get_config()["redirect_uri"]
        == values["MICROSOFT_OAUTH_REDIRECT_URI"]
    )


def test_changed_registration_rejects_pending_login(monkeypatch):
    microsoft_auth_routes._pending["state"] = microsoft_auth_routes.PendingAuth(
        1000.0, "verifier", _config()
    )
    monkeypatch.setattr(
        microsoft_auth_routes, "_get_config", lambda: {**_config(), "client_id": "different"}
    )
    monkeypatch.setattr(
        microsoft_auth_routes.http, "post", lambda *a, **k: pytest.fail("Changed registration used")
    )
    with pytest.raises(HTTPException):
        asyncio.run(microsoft_auth_routes.callback(_request("state=state&code=code")))


@pytest.mark.parametrize("path", ["/callback", "/desktop/callback"])
def test_system_browser_callback_requires_one_time_state_but_not_app_cookie(monkeypatch, path):
    from fastapi.testclient import TestClient
    from backend.server import app
    from backend.services.auth_service import REQUIRE_AUTH_ENV

    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    microsoft_auth_routes._pending["browser-state"] = microsoft_auth_routes.PendingAuth(
        1000.0, "verifier", _config(), True, "ca"
    )
    client = TestClient(app)
    assert client.get("/api/auth/microsoft/login").status_code == 401
    assert client.get("/api/auth/microsoft/status").status_code == 401
    result = client.get(f"/api/auth/microsoft{path}?state=browser-state&error=access_denied")
    assert result.status_code == 200
    assert "tornar a Gnosi" in result.text
    assert (
        client.get(
            f"/api/auth/microsoft{path}?state=browser-state&error=access_denied"
        ).status_code
        == 400
    )
