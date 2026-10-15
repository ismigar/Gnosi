"""CalDAV resources retain provider data and use conditional HTTP writes."""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from icalendar import Calendar, Event

from backend.domains.calendar.caldav_attendees import patch_attendees
from backend.domains.calendar.caldav_time import (
    effective_event_end,
    exact_duration_property,
    parse_calendar,
)
from backend.domains.calendar.caldav_transport import (
    CAL,
    DAV,
    CalDAVClient,
    checked_url,
    parse_xml,
    success_props,
)
from backend.domains.calendar.provider_errors import CalendarProviderError


def caldav_datetime(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Missing time zone")
        return parsed.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    except ValueError as error:
        raise CalendarProviderError(422, "A timestamp with a time zone is required") from error


def event_query(*, uid: str | None = None, time_min: str = "", time_max: str = "") -> str:
    condition = (
        '<c:prop-filter name="UID"><c:text-match collation="i;octet">'
        f"{escape(uid)}</c:text-match></c:prop-filter>"
        if uid is not None
        else f'<c:time-range start="{caldav_datetime(time_min)}" '
        f'end="{caldav_datetime(time_max)}"/>'
    )
    return f"""<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR">
<c:comp-filter name="VEVENT">{condition}</c:comp-filter>
</c:comp-filter></c:filter></c:calendar-query>"""


def resources(
    client: CalDAVClient, calendar: dict[str, Any], query: str
) -> list[tuple[str, str, Calendar]]:
    result = client.request(
        "REPORT",
        calendar["url"],
        data=query,
        headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
    )
    root = parse_xml(result.text)
    if root.tag != DAV + "multistatus":
        raise CalendarProviderError(502, "Invalid calendar query response")
    found = []
    for response in root.findall(DAV + "response"):
        retrieved = False
        for prop in success_props(response):
            data = prop.findtext(CAL + "calendar-data")
            if data:
                url = checked_url(
                    calendar["url"], response.findtext(DAV + "href", ""), collection=calendar["url"]
                )
                try:
                    content = parse_calendar(data)
                except ValueError as error:
                    raise CalendarProviderError(502, "Invalid calendar event data") from error
                found.append((url, prop.findtext(DAV + "getetag", ""), content))
                retrieved = True
        if not retrieved:
            raise CalendarProviderError(502, "Calendar event data could not be retrieved")
    return found


def load_resource(
    client: CalDAVClient, calendar: dict[str, Any], uid: str, resource_url: str | None = None
) -> tuple[str, str, Calendar]:
    if resource_url:
        url = checked_url(calendar["url"], resource_url, collection=calendar["url"])
        result = client.request("GET", url)
        try:
            found = [(url, result.headers.get("ETag", ""), parse_calendar(result.content))]
        except ValueError as error:
            raise CalendarProviderError(502, "Invalid calendar event data") from error
    else:
        found = resources(client, calendar, event_query(uid=uid))
    matching = [
        item
        for item in found
        if any(str(event.get("UID")) == uid for event in item[2].walk("VEVENT"))
    ]
    if len(matching) != 1:
        raise CalendarProviderError(
            404 if not matching else 409, "Calendar event could not be uniquely identified"
        )
    return matching[0]


def editable_event(content: Calendar, uid: str) -> Any:
    events = content.walk("VEVENT")
    if len(events) != 1 or str(events[0].get("UID")) != uid:
        raise CalendarProviderError(
            409, "Recurring CalDAV events must be edited in the provider calendar"
        )
    event = events[0]
    if any(event.get(key) for key in ("RRULE", "RDATE", "EXDATE", "RECURRENCE-ID")):
        raise CalendarProviderError(
            409, "Recurring CalDAV events must be edited in the provider calendar"
        )
    return event


def _date_value(value: object, previous: Any = None) -> date | datetime:
    zone = None
    if isinstance(value, dict):
        zone = value.get("timeZone")
        value = value.get("dateTime") or value.get("date")
    if not isinstance(value, str):
        raise CalendarProviderError(422, "Calendar event start and end are required")
    try:
        if "T" not in value:
            return date.fromisoformat(value)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        previous_dt = getattr(previous, "dt", None)
        previous_zone = previous.params.get("TZID") if previous is not None else None
        zone = zone or previous_zone
        if zone:
            target = (
                previous_dt.tzinfo
                if zone == previous_zone
                and isinstance(previous_dt, datetime)
                and previous_dt.tzinfo is not None
                else ZoneInfo(str(zone))
            )
            return (
                parsed.replace(tzinfo=target)
                if parsed.tzinfo is None
                else parsed.astimezone(target)
            )
        if isinstance(previous_dt, datetime) and previous_dt.tzinfo is None:
            # A floating appointment follows the calendar's wall clock. An
            # offset supplied by an editor must not turn it into a UTC event.
            return parsed.replace(tzinfo=None)
        if isinstance(previous_dt, datetime):
            return (
                parsed.replace(tzinfo=previous_dt.tzinfo)
                if parsed.tzinfo is None
                else parsed.astimezone(previous_dt.tzinfo)
            )
        return parsed
    except (ValueError, KeyError) as error:
        raise CalendarProviderError(422, "Invalid calendar event date or time zone") from error


def _replace(event: Any, key: str, value: object) -> None:
    event.pop(key, None)
    event.add(key, value)


def _patch_text(event: Any, key: str, value: str) -> None:
    previous = event.get(key)
    if str(previous or "") == value:
        return
    parameters = dict(previous.params) if previous is not None else {}
    # A changed value no longer matches its alternate representation. Retain
    # language and extension metadata; echoed values keep the whole property.
    parameters.pop("ALTREP", None)
    event.pop(key, None)
    event.add(key, value, parameters=parameters)


def _comparable_time(value: date | datetime) -> datetime:
    if not isinstance(value, datetime):
        return datetime.combine(value, datetime.min.time())
    return value.astimezone(timezone.utc) if value.tzinfo else value


def _same_time(first: date | datetime | None, second: date | datetime | None) -> bool:
    if first is None or second is None:
        return first is second
    return type(first) is type(second) and _comparable_time(first) == _comparable_time(second)


def _patch_dates(event: Any, data: dict[str, Any]) -> None:
    previous_start = event.get("DTSTART")
    start = (
        _date_value(data["start"], previous_start)
        if "start" in data
        else getattr(previous_start, "dt", None)
    )
    end = (
        _date_value(data["end"], event.get("DTEND") or previous_start)
        if "end" in data
        else effective_event_end(event, start)
    )
    if start is None or end is None:
        raise CalendarProviderError(422, "Calendar event start is required")
    implicit = event.get("DTEND") is None and event.get("DURATION") is None
    try:
        valid = type(start) is type(end) and (
            _comparable_time(end) > _comparable_time(start)
            or (
                implicit
                and (previous_start is not None or "end" not in data)
                and _same_time(start, end)
            )
        )
    except TypeError:
        valid = False
    if not valid:
        raise CalendarProviderError(422, "Calendar event must end after its start")
    if not _same_time(start, getattr(previous_start, "dt", None)):
        _replace(event, "DTSTART", start)
    # Keep the original property, parameters and duration representation when
    # an autosave merely echoes unchanged form dates.
    if (previous_start is None and "end" in data) or not _same_time(
        end, effective_event_end(event)
    ):
        if event.get("DURATION") is not None:
            duration = _comparable_time(end) - _comparable_time(start)
            if isinstance(start, datetime):
                event["DURATION"] = exact_duration_property(duration, event["DURATION"])
            else:
                _replace(event, "DURATION", duration)
        else:
            _replace(event, "DTEND", end)


def patch_component(event: Any, data: dict[str, Any]) -> None:
    if data.get("recurrence"):
        raise CalendarProviderError(
            422, "Recurring CalDAV events must be created in the provider calendar"
        )
    for field, key in (
        ("summary", "SUMMARY"),
        ("description", "DESCRIPTION"),
        ("location", "LOCATION"),
    ):
        if field in data:
            _patch_text(event, key, str(data[field] or ""))
    if "start" in data or "end" in data:
        _patch_dates(event, data)
    if "attendees" in data:
        patch_attendees(event, data["attendees"])
    _replace(event, "DTSTAMP", datetime.now(timezone.utc))
    _replace(event, "SEQUENCE", int(event.get("SEQUENCE", 0)) + 1)


def event_resource(event: Any, *, etag: str, resource_url: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": str(event.get("UID", "")),
        "summary": str(event.get("SUMMARY", "")),
        "etag": etag,
        "resource_url": resource_url,
        "provider": "caldav",
    }
    for field, value in (
        ("start", getattr(event.get("DTSTART"), "dt", None)),
        ("end", effective_event_end(event)),
    ):
        if value is not None:
            result[field] = {
                "dateTime" if isinstance(value, datetime) else "date": value.isoformat()
            }
    return result


def _use_utc_for_new_event(event: Any) -> None:
    # New events are non-recurring. UTC preserves their instants without
    # requiring VTIMEZONE or negotiated timezone-by-reference support. Existing
    # resources keep their original representation through patch_component.
    for name in ("DTSTART", "DTEND"):
        value = getattr(event.get(name), "dt", None)
        if isinstance(value, datetime) and value.tzinfo is not None:
            _replace(event, name, value.astimezone(timezone.utc))


def create_event(
    client: CalDAVClient, calendar: dict[str, Any], data: dict[str, Any], stable_id: str | None
) -> dict[str, Any]:
    uid = (
        "gnosi-" + hashlib.sha256(stable_id.encode()).hexdigest()
        if stable_id
        else str(uuid.uuid4())
    )
    url = checked_url(calendar["url"], uid + ".ics", collection=calendar["url"])
    content, event = Calendar(), Event()
    content.add("VERSION", "2.0")
    content.add("PRODID", "-//Gnosi//Calendar//EN")
    event.add("UID", uid)
    patch_component(event, data)
    if event.get("DTSTART") is None:
        raise CalendarProviderError(422, "Calendar event start is required")
    _use_utc_for_new_event(event)
    content.add_component(event)
    try:
        result = client.request(
            "PUT",
            url,
            data=content.to_ical(),
            headers={"If-None-Match": "*", "Content-Type": "text/calendar; charset=utf-8"},
        )
        etag = result.headers.get("ETag", "")
        if not etag:
            try:
                _, etag, _ = load_resource(client, calendar, uid, url)
            except CalendarProviderError as recovery_error:
                recovery_error.outcome_unknown = True
                raise
        return event_resource(event, etag=etag, resource_url=url)
    except CalendarProviderError as error:
        if error.status_code != 409 or stable_id is None:
            raise
        try:
            _, etag, found = load_resource(client, calendar, uid, url)
            return event_resource(editable_event(found, uid), etag=etag, resource_url=url)
        except CalendarProviderError as recovery_error:
            recovery_error.outcome_unknown = True
            raise


def mutate_event(
    client: CalDAVClient,
    calendar: dict[str, Any],
    uid: str,
    data: dict[str, Any] | None,
    *,
    etag: str | None,
    resource_url: str | None,
) -> dict[str, str]:
    if not etag:
        raise CalendarProviderError(428, "Reload the calendar event before changing it")
    url, current_etag, content = load_resource(client, calendar, uid, resource_url)
    event = editable_event(content, uid)
    if not current_etag or current_etag.startswith("W/"):
        raise CalendarProviderError(409, "Calendar server did not supply a strong event version")
    if etag and etag != current_etag:
        raise CalendarProviderError(409, "Calendar event changed; reload before saving")
    headers = {"If-Match": current_etag}
    if data is None:
        client.request("DELETE", url, headers=headers)
        return {"status": "success"}
    patch_component(event, data)
    headers["Content-Type"] = "text/calendar; charset=utf-8"
    result = client.request("PUT", url, data=content.to_ical(), headers=headers)
    # Servers may rewrite iCalendar and omit an ETag on PUT. Re-read the version
    # so a second autosave still protects against external edits.
    new_etag = result.headers.get("ETag", "")
    if not new_etag:
        _, new_etag, _ = load_resource(client, calendar, uid, url)
    return {"status": "success", "etag": new_etag, "resource_url": url}


def busy_intervals(
    client: CalDAVClient, calendar: dict[str, Any], time_min: str, time_max: str
) -> list[dict[str, str]]:
    body = f'''<c:free-busy-query xmlns:c="urn:ietf:params:xml:ns:caldav">
<c:time-range start="{caldav_datetime(time_min)}" end="{caldav_datetime(time_max)}"/>
</c:free-busy-query>'''
    result = client.request(
        "REPORT",
        calendar["url"],
        data=body,
        headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
    )
    try:
        content = Calendar.from_ical(result.content)
        freebusy = content.walk("VFREEBUSY")
        if not freebusy:
            raise ValueError("Missing free/busy component")
        intervals = []
        for component in freebusy:
            periods = component.get("FREEBUSY", [])
            for period in periods if isinstance(periods, list) else [periods]:
                if str(period.params.get("FBTYPE", "BUSY")).upper() == "FREE":
                    continue
                start, end = period.dt
                end = start + end if isinstance(end, timedelta) else end
                if (
                    not isinstance(start, datetime)
                    or not isinstance(end, datetime)
                    or not start.tzinfo
                    or not end.tzinfo
                    or end <= start
                ):
                    raise ValueError("Invalid busy period")
                intervals.append({"start": start.isoformat(), "end": end.isoformat()})
        return intervals
    except (ValueError, TypeError, AttributeError) as error:
        raise CalendarProviderError(502, "Invalid calendar availability response") from error
