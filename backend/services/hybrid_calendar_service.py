"""
Hybrid Calendar Service — queries Google Calendar and CalDAV directly without a vault.

Supported providers:
  - google  → Google Calendar API v3
  - caldav  → any CalDAV server (iCloud, Fastmail, Nextcloud, Radicale…)
"""

import logging
import re
import threading
import time
from datetime import datetime, timezone
from email.header import decode_header as _raw_decode
from typing import Any, Callable

import requests
from defusedxml import ElementTree as ET

from backend.services.integration_manager import integration_manager
from backend.domains.calendar.timing import calendar_phase
from backend.domains.calendar.conference_links import google_join_url, caldav_join_url
from backend.domains.calendar.caldav_transport import CalDAVClient, checked_url
from backend.domains.calendar.caldav_time import effective_event_end, parse_calendar
from backend.domains.calendar.caldav_attendees import display_address
from backend.domains.calendar.provider_errors import CalendarProviderError

log = logging.getLogger(__name__)

# ── Namespaces CalDAV ──────────────────────────────────────────────────────────
_NS = {
    "d": "DAV:",
    "cal": "urn:ietf:params:xml:ns:caldav",
    "cs": "http://calendarserver.org/ns/",
    "oc": "http://owncloud.org/ns",
}
JsonObject = dict[str, Any]
_CALENDAR_LIST_CACHE_TTL_SECONDS = 300
_calendar_list_cache: dict[str, tuple[float, list[JsonObject]]] = {}
_calendar_list_locks: dict[str, threading.Lock] = {}
_calendar_list_cache_lock = threading.Lock()


# ── Helpers ────────────────────────────────────────────────────────────────────


def _get_account(email: str, *, resolve_secrets: bool = True) -> JsonObject | None:
    with calendar_phase("credentials" if resolve_secrets else "integrations"):
        accounts = integration_manager.get_calendar_accounts(email, resolve_secrets=resolve_secrets)
    return next(iter(accounts), None)


def _normalize_dt(val: object) -> str:
    """Converts various datetime formats to ISO string."""
    if not val:
        return ""
    if isinstance(val, datetime):
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
    with calendar_phase("service"):
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


def clear_calendar_list_cache() -> None:
    """Drop provider-list metadata after an integration configuration change."""
    with _calendar_list_cache_lock:
        _calendar_list_cache.clear()


def _cached_calendar_list(
    cache_key: str, loader: Callable[[], list[JsonObject]]
) -> list[JsonObject]:
    """Return one fresh provider list and coalesce concurrent discovery."""

    def fresh_value() -> list[JsonObject] | None:
        cached = _calendar_list_cache.get(cache_key)
        if cached and time.monotonic() < cached[0]:
            return cached[1]
        return None

    with _calendar_list_cache_lock:
        cached = fresh_value()
        if cached is not None:
            return cached
        account_lock = _calendar_list_locks.setdefault(cache_key, threading.Lock())

    with account_lock:
        with _calendar_list_cache_lock:
            cached = fresh_value()
            if cached is not None:
                return cached
        loaded = loader()
        with _calendar_list_cache_lock:
            _calendar_list_cache[cache_key] = (
                time.monotonic() + _CALENDAR_LIST_CACHE_TTL_SECONDS,
                loaded,
            )
        return loaded


def _load_google_calendars(email: str, provider_service: Any) -> list[JsonObject]:
    """Load Google calendar metadata with an already constructed client."""
    try:
        with calendar_phase("http"):
            result = provider_service.calendarList().list().execute()
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


def google_list_calendars(email: str) -> list[JsonObject]:
    """Returns the list of calendars available for a Google account."""

    def load() -> list[JsonObject]:
        provider_service = _google_service(email)
        if not provider_service:
            return []
        return _load_google_calendars(email, provider_service)

    return _cached_calendar_list(f"google:{email}", load)


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

    calendars = _cached_calendar_list(
        f"google:{email}", lambda: _load_google_calendars(email, service)
    )
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
            with calendar_phase("http"):
                batch.execute()
            return events
        except Exception as ex:
            # Some self-hosted Google-compatible endpoints do not implement the
            # batch transport. Preserve compatibility by retrying sequentially.
            log.warning("google_list_events batch %s: %s; retrying sequentially", email, ex)
            events.clear()

    for cal in calendars:
        try:
            with calendar_phase("http"):
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
        "join_url": google_join_url(e),
        "etag": e.get("etag"),
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
    try:
        return CalDAVClient(acc).calendars(email)
    except CalendarProviderError as error:
        log.warning("CalDAV calendar discovery failed: %s", error.detail)
        return []


