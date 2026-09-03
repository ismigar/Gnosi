from __future__ import annotations

from fastapi import APIRouter, Response, Query, Body, HTTPException, Depends
from pathlib import Path
import asyncio
import functools
import re
import yaml
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Optional, cast
from icalendar import Calendar, Event

from backend.utils.safe_io import safe_write_text
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role

from backend.services.google_calendar_service import (
    create_google_calendar_event,
    get_google_calendar_free_busy,
    update_google_event,
    respond_to_invitation,
    patch_event_attendees,
)
from backend.services.workspace_service import get_workspace_context
from backend.services.context_vars import get_active_vault_path
from backend.models.calendar import HiddenEvent
from backend.data.management_db import get_mgmt_session
from backend.domains.calendar.geocoding import photon_label as _photon_label
from backend.domains.calendar.geocoding import search_photon
from backend.domains.calendar import schemas as calendar_schemas
from backend.services.calendar_event_aggregation import fetch_calendar_accounts

router = APIRouter(
    prefix="/api/calendar", tags=["Calendar"], dependencies=[Depends(get_workspace_context)]
)
log = logging.getLogger(__name__)

# ── Cache ──────────────────────────────────────────────────────────────────────
_EVENTS_CACHE: dict[str, dict[str, Any]] = {}
_EVENTS_CACHE_TTL = 300  # seconds
_CALS_CACHE: dict[str, dict[str, Any]] = {}
_CALS_CACHE_TTL = 300  # 5 min (calendar lists rarely change)


def _invalidate_calendar_cache() -> None:
    _EVENTS_CACHE.clear()


def _get_calendar_storage_path() -> Path:
    base = get_active_vault_path()
    if base is None:
        raise RuntimeError("No active Vault is configured")
    p = base / "Calendar"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_calendar_path(vault_path: Optional[str]) -> Optional[Path]:
    """Confine a client-provided `vault_path` to the active vault's Calendar directory.

    Return the resolved path, or None when it is empty, outside the directory,
    or a traversal (`..` or an arbitrary absolute path).

    `patch_event` and `delete_event` receive `vault_path` from the body/query.
    Without this check, an editor role (or a compromised client/CSRF request)
    could write or move any system file to the Trash. `resolve()` collapses
    actual traversal segments, and the parent check keeps the result inside
    `Calendar/`.
    """
    if not vault_path:
        return None
    try:
        p = Path(vault_path).resolve()
        root = _get_calendar_storage_path().resolve()
    except Exception:
        return None
    return p if (p == root or root in p.parents) else None


def _get_hidden_event_ids() -> set[str]:
    """Return the set of locally hidden event IDs."""
    session = get_mgmt_session()
    try:
        hidden = session.query(HiddenEvent.event_id).all()
        return {h[0] for h in hidden}
    except Exception as e:
        log.warning(f"Error recuperant esdeveniments amagats: {e}")
        return set()
    finally:
        session.close()


def get_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        try:
            return yaml.safe_load(match.group(1)) or {}, content[match.end() :]
        except yaml.YAMLError:
            return {}, content
    return {}, content


def _default_range() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    return (
        (now - timedelta(days=30)).isoformat(),
        (now + timedelta(days=90)).isoformat(),
    )


# ── GET /calendars ─────────────────────────────────────────────────────────────


@router.get("/calendars", response_model=list[calendar_schemas.CalendarListItemResponse], response_model_exclude_unset=True)
async def get_calendars(
    response: Response, email: Optional[str] = Query(None)
) -> list[dict[str, Any]]:
    """Returns the list of available calendars for an account or for all of them.

    If any account has an expired/revoked Google token, the response is NOT
    broken (calendars from valid accounts are still returned), but the
    `X-Calendar-Auth-Error` header is added with the affected emails so the UI can
    request reconnection instead of silently showing an empty list.

    """
    from backend.services.hybrid_calendar_service import list_calendars, GoogleAuthExpired
    from backend.services.integration_manager import integration_manager

    integrations = integration_manager.get_all_safe()
    all_accounts = integrations.get("calendars", []) + integrations.get("emails", [])

    if email:
        email_list = [email]
    else:
        email_list = list(
            {
                a.get("email") or a.get("username")
                for a in all_accounts
                if a.get("email") or a.get("username")
            }
        )

    results = []
    auth_errors = []
    for em in email_list:
        cached = _CALS_CACHE.get(em)
        if cached and time.time() < cached["expiry"]:
            results.extend(cached["data"])
            continue
        try:
            cals = list_calendars(em)
        except GoogleAuthExpired:
            # Expired token: we don't cache it (so a retry after reconnection works)
            # and we mark the account as affected.
            auth_errors.append(em)
            continue
        _CALS_CACHE[em] = {"data": cals, "expiry": time.time() + _CALS_CACHE_TTL}
        results.extend(cals)

    if auth_errors:
        response.headers["X-Calendar-Auth-Error"] = ",".join(auth_errors)
    return results


