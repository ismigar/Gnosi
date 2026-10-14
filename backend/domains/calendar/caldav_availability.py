"""Strict event-based availability for servers without free-busy REPORT (iCloud)."""

from __future__ import annotations

from datetime import datetime, timezone, tzinfo
from typing import Any
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr
from icalendar import Calendar, Timezone

from backend.domains.calendar.caldav_resources import event_query, resources
from backend.domains.calendar.caldav_time import calendar_datetime, event_duration
from backend.domains.calendar.caldav_transport import CalDAVClient
from backend.domains.calendar.provider_errors import CalendarProviderError

_LIMIT = 10000


def _calendar_zone(calendar: dict[str, Any]) -> tzinfo | None:
    raw = calendar.get("timezone_ical")
    if not raw:
        return None
    try:
        component = Calendar.from_ical(raw).walk("VTIMEZONE")[0]
        if not isinstance(component, Timezone):
            raise ValueError("Expected a calendar timezone component")
        result: tzinfo = component.to_tz()
        return result
    except (ValueError, IndexError, KeyError) as error:
        raise CalendarProviderError(502, "Calendar time zone could not be read") from error


def _dates(event: Any, key: str, zone: tzinfo | None) -> dict[datetime, datetime]:
    values = event.get(key, [])
    values = values if isinstance(values, list) else [values]
    result = {}
    for value in values:
        for entry in value.dts:
            instant = calendar_datetime(entry.dt, zone)
            result[instant.astimezone(timezone.utc)] = instant
            if len(result) > _LIMIT:
                raise CalendarProviderError(
                    502, "Calendar recurrence exceeds the availability limit"
                )
    return result


def _starts(event: Any, lower: datetime, upper: datetime, zone: tzinfo | None) -> list[datetime]:
    start = calendar_datetime(getattr(event.get("DTSTART"), "dt", None), zone)
    recurrence = event.get("RRULE")
    if recurrence is None:
        starts = {start.astimezone(timezone.utc): start}
    else:
        if isinstance(recurrence, list) or str(recurrence.get("FREQ", [""])[0]) not in {
            "DAILY",
            "WEEKLY",
            "MONTHLY",
            "YEARLY",
        }:
            raise CalendarProviderError(502, "Calendar recurrence is unsupported for availability")
        try:
            rule = rrulestr(recurrence.to_ical().decode(), dtstart=start)
            starts = {}
            # A nonexistent time before this query can consume a finite COUNT
            # in dateutil. Validate from DTSTART so later valid occurrences
            # cannot silently disappear from a bounded recurrence.
            first = start.astimezone(timezone.utc) if "COUNT" in recurrence else lower
            for value in rule.xafter(first, count=_LIMIT + 1, inc=True):
                if value > upper:
                    break
                if value.astimezone(timezone.utc).astimezone(value.tzinfo).replace(
                    tzinfo=None
                ) != value.replace(tzinfo=None):
                    # dateutil counts nonexistent recurrence times toward COUNT.
                    # Reject that unsupported expansion instead of losing a later
                    # valid occurrence and advertising its interval as free.
                    raise CalendarProviderError(
                        502, "Calendar recurrence crosses a nonexistent local time"
                    )
                starts[value.astimezone(timezone.utc)] = value
                if len(starts) > _LIMIT:
                    raise CalendarProviderError(
                        502, "Calendar recurrence exceeds the availability limit"
                    )
        except (ValueError, TypeError, OverflowError) as error:
            raise CalendarProviderError(502, "Calendar recurrence could not be expanded") from error
    starts.update(_dates(event, "RDATE", zone))
    for excluded in _dates(event, "EXDATE", zone):
        starts.pop(excluded, None)
    return list(starts.values())


def _is_busy(event: Any, master: Any = None) -> bool:
    inherited = master if master is not None else {}
    return (
        str(event.get("STATUS", inherited.get("STATUS", ""))).upper() != "CANCELLED"
        and str(event.get("TRANSP", inherited.get("TRANSP", ""))).upper() != "TRANSPARENT"
    )


def _event_intervals(
    content: Calendar, lower: datetime, upper: datetime, zone: tzinfo | None
) -> list[tuple[datetime, datetime]]:
    events = content.walk("VEVENT")
    masters = [event for event in events if event.get("RECURRENCE-ID") is None]
    if len(masters) != 1:
        raise CalendarProviderError(502, "Calendar recurrence could not be uniquely identified")
    master = masters[0]
    duration = event_duration(master, zone)
    overrides = {}
    for event in events:
        recurrence_id = event.get("RECURRENCE-ID")
        if recurrence_id is not None:
            if recurrence_id.params.get("RANGE"):
                raise CalendarProviderError(
                    502, "Calendar range exceptions are unsupported for availability"
                )
            identity = calendar_datetime(recurrence_id.dt, zone).astimezone(timezone.utc)
            if identity in overrides or str(event.get("UID")) != str(master.get("UID")):
                raise CalendarProviderError(
                    502, "Calendar recurrence could not be uniquely identified"
                )
            overrides[identity] = event
    intervals = []
    if _is_busy(master):
        for start in _starts(master, lower - duration.lookback(), upper, zone):
            if start.astimezone(timezone.utc) not in overrides:
                intervals.append((start, calendar_datetime(duration.end(start), zone)))
    for event in overrides.values():
        if _is_busy(event, master):
            start = calendar_datetime(getattr(event.get("DTSTART"), "dt", None), zone)
            end = event_duration(event, zone, duration).end(start)
            intervals.append((start, calendar_datetime(end, zone)))
    return [
        (start, end)
        for start, end in intervals
        if start.astimezone(timezone.utc) < upper
        and end.astimezone(timezone.utc) > lower
        and end.astimezone(timezone.utc) > start.astimezone(timezone.utc)
    ]


def query_busy_intervals(
    client: CalDAVClient, calendar: dict[str, Any], time_min: str, time_max: str
) -> list[dict[str, str]]:
    lower, upper = (
        datetime.fromisoformat(value.replace("Z", "+00:00")) for value in (time_min, time_max)
    )
    zone = _calendar_zone(calendar)
    items = resources(client, calendar, event_query(time_min=time_min, time_max=time_max))
    intervals = []
    try:
        for _, _, content in items:
            content_zone = zone
            if content_zone is None and content.get("X-WR-TIMEZONE"):
                content_zone = ZoneInfo(str(content["X-WR-TIMEZONE"]))
            intervals.extend(_event_intervals(content, lower, upper, content_zone))
            if len(intervals) > _LIMIT:
                raise CalendarProviderError(502, "Calendar exceeds the availability limit")
    except (ValueError, KeyError, TypeError, AttributeError, OverflowError) as error:
        raise CalendarProviderError(502, "Calendar availability could not be verified") from error
    return [
        {
            "start": start.astimezone(timezone.utc).isoformat(),
            "end": end.astimezone(timezone.utc).isoformat(),
        }
        for start, end in intervals
    ]
