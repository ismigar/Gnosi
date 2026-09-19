"""Calendar schedules with explicit timezone and DST semantics."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AutomationSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["interval", "daily", "weekly"] = "interval"
    timezone: str = "UTC"
    time: str = Field(default="08:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    weekdays: list[int] = Field(default_factory=lambda: [0], max_length=7)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value

    @field_validator("weekdays")
    @classmethod
    def valid_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("Weekdays must be between Monday (0) and Sunday (6)")
        return sorted(set(value))

    @model_validator(mode="after")
    def weekly_has_days(self) -> "AutomationSchedule":
        if self.kind == "weekly" and not self.weekdays:
            raise ValueError("A weekly schedule needs at least one weekday")
        return self


def next_scheduled_run(schedule: AutomationSchedule, interval_minutes: int, after: float) -> float:
    """Use the first fold once; shift nonexistent wall times forward by the DST gap."""
    if schedule.kind == "interval":
        return after + interval_minutes * 60
    zone = ZoneInfo(schedule.timezone)
    local = datetime.fromtimestamp(after, zone)
    hour, minute = map(int, schedule.time.split(":"))
    for offset in range(9):
        day = local.date() + timedelta(days=offset)
        if schedule.kind == "weekly" and day.weekday() not in schedule.weekdays:
            continue
        candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone, fold=0)
        # The UTC roundtrip normalizes spring-forward gaps and fixes the first fold.
        normalized = candidate.astimezone(timezone.utc).astimezone(zone)
        if normalized.timestamp() > after:
            return normalized.timestamp()
    raise ValueError("No future occurrence within the schedule horizon")
