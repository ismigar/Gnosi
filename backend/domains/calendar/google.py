import json
import logging
from typing import Any

from backend.config.app_config import load_params

log = logging.getLogger(__name__)


def get_google_calendar_service(email: str) -> Any:
    """Helper to get a Google Calendar service for a given email."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        log.error("Falten dependències: google-api-python-client, google-auth-oauthlib")
        return None

    cfg = load_params(strict_env=False)
    secrets_path = cfg.paths.get("SECRETS")
    if secrets_path is None:
        log.error("No es troba el directori de secrets.")
        return None
    integrations_file = secrets_path / "integrations.json"

    if not integrations_file.exists():
        log.error("No es troba integrations.json.")
        return None

    try:
        data = json.loads(integrations_file.read_text(encoding="utf-8"))
    except Exception as e:
        log.error(f"Failed to read integrations.json: {e}")
        return None

    from backend.config.env_config import get_env

    # Search in both 'calendars' and 'emails' lists
    all_accounts = data.get("calendars", []) + data.get("emails", [])

    for cal in all_accounts:
        if cal.get("provider") == "google" and cal.get("auth_type") == "oauth2":
            cal_email = cal.get("email") or cal.get("username") or ""
            if cal_email == email:
                try:
                    # Resolve client credentials with environment fallback
                    client_id = cal.get("client_id") or get_env("GOOGLE_OAUTH_CLIENT_ID")
                    client_secret = cal.get("client_secret") or get_env(
                        "GOOGLE_OAUTH_CLIENT_SECRET"
                    )

                    if not client_id or not client_secret:
                        log.error(
                            f"❌ Missing OAuth client credentials for {email}. Sync will fail."
                        )
                        continue

                    creds_dict = {
                        "token": cal.get("token"),
                        "refresh_token": cal.get("refresh_token"),
                        "token_uri": cal.get("token_uri", "https://oauth2.googleapis.com/token"),
                        "client_id": client_id,
                        "client_secret": client_secret,
                    }
                    credentials_factory: Any = Credentials
                    creds = credentials_factory(**creds_dict)
                    return build("calendar", "v3", credentials=creds)
                except Exception as e:
                    log.error(f"Error building service for {email}: {e}")
                    return None
    return None


def list_google_calendar_events(
    email: str,
    calendar_id: str = "primary",
    time_min: str | None = None,
    time_max: str | None = None,
    max_results: int = 250,
    *,
    service_factory: Any = get_google_calendar_service,
) -> Any:
    """Lists events from a Google Calendar."""
    service = service_factory(email)
    if not service:
        return []

    try:
        events_result = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        return events_result.get("items", [])
    except Exception as e:
        log.error(f"Error listing events for {email}: {e}")
        return []


def create_google_calendar_event(
    email: str,
    event_data: dict[str, Any],
    calendar_id: str = "primary",
    *,
    service_factory: Any = get_google_calendar_service,
) -> Any:
    """Creates a new event in Google Calendar."""
    service = service_factory(email)
    if not service:
        return None

    try:
        event = service.events().insert(calendarId=calendar_id, body=event_data).execute()
        return event
    except Exception as e:
        log.error(f"Error creating event for {email}: {e}")
        return None


def get_google_calendar_free_busy(
    email: str,
    time_min: str,
    time_max: str,
    calendar_ids: list[Any] | None = None,
    *,
    service_factory: Any = get_google_calendar_service,
) -> Any:
    """Checks free/busy status for one or more calendars."""
    service = service_factory(email)
    if not service:
        return {}

    if not calendar_ids:
        calendar_ids = ["primary"]

    body = {
        "timeMin": time_min,
        "timeMax": time_max,
        "items": [{"id": cid} for cid in calendar_ids],
    }

    try:
        return service.freebusy().query(body=body).execute()
    except Exception as e:
        log.error(f"Error querying freebusy for {email}: {e}")
        return {}


def _event_attendees_patch(
    patch_data: dict[str, Any], target_event: dict[str, Any]
) -> list[dict[str, Any]] | None:
    raw_attendees = patch_data.get("attendees")
    if not isinstance(raw_attendees, list):
        return None
    requested = [
        {"email": attendee["email"], "displayName": attendee.get("name", "")}
        for attendee in raw_attendees
        if attendee.get("email")
    ]
    existing = [
        {
            "email": attendee.get("email", ""),
            "displayName": attendee.get("displayName", ""),
        }
        for attendee in target_event.get("attendees", [])
        if attendee.get("email")
    ]
    if requested == existing:
        return None
    existing_by_email = {
        attendee.get("email"): attendee
        for attendee in target_event.get("attendees", [])
        if attendee.get("email")
    }
    for attendee in requested:
        preserved = existing_by_email.get(attendee["email"], {})
        if preserved.get("responseStatus"):
            attendee["responseStatus"] = preserved["responseStatus"]
    return requested


def _event_time_patch(
    patch_data: dict[str, Any], event: dict[str, Any], target_event: dict[str, Any]
) -> dict[str, Any]:
    body: dict[str, Any] = {}
    default_tz = (
        (target_event.get("start") or {}).get("timeZone")
        or (target_event.get("end") or {}).get("timeZone")
        or "Europe/Madrid"
    )
    for field in ("start", "end"):
        value = patch_data.get(field)
        if not value:
            continue
        requested = (
            {"dateTime": value, "timeZone": default_tz} if "T" in value else {"date": value[:10]}
        )
        if requested != event.get(field):
            body[field] = requested
    return body


def _event_patch_body(
    patch_data: dict[str, Any], event: dict[str, Any], target_event: dict[str, Any]
) -> dict[str, Any]:
    body: dict[str, Any] = {}
    for field in ("summary", "location", "description"):
        if field not in patch_data:
            continue
        requested = patch_data[field] if field == "summary" else patch_data[field] or ""
        if requested != target_event.get(field, ""):
            body[field] = requested
    attendees = _event_attendees_patch(patch_data, target_event)
    if attendees is not None:
        body["attendees"] = attendees
    body.update(_event_time_patch(patch_data, event, target_event))
    return body


def _restrict_birthday_patch(body: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    birthday_fields = {"summary", "start", "end", "colorId", "reminders"}
    restricted = {key: value for key, value in body.items() if key in birthday_fields}
    properties = event.get("birthdayProperties") or {}
    if properties.get("contact") or properties.get("type") == "self":
        restricted.pop("start", None)
        restricted.pop("end", None)
    return restricted


def update_google_event(
    email: str,
    event_uid: str,
    patch_data: dict[str, Any],
    *,
    service_factory: Any = get_google_calendar_service,
) -> bool:
    """Updates supported fields without replacing provider-owned event data."""
    service = service_factory(email)
    if not service:
        return False

    try:
        # Destination calendar (including subcalendars); defaults to the primary one.
        cal_id = patch_data.get("calendar_id") or "primary"

        # The existing resource supplies context such as the original time zone.
        # It must not be sent back as a full update: expanded recurring instances
        # omit the master's recurrence, which makes special event types such as
        # birthdays fail Google's validation.
        event = service.events().get(calendarId=cal_id, eventId=event_uid).execute()
        target_event = event
        target_event_uid = event_uid
        is_birthday = event.get("eventType") == "birthday"
        if is_birthday and event.get("recurringEventId"):
            target_event_uid = event["recurringEventId"]
            target_event = (
                service.events()
                .get(
                    calendarId=cal_id,
                    eventId=target_event_uid,
                )
                .execute()
            )
        body = _event_patch_body(patch_data, event, target_event)

        # Google birthdays accept only a narrow set of mutable properties.
        # The sidebar submits its complete form state on every autosave, so
        # unsupported empty fields must be discarded even when the user only
        # changes the title.
        if is_birthday:
            body = _restrict_birthday_patch(body, event)

        if body:
            service.events().patch(calendarId=cal_id, eventId=target_event_uid, body=body).execute()
        return True
    except Exception as e:
        log.error(f"Error updating Google Calendar event {event_uid} for {email}: {e}")
        return False


def respond_to_invitation(
    email: str,
    event_id: str,
    rsvp: str,
    calendar_id: str = "primary",
    *,
    service_factory: Any = get_google_calendar_service,
) -> bool:
    """Responds to a Google Calendar invitation (accepted | declined | tentative | needsAction)."""
    service = service_factory(email)
    if not service:
        return False
    try:
        event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        attendees = event.get("attendees", [])
        updated = False
        for a in attendees:
            if a.get("self") or a.get("email") == email:
                a["responseStatus"] = rsvp
                updated = True
                break
        if not updated:
            attendees.append({"email": email, "responseStatus": rsvp, "self": True})
        service.events().patch(
            calendarId=calendar_id,
            eventId=event_id,
            body={"attendees": attendees},
        ).execute()
        return True
    except Exception as e:
        log.error(f"respond_to_invitation {event_id} for {email}: {e}")
        return False


def patch_event_attendees(
    email: str,
    event_id: str,
    new_attendees: list[Any],
    calendar_id: str = "primary",
    *,
    service_factory: Any = get_google_calendar_service,
) -> bool:
    """Adds attendees to a Google Calendar event. Google sends the notifications automatically."""
    service = service_factory(email)
    if not service:
        return False
    try:
        event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        existing_emails = {a["email"] for a in event.get("attendees", [])}
        combined = list(event.get("attendees", []))
        for att in new_attendees:
            if att.get("email") and att["email"] not in existing_emails:
                combined.append({"email": att["email"], "displayName": att.get("name", "")})
        service.events().patch(
            calendarId=calendar_id,
            eventId=event_id,
            body={"attendees": combined},
            sendUpdates="all",
        ).execute()
        return True
    except Exception as e:
        log.error(f"patch_event_attendees {event_id} for {email}: {e}")
        return False
