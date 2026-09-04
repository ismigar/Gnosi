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
    requested_sections: list[str] = []
    captured_credentials: dict[str, Any] = {}
    built: dict[str, Any] = {}

    def get_raw(section: str) -> object:
        requested_sections.append(section)
        return [resolved_account] if section == "calendars" else []

    class Credentials:
        def __init__(self, **values: Any) -> None:
            captured_credentials.update(values)

    def build(api: str, version: str, *, credentials: object) -> object:
        built.update(api=api, version=version, credentials=credentials)
        return built

    monkeypatch.setattr(integration_manager, "get_raw", get_raw)
    monkeypatch.setattr("google.oauth2.credentials.Credentials", Credentials)
    monkeypatch.setattr("googleapiclient.discovery.build", build)

    service = google.get_google_calendar_service("calendar@example.test")

    assert requested_sections == ["calendars", "emails"]
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


def test_google_account_loader_ignores_malformed_sections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        integration_manager,
        "get_raw",
        lambda section: {"unexpected": section},
    )

    assert google._resolved_google_accounts() == []
