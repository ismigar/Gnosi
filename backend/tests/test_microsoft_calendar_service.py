"""Synthetic Graph transport tests; no account data or remote calls."""

from unittest.mock import Mock

import pytest

from backend.domains.calendar.provider_errors import CalendarProviderError
from backend.domains.calendar.schemas import CalendarEventResponse
from backend.services import microsoft_calendar_service as service


@pytest.fixture
def transport(monkeypatch):
    account = {
        "id": "calendar-account",
        "type": "calendar",
        "provider": "microsoft",
        "auth_type": "oauth2",
        "email": "test@example.org",
        "token": "old-token",
        "refresh_token": "refresh",
        "client_id": "client",
        "granted_scopes": ["Calendars.Read"],
    }
    manager = Mock()
    manager.get_calendar_accounts.return_value = [account]
    manager._resolve_secret_refs.side_effect = lambda value: dict(value)
    monkeypatch.setattr(service, "integration_manager", manager)
    get, post = Mock(), Mock()
    monkeypatch.setattr(service.requests, "get", get)
    monkeypatch.setattr(service.requests, "post", post)
    return account, manager, get, post


def response(payload, status=200):
    return Mock(status_code=status, json=Mock(return_value=payload))


def calendar():
    return {"id": "cal/a", "name": "Teaching", "isDefaultCalendar": True}


def event(**updates):
    return {
        "id": "occurrence",
        "subject": "Seminar",
        "type": "occurrence",
        "seriesMasterId": "series",
        "start": {"dateTime": "2026-10-16T10:00:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": "2026-10-16T11:00:00.0000000", "timeZone": "UTC"},
        **updates,
    }


def test_pages_expand_calendar_view_and_normalize(transport):
    _, manager, get, post = transport
    get.side_effect = [
        response({"value": [calendar()]}),
        response(
            {
                "value": [event()],
                "@odata.nextLink": service.GRAPH
                + "/me/calendars/cal%2Fa/calendarView?$skiptoken=x",
            }
        ),
        response(
            {
                "value": [
                    event(
                        id="second",
                        isAllDay=True,
                        start={"dateTime": "2026-10-17T00:00:00", "timeZone": "UTC"},
                        end={"dateTime": "2026-10-19T00:00:00", "timeZone": "UTC"},
                    )
                ]
            }
        ),
    ]
    result = service.list_events("test@example.org", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")
    assert len(result) == 2
    assert CalendarEventResponse.model_validate(result[0]).is_read_only
    assert result[0]["start"] == "2026-10-16T10:00:00+00:00"
    assert result[0]["recurring_event_id"] == "series"
    assert result[1]["start"] == "2026-10-17" and result[1]["end"] == "2026-10-19"
    assert get.call_args_list[1].args[0].endswith("/cal%2Fa/calendarView")
    assert get.call_args_list[1].kwargs["params"]["startDateTime"] == "2026-10-01T00:00:00Z"
    assert get.call_args_list[2].kwargs["params"] is None
    for call in get.call_args_list:
        assert call.kwargs["timeout"] == service.TIMEOUT
        assert call.kwargs["allow_redirects"] is False
        assert call.kwargs["headers"]["Prefer"] == 'outlook.timezone="UTC"'
    manager.get_calendar_accounts.assert_called_once_with(
        "test@example.org", provider="microsoft", auth_type="oauth2", resolve_secrets=False
    )
    post.assert_not_called()


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/v1.0/me/calendars",
        "http://graph.microsoft.com/v1.0/me/calendars",
        "https://graph.microsoft.com:443/v1.0/me/calendars",
        "https://graph.microsoft.com/v1.0/me/messages",
        "https://graph.microsoft.com/v1.0/users/other/calendars",
        "https://graph.microsoft.com/v1.0/me/calendars#fragment",
    ],
)
def test_untrusted_next_link_never_receives_credentials(transport, url):
    _, _, get, _ = transport
    get.return_value = response({"value": [], "@odata.nextLink": url})
    with pytest.raises(CalendarProviderError):
        service.list_calendars("test@example.org")
    assert get.call_count == 1


