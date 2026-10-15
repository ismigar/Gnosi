"""Calendar read dispatch keeps credentials within the selected adapter."""

from typing import Any

import pytest

from backend.domains.calendar import provider_operations
from backend.services import hybrid_calendar_service as hybrid


@pytest.mark.parametrize("caldav_first", [False, True])
def test_read_dispatch_selects_same_email_providers_without_unlocking(
    monkeypatch: pytest.MonkeyPatch, caldav_first: bool,
) -> None:
    email = "reader@example.test"
    references = [
        {"email": email, "provider": "google", "token": "__keychain__:google"},
        {"email": email, "provider": "caldav", "password": "__keychain__:caldav"},
    ]
    if caldav_first:
        references.reverse()
    lookups: list[tuple[str, bool]] = []
    calls: list[tuple[str, str, str, str]] = []

    class MetadataOnlyManager:
        def get_calendar_accounts(self, account: str, *, resolve_secrets: bool) -> list[dict[str, Any]]:
            lookups.append((account, resolve_secrets))
            assert not resolve_secrets
            return references

        def _resolve_secret_refs(self, _account: object) -> object:
            raise AssertionError("Read dispatch must not unlock credentials")

    def adapter(provider: str, account: str, event_id: str, calendar_id: str) -> dict[str, str]:
        calls.append((provider, account, event_id, calendar_id))
        return {"id": event_id, "provider": provider}

    manager = MetadataOnlyManager()
    monkeypatch.setattr(hybrid, "integration_manager", manager)
    monkeypatch.setattr(provider_operations, "integration_manager", manager)
    monkeypatch.setattr(hybrid, "google_get_event", lambda *args: adapter("google", *args))
    monkeypatch.setattr(provider_operations, "get_caldav_event", lambda *args: adapter("caldav", *args))

    assert hybrid.get_event(email, "google-event", "primary") == {
        "id": "google-event", "provider": "google",
    }
    assert hybrid.get_event(email, "caldav-event", "/work/") == {
        "id": "caldav-event", "provider": "caldav",
    }
    assert calls == [
        ("google", email, "google-event", "primary"),
        ("caldav", email, "caldav-event", "/work/"),
    ]
    assert lookups == [(email, False), (email, False)]
