from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from starlette.requests import Request

from backend.api import google_auth_routes
from backend.app.health_contracts import (
    GoogleOAuthHealthResponse,
    GoogleOAuthStatusResponse,
)
from backend.services.integration_manager import integration_manager


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


def _focused_openapi() -> dict[str, Any]:
    app = FastAPI()
    app.include_router(google_auth_routes.router)
    return app.openapi()


def test_google_diagnostic_routes_have_concrete_response_models() -> None:
    routes = {
        route.path: route
        for route in google_auth_routes.router.routes
        if isinstance(route, APIRoute)
    }

    assert routes["/api/auth/google/status"].response_model is GoogleOAuthStatusResponse
    assert routes["/api/auth/google/health"].response_model is GoogleOAuthHealthResponse


def test_google_diagnostic_openapi_preserves_the_existing_payloads() -> None:
    paths = _focused_openapi()["paths"]

    assert paths["/api/auth/google/status"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/GoogleOAuthStatusResponse"}
    assert paths["/api/auth/google/health"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/GoogleOAuthHealthResponse"}


def test_google_status_preserves_the_existing_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(google_auth_routes, "get_google_config", _config)
    monkeypatch.setattr(
        google_auth_routes,
        "get_env",
        lambda key, default=None: "client" if key == "GOOGLE_OAUTH_CLIENT_ID" else default,
    )

    assert asyncio.run(google_auth_routes.status()) == {
        "configured": True,
        "client_id": "client",
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


@pytest.mark.parametrize("hint", ["user+calendar@example.test", " user@example.test ", None, " "])
def test_google_login_passes_the_existing_email_to_google(
    monkeypatch: pytest.MonkeyPatch, hint: str | None,
) -> None:
    options: dict[str, Any] = {}

    class FakeFlow:
        code_verifier = "verifier"

        @classmethod
        def from_client_config(cls, *_args: Any, **_kwargs: Any) -> FakeFlow:
            return cls()

        def authorization_url(self, **kwargs: Any) -> tuple[str, str]:
            options.update(kwargs)
            return "https://accounts.google.test/authorize", "hint-state"

    monkeypatch.setattr(google_auth_routes, "Flow", FakeFlow)
    monkeypatch.setattr(google_auth_routes, "get_google_config", _config)
    asyncio.run(google_auth_routes.login("calendar", hint, True, "ca-ES"))
    assert options.get("login_hint") == ((hint or "").strip() or None)
    assert options["access_type"] == "offline"
    assert google_auth_routes.pending_auths["hint-state"]["desktop"] is True
    assert google_auth_routes.pending_auths["hint-state"]["locale"] == "ca"


def _pending(*, desktop: bool = True, age: float = 0) -> google_auth_routes.PendingAuth:
    return {
        "code_verifier": "fixture-verifier",
        "type": "calendar",
        "created_at": time.monotonic() - age,
        "desktop": desktop,
        "locale": "ca",
    }


def test_expired_callback_is_rejected_before_loading_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    google_auth_routes.pending_auths["expired"] = _pending(age=601)
    monkeypatch.setattr(google_auth_routes, "get_google_config", lambda: pytest.fail("Credentials accessed"))
    with pytest.raises(HTTPException) as error:
        asyncio.run(google_auth_routes.callback(_request("code=fixture&state=expired")))
    assert error.value.status_code == 400
    assert "expired" not in google_auth_routes.pending_auths


def test_cancelled_desktop_login_returns_to_gnosi_without_exchanging_a_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    google_auth_routes.pending_auths["cancelled"] = _pending()
    monkeypatch.setattr(google_auth_routes, "get_google_config", lambda: pytest.fail("Credentials accessed"))
    response = asyncio.run(google_auth_routes.callback(_request("error=access_denied&state=cancelled")))
    assert response.status_code == 200
    assert "location" not in response.headers
    assert "Torna a Gnosi" in bytes(response.body).decode()
    assert "cancelled" not in google_auth_routes.pending_auths


def test_system_browser_callback_uses_one_time_state_without_an_app_cookie(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi.testclient import TestClient
    from backend.server import app
    from backend.services.auth_service import REQUIRE_AUTH_ENV

    monkeypatch.setenv(REQUIRE_AUTH_ENV, "1")
    google_auth_routes.pending_auths["browser-state"] = _pending()
    client = TestClient(app)
    assert client.get("/api/auth/google/login").status_code == 401
    response = client.get("/api/auth/google/callback?state=browser-state&error=access_denied")
    assert response.status_code == 200
    assert "Torna a Gnosi" in response.text
    replay = client.get("/api/auth/google/callback?state=browser-state&error=access_denied")
    assert replay.status_code == 400


@pytest.mark.parametrize("desktop", [True, False])
def test_successful_callback_saves_the_account_once_and_returns_to_the_right_client(
    monkeypatch: pytest.MonkeyPatch, desktop: bool,
) -> None:
    saved: list[dict[str, Any]] = []
    codes: list[str] = []
    flow = SimpleNamespace(
        code_verifier=None,
        fetch_token=lambda *, code: codes.append(code),
        credentials=SimpleNamespace(
            token="fixture-token", refresh_token="fixture-refresh",
            client_id="fixture-client", client_secret="fixture-secret",
            token_uri="https://oauth2.googleapis.com/token",
        ),
    )
    service = SimpleNamespace(userinfo=lambda: SimpleNamespace(
        get=lambda: SimpleNamespace(execute=lambda: {"email": "user@example.test", "name": "Fixture"}),
    ))
    monkeypatch.setattr(google_auth_routes, "get_google_config", _config)
    monkeypatch.setattr(google_auth_routes, "get_env", lambda _key, default=None: default)
    monkeypatch.setattr(google_auth_routes.Flow, "from_client_config", lambda *_args, **_kwargs: flow)
    monkeypatch.setattr("googleapiclient.discovery.build", lambda *_args, **_kwargs: service)
    monkeypatch.setattr(integration_manager, "bulk_update", saved.append)
    google_auth_routes.pending_auths["success"] = _pending(desktop=desktop)

    response = asyncio.run(google_auth_routes.callback(_request("code=fixture-code&state=success")))

    assert codes == ["fixture-code"]
    assert flow.code_verifier == "fixture-verifier"
    assert len(saved) == 1
    assert saved[0]["calendars"][0]["email"] == "user@example.test"
    assert saved[0]["calendars"][0]["refresh_token"] == "fixture-refresh"
    if desktop:
        assert response.status_code == 200
        assert "location" not in response.headers
        assert "Compte de Google connectat" in bytes(response.body).decode()
        assert response.headers["cache-control"] == "no-store"
        assert "fixture-token" not in bytes(response.body).decode()
    else:
        assert response.headers["location"] == "http://localhost:5173/calendar?auth=success&tab=calendar"
    with pytest.raises(HTTPException) as error:
        asyncio.run(google_auth_routes.callback(_request("code=fixture-code&state=success")))
    assert error.value.status_code == 400
    assert len(saved) == 1


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
        integration_manager,
        "get_all_mail_accounts",
        lambda: accounts,
    )
    monkeypatch.setattr(
        integration_manager,
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