def test_pagination_bound_fails_instead_of_returning_partial_result(transport, monkeypatch):
    _, _, get, _ = transport
    monkeypatch.setattr(service, "MAX_PAGES", 1)
    get.return_value = response(
        {"value": [calendar()], "@odata.nextLink": service.GRAPH + "/me/calendars?$skip=x"}
    )
    with pytest.raises(CalendarProviderError):
        service.list_calendars("test@example.org")


def test_401_rotates_calendar_tokens_once_without_replacing_accounts(transport):
    _, manager, get, post = transport
    get.side_effect = [response({}, 401), response({"value": []})]
    post.return_value = response({"access_token": "new-token", "refresh_token": "rotated"})
    assert service.list_calendars("test@example.org") == []
    manager.upsert_calendar_oauth_account.assert_called_once_with(
        {
            "id": "calendar-account",
            "token": "new-token",
            "refresh_token": "rotated",
            "email": "test@example.org",
            "type": "calendar",
            "provider": "microsoft",
        }
    )
    assert "Mail" not in post.call_args.kwargs["data"]["scope"]
    assert get.call_args_list[1].kwargs["headers"]["Authorization"] == "Bearer new-token"


@pytest.mark.parametrize("change", [{"type": "email"}, {"granted_scopes": ["Mail.Read"]}])
def test_mail_credentials_are_never_resolved(transport, change):
    account, manager, get, post = transport
    account.update(change)
    with pytest.raises(CalendarProviderError):
        service.list_calendars("test@example.org")
    manager._resolve_secret_refs.assert_not_called()
    get.assert_not_called()
    post.assert_not_called()


def test_duplicate_calendar_accounts_fail_before_secret_resolution(transport):
    account, manager, _, _ = transport
    manager.get_calendar_accounts.return_value = [account, dict(account)]
    with pytest.raises(CalendarProviderError) as error:
        service.list_calendars("test@example.org")
    assert error.value.status_code == 409
    manager._resolve_secret_refs.assert_not_called()


def test_get_event_uses_calendar_scoped_identity(transport):
    _, _, get, _ = transport
    get.side_effect = [response({"value": [calendar()]}), response(event())]
    result = service.get_event("test@example.org", "event/a", "cal/a")
    assert result["calendar_id"] == "cal/a"
    assert get.call_args.args[0] == service.GRAPH + "/me/calendars/cal%2Fa/events/event%2Fa"


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500, 302])
def test_http_errors_never_look_like_empty_calendar(transport, status):
    _, _, get, post = transport
    get.return_value = response({}, status)
    post.return_value = response({"access_token": "new"})
    with pytest.raises(CalendarProviderError):
        service.list_calendars("test@example.org")
    assert get.call_count <= 2


def test_invalid_date_range_never_connects(transport):
    _, manager, get, _ = transport
    with pytest.raises(CalendarProviderError) as error:
        service.list_events("test@example.org", "2026-10-01", "2026-11-01")
    assert error.value.status_code == 400
    manager.get_calendar_accounts.assert_not_called()
    get.assert_not_called()


def test_hybrid_dispatches_microsoft_without_google_or_caldav(monkeypatch):
    from backend.services import hybrid_calendar_service as hybrid

    account = {"provider": "microsoft", "type": "calendar"}
    manager = Mock()
    manager.get_calendar_accounts.return_value = [account]
    monkeypatch.setattr(hybrid, "integration_manager", manager)
    calendars, events, detail = (
        Mock(return_value=[]),
        Mock(return_value=[]),
        Mock(return_value={"id": "event"}),
    )
    monkeypatch.setattr(service, "list_calendars", calendars)
    monkeypatch.setattr(service, "list_events", events)
    monkeypatch.setattr(service, "get_event", detail)
    assert hybrid.list_calendars("test@example.org") == []
    assert hybrid.list_events("test@example.org", "start", "end", calendar_id="calendar") == []
    assert hybrid.get_event("test@example.org", "event", "calendar") == {"id": "event"}
    calendars.assert_called_once_with("test@example.org")
    events.assert_called_once_with("test@example.org", "start", "end", None, "calendar")
    detail.assert_called_once_with("test@example.org", "event", "calendar")
