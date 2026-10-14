"""Timezone-aware slot calculation over the union of every selected calendar."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from backend.domains.booking.schemas import BookingSchedule, BookingSlot

UTC = timezone.utc
BusyInterval = tuple[datetime, datetime]


def aware_utc(value: datetime) -> datetime:
    """SQLite stores UTC without the timezone marker."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def day_bounds(day: date, zone: ZoneInfo) -> BusyInterval:
    return (
        datetime.combine(day, time.min, zone).astimezone(UTC),
        datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC),
    )


def _wall_boundary(day: date, wall_time: str, zone: ZoneInfo, *, latest: bool) -> datetime:
    """Skip nonexistent spring times; include both repeated autumn hours."""
    wall = datetime.combine(day, time.fromisoformat(wall_time))
    for _ in range(181):
        candidates = [wall.replace(tzinfo=zone, fold=fold).astimezone(UTC) for fold in (0, 1)]
        valid = [instant for instant in candidates if instant.astimezone(zone).replace(tzinfo=None) == wall]
        if valid:
            return max(valid) if latest else min(valid)
        wall += timedelta(minutes=1)
    raise ValueError("Cannot resolve working hours in this timezone")


def calculate_slots(
    day: date,
    schedule: BookingSchedule,
    busy: list[BusyInterval],
    *,
    now: datetime | None = None,
) -> list[BookingSlot]:
    current_time = aware_utc(now or datetime.now(UTC))
    zone = ZoneInfo(schedule.timezone)
    today = current_time.astimezone(zone).date()
    if day < today or day > today + timedelta(days=schedule.horizon_days) or day.weekday() not in schedule.weekdays:
        return []
    cursor = _wall_boundary(day, schedule.working_start, zone, latest=False)
    finish = _wall_boundary(day, schedule.working_end, zone, latest=True)
    duration = timedelta(minutes=schedule.duration_minutes)
    buffer = timedelta(minutes=schedule.buffer_minutes)
    earliest = current_time + timedelta(minutes=schedule.notice_minutes)
    normalized = [(aware_utc(start), aware_utc(end)) for start, end in busy]
    slots: list[BookingSlot] = []
    while cursor + duration <= finish:
        end = cursor + duration
        if cursor >= earliest and not any(cursor - buffer < high and end + buffer > low for low, high in normalized):
            slots.append(BookingSlot(start=cursor, end=end))
        cursor = end
    return slots
