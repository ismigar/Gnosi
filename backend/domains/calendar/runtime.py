"""Provider-neutral calendar loading, caching, and Vault event projection."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import time
from typing import Protocol

from icalendar import Calendar, Event

from backend.services.calendar_event_aggregation import (
    CalendarAccountCalendars,
    CalendarAccountEvents,
)

JsonObject = dict[str, object]

EVENTS_CACHE: dict[str, tuple[float, list[JsonObject]]] = {}
CALENDARS_CACHE: dict[str, tuple[float, list[JsonObject]]] = {}
EVENTS_CACHE_TTL = 300
CALENDARS_CACHE_TTL = 300


class PageRecord(Protocol):
    id: object
    metadata: dict[object, object] | None
    path: object
    title: str


def default_range() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    return (
        (now - timedelta(days=30)).isoformat(),
        (now + timedelta(days=90)).isoformat(),
    )


def account_emails(integrations: Mapping[str, object], email: str | None) -> list[str]:
    if email:
        return [email]
    raw_accounts = integrations.get("calendars", [])
    raw_emails = integrations.get("emails", [])
    accounts = [
        account
        for group in (raw_accounts, raw_emails)
        if isinstance(group, list)
        for account in group
        if isinstance(account, dict)
    ]
    return list(
        {
            identity
            for account in accounts
            if isinstance(identity := account.get("email") or account.get("username"), str)
        }
    )


def load_calendars(
    email_list: Sequence[str],
    fetch_lists: Callable[[Sequence[str]], list[CalendarAccountCalendars]],
) -> tuple[list[JsonObject], list[str]]:
    calendars_by_account: dict[str, list[JsonObject]] = {}
    pending_accounts: list[str] = []
    now = time.time()
    for email in email_list:
        cached = CALENDARS_CACHE.get(email)
        if cached and now < cached[0]:
            calendars_by_account[email] = cached[1]
        else:
            pending_accounts.append(email)

    auth_errors: list[str] = []
    for result in fetch_lists(pending_accounts):
        if result.auth_expired:
            auth_errors.append(result.email)
        elif result.succeeded:
            calendars = [dict(calendar) for calendar in result.calendars]
            CALENDARS_CACHE[result.email] = (
                time.time() + CALENDARS_CACHE_TTL,
                calendars,
            )
            calendars_by_account[result.email] = calendars

    return (
        [
            calendar
            for account_email in email_list
            for calendar in calendars_by_account.get(account_email, [])
        ],
        auth_errors,
    )


def collect_events(
    email_list: Sequence[str],
    time_min: str,
    time_max: str,
    search: str | None,
    calendar_id: str | None,
    include_vault: bool,
    fetch_accounts: Callable[
        [Sequence[tuple[str, str]], str, str, str | None, str | None],
        list[CalendarAccountEvents],
    ],
    hidden_ids_loader: Callable[[], set[str]],
    vault_events_loader: Callable[[str, str, str | None], list[JsonObject]],
) -> list[JsonObject]:
    events: list[JsonObject] = []
    pending: list[tuple[str, str]] = []
    now = time.time()
    for email in email_list:
        cache_key = f"{email}|{time_min}|{time_max}|{search}|{calendar_id}"
        cached = EVENTS_CACHE.get(cache_key)
        if cached and now < cached[0]:
            events.extend(cached[1])
        else:
            pending.append((email, cache_key))

    for result in fetch_accounts(pending, time_min, time_max, search, calendar_id):
        if result.succeeded:
            loaded = [dict(event) for event in result.events]
            EVENTS_CACHE[result.cache_key] = (time.time() + EVENTS_CACHE_TTL, loaded)
            events.extend(loaded)

    hidden_ids = hidden_ids_loader()
    if hidden_ids:
        events = [event for event in events if event.get("id") not in hidden_ids]
    if include_vault:
        vault_events = vault_events_loader(time_min, time_max, search)
        if hidden_ids:
            vault_events = [event for event in vault_events if event.get("id") not in hidden_ids]
        events.extend(vault_events)
    return events


def project_vault_events(
    time_min: str,
    time_max: str,
    search: str | None,
    pages_snapshot: Callable[..., list[PageRecord]],
) -> list[JsonObject]:
    query = (search or "").lower()
    low, high = time_min[:10], time_max[:10]
    events: list[JsonObject] = []
    for page in pages_snapshot(only_calendar=False):
        metadata = page.metadata or {}
        date_value = metadata.get("date")
        if not date_value:
            continue
        path = str(page.path or "")
        if "Calendar/External" in path:
            continue
        source = metadata.get("source", "Gnosi")
        if source and source not in ("Gnosi", "Gnosi Vault") and "External" in path:
            continue
        date = str(date_value)
        if date < low or date > high:
            continue
        title = str(metadata.get("title") or page.title)
        description = str(metadata.get("description") or "")
        if query and query not in title.lower() and query not in description.lower():
            continue
        events.append(
            {
                "id": metadata.get("id") or page.id,
                "vault_path": path,
                "calendar_id": "gnosi",
                "calendar_name": "Gnosi",
                "title": title,
                "start": date,
                "end": str(metadata.get("end_date") or ""),
                "all_day": bool(metadata.get("all_day", "T" not in date)),
                "location": metadata.get("location", ""),
                "description": description[:500],
                "source": source or "Gnosi",
                "account": "",
                "provider": "vault",
                "color": None,
                "status": "confirmed",
                "link": "",
                "recurrence": metadata.get("rrule"),
                "recurring_event_id": None,
                "is_read_only": False,
            }
        )
    return events


def safe_calendar_path(
    vault_path: object, active_vault_loader: Callable[[], Path | None]
) -> Path | None:
    if not vault_path:
        return None
    try:
        base = active_vault_loader()
        if base is None:
            return None
        calendar_root = base / "Calendar"
        calendar_root.mkdir(parents=True, exist_ok=True)
        root = calendar_root.resolve()
        if not isinstance(vault_path, (str, os.PathLike)):
            return None
        candidate = Path(vault_path).resolve()
    except (OSError, RuntimeError, TypeError, ValueError):
        return None
    return candidate if candidate == root or root in candidate.parents else None


def build_ics(events: Sequence[JsonObject]) -> bytes:
    """Serialize normalized local events to an iCalendar feed."""
    calendar = Calendar()
    calendar.add("prodid", "-//Gnosi PIM//ismaelgarcia.net//")
    calendar.add("version", "2.0")
    for event in events:
        try:
            component = Event()
            component.add("summary", event["title"])
            start = event["start"]
            if start:
                if not isinstance(start, str):
                    raise TypeError("event start must be text")
                component.add("dtstart", datetime.fromisoformat(start.replace("Z", "+00:00")))
            end = event.get("end")
            if end:
                if not isinstance(end, str):
                    raise TypeError("event end must be text")
                component.add("dtend", datetime.fromisoformat(end.replace("Z", "+00:00")))
            if event.get("description"):
                component.add("description", event["description"])
            event_id = event["id"]
            if not isinstance(event_id, str):
                raise TypeError("event id must be text")
            component.add("uid", event_id + "@gnosi.local")
            calendar.add_component(component)
        except Exception:
            continue
    return bytes(calendar.to_ical())


def find_attendees(
    accounts: object,
    query: str,
    list_contacts: Callable[[str], list[object]],
    parse_contact: Callable[[object], dict[str, object]],
    on_error: Callable[[Exception], None],
) -> list[dict[str, str]]:
    """Search at most two configured contact accounts for attendee suggestions."""
    if not isinstance(accounts, list):
        return []
    normalized_query = query.lower().strip()
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for account in accounts[:2]:
        if not isinstance(account, dict) or not isinstance(account.get("email"), str):
            continue
        email = account["email"]
        try:
            for contact in list_contacts(email):
                parsed = parse_contact(contact)
                name_value = parsed.get("name", "")
                address_value = parsed.get("email", "")
                name = name_value if isinstance(name_value, str) else str(name_value)
                address = address_value if isinstance(address_value, str) else ""
                if not address or address in seen:
                    continue
                if normalized_query not in address.lower() and normalized_query not in name.lower():
                    continue
                seen.add(address)
                results.append({"email": address, "name": name})
                if len(results) >= 8:
                    return results
        except Exception as error:
            on_error(error)
    return results
