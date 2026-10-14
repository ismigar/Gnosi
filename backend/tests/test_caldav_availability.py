"""iCloud availability fallback expands recurrence without inventing free time."""

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from icalendar import Calendar

from backend.domains.booking.availability import calculate_slots
from backend.domains.booking.schemas import BookingSchedule
from backend.domains.calendar import caldav_availability as availability
from backend.domains.calendar import provider_operations as providers
from backend.domains.calendar.caldav_resources import resources
from backend.domains.calendar.caldav_time import parse_calendar
from backend.domains.calendar.provider_errors import CalendarProviderError


def calendar_data(events: str, zone: str = "Europe/Madrid") -> Calendar:
    return parse_calendar(
        f"BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-TIMEZONE:{zone}\n{events}\nEND:VCALENDAR"
    )


def query(
    monkeypatch, content: Calendar, lower="2026-10-24T00:00:00Z", upper="2026-10-27T00:00:00Z"
):
    monkeypatch.setattr(availability, "resources", lambda *args: [("url", '"etag"', content)])
    return availability.query_busy_intervals(
        SimpleNamespace(),
        {"url": "https://calendar.example.test/work/"},
        lower,
        upper,
    )


def test_daily_recurrence_handles_dst_exdate_and_moved_instance(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:daily
DTSTART;TZID=Europe/Madrid:20261024T100000
DTEND;TZID=Europe/Madrid:20261024T110000
RRULE:FREQ=DAILY;COUNT=4
EXDATE;TZID=Europe/Madrid:20261025T100000
END:VEVENT
BEGIN:VEVENT
UID:daily
RECURRENCE-ID;TZID=Europe/Madrid:20261026T100000
DTSTART;TZID=Europe/Madrid:20261026T120000
DTEND;TZID=Europe/Madrid:20261026T130000
END:VEVENT""")
    assert sorted(query(monkeypatch, content), key=lambda item: item["start"]) == [
        {"start": "2026-10-24T08:00:00+00:00", "end": "2026-10-24T09:00:00+00:00"},
        {"start": "2026-10-26T11:00:00+00:00", "end": "2026-10-26T12:00:00+00:00"},
    ]


def test_all_day_fallback_uses_calendar_zone_across_dst(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:all-day
DTSTART;VALUE=DATE:20261025
DTEND;VALUE=DATE:20261026
END:VEVENT""")
    assert query(monkeypatch, content) == [
        {"start": "2026-10-24T22:00:00+00:00", "end": "2026-10-25T23:00:00+00:00"},
    ]


@pytest.mark.parametrize("property", ["TRANSP:TRANSPARENT", "STATUS:CANCELLED"])
def test_free_or_cancelled_events_do_not_block_slots(monkeypatch, property):
    content = calendar_data(f"""BEGIN:VEVENT
UID:free
DTSTART:20261025T100000Z
DTEND:20261025T110000Z
{property}
END:VEVENT""")
    assert query(monkeypatch, content) == []


def test_cancelled_detached_instance_needs_no_start(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:daily
DTSTART:20261025T100000Z
DTEND:20261025T110000Z
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT
BEGIN:VEVENT
UID:daily
RECURRENCE-ID:20261026T100000Z
STATUS:CANCELLED
END:VEVENT""")
    assert query(monkeypatch, content) == [
        {"start": "2026-10-25T10:00:00+00:00", "end": "2026-10-25T11:00:00+00:00"},
    ]


def test_unsupported_recurrence_blocks_availability_instead_of_omitting_events(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:hourly
DTSTART:20261025T100000Z
DTEND:20261025T110000Z
RRULE:FREQ=HOURLY
END:VEVENT""")
    with pytest.raises(CalendarProviderError, match="unsupported"):
        query(monkeypatch, content)


def test_caldav_error_xml_never_becomes_empty_availability():
    client = SimpleNamespace(request=lambda *args, **kwargs: SimpleNamespace(text="<error/>"))
    with pytest.raises(CalendarProviderError):
        resources(client, {"url": "https://calendar.example.test/work/"}, "query")


