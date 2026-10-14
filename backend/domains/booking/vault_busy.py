"""Strict local calendar projection, including long and recurring events."""

from collections.abc import Iterable, Iterator, Mapping
from datetime import date, datetime, time, timedelta
from typing import Protocol, cast
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr

from backend.domains.booking.availability import UTC, BusyInterval
from backend.services.unified_dates import normalize_date


class CalendarPage(Protocol):
    metadata: dict[str, object]
    path: object


def _is_real_time(value: datetime) -> bool:
    return value.astimezone(UTC).astimezone(value.tzinfo).replace(tzinfo=None) == value.replace(
        tzinfo=None
    )


def _moment(value: object, zone: ZoneInfo, clock: object = None) -> datetime:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        result = datetime.combine(value, time.min)
    else:
        text = str(value)
        if len(text) == 10 and clock:
            text = f"{text}T{clock}"
        result = datetime.fromisoformat(text.replace("Z", "+00:00"))
    result = result.replace(tzinfo=zone) if result.tzinfo is None else result
    if not _is_real_time(result):
        raise ValueError("Local calendar contains a nonexistent time")
    return result


def _exclusions(metadata: Mapping[str, object], zone: ZoneInfo, embedded: list[str]) -> set[str]:
    raw = metadata.get("exdates") or []
    values = raw.split(",") if isinstance(raw, str) else raw
    if not isinstance(values, list):
        raise ValueError("Unsupported local recurrence exclusions")
    result: set[str] = set()
    for value in [*values, *embedded]:
        text = str(value).strip()
        if len(text) == 10:
            result.add(text)
        else:
            result.add(_moment(text, zone).astimezone(UTC).isoformat())
    return result


def _boundaries(
    metadata: Mapping[str, object], zone: ZoneInfo
) -> tuple[datetime, datetime, bool] | None:
    raw = (
        metadata.get("date")
        or metadata.get("data")
        or metadata.get("start_time")
        or metadata.get("due_date")
    )
    normalized = normalize_date(raw)
    raw_start = str(normalized["start"])
    if not raw_start:
        # Planning periods whose start is still pending have no calendar event.
        return None
    explicit_time = raw.get("withTime") if isinstance(raw, dict) else None
    all_day = (
        not explicit_time
        if isinstance(explicit_time, bool)
        else "T" not in raw_start or bool(metadata.get("all_day"))
    )
    if all_day:
        raw_start = raw_start.partition("T")[0]
    start = _moment(raw_start, zone)
    period_end = str(normalized["end"]) if normalized["kind"] == "period" else ""
    raw_end = period_end or metadata.get("end_date") or metadata.get("end_time")
    if raw_end:
        end_text = str(normalize_date(raw_end)["start"])
        if len(end_text) == 5 and ":" in end_text:
            end_text = f"{start.date().isoformat()}T{end_text}"
        if all_day:
            end_text = end_text.partition("T")[0]
        end = _moment(end_text, zone)
        if all_day and not metadata.get("_end_exclusive"):
            end += timedelta(days=1)
    else:
        end = (
            start + timedelta(days=1)
            if all_day
            else (start.astimezone(UTC) + timedelta(minutes=30)).astimezone(start.tzinfo)
        )
    if not _is_real_time(end) or end.astimezone(UTC) <= start.astimezone(UTC):
        raise ValueError("Local calendar contains an invalid event interval")
    return start, end, all_day


def _recurrence_starts(
    recurrence: str, start: datetime, low: datetime, high: datetime
) -> Iterator[datetime]:
    parts = recurrence.split(";")
    counts = [part[6:] for part in parts if part.startswith("COUNT=")]
    limit = int(counts[0]) if counts else None
    if len(counts) > 1 or (
        limit is not None and (limit < 1 or any(part.startswith("UNTIL=") for part in parts))
    ):
        raise ValueError("Invalid local recurrence count")
    # dateutil counts nonexistent wall times. Remove COUNT and apply it only
    # to real occurrences, including those before the queried window. EXDATE
    # is applied later: excluded real occurrences still consume COUNT.
    rule = rrulestr(
        ";".join(part for part in parts if not part.startswith("COUNT=")), dtstart=start
    )
    first = start.astimezone(UTC) if limit is not None else low
    valid_count = 0
    for visited, occurrence in enumerate(rule.xafter(first, inc=True), 1):
        if occurrence >= high:
            break
        if visited > 3000:
            raise ValueError("Local recurrence exceeds the availability limit")
        if not _is_real_time(occurrence):
            continue
        valid_count += 1
        if occurrence >= low:
            yield occurrence
        if limit is not None and valid_count >= limit:
            break


def _event_intervals(
    metadata: Mapping[str, object], low: datetime, high: datetime, zone: ZoneInfo
) -> list[BusyInterval]:
    boundaries = _boundaries(metadata, zone)
    if boundaries is None:
        return []
    start, end, all_day = boundaries
    duration = end - start if all_day else end.astimezone(UTC) - start.astimezone(UTC)
    recurrence = metadata.get("date_rrule") or metadata.get("rrule") or metadata.get("recurrence")
    if not recurrence:
        return [(start.astimezone(UTC), end.astimezone(UTC))] if start < high and end > low else []
    if not isinstance(recurrence, str):
        raise ValueError("Unsupported local recurrence")
    parts = recurrence.split(";")
    frequency = next((part.partition("=")[2] for part in parts if part.startswith("FREQ=")), "")
    if frequency not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"} or any(
        part.startswith(("BYSECOND=", "BYMINUTE=", "BYHOUR=")) for part in parts
    ):
        raise ValueError("Unsupported high-frequency local recurrence")
    embedded = [
        value for part in parts if part.startswith("EXDATE=") for value in part[7:].split(",")
    ]
    recurrence = ";".join(part for part in parts if not part.startswith("EXDATE="))
    excluded = _exclusions(metadata, zone, embedded)
    output: list[BusyInterval] = []
    # Nominal all-day spans can cross an offset change. Two days bound the
    # difference between valid UTC offsets and keep long overlaps in scope.
    lookback = duration + (timedelta(days=2) if all_day else timedelta())
    for occurrence in _recurrence_starts(recurrence, start, low - lookback, high):
        instant = occurrence.astimezone(UTC)
        finish = occurrence + duration if all_day else instant + duration
        if not _is_real_time(finish):
            raise ValueError("Local recurrence ends at a nonexistent time")
        if (
            finish > low
            and instant.isoformat() not in excluded
            and occurrence.date().isoformat() not in excluded
        ):
            output.append((instant, finish.astimezone(UTC)))
    return output


def project_busy(
    pages: Iterable[CalendarPage], low: datetime, high: datetime, zone: ZoneInfo
) -> list[BusyInterval]:
    busy: list[BusyInterval] = []
    for page in pages:
        metadata = page.metadata or {}
        if "Calendar/External" in str(page.path):
            continue
        if metadata.get("status") == "cancelled" or metadata.get("transparency") == "transparent":
            continue
        busy.extend(_event_intervals(metadata, low, high, zone))
    return busy


def load_vault_busy(low: datetime, high: datetime, zone: ZoneInfo) -> list[BusyInterval]:
    from backend.api.vault_routes import _get_pages_snapshot

    pages = cast(Iterable[CalendarPage], _get_pages_snapshot(only_calendar=False))
    return project_busy(pages, low, high, zone)
