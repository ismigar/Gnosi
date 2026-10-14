"""CalDAV writes must preserve data, reject stale edits and confine credentials."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
import requests
from icalendar import Calendar

from backend.api import calendar_routes
from backend.domains.booking.reservations import _write_event
from backend.domains.booking.schemas import BookingLinkCreate
from backend.domains.calendar import caldav_resources as resources
from backend.domains.calendar import provider_operations as providers
from backend.domains.calendar.api_contracts import CalendarEventCreateRequest
from backend.domains.calendar.caldav_time import parse_calendar
from backend.domains.calendar.caldav_transport import CalDAVClient, checked_url
from backend.domains.calendar.provider_errors import CalendarProviderError
from backend.services.hybrid_calendar_service import _normalize_caldav_event, _parse_caldav_response

ICAL = b"""BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Provider//EN\r
BEGIN:VEVENT\r
UID:event-1\r
DTSTART;TZID=Europe/Madrid:20261014T100000\r
DTEND;TZID=Europe/Madrid:20261014T110000\r
SUMMARY:Original\r
DESCRIPTION:Keep this description\r
X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r
ATTENDEE;CN=Guest;PARTSTAT=ACCEPTED:mailto:guest@example.test\r
BEGIN:VALARM\r
ACTION:DISPLAY\r
TRIGGER:-PT15M\r
DESCRIPTION:Reminder\r
END:VALARM\r
END:VEVENT\r
END:VCALENDAR\r
"""
CALENDAR = {"url": "https://calendar.example.test/home/work/", "id": "/home/work/"}
RESOURCE = CALENDAR["url"] + "opaque-resource.ics"


class ResourceClient:
    def __init__(self, content: bytes = ICAL, etag: str = '"one"'):
        self.content = content
        self.etag = etag
        self.calls = []

    def request(self, method, url, *, data=None, headers=None):
        self.calls.append((method, url, data, headers))
        if method == "GET":
            return SimpleNamespace(content=self.content, headers={"ETag": self.etag})
        return SimpleNamespace(headers={"ETag": '"two"'})


def test_patch_preserves_uid_time_zone_alarms_attendee_state_and_unknown_properties():
    client = ResourceClient()
    result = resources.mutate_event(
        client,
        CALENDAR,
        "event-1",
        {
            "summary": "Updated",
            "start": "2026-10-14T12:00:00",
            "end": "2026-10-14T13:00:00",
            "attendees": [{"email": "guest@example.test", "name": "Guest"}],
        },
        etag='"one"',
        resource_url=RESOURCE,
    )
    method, url, payload, headers = client.calls[-1]
    assert (method, url, headers["If-Match"]) == ("PUT", RESOURCE, '"one"')
    event = Calendar.from_ical(payload).walk("VEVENT")[0]
    assert str(event["UID"]) == "event-1"
    assert event["DTSTART"].params["TZID"] == "Europe/Madrid"
    assert event["DTSTART"].dt.hour == 12
    assert event["ATTENDEE"].params["PARTSTAT"] == "ACCEPTED"
    assert event["DESCRIPTION"] == "Keep this description"
    assert event["X-APPLE-TRAVEL-ADVISORY-BEHAVIOR"] == "AUTOMATIC"
    assert len(event.walk("VALARM")) == 1
    assert result["etag"] == '"two"'


@pytest.mark.parametrize("edited", ["summary", "description", "location"])
def test_editing_one_text_field_preserves_other_values_and_property_parameters(edited):
    original = Calendar.from_ical(ICAL)
    source = original.walk("VEVENT")[0]
    source["SUMMARY"].params["LANGUAGE"] = "ca"
    source.pop("DESCRIPTION")
    source.add("DESCRIPTION", "  Read agenda\n  ", parameters={
        "LANGUAGE": "ca", "ALTREP": "https://calendar.example.test/agenda",
    })
    source.add("LOCATION", "  Room one  ", parameters={
        "LANGUAGE": "ca", "ALTREP": "https://calendar.example.test/room",
    })
    keys = {"summary": "SUMMARY", "description": "DESCRIPTION", "location": "LOCATION"}
    data = {field: str(source[key]) for field, key in keys.items()}
    data[edited] = "Updated" if edited == "summary" else ""
    client = ResourceClient(original.to_ical())
    resources.mutate_event(
        client, CALENDAR, "event-1", data, etag='"one"', resource_url=RESOURCE,
    )
    method, _, payload, headers = client.calls[-1]
    assert method == "PUT" and headers["If-Match"] == '"one"'
    changed = Calendar.from_ical(payload).walk("VEVENT")[0]
    for field, key in keys.items():
        assert str(changed[key]) == data[field]
        assert changed[key].params["LANGUAGE"] == "ca"
        if field != edited:
            assert dict(changed[key].params) == dict(source[key].params)
        else:
            assert "ALTREP" not in changed[key].params


@pytest.mark.parametrize("etag,status", [('"stale"', 409), (None, 428)])
def test_stale_or_missing_version_never_writes(etag, status):
    client = ResourceClient()
    with pytest.raises(CalendarProviderError) as caught:
        resources.mutate_event(
            client, CALENDAR, "event-1", {"summary": "Changed"}, etag=etag, resource_url=RESOURCE
        )
    assert caught.value.status_code == status
    assert all(call[0] == "GET" for call in client.calls)


def test_delete_is_conditional_and_recurrence_cannot_delete_entire_series():
    client = ResourceClient()
    resources.mutate_event(client, CALENDAR, "event-1", None, etag='"one"', resource_url=RESOURCE)
    assert client.calls[-1] == ("DELETE", RESOURCE, None, {"If-Match": '"one"'})
    recurring = ResourceClient(
        ICAL.replace(b"SUMMARY:Original", b"RRULE:FREQ=DAILY\r\nSUMMARY:Original")
    )
    with pytest.raises(CalendarProviderError, match="Recurring"):
        resources.mutate_event(
            recurring, CALENDAR, "event-1", None, etag='"one"', resource_url=RESOURCE
        )
    assert len(recurring.calls) == 1


def test_create_uses_exclusive_all_day_end_and_if_none_match():
    client = ResourceClient()
    result = resources.create_event(
        client,
        CALENDAR,
        {
            "summary": "Day off",
            "start": {"date": "2026-10-14"},
            "end": {"date": "2026-10-15"},
        },
        "stable-booking-id",
    )
    method, url, payload, headers = client.calls[-1]
    assert method == "PUT" and headers["If-None-Match"] == "*"
    event = Calendar.from_ical(payload).walk("VEVENT")[0]
    assert event["DTSTART"].params["VALUE"] == "DATE"
    assert event["DTEND"].dt.isoformat() == "2026-10-15"
    assert result["resource_url"] == url and result["id"].startswith("gnosi-")


@pytest.mark.parametrize(
    "start,end,expected_start,expected_end",
    [
        ("2026-10-14T10:00:00", "2026-10-14T11:00:00",
         "2026-10-14T08:00:00+00:00", "2026-10-14T09:00:00+00:00"),
        ("2026-03-29T01:30:00+01:00", "2026-03-29T04:30:00+02:00",
         "2026-03-29T00:30:00+00:00", "2026-03-29T02:30:00+00:00"),
        ("2026-10-25T02:15:00+02:00", "2026-10-25T02:45:00+01:00",
         "2026-10-25T00:15:00+00:00", "2026-10-25T01:45:00+00:00"),
    ],
)
def test_created_zoned_events_preserve_instants_without_undefined_timezone_references(
    start, end, expected_start, expected_end,
):
    client = ResourceClient()
    result = resources.create_event(client, CALENDAR, {
        "summary": "Appointment",
        "start": {"dateTime": start, "timeZone": "Europe/Madrid"},
        "end": {"dateTime": end, "timeZone": "Europe/Madrid"},
    }, None)
    content = Calendar.from_ical(client.calls[-1][2])
    assert not content.get_missing_tzids()
    event = content.walk("VEVENT")[0]
    for field, name, expected in (
        ("start", "DTSTART", expected_start), ("end", "DTEND", expected_end),
    ):
        assert event[name].dt == datetime.fromisoformat(expected)
        assert event[name].to_ical().endswith(b"Z")
        assert "TZID" not in event[name].params
        assert result[field]["dateTime"] == expected
    edited_start = datetime.fromisoformat(expected_start) + timedelta(minutes=15)
    edited_end = datetime.fromisoformat(expected_end) + timedelta(minutes=15)
    stored = ResourceClient(client.calls[-1][2])
    resources.mutate_event(stored, CALENDAR, result["id"], {
        "start": edited_start.isoformat(), "end": edited_end.isoformat(),
    }, etag='"one"', resource_url=result["resource_url"])
    updated = Calendar.from_ical(stored.calls[-1][2])
    assert not updated.get_missing_tzids()
    assert updated.walk("VEVENT")[0]["DTSTART"].dt == edited_start
    assert updated.walk("VEVENT")[0]["DTEND"].dt == edited_end


def test_booking_provider_write_emits_self_contained_calendar_times(monkeypatch):
    client = ResourceClient()
    monkeypatch.setattr(client, "calendar", lambda *_, **__: CALENDAR, raising=False)
    monkeypatch.setattr(providers, "configured_account", lambda *_: {"provider": "caldav"})
    monkeypatch.setattr(providers, "CalDAVClient", lambda *_: client)
    config = BookingLinkCreate.model_validate({
        "title": "Consultation",
        "schedule": {"calendars": [{
            "provider": "caldav", "account": "owner@example.test", "calendar_id": CALENDAR["id"],
        }], "timezone": "Europe/Madrid"},
        "destination": {
            "provider": "caldav", "account": "owner@example.test", "calendar_id": CALENDAR["id"],
        },
    })
    row = SimpleNamespace(
        id="reservation-protocol-test", name="Guest", email="guest@example.test",
        start_at=datetime.fromisoformat("2026-10-14T08:00:00+00:00"),
        end_at=datetime.fromisoformat("2026-10-14T08:30:00+00:00"),
    )
    event_id = _write_event(row, config, SimpleNamespace())
    method, _, payload, headers = client.calls[-1]
    assert method == "PUT" and headers["If-None-Match"] == "*"
    content = Calendar.from_ical(payload)
    assert not content.get_missing_tzids()
    event = content.walk("VEVENT")[0]
    assert str(event["UID"]) == event_id
    assert event["DTSTART"].dt == row.start_at
    assert event["DTEND"].dt == row.end_at
    assert "TZID" not in event["DTSTART"].params
    assert str(event["ATTENDEE"]) == "mailto:guest@example.test"


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.test/steal",
        "https://calendar.example.test/home/other/e.ics",
        "https://calendar.example.test/home/work/%2e%2e/other.ics",
        "//evil.test/steal",
        "https://calendar.example.test/home/work/%252e%252e/other.ics",
    ],
)
def test_resource_url_cannot_escape_discovered_calendar(url):
    with pytest.raises(CalendarProviderError):
        checked_url(CALENDAR["url"], url, collection=CALENDAR["url"])


def test_icloud_discovery_allows_only_apple_caldav_shards():
    assert checked_url("https://caldav.icloud.com/", "https://p42-caldav.icloud.com/123/calendars/")
    for url in [
        "https://caldav.icloud.com.evil.test/",
        "https://evil.icloud.com/",
        "http://p42-caldav.icloud.com/",
    ]:
        with pytest.raises(CalendarProviderError):
            checked_url("https://caldav.icloud.com/", url)


def test_icloud_follows_principal_then_calendar_home_and_resolves_root_hrefs(monkeypatch):
    client = CalDAVClient({"caldav_url": "https://caldav.icloud.com", "email": "me@icloud.com"})
    properties = [
        "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>",
        "<c:calendar-home-set><d:href>https://p42-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set>",
        "<d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname>",
    ]
    hrefs = ["/", "/123/principal/", "/123/calendars/work/"]
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        index = len(calls) - 1
        xml = (
            '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
            f"<d:response><d:href>{hrefs[index]}</d:href><d:propstat><d:prop>{properties[index]}</d:prop>"
            "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"
        )
        return SimpleNamespace(status_code=207, text=xml, url=url)

    monkeypatch.setattr(client.session, "request", request)
    calendars = client.calendars("me@icloud.com")
    assert calendars[0]["url"] == "https://p42-caldav.icloud.com/123/calendars/work/"
    assert [call[1] for call in calls] == [
        "https://caldav.icloud.com/",
        "https://caldav.icloud.com/123/principal/",
        "https://p42-caldav.icloud.com/123/calendars/",
    ]
    assert all(call[2]["allow_redirects"] is False for call in calls)


def test_remote_write_timeout_is_reported_as_unknown_outcome(monkeypatch):
    client = CalDAVClient({"caldav_url": CALENDAR["url"]})

    def fail(*_args, **_kwargs):
        raise requests.Timeout()

    monkeypatch.setattr(client.session, "request", fail)
    with pytest.raises(CalendarProviderError) as caught:
        client.request("PUT", RESOURCE, data=b"event")
    assert caught.value.outcome_unknown is True


def test_calendar_routes_dispatch_caldav_create_patch_and_delete(monkeypatch):
    calls = []
    monkeypatch.setattr(providers, "configured_account", lambda *args: {"provider": "caldav"})
    monkeypatch.setattr(
        providers,
        "create_provider_event",
        lambda *args: calls.append(("create", args)) or {"id": "created"},
    )
    monkeypatch.setattr(
        providers,
        "mutate_caldav_event",
        lambda *args, **kwargs: calls.append(("mutate", args, kwargs)) or {"status": "success"},
    )
    monkeypatch.setattr(
        calendar_routes, "update_google_event", lambda *args: pytest.fail("CalDAV reached Google")
    )
    assert asyncio.run(
        calendar_routes.post_event(
            "me@example.test", "/work/", CalendarEventCreateRequest(summary="Created")
        )
    ) == {"id": "created"}
    asyncio.run(
        calendar_routes.patch_event(
            "event", "me@example.test", "/work/", {"summary": "Changed", "etag": '"one"'}
        )
    )
    asyncio.run(
        calendar_routes.delete_event("event", "me@example.test", "/work/", None, '"one"', RESOURCE)
    )
    assert [call[0] for call in calls] == ["create", "mutate", "mutate"]
    assert calls[-1][1][-1] is None
    assert calls[1][2]["etag"] == '"one"'


def test_provider_conflict_preserves_http_status(monkeypatch):
    def conflict(*args):
        raise CalendarProviderError(409, "Calendar event changed")

    monkeypatch.setattr(providers, "create_provider_event", conflict)
    with pytest.raises(calendar_routes.HTTPException) as caught:
        asyncio.run(
            calendar_routes.post_event("me@example.test", "/work/", CalendarEventCreateRequest())
        )
    assert caught.value.status_code == 409


def calendar_with_dates(properties: str) -> bytes:
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-1\r\n"
        + properties
        + "\r\nSUMMARY:Original\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    ).encode()


@pytest.mark.parametrize(
    "properties,expected_start,expected_end",
    [
        (
            "DTSTART;TZID=Europe/Madrid:20261014T100000\r\nDURATION:PT1H",
            "2026-10-14T10:00:00+02:00",
            "2026-10-14T11:00:00+02:00",
        ),
        ("DTSTART:20261014T100000\r\nDURATION:PT1H", "2026-10-14T10:00:00", "2026-10-14T11:00:00"),
        ("DTSTART:20261014T100000", "2026-10-14T10:00:00", "2026-10-14T10:00:00"),
        ("DTSTART;VALUE=DATE:20261014", "2026-10-14", "2026-10-15"),
        (
            "DTSTART;TZID=Europe/Madrid:20260329T013000\r\nDURATION:PT1H",
            "2026-03-29T01:30:00+01:00",
            "2026-03-29T03:30:00+02:00",
        ),
        (
            "DTSTART;TZID=Europe/Madrid:20261025T023000\r\nDURATION:PT1H",
            "2026-10-25T02:30:00+02:00",
            "2026-10-25T02:30:00+01:00",
        ),
    ],
)
def test_title_autosave_preserves_duration_or_implicit_end(
    properties, expected_start, expected_end
):
    original = calendar_with_dates(properties)
    before = Calendar.from_ical(original).walk("VEVENT")[0]
    normalized = _normalize_caldav_event(before, "me@example.test", CALENDAR)
    assert (normalized["start"], normalized["end"]) == (expected_start, expected_end)
    client = ResourceClient(original)
    result = resources.mutate_event(
        client,
        CALENDAR,
        "event-1",
        {"summary": "Changed title", "start": normalized["start"], "end": normalized["end"]},
        etag='"one"',
        resource_url=RESOURCE,
    )
    after = Calendar.from_ical(client.calls[-1][2]).walk("VEVENT")[0]
    assert after["SUMMARY"] == "Changed title" and result["etag"] == '"two"'
    assert client.calls[-1][3]["If-Match"] == '"one"'
    for name in ("DTSTART", "DTEND", "DURATION"):
        assert (name in before) == (name in after)
        if name in before:
            assert before[name].to_ical() == after[name].to_ical()
            assert before[name].params == after[name].params


@pytest.mark.parametrize("end,duration", [("13:00:00+02:00", b"PT1H"), ("14:00:00+02:00", b"PT2H")])
def test_moving_duration_event_keeps_duration_representation(end, duration):
    event = Calendar.from_ical(
        calendar_with_dates("DTSTART;TZID=Europe/Madrid:20261014T100000\r\nDURATION:PT1H")
    ).walk("VEVENT")[0]
    resources.patch_component(
        event,
        {
            "start": "2026-10-14T12:00:00+02:00",
            "end": "2026-10-14T" + end,
        },
    )
    assert "DTEND" not in event and event["DURATION"].to_ical() == duration
    assert event["DTSTART"].params["TZID"] == "Europe/Madrid"
    assert event["DTSTART"].to_ical() == b"20261014T120000"


@pytest.mark.parametrize("offset", ["", "+00:00"])
def test_floating_title_save_and_wall_time_edit_remain_floating(offset):
    event = Calendar.from_ical(
        calendar_with_dates("DTSTART:20261014T100027\r\nDTEND:20261014T110027")
    ).walk("VEVENT")[0]
    normalized = _normalize_caldav_event(event, "me@example.test", CALENDAR)
    assert normalized["start"] == "2026-10-14T10:00:27"
    resources.patch_component(
        event,
        {
            "summary": "Title",
            "start": normalized["start"],
            "end": normalized["end"],
        },
    )
    assert event["DTSTART"].to_ical() == b"20261014T100027"
    assert event["DTEND"].to_ical() == b"20261014T110027"
    resources.patch_component(
        event,
        {
            "start": "2026-10-14T12:00:00" + offset,
            "end": "2026-10-14T13:00:00" + offset,
        },
    )
    assert event["DTSTART"].to_ical() == b"20261014T120000"
    assert event["DTEND"].to_ical() == b"20261014T130000"
    assert event["DTSTART"].dt.tzinfo is None and event["DTEND"].dt.tzinfo is None


def test_explicit_timed_creation_still_rejects_empty_interval_before_transport():
    client = ResourceClient()
    with pytest.raises(CalendarProviderError) as caught:
        resources.create_event(
            client,
            CALENDAR,
            {
                "start": {"dateTime": "2026-10-14T10:00:00", "timeZone": "Europe/Madrid"},
                "end": {"dateTime": "2026-10-14T10:00:00", "timeZone": "Europe/Madrid"},
            },
            None,
        )
    assert caught.value.status_code == 422 and client.calls == []


@pytest.mark.parametrize(
    "duration,expected_end",
    [
        ("PT24H", "2026-03-30T02:30:00+02:00"),
        ("PT1440M", "2026-03-30T02:30:00+02:00"),
        ("P1D", "2026-03-30T01:30:00+02:00"),
        ("P1DT24H", "2026-03-31T01:30:00+02:00"),
        ("P1W", "2026-04-05T01:30:00+02:00"),
    ],
)
def test_raw_duration_units_survive_report_normalization_and_title_write(duration, expected_end):
    original = calendar_with_dates(
        "DTSTART;TZID=Europe/Madrid:20260329T013000\r\nDURATION:" + duration
    )
    response = (
        '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        "<d:response><d:href>opaque-resource.ics</d:href><d:propstat><d:prop>"
        "<c:calendar-data><![CDATA[" + original.decode() + "]]></c:calendar-data>"
        "</d:prop></d:propstat></d:response></d:multistatus>"
    )
    normalized = _parse_caldav_response(response, "me@example.test", CALENDAR, None)[0]
    assert normalized["end"] == expected_end
    client = ResourceClient(original)
    resources.mutate_event(
        client,
        CALENDAR,
        "event-1",
        {
            "summary": "Changed title",
            "start": normalized["start"],
            "end": normalized["end"],
        },
        etag='"one"',
        resource_url=RESOURCE,
    )
    serialized = client.calls[-1][2]
    assert ("\r\nDURATION:" + duration + "\r\n").encode() in serialized
    after = parse_calendar(serialized).walk("VEVENT")[0]
    assert resources.effective_event_end(after).isoformat() == expected_end


def test_edited_24_hour_duration_is_not_serialized_as_one_nominal_day():
    event = parse_calendar(
        calendar_with_dates("DTSTART;TZID=Europe/Madrid:20260328T120000\r\nDURATION:PT1H")
    ).walk("VEVENT")[0]
    resources.patch_component(event, {"end": "2026-03-29T13:00:00+02:00"})
    assert event["DURATION"].to_ical() == b"PT24H"
    assert resources.effective_event_end(event).isoformat() == "2026-03-29T13:00:00+02:00"


@pytest.mark.parametrize(
    "uri,normalized_address",
    [
        ("MAILTO:guest@example.test", "guest@example.test"),
        ("MailTo:Guest@EXAMPLE.test", "Guest@EXAMPLE.test"),
        ("urn:uuid:7abC", "urn:uuid:7abC"),
        ("SIP:guest@example.test", "SIP:guest@example.test"),
        ("https://calendar.example.test/users/Guest", "https://calendar.example.test/users/Guest"),
    ],
)
def test_title_save_preserves_calendar_user_address_and_all_scheduling_parameters(
    uri, normalized_address
):
    original = calendar_with_dates(
        "DTSTART:20261014T100000Z\r\nDTEND:20261014T110000Z\r\n"
        "ATTENDEE;CN=Guest;PARTSTAT=ACCEPTED;RSVP=TRUE;ROLE=REQ-PARTICIPANT;"
        'SENT-BY="mailto:assistant@example.test";X-PROVIDER-STATE=retained:'
        + uri
        + "\r\nORGANIZER:MAILTO:organizer@example.test"
    )
    before = parse_calendar(original).walk("VEVENT")[0]
    normalized = _normalize_caldav_event(before, "guest@example.test", CALENDAR)
    assert normalized["attendees"][0]["email"] == normalized_address
    assert normalized["organizer"] == "organizer@example.test"
    client = ResourceClient(original)
    resources.mutate_event(
        client,
        CALENDAR,
        "event-1",
        {
            "summary": "Changed title",
            "start": normalized["start"],
            "end": normalized["end"],
            "attendees": normalized["attendees"],
        },
        etag='"one"',
        resource_url=RESOURCE,
    )
    after = parse_calendar(client.calls[-1][2]).walk("VEVENT")[0]
    assert str(after["ATTENDEE"]) == uri
    assert after["ATTENDEE"].params == before["ATTENDEE"].params
    assert client.calls[-1][3]["If-Match"] == '"one"'


def test_distinct_case_sensitive_non_email_attendees_are_not_merged():
    event = parse_calendar(
        calendar_with_dates(
            "DTSTART:20261014T100000Z\r\nDTEND:20261014T110000Z\r\n"
            "ATTENDEE;CN=Upper;PARTSTAT=ACCEPTED:urn:uuid:Guest\r\n"
            "ATTENDEE;CN=Lower;PARTSTAT=DECLINED:urn:uuid:guest"
        )
    ).walk("VEVENT")[0]
    normalized = _normalize_caldav_event(event, "me@example.test", CALENDAR)
    resources.patch_component(
        event, {"summary": "Changed title", "attendees": normalized["attendees"]}
    )
    assert [(str(value), value.params["PARTSTAT"]) for value in event["ATTENDEE"]] == [
        ("urn:uuid:Guest", "ACCEPTED"),
        ("urn:uuid:guest", "DECLINED"),
    ]


def test_new_mailto_attendee_has_only_one_scheme_and_unsupported_new_cua_is_rejected():
    event = parse_calendar(calendar_with_dates("DTSTART:20261014T100000Z")).walk("VEVENT")[0]
    resources.patch_component(
        event, {"attendees": [{"email": "MAILTO:new@example.test", "name": "New"}]}
    )
    assert str(event["ATTENDEE"]) == "mailto:new@example.test"
    with pytest.raises(CalendarProviderError, match="Only email attendees"):
        resources.patch_component(event, {"attendees": [{"email": "urn:uuid:new"}]})
    assert str(event["ATTENDEE"]) == "mailto:new@example.test"