def test_icloud_freebusy_failure_uses_strict_event_fallback(monkeypatch):
    monkeypatch.setattr(providers, "configured_account", lambda *args: {"provider": "caldav"})
    monkeypatch.setattr(
        providers,
        "CalDAVClient",
        lambda *args: SimpleNamespace(calendar=lambda *args: {"url": "calendar"}),
    )

    def unsupported(*args):
        raise CalendarProviderError(502, "Unsupported free-busy report")

    monkeypatch.setattr(providers.caldav_resources, "busy_intervals", unsupported)
    expected = [{"start": "2026-10-25T10:00:00+00:00", "end": "2026-10-25T11:00:00+00:00"}]
    monkeypatch.setattr(availability, "query_busy_intervals", lambda *args: expected)
    assert (
        providers.get_busy_intervals("me@icloud.com", "/work/", "start", "end", provider="caldav")
        == expected
    )


def test_exact_dst_duration_does_not_advertise_overlapping_booking_slots(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:busy
DTSTART;TZID=Europe/Madrid:20260329T013000
DURATION:PT2H
END:VEVENT""")
    busy = query(monkeypatch, content, "2026-03-29T00:00:00Z", "2026-03-30T00:00:00Z")
    assert busy == [{"start": "2026-03-29T00:30:00+00:00", "end": "2026-03-29T02:30:00+00:00"}]
    schedule = BookingSchedule.model_validate(
        {
            "calendars": [
                {"provider": "caldav", "account": "me@example.test", "calendar_id": "/work/"}
            ],
            "timezone": "Europe/Madrid",
            "weekdays": list(range(7)),
            "notice_minutes": 0,
            "working_start": "03:30",
            "working_end": "05:00",
            "duration_minutes": 30,
        }
    )
    slots = calculate_slots(
        date(2026, 3, 29),
        schedule,
        [
            (datetime.fromisoformat(item["start"]), datetime.fromisoformat(item["end"]))
            for item in busy
        ],
        now=datetime(2026, 3, 28, tzinfo=timezone.utc),
    )
    assert [(slot.start.isoformat(), slot.end.isoformat()) for slot in slots] == [
        ("2026-03-29T02:30:00+00:00", "2026-03-29T03:00:00+00:00"),
    ]


@pytest.mark.parametrize(
    "end,expected_ends",
    [
        ("DURATION:P1D", ["2026-10-25T11:00:00+00:00", "2026-10-26T11:00:00+00:00"]),
        ("DURATION:PT24H", ["2026-10-25T10:00:00+00:00", "2026-10-26T11:00:00+00:00"]),
        (
            "DTEND;TZID=Europe/Madrid:20261025T120000",
            ["2026-10-25T11:00:00+00:00", "2026-10-26T12:00:00+00:00"],
        ),
    ],
)
def test_recurring_nominal_days_and_exact_hours_have_distinct_fall_dst_ends(
    monkeypatch, end, expected_ends
):
    content = calendar_data(f"""BEGIN:VEVENT
UID:daily
DTSTART;TZID=Europe/Madrid:20261024T120000
{end}
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT""")
    busy = sorted(query(monkeypatch, content), key=lambda item: item["start"])
    assert [item["start"] for item in busy] == [
        "2026-10-24T10:00:00+00:00",
        "2026-10-25T11:00:00+00:00",
    ]
    assert [item["end"] for item in busy] == expected_ends


@pytest.mark.parametrize(
    "end,expected_ends",
    [
        ("DURATION:P1D", ["2026-03-29T10:00:00+00:00", "2026-03-30T10:00:00+00:00"]),
        ("DURATION:PT24H", ["2026-03-29T11:00:00+00:00", "2026-03-30T10:00:00+00:00"]),
        (
            "DTEND;TZID=Europe/Madrid:20260329T120000",
            ["2026-03-29T10:00:00+00:00", "2026-03-30T09:00:00+00:00"],
        ),
    ],
)
def test_recurring_nominal_days_and_exact_hours_have_distinct_spring_dst_ends(
    monkeypatch, end, expected_ends
):
    content = calendar_data(f"""BEGIN:VEVENT
UID:daily
DTSTART;TZID=Europe/Madrid:20260328T120000
{end}
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT""")
    busy = sorted(
        query(monkeypatch, content, "2026-03-28T00:00:00Z", "2026-03-31T00:00:00Z"),
        key=lambda item: item["start"],
    )
    assert [item["end"] for item in busy] == expected_ends


@pytest.mark.parametrize(
    "master_end,override_end,expected",
    [
        ("DURATION:PT24H", "", "2026-03-30T00:30:00+00:00"),
        ("DURATION:P1D", "", "2026-03-29T23:30:00+00:00"),
        ("DURATION:P1D", "DURATION:PT2H", "2026-03-29T02:30:00+00:00"),
        ("DURATION:PT24H", "DTEND;TZID=Europe/Madrid:20260329T043000", "2026-03-29T02:30:00+00:00"),
    ],
)
def test_moved_override_uses_its_own_duration_or_inherits_master_semantics(
    monkeypatch, master_end, override_end, expected
):
    content = calendar_data(f"""BEGIN:VEVENT
UID:daily
DTSTART;TZID=Europe/Madrid:20260328T100000
{master_end}
RRULE:FREQ=DAILY;COUNT=1
END:VEVENT
BEGIN:VEVENT
UID:daily
RECURRENCE-ID;TZID=Europe/Madrid:20260328T100000
DTSTART;TZID=Europe/Madrid:20260329T013000
{override_end}
END:VEVENT""")
    assert query(monkeypatch, content, "2026-03-28T00:00:00Z", "2026-03-31T00:00:00Z") == [
        {"start": "2026-03-29T00:30:00+00:00", "end": expected},
    ]


def test_fold_end_and_exdate_identity_use_instants(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:fold
DTSTART;TZID=Europe/Madrid:20261025T023000
DTEND:20261025T020000Z
RDATE:20261025T013000Z
EXDATE:20261025T003000Z
END:VEVENT""")
    assert query(monkeypatch, content) == [
        {"start": "2026-10-25T01:30:00+00:00", "end": "2026-10-25T03:00:00+00:00"},
    ]


