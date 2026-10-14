"""RFC 5545 duration arithmetic without losing nominal days or exact hours."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any, cast

from icalendar import Calendar
from icalendar.parser import Contentlines

from backend.domains.calendar.provider_errors import CalendarProviderError

_DURATION = re.compile(
    r"\+?P(?:(?P<weeks>\d+)W|(?:(?P<days>\d+)D)?"
    r"(?:T(?=\d)(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?)",
    re.IGNORECASE,
)


@dataclass
class PreservedDuration:
    """A property compatible with icalendar serialization, retaining its units."""

    original: str
    dt: timedelta
    params: Any

    def to_ical(self) -> bytes:
        return self.original.encode("ascii")


def parse_calendar(data: str | bytes) -> Calendar:
    """Keep DURATION tokens that icalendar otherwise folds from PT24H into P1D."""
    content: Calendar = Calendar.from_ical(data)
    components = iter(content.walk())
    stack: list[Any] = []
    # The library's content-line parser has no annotated call signature.
    parse_lines = cast(Callable[[str | bytes], Contentlines], Contentlines.from_ical)
    for line in parse_lines(data):
        if not line:
            continue
        name, _, value = line.parts()
        name = name.upper()
        if name == "BEGIN":
            component = next(components)
            if component.name is None or component.name.upper() != value.upper():
                raise ValueError("Calendar components could not be matched")
            stack.append(component)
        elif name == "END":
            stack.pop()
        elif name == "DURATION" and stack:
            previous = stack[-1].get(name)
            if not isinstance(getattr(previous, "dt", None), timedelta):
                raise ValueError("Invalid or repeated calendar duration")
            stack[-1][name] = PreservedDuration(value, previous.dt, previous.params)
    return content


def calendar_datetime(value: object, zone: tzinfo | None) -> datetime:
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value
    if zone is None:
        raise CalendarProviderError(502, "Calendar time zone is required for availability")
    if isinstance(value, datetime):
        return value.replace(tzinfo=zone)
    if isinstance(value, date):
        return datetime.combine(value, time.min, zone)
    raise CalendarProviderError(502, "Calendar contains an invalid event date")


@dataclass(frozen=True)
class EventDuration:
    nominal_days: int = 0
    exact: timedelta = timedelta(0)

    def end(self, start: date | datetime) -> date | datetime:
        # Preserve fold when no nominal days are added: datetime + timedelta(0)
        # resets it. RFC 5545 3.3.6 adds nominal days before exact elapsed time.
        later = start + timedelta(days=self.nominal_days) if self.nominal_days else start
        if isinstance(later, datetime) and later.tzinfo is not None:
            return (later.astimezone(timezone.utc) + self.exact).astimezone(later.tzinfo)
        return later + self.exact

    def lookback(self) -> timedelta:
        # A nominal interval may cross an offset change. UTC offsets are each
        # strictly less than 24 hours, so two days safely bound their difference.
        margin = 2 if self.nominal_days else 0
        return timedelta(days=self.nominal_days + margin) + self.exact


def _duration_property(value: Any) -> EventDuration:
    match = _DURATION.fullmatch(value.to_ical().decode("ascii"))
    if match is None or not any(match.groupdict().values()):
        raise CalendarProviderError(502, "Calendar contains an invalid event duration")
    parts = {key: int(item or 0) for key, item in match.groupdict().items()}
    return EventDuration(
        nominal_days=parts["weeks"] * 7 + parts["days"],
        exact=timedelta(hours=parts["hours"], minutes=parts["minutes"], seconds=parts["seconds"]),
    )


def event_duration(
    event: Any, zone: tzinfo | None = None, default: EventDuration | None = None
) -> EventDuration:
    start = getattr(event.get("DTSTART"), "dt", None)
    end = getattr(event.get("DTEND"), "dt", None)
    duration = event.get("DURATION")
    if end is not None and duration is not None:
        raise CalendarProviderError(502, "Calendar event has both an end and a duration")
    if end is not None:
        if not isinstance(start, date) or not isinstance(end, date) or type(start) is not type(end):
            raise CalendarProviderError(502, "Calendar event dates have different value types")
        if isinstance(start, datetime):
            # DTEND gives every recurrence the same elapsed duration (3.8.5.3).
            first, last = (calendar_datetime(value, zone) for value in (start, end))
            result = EventDuration(
                exact=last.astimezone(timezone.utc) - first.astimezone(timezone.utc)
            )
        else:
            # DATE values occupy complete calendar dates, including 23/25h days.
            result = EventDuration(nominal_days=(end - start).days)
    elif duration is not None:
        result = _duration_property(duration)
    elif default is not None:
        result = default
    else:
        result = EventDuration(
            nominal_days=int(isinstance(start, date) and not isinstance(start, datetime))
        )
    if result.nominal_days < 0 or result.exact < timedelta(0):
        raise CalendarProviderError(502, "Calendar contains a negative event duration")
    if (duration is not None or end is not None) and result == EventDuration():
        raise CalendarProviderError(502, "Calendar event duration must be positive")
    if isinstance(start, date) and not isinstance(start, datetime) and result.exact:
        raise CalendarProviderError(502, "All-day calendar durations must use whole days")
    return result


def effective_event_end(event: Any, start: date | datetime | None = None) -> date | datetime | None:
    explicit = getattr(event.get("DTEND"), "dt", None)
    if explicit is not None:
        if not isinstance(explicit, date):
            raise CalendarProviderError(422, "Invalid calendar event end")
        return explicit
    start = start if start is not None else getattr(event.get("DTSTART"), "dt", None)
    return event_duration(event).end(start) if start is not None else None


def exact_duration_property(duration: timedelta, previous: Any) -> PreservedDuration:
    """Serialize an edited elapsed duration as hours, never as nominal days."""
    seconds = int(duration.total_seconds())
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    parts = (f"{hours}H" if hours else "") + (f"{minutes}M" if minutes else "")
    parts += f"{seconds}S" if seconds or not parts else ""
    return PreservedDuration("PT" + parts, duration, previous.params)