def caldav_list_events(
    email: str, time_min: str, time_max: str, search: str | None = None,
    calendar_id: str | None = None,
) -> list[JsonObject]:
    from backend.domains.calendar.caldav_resources import event_query

    acc = _get_account(email)
    if not acc:
        return []
    client = CalDAVClient(acc)
    calendars = client.calendars(email)
    if calendar_id:
        calendars = [calendar for calendar in calendars if calendar_id in {calendar["id"], calendar["url"]}]
    events: list[JsonObject] = []
    for calendar in calendars:
        try:
            result = client.request("REPORT", calendar["url"], data=event_query(time_min=time_min, time_max=time_max),
                                    headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"})
            events.extend(_parse_caldav_response(result.text, email, calendar, search))
        except CalendarProviderError as error:
            log.warning("CalDAV event query failed: %s", error.detail)
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
            ical = parse_calendar(cal_data)
            for component in ical.walk():
                if component.name != "VEVENT":
                    continue
                ev = _normalize_caldav_event(component, email, cal)
                ev["etag"] = resp.findtext(".//{DAV:}getetag", "")
                ev["resource_url"] = checked_url(cal["url"], resp.findtext("{DAV:}href", ""), collection=cal["url"])
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


def _caldav_attendees(component: Any, email: str) -> list[JsonObject]:
    values = component.get("ATTENDEE", [])
    values = values if isinstance(values, list) else [values]
    return [{
        "email": display_address(value),
        "name": str(value.params.get("CN", "")),
        "rsvp": {"ACCEPTED": "accepted", "DECLINED": "declined", "TENTATIVE": "tentative"}.get(str(value.params.get("PARTSTAT", "")), "needsAction"),
        "self": str(value).lower() == "mailto:" + email.lower(),
    } for value in values]


def _normalize_caldav_event(component: Any, email: str, cal: JsonObject) -> JsonObject:
    uid = _ical_prop(component, "UID")
    title = _ical_prop(component, "SUMMARY", "(sense títol)")
    start = _ical_prop(component, "DTSTART")
    end = _ical_prop(component, "DTEND") or _ical_prop(component, "DUE") or _normalize_dt(effective_event_end(component))
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
        "join_url": caldav_join_url(component),
        "attendees": _caldav_attendees(component, email),
        "organizer": display_address(_ical_prop(component, "ORGANIZER")),
        "recurrence": rrule_str,
        "recurring_event_id": None,
        "is_read_only": cal.get("access_role") == "reader" or any(component.get(key) for key in ("RRULE", "RDATE", "EXDATE", "RECURRENCE-ID")),
    }


# ── Public dispatcher ──────────────────────────────────────────────────────────


def list_calendars(email: str) -> list[JsonObject]:
    acc = _get_account(email, resolve_secrets=False)
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
    acc = _get_account(email, resolve_secrets=False)
    if not acc:
        return []
    if acc.get("provider") == "google":
        return google_list_events(email, time_min, time_max, search, calendar_id)
    if _is_caldav_account(acc):
        if calendar_id is None:
            return caldav_list_events(email, time_min, time_max, search)
        return caldav_list_events(email, time_min, time_max, search, calendar_id)
    return []


def get_event(email: str, event_id: str, calendar_id: str | None = None) -> JsonObject | None:
    from backend.domains.calendar import provider_operations

    with calendar_phase("integrations"):
        accounts = integration_manager.get_calendar_accounts(email, resolve_secrets=False)
    if not accounts:
        return None
    account = provider_operations.select_account_reference(accounts, calendar_id or "primary")
    if provider_operations.account_provider(account) == "google":
        return google_get_event(email, event_id, calendar_id or "primary")
    return provider_operations.get_caldav_event(email, event_id, calendar_id or "primary")
