from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.api import google_auth_routes


def _request(query: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/auth/google/callback",
            "headers": [],
            "query_string": query.encode(),
        }
    )


def _config() -> google_auth_routes.GoogleConfig:
    return {
        "web": {
            "client_id": "client",
            "client_secret": "secret",
            "auth_uri": "https://accounts.google.test/auth",
            "token_uri": "https://accounts.google.test/token",
            "redirect_uris": ["http://localhost:5002/api/auth/google/callback"],
        }
    }


def test_google_login_records_pkce_context_and_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeFlow:
        code_verifier = "verifier"

        @classmethod
        def from_client_config(cls, *_args: Any, **_kwargs: Any) -> FakeFlow:
            return cls()

        def authorization_url(self, **_kwargs: Any) -> tuple[str, str]:
            return "https://accounts.google.test/authorize", "state-1"

    google_auth_routes.pending_auths.clear()
    monkeypatch.setattr(google_auth_routes, "Flow", FakeFlow)
    monkeypatch.setattr(google_auth_routes, "get_google_config", _config)

    response = asyncio.run(google_auth_routes.login("mail"))

    assert response.status_code == 307
    assert response.headers["location"] == "https://accounts.google.test/authorize"
    assert google_auth_routes.pending_auths["state-1"]["code_verifier"] == "verifier"
    assert google_auth_routes.pending_auths["state-1"]["type"] == "mail"


def test_google_login_rejects_missing_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(google_auth_routes, "get_google_config", lambda: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(google_auth_routes.login("calendar"))

    assert exc_info.value.status_code == 400


def test_google_callback_rejects_unknown_state_before_token_exchange() -> None:
    google_auth_routes.pending_auths.clear()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(google_auth_routes.callback(_request("code=code&state=unknown")))

    assert exc_info.value.status_code == 400
    assert "Invalid or expired OAuth state" in str(exc_info.value.detail)


def test_google_health_summarizes_connected_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    accounts = [
        {"provider": "google", "refresh_token": "refresh"},
        {"provider": "google", "last_refresh_error": "invalid_grant"},
        {"provider": "microsoft", "refresh_token": "other"},
    ]
    monkeypatch.setattr(google_auth_routes, "get_google_config", _config)
    monkeypatch.setattr(
        google_auth_routes.integration_manager,
        "get_all_mail_accounts",
        lambda: accounts,
    )
    monkeypatch.setattr(
        google_auth_routes.integration_manager,
        "is_google_account",
        lambda account: account.get("provider") == "google",
    )
    monkeypatch.setattr(
        google_auth_routes,
        "get_env",
        lambda key, default=None: "client" if key == "GOOGLE_OAUTH_CLIENT_ID" else default,
    )

    result = asyncio.run(google_auth_routes.health())

    assert result["google_accounts_total"] == 2
    assert result["google_accounts_with_refresh_token"] == 1
    assert result["google_accounts_recently_failed"] == 1
    assert result["app_status"] == "testing-likely"
