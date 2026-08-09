import logging
import json
from pathlib import Path
from datetime import datetime, timedelta
from backend.config.app_config import load_params

log = logging.getLogger(__name__)


def get_google_calendar_service(email: str):
    """Helper to get a Google Calendar service for a given email."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        log.error("Falten dependències: google-api-python-client, google-auth-oauthlib")
        return None

    cfg = load_params(strict_env=False)
    integrations_file = cfg.paths["SECRETS"] / "integrations.json"

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
                    client_secret = cal.get("client_secret") or get_env("GOOGLE_OAUTH_CLIENT_SECRET")
                    
                    if not client_id or not client_secret:
                        log.error(f"❌ Missing OAuth client credentials for {email}. Sync will fail.")
                        continue

                    creds_dict = {
                        "token": cal.get("token"),
                        "refresh_token": cal.get("refresh_token"),
                        "token_uri": cal.get(
                            "token_uri", "https://oauth2.googleapis.com/token"
                        ),
                        "client_id": client_id,
                        "client_secret": client_secret,
                    }
                    creds = Credentials(**creds_dict)
                    return build("calendar", "v3", credentials=creds)
                except Exception as e:
                    log.error(f"Error building service for {email}: {e}")
                    return None
    return None


def list_google_calendar_events(
    email: str,
    calendar_id: str = "primary",
    time_min: str = None,
    time_max: str = None,
    max_results: int = 250,
):
    """Lists events from a Google Calendar."""
    service = get_google_calendar_service(email)
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
    email: str, event_data: dict, calendar_id: str = "primary"
):
    """Creates a new event in Google Calendar."""
    service = get_google_calendar_service(email)
    if not service:
        return None

    try:
        event = (
            service.events().insert(calendarId=calendar_id, body=event_data).execute()
        )
        return event
    except Exception as e:
        log.error(f"Error creating event for {email}: {e}")
        return None


def get_google_calendar_free_busy(
    email: str, time_min: str, time_max: str, calendar_ids: list = None
):
    """Checks free/busy status for one or more calendars."""
    service = get_google_calendar_service(email)
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


def update_google_event(email: str, event_uid: str, patch_data: dict) -> bool:
    """Updates supported fields without replacing provider-owned event data."""
    service = get_google_calendar_service(email)
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
        body = {}

        if "summary" in patch_data and patch_data["summary"] != event.get("summary", ""):
            body["summary"] = patch_data["summary"]
        if (
            "location" in patch_data
            and (patch_data["location"] or "") != event.get("location", "")
        ):
            body["location"] = patch_data["location"] or ""
        if (
            "description" in patch_data
            and (patch_data["description"] or "") != event.get("description", "")
        ):
            body["description"] = patch_data["description"] or ""
        if "attendees" in patch_data and isinstance(patch_data["attendees"], list):
            requested_attendees = [
                {"email": a["email"], "displayName": a.get("name", "")}
                for a in patch_data["attendees"]
                if a.get("email")
            ]
            existing_attendees = [
                {
                    "email": attendee.get("email", ""),
                    "displayName": attendee.get("displayName", ""),
                }
                for attendee in event.get("attendees", [])
                if attendee.get("email")
            ]
            if requested_attendees != existing_attendees:
                existing_by_email = {
                    attendee.get("email"): attendee
                    for attendee in event.get("attendees", [])
                    if attendee.get("email")
                }
                body["attendees"] = []
                for attendee in requested_attendees:
                    preserved = existing_by_email.get(attendee["email"], {})
                    if preserved.get("responseStatus"):
                        attendee["responseStatus"] = preserved["responseStatus"]
                    body["attendees"].append(attendee)

        # Time zone: Google requires `timeZone` when the dateTime doesn't carry
        # an offset. Preserves the original event's, and if it doesn't have one, the user's.
        default_tz = (
            (event.get("start") or {}).get("timeZone")
            or (event.get("end") or {}).get("timeZone")
            or "Europe/Madrid"
        )

        if "start" in patch_data and patch_data["start"]:
            start_val = patch_data["start"]
            if "T" in start_val:
                requested_start = {"dateTime": start_val, "timeZone": default_tz}
            else:
                requested_start = {"date": start_val[:10]}
            if requested_start != event.get("start"):
                body["start"] = requested_start

        if "end" in patch_data and patch_data["end"]:
            end_val = patch_data["end"]
            if "T" in end_val:
                requested_end = {"dateTime": end_val, "timeZone": default_tz}
            else:
                requested_end = {"date": end_val[:10]}
            if requested_end != event.get("end"):
                body["end"] = requested_end

        # Google birthdays accept only a narrow set of mutable properties.
        # The sidebar submits its complete form state on every autosave, so
        # unsupported empty fields must be discarded even when the user only
        # changes the title.
        if event.get("eventType") == "birthday":
            birthday_fields = {"summary", "start", "end", "colorId", "reminders"}
            body = {key: value for key, value in body.items() if key in birthday_fields}

        if body:
            service.events().patch(
                calendarId=cal_id, eventId=event_uid, body=body
            ).execute()
        return True
    except Exception as e:
        log.error(
            f"Error updating Google Calendar event {event_uid} for {email}: {e}"
        )
        return False


def respond_to_invitation(email: str, event_id: str, rsvp: str, calendar_id: str = "primary") -> bool:
    """Responds to a Google Calendar invitation (accepted | declined | tentative | needsAction)."""
    service = get_google_calendar_service(email)
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


def patch_event_attendees(email: str, event_id: str, new_attendees: list, calendar_id: str = "primary") -> bool:
    """Adds attendees to a Google Calendar event. Google sends the notifications automatically."""
    service = get_google_calendar_service(email)
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
