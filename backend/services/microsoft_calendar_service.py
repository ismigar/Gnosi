"""Read-only Microsoft Graph calendars using dedicated calendar OAuth accounts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlsplit

import requests

from backend.domains.calendar.provider_errors import CalendarProviderError
from backend.services.integration_manager import integration_manager

GRAPH = "https://graph.microsoft.com/v1.0"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MAX_PAGES = 100
TIMEOUT = 20
JsonObject = dict[str, Any]


def _failure(status: int = 502) -> CalendarProviderError:
    return CalendarProviderError(
        status, "Microsoft calendar could not be read; reconnect the calendar account if necessary"
    )


def _account(email: str) -> JsonObject:
    accounts = integration_manager.get_calendar_accounts(
        email, provider="microsoft", auth_type="oauth2", resolve_secrets=False
    )
    accounts = [a for a in accounts if a.get("type") == "calendar"]
    if len(accounts) != 1:
        raise _failure(409 if accounts else 403)
    account = accounts[0]
    scopes = account.get("granted_scopes", [])
    scopes = scopes.split() if isinstance(scopes, str) else scopes
    if not isinstance(scopes, list) or not any(
        isinstance(scope, str)
        and scope in {"Calendars.Read", "https://graph.microsoft.com/Calendars.Read"}
        for scope in scopes
    ):
        raise _failure(403)
    return dict(integration_manager._resolve_secret_refs(account))


def _refresh(account: JsonObject) -> str:
    if not account.get("client_id") or not account.get("refresh_token") or not account.get("id"):
        raise _failure(403)
    data = {
        "client_id": account["client_id"],
        "refresh_token": account["refresh_token"],
        "grant_type": "refresh_token",
        "scope": "https://graph.microsoft.com/Calendars.Read offline_access",
    }
    if account.get("client_secret"):
        data["client_secret"] = account["client_secret"]
    try:
        response = requests.post(TOKEN_URL, data=data, timeout=TIMEOUT, allow_redirects=False)
        if response.status_code != 200:
            raise _failure(403)
        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise _failure(403)
        update = {"id": account["id"], "token": token}
        if payload.get("refresh_token"):
            if not isinstance(payload["refresh_token"], str):
                raise _failure(502)
            update["refresh_token"] = payload["refresh_token"]
        integration_manager.upsert_calendar_oauth_account(
            {
                **update,
                "email": account["email"],
                "type": "calendar",
                "provider": "microsoft",
            }
        )
        account.update(update)
        return token
    except (requests.RequestException, ValueError, TypeError) as error:
        raise _failure(403) from error


class _Client:
    def __init__(self, email: str) -> None:
        self.account = _account(email)

    def get(self, url: str, *, params: JsonObject | None = None) -> JsonObject:
        token = self.account.get("token") or _refresh(self.account)
        for attempt in range(2):
            try:
                response = requests.get(
                    url,
                    params=params,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Prefer": 'outlook.timezone="UTC"',
                    },
                    timeout=TIMEOUT,
                    allow_redirects=False,
                )
                if response.status_code == 401 and attempt == 0:
                    token = _refresh(self.account)
                    continue
                if response.status_code != 200:
                    raise _failure(
                        {401: 403, 403: 403, 404: 404, 429: 503}.get(response.status_code, 502)
                    )
                payload = response.json()
                if not isinstance(payload, dict):
                    raise _failure()
                return payload
            except (requests.RequestException, ValueError) as error:
                raise _failure() from error
        raise _failure(403)

    def pages(self, path: str, params: JsonObject | None = None) -> list[JsonObject]:
        url = GRAPH + path
        items: list[JsonObject] = []
        seen: set[str] = set()
        for _ in range(MAX_PAGES):
            parsed = urlsplit(url)
            if (
                parsed.scheme != "https"
                or parsed.netloc != "graph.microsoft.com"
                or parsed.path != "/v1.0" + path
                or parsed.fragment
                or url in seen
            ):
                raise _failure()
            seen.add(url)
            payload = self.get(url, params=params)
            values = payload.get("value")
            if not isinstance(values, list) or any(not isinstance(item, dict) for item in values):
                raise _failure()
            items.extend(values)
            next_url = payload.get("@odata.nextLink")
            if next_url is None:
                return items
            if not isinstance(next_url, str) or not next_url:
                raise _failure()
            url, params = next_url, None
        raise _failure()


def _calendar(raw: JsonObject, email: str) -> JsonObject:
    if not isinstance(raw.get("id"), str) or not raw["id"]:
        raise _failure()
    color = raw.get("hexColor")
    return {
        "id": raw["id"],
        "name": raw.get("name") or raw["id"],
        "color": color,
        "access_role": "reader",
        "primary": bool(raw.get("isDefaultCalendar")),
        "account": email,
        "provider": "microsoft",
    }


def _time(raw: JsonObject, all_day: bool) -> str:
    try:
        dt = datetime.fromisoformat(raw["dateTime"].replace("Z", "+00:00"))
        if all_day:
            return dt.date().isoformat()
        if dt.tzinfo is None:
            if raw.get("timeZone") not in {"UTC", "Etc/UTC"}:
                raise _failure()
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise _failure() from error


def _event(raw: JsonObject, email: str, calendar: JsonObject) -> JsonObject:
    if not isinstance(raw.get("id"), str) or not raw["id"]:
        raise _failure()
    all_day = bool(raw.get("isAllDay"))
    organizer = (raw.get("organizer") or {}).get("emailAddress") or {}
    rsvp = {"accepted": "accepted", "declined": "declined", "tentativelyAccepted": "tentative"}
    return {
        "id": raw["id"],
        "calendar_id": calendar["id"],
        "calendar_name": calendar["name"],
        "title": raw.get("subject") or "",
        "start": _time(raw.get("start", {}), all_day),
        "end": _time(raw.get("end", {}), all_day),
        "all_day": all_day,
        "location": (raw.get("location") or {}).get("displayName") or "",
        "description": raw.get("bodyPreview") or "",
        "source": f"{email} - {calendar['name']}",
        "account": email,
        "provider": "microsoft",
        "color": calendar.get("color"),
        "status": "cancelled" if raw.get("isCancelled") else "confirmed",
        "link": raw.get("webLink") or "",
        "join_url": (raw.get("onlineMeeting") or {}).get("joinUrl") or "",
        "etag": raw.get("@odata.etag"),
        "recurring_event_id": raw.get("seriesMasterId"),
        "is_read_only": True,
        "organizer": organizer.get("address") or "",
        "attendees": [
            {
                "email": (a.get("emailAddress") or {}).get("address") or "",
                "name": (a.get("emailAddress") or {}).get("name") or "",
                "rsvp": rsvp.get(str((a.get("status") or {}).get("response") or ""), "needsAction"),
                "self": ((a.get("emailAddress") or {}).get("address") or "").lower()
                == email.lower(),
            }
            for a in raw.get("attendees", [])
        ],
    }


def list_calendars(email: str) -> list[JsonObject]:
    return [_calendar(raw, email) for raw in _Client(email).pages("/me/calendars")]


def _selected(client: _Client, email: str, calendar_id: str | None) -> list[JsonObject]:
    calendars = [_calendar(raw, email) for raw in client.pages("/me/calendars")]
    if calendar_id:
        calendars = [
            cal
            for cal in calendars
            if cal["id"] == calendar_id or (calendar_id == "primary" and cal["primary"])
        ]
        if not calendars:
            raise _failure(404)
    return calendars


def list_events(
    email: str,
    time_min: str,
    time_max: str,
    search: str | None = None,
    calendar_id: str | None = None,
) -> list[JsonObject]:
    try:
        start, end = [
            datetime.fromisoformat(value.replace("Z", "+00:00")) for value in (time_min, time_max)
        ]
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError()
    except (ValueError, TypeError, AttributeError) as error:
        raise CalendarProviderError(
            400, "Calendar query requires an ordered, timezone-aware date range"
        ) from error
    client = _Client(email)
    events = []
    for calendar in _selected(client, email, calendar_id):
        path = "/me/calendars/" + quote(calendar["id"], safe="") + "/calendarView"
        for raw in client.pages(
            path, {"startDateTime": time_min, "endDateTime": time_max, "$top": 500}
        ):
            event = _event(raw, email, calendar)
            if (
                not search
                or search.casefold() in (event["title"] + " " + event["description"]).casefold()
            ):
                events.append(event)
    return events


def get_event(email: str, event_id: str, calendar_id: str = "primary") -> JsonObject:
    client = _Client(email)
    calendar = _selected(client, email, calendar_id)[0]
    path = "/me/calendars/" + quote(calendar["id"], safe="") + "/events/" + quote(event_id, safe="")
    return _event(client.get(GRAPH + path), email, calendar)
