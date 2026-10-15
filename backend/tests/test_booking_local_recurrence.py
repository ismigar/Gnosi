"""Local booking availability stays correct through timezone transitions."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from backend.domains.booking import sources
from backend.domains.booking.availability import day_bounds
from backend.domains.booking.schemas import BookingSchedule
from backend.domains.booking.vault_busy import project_busy

UTC = timezone.utc
ZONE = ZoneInfo("Europe/Madrid")


def page(**metadata):
    return SimpleNamespace(path="Calendar/synthetic.md", metadata=metadata)


def config(**updates):
    return BookingSchedule.model_validate(
        {
            "calendars": [{"provider": "vault", "calendar_id": "gnosi"}],
            "timezone": "Europe/Madrid",
            "weekdays": list(range(7)),
            "working_start": "02:30",
            "working_end": "04:00",
            "notice_minutes": 0,
            **updates,
        }
    )


def project(event, day):
    low, high = day_bounds(day, ZONE)
    return project_busy([event], low, high, ZONE)


def test_finite_count_skips_nonexistent_occurrences_before_the_requested_day(monkeypatch):
    event = page(
        date="2026-03-28T02:30:00", end_date="2026-03-28T03:00:00", rrule="FREQ=DAILY;COUNT=3"
    )
    assert project(event, date(2026, 3, 29)) == []
    assert project(event, date(2026, 3, 31)) == [
        (datetime(2026, 3, 31, 0, 30, tzinfo=UTC), datetime(2026, 3, 31, 1, tzinfo=UTC)),
    ]
    assert project(event, date(2026, 4, 1)) == []
    monkeypatch.setattr(
        sources, "load_vault_busy", lambda low, high, zone: project_busy([event], low, high, zone)
    )
    monkeypatch.setattr(sources, "reservation_busy", lambda *args: [])
    result = sources.slots_for_day(
        None, SimpleNamespace(), config(), date(2026, 3, 31), now=datetime(2026, 3, 28, tzinfo=UTC)
    )
    assert [slot.start for slot in result.slots] == [
        datetime(2026, 3, 31, 1, tzinfo=UTC),
        datetime(2026, 3, 31, 1, 30, tzinfo=UTC),
    ]


@pytest.mark.parametrize(
    "exclusions", [{"exdates": ["2026-03-30"]}, {"rrule": "FREQ=DAILY;COUNT=3;EXDATE=2026-03-30"}]
)
def test_excluded_real_occurrences_still_consume_count(exclusions):
    event = page(
        **{
            "date": "2026-03-28T02:30:00",
            "end_date": "2026-03-28T03:00:00",
            "rrule": "FREQ=DAILY;COUNT=3",
            **exclusions,
        }
    )
    assert project(event, date(2026, 3, 30)) == []
    assert len(project(event, date(2026, 3, 31))) == 1
    assert project(event, date(2026, 4, 1)) == []


@pytest.mark.parametrize("rule", ["FREQ=DAILY", "FREQ=DAILY;UNTIL=20260331T230000Z"])
def test_unbounded_and_until_rules_skip_the_gap(rule):
    event = page(date="2026-03-28T02:30:00", end_date="2026-03-28T03:00:00", rrule=rule)
    assert project(event, date(2026, 3, 29)) == []
    assert len(project(event, date(2026, 3, 31))) == 1


@pytest.mark.parametrize(
    "start,end,day,expected_start,hours",
    [
        (
            "2026-03-29T01:30:00",
            "2026-03-29T03:30:00",
            date(2026, 3, 30),
            "2026-03-29T23:30:00+00:00",
            1,
        ),
        (
            "2026-10-25T01:30:00",
            "2026-10-25T03:30:00",
            date(2026, 10, 26),
            "2026-10-26T00:30:00+00:00",
            3,
        ),
    ],
)
def test_timed_recurrences_keep_elapsed_duration_across_offset_changes(
    start, end, day, expected_start, hours
):
    event = page(date=start, end_date=end, rrule="FREQ=DAILY;COUNT=2")
    instant = datetime.fromisoformat(expected_start)
    assert project(event, day) == [(instant, instant + timedelta(hours=hours))]


@pytest.mark.parametrize(
    "start,day,hours",
    [
        ("2026-03-28", date(2026, 3, 29), 23),
        ("2026-10-24", date(2026, 10, 25), 25),
    ],
)
def test_all_day_recurrences_keep_nominal_days(start, day, hours):
    event = page(date=start, all_day=True, rrule="FREQ=DAILY;COUNT=2")
    result = project(event, day)
    assert result == [day_bounds(day, ZONE)]
    assert result[0][1] - result[0][0] == timedelta(hours=hours)


@pytest.mark.parametrize(
    "start,end",
    [
        ("2026-03-29T02:30:00", "2026-03-29T03:00:00"),
        ("2026-03-29T01:30:00", "2026-03-29T02:30:00"),
        ("2026-03-29T04:00:00", "2026-03-29T03:00:00"),
    ],
)
def test_invalid_local_intervals_never_become_free_time(monkeypatch, start, end):
    event = page(date=start, end_date=end)
    monkeypatch.setattr(
        sources, "load_vault_busy", lambda low, high, zone: project_busy([event], low, high, zone)
    )
    with pytest.raises(HTTPException) as error:
        sources.slots_for_day(
            None,
            SimpleNamespace(),
            config(),
            date(2026, 3, 29),
            now=datetime(2026, 3, 28, tzinfo=UTC),
        )
    assert error.value.status_code == 503


@pytest.mark.parametrize(
    "invalid",
    [
        (datetime(2026, 3, 29, 1, 30, tzinfo=UTC), datetime(2026, 3, 29, 1, tzinfo=UTC)),
        (datetime(2026, 3, 29, 1), datetime(2026, 3, 29, 2)),
    ],
)
def test_local_adapter_results_receive_the_same_validation_as_external_sources(
    monkeypatch, invalid
):
    monkeypatch.setattr(sources, "load_vault_busy", lambda *args: [invalid])
    with pytest.raises(HTTPException) as error:
        sources.slots_for_day(
            None,
            SimpleNamespace(),
            config(),
            date(2026, 3, 29),
            now=datetime(2026, 3, 28, tzinfo=UTC),
        )
    assert error.value.status_code == 503


def test_count_validation_remains_bounded_and_fails_closed(monkeypatch):
    event = page(
        date="2010-01-01T02:30:00", end_date="2010-01-01T03:00:00", rrule="FREQ=DAILY;COUNT=9000"
    )
    monkeypatch.setattr(
        sources, "load_vault_busy", lambda low, high, zone: project_busy([event], low, high, zone)
    )
    with pytest.raises(HTTPException) as error:
        sources.slots_for_day(
            None,
            SimpleNamespace(),
            config(),
            date(2026, 3, 31),
            now=datetime(2026, 3, 28, tzinfo=UTC),
        )
    assert error.value.status_code == 503
