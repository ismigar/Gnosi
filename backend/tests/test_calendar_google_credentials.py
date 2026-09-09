"""Credential-boundary regressions for the Google Calendar adapter."""

from typing import Any

import pytest

from backend.domains.calendar import google
from backend.services.integration_manager import integration_manager


def test_google_service_receives_resolved_secure_store_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved_account = {
        "auth_type": "oauth2",
        "client_id": "resolved-client-id",
        "client_secret": "resolved-client-secret",
        "email": "calendar@example.test",
        "provider": "google",
        "refresh_token": "resolved-refresh-token",
        "token": "resolved-access-token",
    }
    requested_accounts: list[tuple[str, dict[str, object]]] = []
    captured_credentials: dict[str, Any] = {}
    built: dict[str, Any] = {}

    def get_calendar_accounts(email: str, **filters: object) -> object:
        requested_accounts.append((email, filters))
        return [resolved_account]

    class Credentials:
        def __init__(self, **values: Any) -> None:
            captured_credentials.update(values)

    def build(
        api: str, version: str, *, credentials: object,
        cache_discovery: bool, static_discovery: bool,
    ) -> object:
        built.update(
            api=api, version=version, credentials=credentials,
            cache_discovery=cache_discovery, static_discovery=static_discovery,
        )
        return built

    monkeypatch.setattr(integration_manager, "get_calendar_accounts", get_calendar_accounts)
    monkeypatch.setattr("google.oauth2.credentials.Credentials", Credentials)
    monkeypatch.setattr("googleapiclient.discovery.build", build)

    service = google.get_google_calendar_service("calendar@example.test")

    assert requested_accounts == [
        ("calendar@example.test", {
            "provider": "google", "auth_type": "oauth2", "resolve_secrets": False,
        })
    ]
    assert captured_credentials == {
        "token": "resolved-access-token",
        "refresh_token": "resolved-refresh-token",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "resolved-client-id",
        "client_secret": "resolved-client-secret",
    }
    assert service is built
    assert built["api"] == "calendar"
    assert built["version"] == "v3"
    assert built["cache_discovery"] is False
    assert built["static_discovery"] is True


def test_google_service_uses_bundled_schema_without_legacy_cache_or_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def accounts(email: str) -> list[dict[str, str]]:
        return [{
            "provider": "google", "auth_type": "oauth2", "email": email,
            "client_id": "synthetic-client", "client_secret": "synthetic-secret",
            "token": "synthetic-token", "refresh_token": "synthetic-refresh",
        }]

    def forbidden(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("Calendar construction must use the bundled schema")

    monkeypatch.setattr(google, "_resolved_google_accounts", accounts)
    monkeypatch.setattr("googleapiclient.discovery_cache.autodetect", forbidden)
    monkeypatch.setattr("httplib2.Http.request", forbidden)
    first = google.get_google_calendar_service("first@example.test")
    second = google.get_google_calendar_service("second@example.test")
    assert first is not None and second is not None
    assert first is not second
    # Independent transports retain isolation between concurrent accounts.
    assert first._http is not second._http


def test_google_account_loader_ignores_malformed_sections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        integration_manager,
        "_load_secured",
        lambda: {"calendars": {"unexpected": "value"}, "emails": [None, 42]},
    )

    assert google._resolved_google_accounts("missing@example.test") == []
