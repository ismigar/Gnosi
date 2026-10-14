"""Explicit write providers survive ambiguous account/calendar naming."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.api import calendar_routes
from backend.domains.calendar import provider_operations


@pytest.fixture
def dispatch_capture(monkeypatch):
    account = "owner@example.test"
    accounts = [{"email": account, "provider": provider} for provider in ("google", "caldav")]
    monkeypatch.setattr(
        provider_operations.integration_manager, "get_calendar_accounts", lambda *a, **kw: accounts
    )
    monkeypatch.setattr(
        provider_operations.integration_manager, "_resolve_secret_refs", lambda value: value
    )
    calls = []
    monkeypatch.setattr(calendar_routes, "_invalidate_calendar_cache", lambda: None)

    def caldav(email, event_id, calendar_id, data, **kwargs):
        calls.append(("caldav", email, event_id, calendar_id, data))
        return {"status": "success", "etag": '"two"'}

    def google_update(email, event_id, data):
        calls.append(("google", email, event_id, data["calendar_id"], data))
        return True

    def google_delete(**kwargs):
        calls.append(("google", account, kwargs["eventId"], kwargs["calendarId"], None))
        return SimpleNamespace(execute=lambda: {})

    monkeypatch.setattr(provider_operations, "mutate_caldav_event", caldav)
    monkeypatch.setattr(calendar_routes, "update_google_event", google_update)
    monkeypatch.setattr(
        "backend.services.google_calendar_service.get_google_calendar_service",
        lambda email: SimpleNamespace(events=lambda: SimpleNamespace(delete=google_delete)),
    )
    return account, calls


@pytest.mark.parametrize("provider,calendar_id", [("google", "/work/"), ("caldav", "primary")])
def test_patch_uses_explicit_provider_instead_of_calendar_id_shape(dispatch_capture, provider, calendar_id):
    account, calls = dispatch_capture
    result = asyncio.run(calendar_routes.patch_event(
        "event", account, calendar_id,
        {"provider": provider, "summary": "Changed", "etag": '"one"'},
    ))
    assert result["status"] == "success"
    assert len(calls) == 1
    assert calls[0][:4] == (provider, account, "event", calendar_id)
    assert calls[0][4]["summary"] == "Changed"
    assert "provider" not in calls[0][4]


@pytest.mark.parametrize("provider,calendar_id", [("google", "/work/"), ("caldav", "primary")])
def test_delete_uses_the_same_explicit_provider(dispatch_capture, provider, calendar_id):
    account, calls = dispatch_capture
    result = asyncio.run(calendar_routes.delete_event(
        "event", account, calendar_id, None, '"one"', None, provider,
    ))
    assert result["status"] == "success"
    assert calls == [(provider, account, "event", calendar_id, None)]


@pytest.mark.parametrize("provider", ["", "manual", "unknown", {}, []])
def test_invalid_explicit_provider_never_falls_back_to_another_account(dispatch_capture, provider):
    account, calls = dispatch_capture
    with pytest.raises(HTTPException) as error:
        asyncio.run(calendar_routes.patch_event("event", account, "/work/", {"provider": provider}))
    assert error.value.status_code == 400
    assert not calls


def test_legacy_unqualified_patch_keeps_calendar_shape_resolution(dispatch_capture):
    account, calls = dispatch_capture
    asyncio.run(calendar_routes.patch_event("event", account, "/work/", {"summary": "Legacy"}))
    assert calls[0][:4] == ("caldav", account, "event", "/work/")
