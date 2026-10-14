"""Scheduling boundaries, aggregation and private local-calendar projection."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi import HTTPException
import pytest
from pydantic import ValidationError

from backend.domains.booking.availability import calculate_slots, day_bounds
from backend.domains.booking.schemas import BookingSchedule
from backend.domains.booking.vault_busy import project_busy
from backend.services.workspace_service import WorkspaceContext

UTC = timezone.utc


def schedule(**updates):
    values = {"calendars": [{"provider": "vault", "calendar_id": "gnosi"}], "timezone": "Europe/Madrid", "weekdays": list(range(7)), "notice_minutes": 0}
    values.update(updates)
    return BookingSchedule.model_validate(values)


@pytest.mark.parametrize("day,count", [(date(2026, 3, 29), 2), (date(2026, 10, 25), 4)])
def test_daylight_saving_slots_are_real_instants(day, count):
    config = schedule(working_start="01:00", working_end="04:00", duration_minutes=60)
    result = calculate_slots(day, config, [], now=datetime.combine(day, datetime.min.time(), UTC) - timedelta(days=1))
    assert len(result) == count
    assert all(item.end - item.start == timedelta(hours=1) for item in result)
    assert len({item.start for item in result}) == len(result)


def test_nonexistent_spring_working_start_moves_forward():
    config = schedule(working_start="02:30", working_end="04:00", duration_minutes=30)
    day = date(2026, 3, 29)
    result = calculate_slots(day, config, [], now=datetime(2026, 3, 28, tzinfo=UTC))
    assert [item.start.astimezone(ZoneInfo(config.timezone)).strftime("%H:%M") for item in result] == ["03:00", "03:30"]


def test_busy_union_buffer_notice_and_horizon():
    config = schedule(timezone="UTC", working_start="09:00", working_end="12:00", buffer_minutes=15, notice_minutes=60)
    day = date(2026, 10, 14)
    busy = [(datetime(2026, 10, 14, 10, 0, tzinfo=UTC), datetime(2026, 10, 14, 10, 30, tzinfo=UTC))]
    slots = calculate_slots(day, config, busy, now=datetime(2026, 10, 14, 8, 30, tzinfo=UTC))
    assert [slot.start.hour for slot in slots] == [11, 11]
    assert calculate_slots(day + timedelta(days=31), config, [], now=datetime(2026, 10, 14, tzinfo=UTC)) == []


@pytest.mark.parametrize("updates", [{"timezone": "Mars/Olympus"}, {"weekdays": [7]}, {"weekdays": [1, 1]}, {"working_start": "25:00"}, {"working_start": "18:00", "working_end": "09:00"}, {"duration_minutes": 0}])
def test_invalid_scheduling_input_is_rejected(updates):
    with pytest.raises(ValidationError):
        schedule(**updates)


def test_vault_projection_counts_long_events_recurrence_and_exclusions():
    low, high = day_bounds(date(2026, 10, 14), ZoneInfo("UTC"))
    pages = [
        SimpleNamespace(path="Calendar/long.md", metadata={"date": "2026-10-13", "end_date": "2026-10-15", "all_day": True}),
        SimpleNamespace(path="Calendar/recurring.md", metadata={"date": "2026-09-01T09:00:00Z", "end_date": "2026-09-01T10:00:00Z", "rrule": "FREQ=DAILY", "exdates": ["2026-10-14"]}),
        SimpleNamespace(path="Calendar/repeat.md", metadata={"date": "2026-09-01T11:00:00Z", "end_date": "2026-09-01T12:00:00Z", "rrule": "FREQ=DAILY"}),
        SimpleNamespace(path="Calendar/free.md", metadata={"date": "2026-10-14T15:00:00Z", "transparency": "transparent"}),
    ]
    result = project_busy(pages, low, high, ZoneInfo("UTC"))
    assert len(result) == 2
    assert result[0][0] < low and result[0][1] >= high
    assert result[1][0].hour == 11


def test_unified_dates_preserve_hidden_clocks_inclusive_end_and_pending_boundaries():
    low, high = day_bounds(date(2026, 10, 14), ZoneInfo("UTC"))
    pages = [
        SimpleNamespace(path="Calendar/period.md", metadata={"date": {"kind": "period", "start": "2026-10-13T09:00", "end": "2026-10-14T10:00", "withTime": False}}),
        SimpleNamespace(path="Calendar/timed.md", metadata={"date": {"kind": "period", "start": "2026-10-14T10:00Z", "end": "2026-10-14T12:00Z", "withTime": True}, "all_day": True}),
        SimpleNamespace(path="Calendar/pending.md", metadata={"date": {"kind": "period", "start": "", "end": "2026-10-15", "withTime": False}}),
        SimpleNamespace(path="Calendar/no-end.md", metadata={"date": {"kind": "period", "start": "2026-10-14T14:00Z", "end": "", "withTime": True}}),
    ]
    result = project_busy(pages, low, high, ZoneInfo("UTC"))
    assert len(result) == 3
    assert result[0] == (low - timedelta(days=1), high)
    assert result[1] == (low + timedelta(hours=10), low + timedelta(hours=12))
    assert result[2] == (low + timedelta(hours=14), low + timedelta(hours=14, minutes=30))


def test_inclusive_all_day_end_and_embedded_exdate_match_calendar():
    low, high = day_bounds(date(2026, 10, 14), ZoneInfo("UTC"))
    pages = [
        SimpleNamespace(path="Calendar/inclusive.md", metadata={"date": "2026-10-12", "end_date": "2026-10-14", "all_day": True}),
        SimpleNamespace(path="Calendar/exclusive.md", metadata={"date": "2026-10-12", "end_date": "2026-10-14", "all_day": True, "_end_exclusive": True}),
        SimpleNamespace(path="Calendar/recurrence.md", metadata={"date": "2026-10-01", "rrule": "FREQ=DAILY;EXDATE=2026-10-14"}),
    ]
    assert project_busy(pages, low, high, ZoneInfo("UTC")) == [(low - timedelta(days=2), high)]


def test_aggregation_queries_every_selected_account_and_fails_closed(monkeypatch):
    from backend.domains.booking import sources
    from backend.domains.calendar import provider_operations

    config = schedule(calendars=[
        {"provider": "google", "account": "first@example.test", "calendar_id": "work"},
        {"provider": "caldav", "account": "second@example.test", "calendar_id": "/private/"},
        {"provider": "vault", "calendar_id": "gnosi"},
    ])
    calls = []

    def provider(email, calendar_id, *args, **kwargs):
        calls.append((email, calendar_id, kwargs["provider"]))
        return [{"start": "2026-10-14T09:00:00Z", "end": "2026-10-14T10:00:00Z"}]

    monkeypatch.setattr(provider_operations, "get_busy_intervals", provider)
    monkeypatch.setattr(sources, "load_vault_busy", lambda *args: [(datetime(2026, 10, 14, 11, tzinfo=UTC), datetime(2026, 10, 14, 12, tzinfo=UTC))])
    low, high = day_bounds(date(2026, 10, 14), ZoneInfo("UTC"))
    assert len(sources._provider_busy(config, low, high)) == 3
    assert calls == [("first@example.test", "work", "google"), ("second@example.test", "/private/", "caldav")]
    monkeypatch.setattr(sources, "validate_external_scope", lambda *args: None)
    monkeypatch.setattr(sources, "_provider_busy", lambda *args: (_ for _ in ()).throw(RuntimeError("token expired")))
    with pytest.raises(HTTPException) as error:
        sources.slots_for_day(None, WorkspaceContext("personal", "u", "owner", Path("/tmp")), config, date(2026, 10, 14), now=datetime(2026, 10, 13, tzinfo=UTC))
    assert error.value.status_code == 503
    assert "token expired" not in str(error.value.detail)


def test_org_cannot_borrow_global_account_credentials(monkeypatch):
    from backend.domains.booking import sources

    monkeypatch.setattr(sources, "load_params", lambda **kwargs: SimpleNamespace(gnosi_mode="org"))
    config = schedule(calendars=[{"provider": "google", "account": "owner@example.test", "calendar_id": "primary"}])
    with pytest.raises(HTTPException) as error:
        sources.validate_external_scope(config, WorkspaceContext("org", "u", "owner", Path("/tmp")))
    assert error.value.status_code == 403


def test_external_claim_resources_distinguish_accounts_providers_and_calendars():
    from backend.domains.booking.claims import calendar_resources

    def resources(provider="google", account="first@example.test", calendar_id="work"):
        return calendar_resources(schedule(calendars=[{
            "provider": provider, "account": account, "calendar_id": calendar_id,
        }]), "personal", "any-vault")

    selected = resources()
    assert selected == resources(account="FIRST@example.test")
    assert selected.isdisjoint(resources(calendar_id="private"))
    assert selected.isdisjoint(resources(account="second@example.test"))
    assert selected.isdisjoint(resources(provider="caldav"))