@pytest.mark.parametrize("ending", ["", "DURATION:P1D", "DTEND;VALUE=DATE:20261025"])
def test_all_day_recurrences_keep_whole_days_with_implicit_or_explicit_ends(monkeypatch, ending):
    content = calendar_data(f"""BEGIN:VEVENT
UID:all-day
DTSTART;VALUE=DATE:20261024
{ending}
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT""")
    assert sorted(query(monkeypatch, content), key=lambda item: item["start"]) == [
        {"start": "2026-10-23T22:00:00+00:00", "end": "2026-10-24T22:00:00+00:00"},
        {"start": "2026-10-24T22:00:00+00:00", "end": "2026-10-25T23:00:00+00:00"},
    ]


def test_nominal_duration_lookback_does_not_omit_a_long_fall_day(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:daily
DTSTART;TZID=Europe/Madrid:20261024T120000
DURATION:P1D
RRULE:FREQ=DAILY;COUNT=1
END:VEVENT""")
    assert query(monkeypatch, content, "2026-10-25T10:30:00Z", "2026-10-25T11:30:00Z") == [
        {"start": "2026-10-24T10:00:00+00:00", "end": "2026-10-25T11:00:00+00:00"},
    ]


def test_implicit_timed_recurrence_has_no_busy_duration(monkeypatch):
    content = calendar_data("""BEGIN:VEVENT
UID:instant
DTSTART;TZID=Europe/Madrid:20261025T023000
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT""")
    assert query(monkeypatch, content) == []


@pytest.mark.parametrize("lower", ["2026-03-28T00:00:00Z", "2026-03-30T00:00:00Z"])
def test_nonexistent_recurrence_times_fail_closed_instead_of_undercounting_count(
    monkeypatch, lower
):
    content = calendar_data("""BEGIN:VEVENT
UID:gap
DTSTART;TZID=Europe/Madrid:20260328T023000
DURATION:PT1H
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT""")
    with pytest.raises(CalendarProviderError, match="nonexistent"):
        query(monkeypatch, content, lower, "2026-03-31T00:00:00Z")
