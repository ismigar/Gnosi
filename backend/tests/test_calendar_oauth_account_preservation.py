"""Calendar OAuth credential rotation never drops unrelated recovered data."""

import copy
import threading

import pytest

from backend.services.integration_manager import IntegrationManager


def manager_fixture(monkeypatch, document):
    manager = object.__new__(IntegrationManager)
    manager._lock = threading.RLock()
    monkeypatch.setattr(manager, "_load_secured", lambda: copy.deepcopy(document))

    def save(updated):
        document.clear()
        document.update(updated)

    monkeypatch.setattr(manager, "_save", save)
    return manager


def account(**kwargs):
    return {"email": "calendar@example.test", "provider": "microsoft", "type": "calendar", **kwargs}


def test_calendar_login_and_rotation_preserve_idless_entries_and_other_sections(monkeypatch):
    original = {
        "calendars": [{"name": "Recovered local calendar"}, {"id": "dav", "provider": "caldav"}],
        "mail_accounts": [{"email": "calendar@example.test", "token": "__keychain__:mail"}],
        "contacts": [{"id": "contacts"}],
    }
    document = copy.deepcopy(original)
    manager = manager_fixture(monkeypatch, document)
    manager.upsert_calendar_oauth_account(account(token="first", refresh_token="refresh"))
    manager.upsert_calendar_oauth_account(account(token="rotated"))
    assert document["calendars"][:2] == original["calendars"]
    assert len(document["calendars"]) == 3
    assert document["calendars"][2]["token"] == "rotated"
    assert document["calendars"][2]["refresh_token"] == "refresh"
    assert document["mail_accounts"] == original["mail_accounts"]
    assert document["contacts"] == original["contacts"]


def test_ambiguous_calendar_credentials_leave_config_unchanged(monkeypatch):
    document = {"calendars": [account(id="one"), account(id="two")]}
    original = copy.deepcopy(document)
    manager = manager_fixture(monkeypatch, document)
    with pytest.raises(ValueError, match="ambiguous"):
        manager.upsert_calendar_oauth_account(account(token="new"))
    assert document == original
