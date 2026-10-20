"""Strict provider operations shared by private calendar editing and public booking."""

from __future__ import annotations

import hashlib
from typing import Any

from backend.domains.calendar import caldav_resources
from backend.domains.calendar.caldav_transport import CalDAVClient
from backend.domains.calendar.provider_errors import CalendarProviderError
from backend.services.integration_manager import integration_manager


def select_account_reference(
    accounts: list[dict[str, Any]], calendar_id: str, provider: str | None = None
) -> dict[str, Any]:
    """Select provider metadata without unlocking credentials."""
    if provider is not None:
        if not isinstance(provider, str) or provider not in {"google", "caldav"}:
            raise CalendarProviderError(400, "Calendar provider is unsupported")
        accounts = [account for account in accounts if account_provider(account) == provider]
    if len(accounts) > 1 and provider is None:
        likely = "caldav" if calendar_id.startswith(("/", "https://", "http://")) else "google"
        accounts = [account for account in accounts if account_provider(account) == likely]
    if len(accounts) != 1:
        raise CalendarProviderError(
            404 if not accounts else 409, "Calendar account is unavailable or ambiguous"
        )
    return dict(accounts[0])


def configured_account(email: str, calendar_id: str, provider: str | None = None) -> dict[str, Any]:
    account = select_account_reference(
        integration_manager.get_calendar_accounts(email, resolve_secrets=False),
        calendar_id,
        provider,
    )
    # Resolve only the selected account. Do not expose secrets in provider errors.
    return dict(integration_manager._resolve_secret_refs(account))


def account_provider(account: dict[str, Any]) -> str:
    if account.get("provider") == "google":
        return "google"
    if (
        account.get("provider") in {"caldav", "manual"}
        or account.get("caldav_url")
        or account.get("server_url")
    ):
        return "caldav"
    raise CalendarProviderError(400, "Calendar provider is unsupported")


def _google_service(email: str) -> Any:
    from backend.services.google_calendar_service import get_google_calendar_service

    service = get_google_calendar_service(email)
    if service is None:
        raise CalendarProviderError(503, "Calendar account needs to be reconnected")
    return service


def _google_failure(error: Exception, *, write: bool = False) -> CalendarProviderError:
    status = getattr(getattr(error, "resp", None), "status", None)
    status = status if isinstance(status, int) else None
    code = {404: 404, 403: 403, 401: 403, 409: 409, 412: 409}.get(status or 0, 502)
    return CalendarProviderError(
        code,
        "Calendar provider could not complete the request",
        outcome_unknown=write and (status is None or status >= 500),
    )


def get_busy_intervals(
    email: str, calendar_id: str, time_min: str, time_max: str, *, provider: str | None = None
) -> list[dict[str, str]]:
    """Return only busy periods; provider errors never become empty availability."""
    account = configured_account(email, calendar_id, provider)
    if account_provider(account) == "caldav":
        client = CalDAVClient(account)
        calendar = client.calendar(email, calendar_id)
        try:
            return caldav_resources.busy_intervals(client, calendar, time_min, time_max)
        except CalendarProviderError:
            # iCloud does not implement free-busy REPORT. The fallback still
            # fails closed for transport errors or unsupported recurrence.
            from backend.domains.calendar.caldav_availability import query_busy_intervals

            return query_busy_intervals(client, calendar, time_min, time_max)
    caldav_resources.caldav_datetime(time_min)
    caldav_resources.caldav_datetime(time_max)
    try:
        result = (
            _google_service(email)
            .freebusy()
            .query(
                body={
                    "timeMin": time_min,
                    "timeMax": time_max,
                    "items": [{"id": calendar_id}],
                }
            )
            .execute()
        )
    except CalendarProviderError:
        raise
    except Exception as error:
        raise _google_failure(error) from error
    calendar = result.get("calendars", {}).get(calendar_id)
    if (
        not isinstance(calendar, dict)
        or calendar.get("errors")
        or not isinstance(calendar.get("busy"), list)
    ):
        raise CalendarProviderError(502, "Selected calendar availability could not be verified")
    periods = []
    for interval in calendar["busy"]:
        if (
            not isinstance(interval, dict)
            or not isinstance(interval.get("start"), str)
            or not isinstance(interval.get("end"), str)
        ):
            raise CalendarProviderError(502, "Invalid calendar availability response")
        caldav_resources.caldav_datetime(interval["start"])
        caldav_resources.caldav_datetime(interval["end"])
        periods.append({"start": interval["start"], "end": interval["end"]})
    return periods


def create_provider_event(
    email: str, calendar_id: str, event_data: dict[str, Any], *, stable_id: str | None = None
) -> dict[str, Any]:
    """Create conditionally; a stable ID makes a retried booking recoverable."""
    data = dict(event_data)
    provider = data.pop("provider", None)
    account = configured_account(email, calendar_id, provider)
    if account_provider(account) == "caldav":
        client = CalDAVClient(account)
        return caldav_resources.create_event(
            client, client.calendar(email, calendar_id, write=True), data, stable_id
        )
    service = _google_service(email)
    if stable_id is not None:
        data["id"] = hashlib.sha256(stable_id.encode()).hexdigest()
    try:
        options: dict[str, Any] = {"calendarId": calendar_id, "body": data}
        if data.get("conferenceData"):
            options["conferenceDataVersion"] = 1
        return dict(service.events().insert(**options).execute())
    except Exception as error:
        if stable_id is not None and getattr(getattr(error, "resp", None), "status", None) == 409:
            try:
                return dict(
                    service.events().get(calendarId=calendar_id, eventId=data["id"]).execute()
                )
            except Exception as recovery_error:
                failure = _google_failure(recovery_error, write=True)
                failure.outcome_unknown = True
                raise failure from recovery_error
        raise _google_failure(error, write=True) from error


def get_caldav_event(email: str, event_id: str, calendar_id: str) -> dict[str, Any]:
    from backend.services.hybrid_calendar_service import _normalize_caldav_event

    client = CalDAVClient(configured_account(email, calendar_id, "caldav"))
    calendar = client.calendar(email, calendar_id)
    url, etag, content = caldav_resources.load_resource(client, calendar, event_id)
    event = next(event for event in content.walk("VEVENT") if str(event.get("UID")) == event_id)
    normalized = _normalize_caldav_event(event, email, calendar)
    return {**normalized, "etag": etag, "resource_url": url}


def mutate_caldav_event(
    email: str,
    event_id: str,
    calendar_id: str,
    data: dict[str, Any] | None,
    *,
    etag: str | None = None,
    resource_url: str | None = None,
) -> dict[str, str]:
    client = CalDAVClient(configured_account(email, calendar_id, "caldav"))
    calendar = client.calendar(email, calendar_id, write=True)
    return caldav_resources.mutate_event(
        client, calendar, event_id, data, etag=etag, resource_url=resource_url
    )
