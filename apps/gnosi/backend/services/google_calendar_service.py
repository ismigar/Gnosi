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

    for cal in data.get("calendars", []):
        if cal.get("provider") == "google" and cal.get("auth_type") == "oauth2":
            cal_email = cal.get("email", cal.get("username", ""))
            if cal_email == email:
                try:
                    creds_dict = {
                        "token": cal.get("token"),
                        "refresh_token": cal.get("refresh_token"),
                        "token_uri": cal.get(
                            "token_uri", "https://oauth2.googleapis.com/token"
                        ),
                        "client_id": cal.get("client_id"),
                        "client_secret": cal.get("client_secret"),
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
    """Updates a Google Calendar event (legacy compatibility)."""
    service = get_google_calendar_service(email)
    if not service:
        return False

    try:
        # Fetch existing event
        event = service.events().get(calendarId="primary", eventId=event_uid).execute()

        # Update fields
        if "summary" in patch_data:
            event["summary"] = patch_data["summary"]

        # Start time logic
        if "start" in patch_data and patch_data["start"]:
            start_val = patch_data["start"]
            if "T" in start_val:
                event["start"] = {"dateTime": start_val}
                if "date" in event["start"]:
                    del event["start"]["date"]
            else:
                event["start"] = {"date": start_val[:10]}
                if "dateTime" in event["start"]:
                    del event["start"]["dateTime"]

        # End time logic
        if "end" in patch_data and patch_data["end"]:
            end_val = patch_data["end"]
            if "T" in end_val:
                event["end"] = {"dateTime": end_val}
                if "date" in event["end"]:
                    del event["end"]["date"]
            else:
                event["end"] = {"date": end_val[:10]}
                if "dateTime" in event["end"]:
                    del event["end"]["dateTime"]

        # Update back to Google API
        service.events().update(
            calendarId="primary", eventId=event_uid, body=event
        ).execute()
        return True
    except Exception as e:
        log.error(
            f"Error actualitzant Google Calendar event {event_uid} per a {email}: {e}"
        )
        return False
