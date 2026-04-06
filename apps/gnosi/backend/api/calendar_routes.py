from fastapi import APIRouter, Response, Query, Body, HTTPException
from pathlib import Path
import os
import re
import yaml
import logging
from datetime import datetime
from icalendar import Calendar, Event

from backend.api.vault_routes import VAULT_PATH
from dotenv import load_dotenv
from backend.services.google_calendar_service import (
    list_google_calendar_events,
    create_google_calendar_event,
    get_google_calendar_free_busy,
)

router = APIRouter(prefix="/api/calendar", tags=["Calendar"])
log = logging.getLogger(__name__)

try:
    base_dir = Path(__file__).resolve().parents[4]
    shared_env = base_dir / ".env_shared"
    if shared_env.exists():
        load_dotenv(shared_env)
except Exception:
    pass

FOLDERS_TO_INDEX = ["Calendar", "Tasques"]


def get_frontmatter(content: str):
    """Simple YAML frontmatter parsed."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end() :]
        try:
            return yaml.safe_load(yaml_content) or {}, body
        except yaml.YAMLError:
            return {}, content
    return {}, content


@router.get("/events")
async def get_google_events(
    email: str = Query(...),
    calendar_id: str = "primary",
    time_min: str = Query(None),
    time_max: str = Query(None),
):
    """Lists events from Google Calendar."""
    try:
        return list_google_calendar_events(email, calendar_id, time_min, time_max)
    except Exception as e:
        log.error(f"Error in GET /api/calendar/events: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/events")
async def post_google_event(
    email: str = Query(...), calendar_id: str = "primary", event_data: dict = Body(...)
):
    """Creates a new event in Google Calendar."""
    try:
        event = create_google_calendar_event(email, event_data, calendar_id)
        if event:
            return event
        raise HTTPException(status_code=500, detail="Failed to create event")
    except Exception as e:
        log.error(f"Error in POST /api/calendar/events: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/freebusy")
async def post_freebusy(
    email: str = Query(...),
    time_min: str = Body(...),
    time_max: str = Body(...),
    calendar_ids: list = Body(None),
):
    """Checks free/busy status."""
    try:
        return get_google_calendar_free_busy(email, time_min, time_max, calendar_ids)
    except Exception as e:
        log.error(f"Error in POST /api/calendar/freebusy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/feed.ics", response_class=Response)
def get_ics_feed():
    """Generates an .ics representation of vault notes with dates dynamically."""
    cal = Calendar()
    cal.add("prodid", "-//Digital Brain PIM//ismaelgarcia.net//")
    cal.add("version", "2.0")

    for folder in FOLDERS_TO_INDEX:
        folder_path = VAULT_PATH / folder
        if not folder_path.exists():
            continue

        for file_path in folder_path.rglob("*.md"):
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                metadata, body = get_frontmatter(raw_content)

                start_date_str = (
                    metadata.get("date")
                    or metadata.get("start_time")
                    or metadata.get("due_date")
                )
                if not start_date_str:
                    continue

                event = Event()
                event.add("summary", metadata.get("title") or file_path.stem)

                try:
                    start_date = datetime.fromisoformat(
                        str(start_date_str).replace("Z", "+00:00")
                    )
                    event.add("dtstart", start_date)
                except ValueError:
                    continue

                end_date_str = metadata.get("end_date") or metadata.get("end_time")
                if end_date_str:
                    try:
                        end_date = datetime.fromisoformat(
                            str(end_date_str).replace("Z", "+00:00")
                        )
                        event.add("dtend", end_date)
                    except ValueError:
                        pass

                description = metadata.get("description", "")
                if body.strip():
                    if description:
                        description += "\n\n"
                    description += body[:500] + ("..." if len(body) > 500 else "")

                if description:
                    event.add("description", description)

                uid = metadata.get("uid") or metadata.get("id") or file_path.stem
                event.add("uid", uid + "@gnosi.local")

                cal.add_component(event)

            except Exception as e:
                pass

    return Response(content=cal.to_ical(), media_type="text/calendar")
