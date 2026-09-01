from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import parse_qs, urlparse

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
    microsoft_auth_routes._pending["expired"] = 0.0
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", _config)
    monkeypatch.setattr(microsoft_auth_routes.secrets, "token_urlsafe", lambda _size: "state-1")
    monkeypatch.setattr(microsoft_auth_routes.time, "monotonic", lambda: 1000.0)

    response = asyncio.run(microsoft_auth_routes.login())

    query = parse_qs(urlparse(response.headers["location"]).query)
    assert response.status_code == 307
    assert query["client_id"] == ["client"]
    assert query["state"] == ["state-1"]
    assert query["scope"] == [microsoft_auth_routes.SCOPES]
    assert "expired" not in microsoft_auth_routes._pending
    assert microsoft_auth_routes._pending["state-1"] == 1000.0


def test_microsoft_callback_rejects_unknown_state() -> None:
    microsoft_auth_routes._pending.clear()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(microsoft_auth_routes.callback(_request("code=code&state=unknown")))

    assert exc_info.value.status_code == 400


def test_microsoft_callback_persists_normalized_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    microsoft_auth_routes._pending.clear()
    microsoft_auth_routes._pending["state-1"] = 1.0
    captured: dict[str, Any] = {}
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", _config)
    monkeypatch.setattr(
        microsoft_auth_routes.http,
        "post",
        lambda *_args, **_kwargs: _Response(
            {"access_token": "access", "refresh_token": "refresh"}
        ),
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

    response = asyncio.run(
        microsoft_auth_routes.callback(_request("code=code&state=state-1"))
    )

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
    microsoft_auth_routes._pending["state-1"] = 1.0
    monkeypatch.setattr(microsoft_auth_routes, "_get_config", lambda: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            microsoft_auth_routes.callback(_request("code=code&state=state-1"))
        )

    assert exc_info.value.status_code == 400
