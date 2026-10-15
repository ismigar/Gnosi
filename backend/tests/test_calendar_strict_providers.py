"""Availability and join links use explicit, safe provider semantics."""

from types import SimpleNamespace

import pytest
from icalendar import Calendar

from backend.domains.calendar import caldav_resources, provider_operations
from backend.domains.calendar.conference_links import caldav_join_url, google_join_url
from backend.domains.calendar.provider_errors import CalendarProviderError
from backend.services.hybrid_calendar_service import (
    _normalize_caldav_event,
    _normalize_google_event,
)


def test_google_conference_video_entry_precedes_hangout_link_and_unsafe_urls_are_rejected():
    event = {
        "id": "meeting",
        "conferenceData": {
            "entryPoints": [
                {"entryPointType": "phone", "uri": "tel:+12345"},
                {"entryPointType": "video", "uri": "javascript:alert(1)"},
                {"entryPointType": "video", "uri": "https://meet.example.test/room"},
            ]
        },
        "hangoutLink": "https://meet.example.test/fallback",
    }
    assert google_join_url(event) == "https://meet.example.test/room"
    assert (
        _normalize_google_event(event, "me@example.test", {"id": "work", "name": "Work"})[
            "join_url"
        ]
        == "https://meet.example.test/room"
    )
    assert google_join_url({"hangoutLink": "file:///etc/passwd"}) == ""
    assert google_join_url({"hangoutLink": "https://user:pass@meet.example.test/room"}) == ""


def test_caldav_conference_link_and_attendees_survive_normalization():
    content = Calendar.from_ical("""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test
DTSTART:20261014T100000Z
DTEND:20261014T110000Z
CONFERENCE;FEATURE=VIDEO:https://video.example.test/room
URL:https://calendar.example.test/event
ATTENDEE;CN=Guest;PARTSTAT=ACCEPTED:mailto:guest@example.test
END:VEVENT
END:VCALENDAR""")
    component = content.walk("VEVENT")[0]
    event = _normalize_caldav_event(
        component, "guest@example.test", {"id": "/work/", "name": "Work"}
    )
    assert caldav_join_url(component) == "https://video.example.test/room"
    assert event["join_url"] == "https://video.example.test/room"
    assert event["attendees"][0]["rsvp"] == "accepted"
    assert event["attendees"][0]["self"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"calendars": {"work": {"errors": [{"reason": "notFound"}]}}},
        {"calendars": {"work": {"busy": [{}]}}},
    ],
)
def test_failed_google_calendar_never_looks_free(monkeypatch, payload):
    monkeypatch.setattr(
        provider_operations, "configured_account", lambda *args: {"provider": "google"}
    )
    monkeypatch.setattr(
        provider_operations,
        "_google_service",
        lambda *_: SimpleNamespace(
            freebusy=lambda: SimpleNamespace(
                query=lambda **kw: SimpleNamespace(execute=lambda: payload)
            )
        ),
    )
    with pytest.raises(CalendarProviderError):
        provider_operations.get_busy_intervals(
            "me@example.test", "work", "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z"
        )


def test_caldav_freebusy_reads_periods_and_skips_explicit_free():
    content = b"""BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VFREEBUSY\r
DTSTART:20261014T000000Z\r
DTEND:20261015T000000Z\r
FREEBUSY:20261014T100000Z/PT1H\r
FREEBUSY;FBTYPE=FREE:20261014T130000Z/20261014T140000Z\r
END:VFREEBUSY\r
END:VCALENDAR\r
"""
    client = SimpleNamespace(request=lambda *args, **kwargs: SimpleNamespace(content=content))
    assert caldav_resources.busy_intervals(
        client,
        {"url": "https://calendar.example.test/work/"},
        "2026-10-14T00:00:00Z",
        "2026-10-15T00:00:00Z",
    ) == [
        {"start": "2026-10-14T10:00:00+00:00", "end": "2026-10-14T11:00:00+00:00"},
    ]


def test_empty_caldav_xml_is_not_a_free_calendar():
    client = SimpleNamespace(request=lambda *args, **kwargs: SimpleNamespace(content=b"<error/>"))
    with pytest.raises(CalendarProviderError):
        caldav_resources.busy_intervals(
            client,
            {"url": "https://calendar.example.test/work/"},
            "2026-10-14T00:00:00Z",
            "2026-10-15T00:00:00Z",
        )


def test_duplicate_booking_create_returns_existing_google_event(monkeypatch):
    calls = []

    class Conflict(Exception):
        resp = SimpleNamespace(status=409)

    def insert(**kwargs):
        calls.append(kwargs)

        def execute():
            raise Conflict()

        return SimpleNamespace(execute=execute)

    service = SimpleNamespace(
        events=lambda: SimpleNamespace(
            insert=insert, get=lambda **kw: SimpleNamespace(execute=lambda: {"id": kw["eventId"]})
        )
    )
    monkeypatch.setattr(
        provider_operations, "configured_account", lambda *args: {"provider": "google"}
    )
    monkeypatch.setattr(provider_operations, "_google_service", lambda *_: service)
    event = provider_operations.create_provider_event(
        "me@example.test", "work", {"summary": "Booked"}, stable_id="reservation-1"
    )
    assert event["id"] == calls[0]["body"]["id"]
    assert len(event["id"]) == 64
