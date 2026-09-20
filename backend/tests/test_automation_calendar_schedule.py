"""Calendar scheduling must preserve wall time across DST and scope history."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from backend.services.automation_schedule import AutomationSchedule, next_scheduled_run


def stamp(value: str) -> float:
    return datetime.fromisoformat(value).timestamp()


@pytest.mark.parametrize(("after", "expected"), [
    ("2026-03-28T08:00:00+01:00", "2026-03-29T08:00:00+02:00"),
    ("2026-10-24T08:00:00+02:00", "2026-10-25T08:00:00+01:00"),
])
def test_daily_preserves_local_time(after, expected):
    schedule = AutomationSchedule(kind="daily", timezone="Europe/Madrid", time="08:00")
    assert next_scheduled_run(schedule, 1440, stamp(after)) == stamp(expected)


def test_nonexistent_time_moves_forward_and_repeated_time_runs_once():
    schedule = AutomationSchedule(kind="daily", timezone="Europe/Madrid", time="02:30")
    assert next_scheduled_run(schedule, 1440, stamp("2026-03-28T03:00:00+01:00")) == stamp("2026-03-29T03:30:00+02:00")
    first = next_scheduled_run(schedule, 1440, stamp("2026-10-24T03:00:00+02:00"))
    assert first == stamp("2026-10-25T02:30:00+02:00")
    assert next_scheduled_run(schedule, 1440, first) == stamp("2026-10-26T02:30:00+01:00")


def test_weekly_skips_unselected_days():
    schedule = AutomationSchedule(kind="weekly", weekdays=[4], timezone="Europe/Madrid", time="17:00")
    result = datetime.fromtimestamp(next_scheduled_run(schedule, 1440, stamp("2026-09-19T12:00:00+02:00")), ZoneInfo("Europe/Madrid"))
    assert result.isoformat() == "2026-09-25T17:00:00+02:00"


@pytest.mark.parametrize("values", [{"timezone": "Invalid/Zone"}, {"time": "25:00"}, {"kind": "weekly", "weekdays": []}, {"weekdays": [7]}])
def test_invalid_schedule_is_rejected(values):
    with pytest.raises(ValueError):
        AutomationSchedule(**values)
