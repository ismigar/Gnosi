"""Private adapters; provider failures never become apparent free time."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.config.app_config import load_params
from backend.domains.booking.availability import (
    BusyInterval,
    aware_utc,
    calculate_slots,
    day_bounds,
)
from backend.domains.booking.claims import reservation_busy
from backend.domains.booking.schemas import BookingSchedule, BookingSlotsResponse
from backend.domains.booking.vault_busy import load_vault_busy
from backend.services.workspace_service import WorkspaceContext


def validate_external_scope(schedule: BookingSchedule, context: WorkspaceContext) -> None:
    if all(item.provider == "vault" for item in schedule.calendars):
        return
    # Integration credentials belong to the local installation, not org tenants.
    if (
        load_params(strict_env=False).gnosi_mode != "personal"
        or context.workspace_id != "personal"
        or context.role.lower() != "owner"
    ):
        raise HTTPException(
            403, detail="External booking calendars require the personal workspace owner"
        )


def _provider_busy(schedule: BookingSchedule, low: datetime, high: datetime) -> list[BusyInterval]:
    from backend.domains.calendar.provider_operations import get_busy_intervals

    result: list[BusyInterval] = []
    for calendar in schedule.calendars:
        if calendar.provider == "vault":
            result.extend(load_vault_busy(low, high, ZoneInfo(schedule.timezone)))
            continue
        for interval in get_busy_intervals(
            calendar.account,
            calendar.calendar_id,
            low.isoformat(),
            high.isoformat(),
            provider=calendar.provider,
        ):
            start = datetime.fromisoformat(interval["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(interval["end"].replace("Z", "+00:00"))
            result.append((start, end))
    normalized: list[BusyInterval] = []
    for start, end in result:
        if start.tzinfo is None or end.tzinfo is None or aware_utc(end) <= aware_utc(start):
            raise ValueError("Invalid calendar busy interval")
        normalized.append((aware_utc(start), aware_utc(end)))
    return normalized


def slots_for_day(
    db: Session,
    context: WorkspaceContext,
    schedule: BookingSchedule,
    day: date,
    *,
    now: datetime | None = None,
) -> BookingSlotsResponse:
    validate_external_scope(schedule, context)
    if not calculate_slots(day, schedule, [], now=now):
        return BookingSlotsResponse(timezone=schedule.timezone, date=day, slots=[])
    low, high = day_bounds(day, ZoneInfo(schedule.timezone))
    padding = timedelta(minutes=schedule.buffer_minutes)
    try:
        busy = _provider_busy(schedule, low - padding, high + padding)
        busy.extend(reservation_busy(db, context, schedule, low - padding, high + padding))
    except Exception as exc:
        raise HTTPException(
            503, detail="Availability cannot be verified for every selected calendar"
        ) from exc
    return BookingSlotsResponse(
        timezone=schedule.timezone, date=day, slots=calculate_slots(day, schedule, busy, now=now)
    )