# ── GET /events ────────────────────────────────────────────────────────────────


@router.get("/events", response_model=list[calendar_schemas.CalendarEventResponse], response_model_exclude_unset=True)
async def get_events(
    email: Optional[str] = Query(None),
    time_min: Optional[str] = Query(None),
    time_max: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    calendar_id: Optional[str] = Query(None),
    include_vault: bool = Query(True),
) -> list[dict[str, Any]]:
    """
        Returns Google Calendar / CalDAV events directly (without the vault).
    If include_vault=true, also adds vault notes that have a date.

    """
    t_min, t_max = _default_range()
    time_min = time_min or t_min
    time_max = time_max or t_max

    return await asyncio.to_thread(
        collect_all_events, time_min, time_max, search, calendar_id, include_vault, email
    )


def collect_all_events(
    time_min: str,
    time_max: str,
    search: Optional[str] = None,
    calendar_id: Optional[str] = None,
    include_vault: bool = True,
    email: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Gathers events from all accounts (Google/CalDAV) + vault within a range.

    SYNCHRONOUS, reusable version: used by the GET /events endpoint (via
    `to_thread`) and also by the meeting notifier
    (`backend/services/meeting_reminders.py`). Applies the per-account cache
    (`_EVENTS_CACHE`) and the hidden-events filter.

    """
    from backend.services.integration_manager import integration_manager

    integrations = integration_manager.get_all_safe()
    all_accounts = integrations.get("calendars", []) + integrations.get("emails", [])

    if email:
        email_list = [email]
    else:
        email_list = list(
            {
                a.get("email") or a.get("username")
                for a in all_accounts
                if a.get("email") or a.get("username")
            }
        )

    all_events: list[dict[str, Any]] = []
    pending_accounts: list[tuple[str, str]] = []
    for em in email_list:
        cache_key = f"{em}|{time_min}|{time_max}|{search}|{calendar_id}"
        cached = _EVENTS_CACHE.get(cache_key)
        if cached and time.time() < cached["expiry"]:
            all_events.extend(cached["data"])
            continue
        pending_accounts.append((em, cache_key))

    account_results = fetch_calendar_accounts(
        pending_accounts, time_min, time_max, search, calendar_id
    )
    for result in account_results:
        if not result.succeeded:
            continue
        _EVENTS_CACHE[result.cache_key] = {
            "data": result.events,
            "expiry": time.time() + _EVENTS_CACHE_TTL,
        }
        all_events.extend(result.events)

    # Filtrar esdeveniments amagats
    hidden_ids = _get_hidden_event_ids()
    if hidden_ids:
        all_events = [ev for ev in all_events if ev.get("id") not in hidden_ids]

    # Vault events (local notes with a date field)
    if include_vault:
        vault_events = _get_vault_events(time_min, time_max, search)
        if hidden_ids:
            vault_events = [ev for ev in vault_events if ev.get("id") not in hidden_ids]
        all_events.extend(vault_events)

    return all_events


def _get_vault_events(time_min: str, time_max: str, search: Optional[str]) -> list[dict[str, Any]]:
    """Vault events (notes with a 'date' field) from the app's page_index.

    Uses `_get_pages_snapshot()` — the cached index that also feeds the sidebar —
    instead of doing `rglob`+`read_text` over the whole vault. It used to read ~2939
    files on every request (~11s); now it filters the ~119 pages with a
    `date` field in memory without touching disk (the index already carries all the metadata, including
    `description`). See directive async_event_loop_vault_io.

    """
    try:
        from backend.api.vault_routes import _get_pages_snapshot

        pages_snapshot = cast(Callable[..., list[Any]], _get_pages_snapshot)
        q = (search or "").lower()
        lo, hi = time_min[:10], time_max[:10]
        events = []
        for p in pages_snapshot(only_calendar=False):
            meta = p.metadata or {}
            date_val = meta.get("date")
            if not date_val:
                continue
            path_str = p.path or ""
            # Excludes Calendar/External (old sync files) and external sources.
            if "Calendar/External" in path_str:
                continue
            source = meta.get("source", "Gnosi")
            if source and source not in ("Gnosi", "Gnosi Vault") and "External" in path_str:
                continue
            date_str = str(date_val)
            if date_str < lo or date_str > hi:
                continue
            title = meta.get("title") or p.title
            body = str(meta.get("description") or "")
            if q and q not in title.lower() and q not in body.lower():
                continue
            events.append(
                {
                    "id": meta.get("id") or p.id,
                    "vault_path": path_str,
                    "calendar_id": "gnosi",
                    "calendar_name": "Gnosi",
                    "title": title,
                    "start": date_str,
                    "end": str(meta.get("end_date") or ""),
                    "all_day": bool(meta.get("all_day", "T" not in date_str)),
                    "location": meta.get("location", ""),
                    "description": body[:500],
                    "source": source or "Gnosi",
                    "account": "",
                    "provider": "vault",
                    "color": None,
                    "status": "confirmed",
                    "link": "",
                    "recurrence": meta.get("rrule"),
                    "recurring_event_id": None,
                    "is_read_only": False,
                }
            )
        return events
    except Exception as ex:
        log.warning(f"_get_vault_events: {ex}")
        return []


# ── Meeting reminders (AI-powered notifier) ────────────────────────────


@router.get("/reminders", response_model=calendar_schemas.MeetingRemindersResponse, response_model_exclude_unset=True)
async def get_meeting_reminders() -> dict[str, Any]:
    """Active reminders for the app banner (with the agenda already
    generated by the service; doesn't call the AI again)."""
    from backend.services.meeting_reminders import get_active

    return {"reminders": get_active()}


@router.post("/reminders/{reminder_id}/dismiss", response_model=calendar_schemas.CalendarStatusResponse)
async def dismiss_meeting_reminder(reminder_id: str) -> dict[str, str]:
    from backend.services.meeting_reminders import dismiss

    ok = dismiss(reminder_id)
    return {"status": "success" if ok else "not_found"}


@router.get("/reminders/settings", response_model=calendar_schemas.MeetingReminderSettingsResponse)
async def get_meeting_reminder_settings() -> dict[str, Any]:
    from backend.services.meeting_reminders import get_settings

    return get_settings()


@router.put("/reminders/settings", response_model=calendar_schemas.MeetingReminderSettingsResponse)
async def update_meeting_reminder_settings(
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    """Updates {enabled, lead_minutes} and keeps a SINGLE source of truth for
    on/off: also enables/disables the scheduler's `meeting_reminders` task
    (1 min interval)."""
    from backend.services.meeting_reminders import update_settings

    s = update_settings(payload)
    try:
        from backend.scheduler.manager import scheduler_manager

        scheduler_manager.update_task("meeting_reminders", 1, bool(s.get("enabled")))
    except Exception as e:
        log.warning("Could not synchronize the meeting_reminders task: %s", e)
    return s


# ── GET /events/{event_id} ─────────────────────────────────────────────────────


@router.get("/events/{event_id}", response_model=calendar_schemas.CalendarEventResponse, response_model_exclude_unset=True)
async def get_event(
    event_id: str,
    email: str = Query(...),
    calendar_id: Optional[str] = Query(None),
) -> dict[str, Any]:
    """Return the details of an event (Google Calendar or CalDAV)."""
    from backend.services.hybrid_calendar_service import get_event as _get_event

    ev = _get_event(email, event_id, calendar_id)
    if ev:
        return ev
    raise HTTPException(status_code=404, detail="Event not found")


# ── POST /events ───────────────────────────────────────────────────────────────


@router.post("/events", response_model=calendar_schemas.GoogleEventResourceResponse, response_model_exclude_unset=True, dependencies=[Depends(require_role("editor"))])
async def post_event(
    email: str = Query(...),
    calendar_id: str = Query("primary"),
    event_data: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    """Creates a new event in Google Calendar."""
    try:
        event = create_google_calendar_event(email, event_data, calendar_id)
        if isinstance(event, dict) and event:
            _invalidate_calendar_cache()
            return event
        raise HTTPException(status_code=500, detail="Failed to create event")
    except Exception as e:
        log.error(f"POST /events: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, "POST /events"))


# ── PATCH /events/{event_id} ───────────────────────────────────────────────────


@router.patch(
    "/events/{event_id}",
    response_model=calendar_schemas.CalendarStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def patch_event(
    event_id: str,
    email: str = Query(...),
    calendar_id: str = Query("primary"),
    patch_data: dict[str, Any] = Body(...),
) -> dict[str, str]:
    """Updates an existing event (Google Calendar or local vault)."""
    # Vault local
    if patch_data.get("provider") == "vault" or patch_data.get("vault_path"):
        raw_vault_path = patch_data.get("vault_path")
        if raw_vault_path:
            p = _safe_calendar_path(raw_vault_path)
            if p is None:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid vault_path or path outside the Calendar directory",
                )
            if p.exists():
                content = p.read_text(encoding="utf-8")
                meta, body = get_frontmatter(content)
                allowed = {"date", "end_date", "title", "location", "description", "all_day"}
                for k, v in patch_data.items():
                    if k in allowed:
                        meta[k] = v
                new_front = yaml.dump(meta, default_flow_style=False, allow_unicode=True)
                safe_write_text(p, f"---\n{new_front}---\n\n{body}\n")
                _invalidate_calendar_cache()
                return {"status": "success"}

    # Google Calendar — pass calendar_id via patch_data so update_google_event accepts it
    patch_data.setdefault("calendar_id", calendar_id)
    ok = update_google_event(email, event_id, patch_data)
    if ok:
        _invalidate_calendar_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error updating event")


# ── DELETE /events/{event_id} ──────────────────────────────────────────────────


@router.delete(
    "/events/{event_id}",
    response_model=calendar_schemas.CalendarStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def delete_event(
    event_id: str,
    email: str = Query(...),
    calendar_id: str = Query("primary"),
    vault_path: Optional[str] = Query(None),
) -> dict[str, str]:
    """Deletes an event from Google Calendar or the vault."""
    if vault_path:
        p = _safe_calendar_path(vault_path)
        if p is None:
            raise HTTPException(
                status_code=400, detail="Invalid vault_path or path outside the Calendar directory"
            )
        if p.exists():
            # We don't delete permanently: we move to the Vault trash
            # (recoverable), consistent with DELETE /api/vault/pages. It used to do
            # `p.unlink()`, so a Vault event deleted through this path
            # was lost forever, bypassing the trash. `event_id` is the id
            # of the Vault page.
            from backend.api.vault_routes import _move_page_to_trash

            move_to_trash = cast(Callable[[str, Path], object], _move_page_to_trash)
            move_to_trash(event_id, p)
            _invalidate_calendar_cache()
            return {"status": "success"}

    from backend.services.google_calendar_service import get_google_calendar_service

    service = get_google_calendar_service(email)
    if not service:
        raise HTTPException(status_code=500, detail="No calendar service")
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
        _invalidate_calendar_cache()
        return {"status": "success"}
    except Exception as e:
        log.error(f"DELETE /events/{event_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, f"DELETE /events/{event_id}"),
        )


# ── POST /freebusy ─────────────────────────────────────────────────────────────


@router.post("/freebusy", response_model=calendar_schemas.FreeBusyResponse, response_model_exclude_unset=True)
async def post_freebusy(
    email: str = Query(...),
    time_min: str = Body(...),
    time_max: str = Body(...),
    calendar_ids: list[Any] = Body(None),
) -> Any:
    try:
        return get_google_calendar_free_busy(email, time_min, time_max, calendar_ids)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /freebusy"),
        )


# ── GET /feed.ics ──────────────────────────────────────────────────────────────


@router.get("/feed.ics", response_class=Response, response_model=None)
def get_ics_feed(
    time_min: Optional[str] = Query(None),
    time_max: Optional[str] = Query(None),
) -> Response:
    """Generate an .ics of all events (local vault + Google Calendar)."""
    cal = Calendar()
    cal.add("prodid", "-//Gnosi PIM//ismaelgarcia.net//")
    cal.add("version", "2.0")

    t_min, t_max = _default_range()
    events = _get_vault_events(time_min or t_min, time_max or t_max, None)

    for ev in events:
        try:
            ical_event = Event()
            ical_event.add("summary", ev["title"])
            start_str = ev["start"]
            if start_str:
                dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                ical_event.add("dtstart", dt)
            end_str = ev.get("end")
            if end_str:
                dt_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                ical_event.add("dtend", dt_end)
            if ev.get("description"):
                ical_event.add("description", ev["description"])
            ical_event.add("uid", ev["id"] + "@gnosi.local")
            cal.add_component(ical_event)
        except Exception:
            continue

    return Response(content=cal.to_ical(), media_type="text/calendar")


# ── POST /sync (no-op — the hybrid architecture doesn't need sync) ──────────────


@router.post("/sync", response_model=calendar_schemas.CalendarSyncResponse, dependencies=[Depends(require_role("editor"))])
async def sync_calendar_accounts(
    email: Optional[str] = Query(None),
) -> dict[str, str | int]:
    """
        With the hybrid architecture, syncing to the vault is no longer necessary.
    Kept for compatibility but does nothing.

    """
    log.info("POST /api/calendar/sync — no-op (arquitectura híbrida activa)")
    return {
        "status": "success",
        "synced_count": 0,
        "message": "Hybrid mode: direct API queries, no vault sync needed",
    }


# ── GET /attendees/search ──────────────────────────────────────────────────────


@router.get("/attendees/search", response_model=list[calendar_schemas.CalendarAttendeeSearchResponse])
async def search_attendees(
    q: str = Query(..., min_length=1),
) -> list[dict[str, str]]:
    """Search Google contacts for autocomplete in the attendees form."""
    from backend.services.integration_manager import integration_manager
    from backend.services.google_contacts_service import (
        list_google_contacts,
        parse_google_contact_to_dict,
    )

    integrations = integration_manager.get_all_safe()
    accounts = integrations.get("contacts", []) or integrations.get("calendars", [])
    q_lower = q.lower().strip()
    results = []
    seen = set()

    for acc in accounts[:2]:
        email = acc.get("email")
        if not email:
            continue
        try:
            contacts = list_google_contacts(email)
            for c in contacts:
                parsed = parse_google_contact_to_dict(c)
                name = parsed.get("name", "")
                # `parse_google_contact_to_dict` exposes the email as `email` (singular
                # string), not `emails` (list): always iterate `parsed.get("emails", [])`
                # returned [] → the assistant autocomplete remained EMPTY for every query.
                addr = parsed.get("email", "")
                if not addr or addr in seen:
                    continue
                if q_lower not in addr.lower() and q_lower not in name.lower():
                    continue
                seen.add(addr)
                results.append({"email": addr, "name": name})
                if len(results) >= 8:
                    break
            if len(results) >= 8:
                break
        except Exception as ex:
            log.warning(f"search_attendees: {ex}")

    return results


# ── GET /geocode ──────────────────────────────────────────────────────────────


@router.get("/geocode", response_model=list[calendar_schemas.CalendarGeocodeResponse])
async def geocode_location(
    q: str = Query(..., min_length=3),
) -> list[dict[str, Any]]:
    """Autocompletes/verifies addresses via Photon (OpenStreetMap). No API key needed.

    Returns a list of suggestions [{label, lat, lon}] for the Location field
    of the appointments form. Doesn't geocode if the query looks like a URL.

    """
    return await search_photon(q)


# ── POST /events/{event_id}/rsvp ──────────────────────────────────────────────


async def rsvp_event(event_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Accepts, declines, or marks as tentative a Google Calendar invitation."""
    email = body.get("email")
    calendar_id = body.get("calendar_id", "primary")
    rsvp = body.get("rsvp")

    if not email or not rsvp:
        raise HTTPException(status_code=400, detail="email i rsvp són requerits")
    if rsvp not in ("accepted", "declined", "tentative", "needsAction"):
        raise HTTPException(status_code=400, detail="rsvp invàlid")

    ok = respond_to_invitation(email, event_id, rsvp, calendar_id)
    if not ok:
        raise HTTPException(
            status_code=503, detail="Could not update the response in Google Calendar"
        )

    _invalidate_calendar_cache()
    return {"ok": True, "rsvp": rsvp}


@router.post("/events/{event_id}/rsvp", response_model=calendar_schemas.CalendarRsvpResponse, dependencies=[Depends(require_role("editor"))], name="rsvp_event")
async def _rsvp_event_endpoint(event_id: str, body: calendar_schemas.CalendarRsvpRequest = Body(...)) -> dict[str, Any]:
    return await rsvp_event(event_id, body.model_dump(exclude_unset=True, by_alias=True))


# ── POST /events/{event_id}/invite ────────────────────────────────────────────


async def invite_to_event(event_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """
        Adds guests to an event.
    - Google Calendar: patch + sendUpdates='all' (Google sends the invitations)
    - Vault: sends an HTML email via Gmail API

    """
    email = body.get("email")
    attendees = body.get("attendees", [])
    calendar_id = body.get("calendar_id", "primary")
    is_vault = body.get("is_vault", False)
    event_data = body.get("event_data", {})

    if not email or not attendees:
        raise HTTPException(status_code=400, detail="email i attendees són requerits")

    if is_vault:
        from backend.services.google_mail_service import send_new_message

        title = event_data.get("title", "Cita")
        date_str = event_data.get("date", "")
        location = event_data.get("location", "")
        description = event_data.get("description", "")

        failed = []
        for att in attendees:
            addr = att.get("email", "")
            if not addr:
                continue
            loc_html = f"<p><strong>Lloc:</strong> {location}</p>" if location else ""
            desc_html = f"<p><strong>Descripció:</strong> {description}</p>" if description else ""
            html = (
                f"<h2>T'han convidat a: {title}</h2>"
                f"<p><strong>Data:</strong> {date_str}</p>"
                f"{loc_html}{desc_html}"
                f"<p style='color:#888;font-size:12px'>Invitació enviada des de <strong>Gnosi</strong>.</p>"
            )
            if not send_new_message(email, addr, f"Invitació: {title}", html):
                failed.append(addr)

        if failed:
            return {"ok": False, "failed": failed, "sent": len(attendees) - len(failed)}
        return {"ok": True, "sent": len(attendees)}

    else:
        ok = patch_event_attendees(email, event_id, attendees, calendar_id)
        if not ok:
            raise HTTPException(
                status_code=503, detail="Could not update the guests in Google Calendar"
            )
        _invalidate_calendar_cache()
        return {"ok": True}


@router.post("/events/{event_id}/invite", response_model=calendar_schemas.CalendarInviteResponse, response_model_exclude_unset=True, name="invite_to_event")
async def _invite_to_event_endpoint(event_id: str, body: calendar_schemas.CalendarInviteRequest = Body(...)) -> dict[str, Any]:
    return await invite_to_event(event_id, body.model_dump(exclude_unset=True, by_alias=True))


# ── POST /events/{event_id}/hide ─────────────────────────────────────────────


@router.post("/events/{event_id}/hide", response_model=calendar_schemas.CalendarStatusMessageResponse)
async def hide_event(event_id: str) -> dict[str, str]:
    """Hides an event locally."""
    session = get_mgmt_session()
    try:
        exists = session.query(HiddenEvent).filter_by(event_id=event_id).first()
        if not exists:
            new_hidden = HiddenEvent(event_id=event_id)
            session.add(new_hidden)
            session.commit()
        _invalidate_calendar_cache()
        return {"status": "success", "message": "Event hidden"}
    except Exception as e:
        session.rollback()
        log.error(f"Error amagant esdeveniment: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /events/{event_id}/hide"),
        )
    finally:
        session.close()


@router.post("/events/{event_id}/unhide", response_model=calendar_schemas.CalendarStatusMessageResponse)
async def unhide_event(event_id: str) -> dict[str, str]:
    """Show a hidden event again."""
    session = get_mgmt_session()
    try:
        session.query(HiddenEvent).filter_by(event_id=event_id).delete()
        session.commit()
        _invalidate_calendar_cache()
        return {"status": "success", "message": "Event unhidden"}
    except Exception as e:
        session.rollback()
        log.error(f"Error desamagant esdeveniment: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /events/{event_id}/unhide"),
        )
    finally:
        session.close()
