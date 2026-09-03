"""
Hybrid Calendar Service — queries Google Calendar and CalDAV directly without a vault.

Supported providers:
  - google  → Google Calendar API v3
  - caldav  → any CalDAV server (iCloud, Fastmail, Nextcloud, Radicale…)
"""

import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.header import decode_header as _raw_decode
from typing import Any

import requests

from backend.services.integration_manager import integration_manager

log = logging.getLogger(__name__)

# ── Namespaces CalDAV ──────────────────────────────────────────────────────────
_NS = {
    "d": "DAV:",
    "cal": "urn:ietf:params:xml:ns:caldav",
    "cs": "http://calendarserver.org/ns/",
    "oc": "http://owncloud.org/ns",
}
JsonObject = dict[str, Any]


# ── Helpers ────────────────────────────────────────────────────────────────────


def _get_account(email: str) -> JsonObject | None:
    raw_accounts: list[object] = []
    for section in ("calendars", "emails"):
        values = integration_manager.get_raw(section)
        if isinstance(values, list):
            raw_accounts.extend(values)
    return next(
        (
            account
            for account in raw_accounts
            if isinstance(account, dict)
            and (account.get("email") or account.get("username")) == email
        ),
        None,
    )


def _normalize_dt(val: object) -> str:
    """Converts various datetime formats to ISO string."""
    if not val:
        return ""
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.isoformat()
    s = str(val)
    # DATE-only (YYYYMMDD)
    if re.match(r"^\d{8}$", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    # DATETIME compact (YYYYMMDDTHHmmss)
    if re.match(r"^\d{8}T\d{6}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[9:11]}:{s[11:13]}:{s[13:15]}"
    return s


def _ical_prop(component: Any, name: str, default: str = "") -> str:
    try:
        val = component.get(name)
        if val is None:
            return default
        if hasattr(val, "dt"):
            return _normalize_dt(val.dt)
        return str(val)
    except Exception:
        return default


# ── Google Calendar ────────────────────────────────────────────────────────────


def _google_service(email: str) -> Any:
    from backend.services.google_calendar_service import get_google_calendar_service

    return get_google_calendar_service(email)


class GoogleAuthExpired(Exception):
    """The Google refresh token has expired or been revoked (invalid_grant).

    It propagates up to the route so the UI can request reconnection instead of
    silently showing an empty list. `email` indicates the affected account.

    """

    def __init__(self, email: str = "") -> None:
        self.email = email
        super().__init__(email)


def google_list_calendars(email: str) -> list[JsonObject]:
    """Returns the list of calendars available for a Google account."""
    service = _google_service(email)
    if not service:
        return []
    try:
        result = service.calendarList().list().execute()
        return [
            {
                "id": c["id"],
                "name": c.get("summary", c["id"]),
                "color": c.get("backgroundColor"),
                "access_role": c.get("accessRole", "reader"),
                "primary": c.get("primary", False),
                "account": email,
                "provider": "google",
            }
            for c in result.get("items", [])
        ]
    except Exception as e:
        log.error(f"google_list_calendars {email}: {e}")
        if "invalid_grant" in str(e).lower() or "expired or revoked" in str(e).lower():
            raise GoogleAuthExpired(email)
        return []


def google_list_events(
    email: str,
    time_min: str,
    time_max: str,
    search: str | None = None,
    calendar_id: str | None = None,
) -> list[JsonObject]:
    """Queries all calendars (or one specific one) and returns normalized events."""
    service = _google_service(email)
    if not service:
        return []

    calendars = google_list_calendars(email)
    if calendar_id:
        calendars = [c for c in calendars if c["id"] == calendar_id]

    def request_for(cal: JsonObject) -> Any:
        kwargs = dict(
            calendarId=cal["id"],
            timeMin=time_min,
            timeMax=time_max,
            maxResults=500,
            singleEvents=True,
            orderBy="startTime",
        )
        if search:
            kwargs["q"] = search
        return service.events().list(**kwargs)

    events: list[JsonObject] = []
    if len(calendars) > 1 and hasattr(service, "new_batch_http_request"):
        calendars_by_request = {str(index): cal for index, cal in enumerate(calendars)}

        def collect_batch_result(
            request_id: str, response: JsonObject | None, exception: Exception | None
        ) -> None:
            cal = calendars_by_request[request_id]
            if exception is not None:
                log.warning(
                    "google_list_events calendar=%s %s: %s",
                    cal["id"],
                    email,
                    exception,
                )
                return
            for event in (response or {}).get("items", []):
                events.append(_normalize_google_event(event, email, cal))

        try:
            batch = service.new_batch_http_request(callback=collect_batch_result)
            for request_id, cal in calendars_by_request.items():
                batch.add(request_for(cal), request_id=request_id)
            batch.execute()
            return events
        except Exception as ex:
            # Some self-hosted Google-compatible endpoints do not implement the
            # batch transport. Preserve compatibility by retrying sequentially.
            log.warning("google_list_events batch %s: %s; retrying sequentially", email, ex)
            events.clear()

    for cal in calendars:
        try:
            result = request_for(cal).execute()
            for e in result.get("items", []):
                events.append(_normalize_google_event(e, email, cal))
        except Exception as ex:
            log.warning(f"google_list_events calendar={cal['id']} {email}: {ex}")

    return events


def google_get_event(email: str, event_id: str, calendar_id: str = "primary") -> JsonObject | None:
    service = _google_service(email)
    if not service:
        return None
    try:
        e = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        cal_info = {
            "id": calendar_id,
            "name": calendar_id,
            "color": None,
            "account": email,
            "provider": "google",
        }
        return _normalize_google_event(e, email, cal_info)
    except Exception as ex:
        log.error(f"google_get_event {event_id}: {ex}")
        return None


def _normalize_google_event(e: JsonObject, email: str, cal: JsonObject) -> JsonObject:
    start = e.get("start", {})
    end = e.get("end", {})
    all_day = "date" in start and "dateTime" not in start
    source = f"{email} - {cal['name']}" if cal.get("name") and cal["name"] != email else email
    return {
        "id": e["id"],
        "calendar_id": cal["id"],
        "calendar_name": cal.get("name", ""),
        "title": e.get("summary", "(sense títol)"),
        "start": start.get("dateTime") or start.get("date", ""),
        "end": end.get("dateTime") or end.get("date", ""),
        "all_day": all_day,
        "location": e.get("location", ""),
        "description": e.get("description", ""),
        "source": source,
        "account": email,
        "provider": "google",
        "color": cal.get("color"),
        "status": e.get("status", "confirmed"),
        "link": e.get("htmlLink", ""),
        "recurrence": e.get("recurrence"),
        "recurring_event_id": e.get("recurringEventId"),
        "event_type": e.get("eventType", "default"),
        "birthday_properties": e.get("birthdayProperties"),
        "is_read_only": cal.get("access_role") == "reader",
        "attendees": [
            {
                "email": a.get("email", ""),
                "name": a.get("displayName", ""),
                "rsvp": a.get("responseStatus", "needsAction"),
                "self": a.get("self", False),
                "organizer": a.get("organizer", False),
            }
            for a in e.get("attendees", [])
        ],
        "organizer": e.get("organizer", {}).get("email", ""),
    }


# ── CalDAV ─────────────────────────────────────────────────────────────────────


def _caldav_session(acc: JsonObject) -> requests.Session:
    s = requests.Session()
    s.auth = (acc.get("username") or acc.get("email", ""), acc.get("password", ""))
    s.headers["Content-Type"] = "application/xml; charset=utf-8"
    s.headers["Depth"] = "1"
    return s


def _caldav_base_url(acc: JsonObject) -> str:
    url = (acc.get("caldav_url") or acc.get("server_url") or "").rstrip("/")
    email = acc.get("email") or acc.get("username") or ""
    if not url and "icloud.com" in email:
        url = "https://caldav.icloud.com"
    return url


def _is_caldav_account(acc: JsonObject) -> bool:
    return (
        acc.get("provider") in ("caldav", "manual")
        or bool(acc.get("caldav_url"))
        or bool(acc.get("server_url"))
    )


def caldav_list_calendars(email: str) -> list[JsonObject]:
    acc = _get_account(email)
    if not acc:
        return []
    base_url = _caldav_base_url(acc)
    if not base_url:
        return []

    session = _caldav_session(acc)
    # PROPFIND to discover the calendar collections
    body = """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cal:calendar-description/>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>"""
    try:
        r = session.request(
            "PROPFIND", base_url + "/", data=body, headers={"Depth": "1"}, timeout=15
        )
        r.raise_for_status()
    except Exception as ex:
        log.error(f"caldav_list_calendars {email}: {ex}")
        return []

    calendars: list[JsonObject] = []
    try:
        root = ET.fromstring(r.text)
        for resp in root.findall(".//{DAV:}response"):
            href = resp.findtext("{DAV:}href", "")
            restype = resp.find(".//{DAV:}resourcetype")
            is_cal = (
                restype is not None
                and restype.find("{urn:ietf:params:xml:ns:caldav}calendar") is not None
            )
            if not is_cal:
                continue
            # Last NON-empty segment of the href (calendar id): robust to an href without a trailing
            # slash or without slashes. Previously `href.split("/")[-2]` raised an IndexError with an href
            # without enough slashes and, since the except below swallows the rest, it aborted the ENTIRE
            # from a calendar list; also `[-2]` (assuming a trailing slash) took the parent segment
            # if there wasn't one.
            _segs = [s for s in href.split("/") if s]
            name = resp.findtext(".//{DAV:}displayname") or (_segs[-1] if _segs else "") or href
            calendars.append(
                {
                    "id": href,
                    "name": name,
                    "color": None,
                    "account": email,
                    "provider": "caldav",
                    "url": base_url.rstrip("/") + "/" + href.lstrip("/")
                    if not href.startswith("http")
                    else href,
                }
            )
    except Exception as ex:
        log.error(f"caldav_list_calendars parse {email}: {ex}")

    return calendars


def caldav_list_events(
    email: str,
    time_min: str,
    time_max: str,
    search: str | None = None,
) -> list[JsonObject]:
    acc = _get_account(email)
    if not acc:
        return []

    calendars = caldav_list_calendars(email)
    session = _caldav_session(acc)
    events: list[JsonObject] = []

    for cal in calendars:
        cal_url = cal["url"]
        body = f"""<?xml version="1.0" encoding="utf-8"?>
<cal:calendar-query xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <cal:calendar-data/>
  </d:prop>
  <cal:filter>
    <cal:comp-filter name="VCALENDAR">
      <cal:comp-filter name="VEVENT">
        <cal:time-range start="{_to_caldav_dt(time_min)}" end="{_to_caldav_dt(time_max)}"/>
      </cal:comp-filter>
    </cal:comp-filter>
  </cal:filter>
</cal:calendar-query>"""
        try:
            r = session.request("REPORT", cal_url, data=body, headers={"Depth": "1"}, timeout=20)
            r.raise_for_status()
            events.extend(_parse_caldav_response(r.text, email, cal, search))
        except Exception as ex:
            log.warning(f"caldav_list_events calendar={cal_url}: {ex}")

    return events


def _to_caldav_dt(iso: str) -> str:
    """Converts ISO8601 to CalDAV format (YYYYMMDDTHHmmssZ)."""
    if not iso:
        return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    except Exception:
        return iso


def _parse_caldav_response(
    xml_text: str,
    email: str,
    cal: JsonObject,
    search: str | None,
) -> list[JsonObject]:
    from icalendar import Calendar as iCal

    events: list[JsonObject] = []
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return events

    q = (search or "").lower()

    for resp in root.findall(".//{DAV:}response"):
        cal_data = resp.findtext(".//{urn:ietf:params:xml:ns:caldav}calendar-data")
        if not cal_data:
            continue
        try:
            ical = iCal.from_ical(cal_data)
            for component in ical.walk():
                if component.name != "VEVENT":
                    continue
                ev = _normalize_caldav_event(component, email, cal)
                if (
                    q
                    and q not in ev["title"].lower()
                    and q not in ev.get("description", "").lower()
                ):
                    continue
                events.append(ev)
        except Exception as ex:
            log.debug(f"caldav parse component: {ex}")

    return events


def _normalize_caldav_event(component: Any, email: str, cal: JsonObject) -> JsonObject:
    uid = _ical_prop(component, "UID")
    title = _ical_prop(component, "SUMMARY", "(sense títol)")
    start = _ical_prop(component, "DTSTART")
    end = _ical_prop(component, "DTEND") or _ical_prop(component, "DUE")
    all_day = "T" not in start if start else False
    source = f"{email} - {cal['name']}" if cal.get("name") and cal["name"] != email else email
    rrule_obj = component.get("RRULE")
    rrule_str = None
    if rrule_obj:
        try:
            rrule_str = "RRULE:" + rrule_obj.to_ical().decode()
        except Exception:
            rrule_str = str(rrule_obj)

    return {
        "id": uid,
        "calendar_id": cal["id"],
        "calendar_name": cal.get("name", ""),
        "title": title,
        "start": start,
        "end": end,
        "all_day": all_day,
        "location": _ical_prop(component, "LOCATION"),
        "description": _ical_prop(component, "DESCRIPTION"),
        "source": source,
        "account": email,
        "provider": "caldav",
        "color": cal.get("color"),
        "status": _ical_prop(component, "STATUS", "confirmed").lower(),
        "link": _ical_prop(component, "URL"),
        "recurrence": rrule_str,
        "recurring_event_id": None,
        "is_read_only": False,
    }


# ── Public dispatcher ──────────────────────────────────────────────────────────


def list_calendars(email: str) -> list[JsonObject]:
    acc = _get_account(email)
    if not acc:
        return []
    if acc.get("provider") == "google":
        return google_list_calendars(email)
    if _is_caldav_account(acc):
        return caldav_list_calendars(email)
    return []


def list_events(
    email: str,
    time_min: str,
    time_max: str,
    search: str | None = None,
    calendar_id: str | None = None,
) -> list[JsonObject]:
    acc = _get_account(email)
    if not acc:
        return []
    if acc.get("provider") == "google":
        return google_list_events(email, time_min, time_max, search, calendar_id)
    if _is_caldav_account(acc):
        return caldav_list_events(email, time_min, time_max, search)
    return []


def get_event(email: str, event_id: str, calendar_id: str | None = None) -> JsonObject | None:
    acc = _get_account(email)
    if not acc:
        return None
    if acc.get("provider") == "google":
        return google_get_event(email, event_id, calendar_id or "primary")
    return None
