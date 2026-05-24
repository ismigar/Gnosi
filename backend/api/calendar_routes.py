from fastapi import APIRouter, Response, Query, Body, HTTPException, Depends
from pathlib import Path
import asyncio
import functools
import re
import yaml
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional
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

router = APIRouter(
    prefix="/api/calendar", tags=["Calendar"], dependencies=[Depends(get_workspace_context)]
)
log = logging.getLogger(__name__)

# ── Cache ──────────────────────────────────────────────────────────────────────
_EVENTS_CACHE: dict = {}
_EVENTS_CACHE_TTL = 300  # seconds
_CALS_CACHE: dict = {}
_CALS_CACHE_TTL = 300  # 5 min (les llistes de calendaris canvien poc)


def _invalidate_calendar_cache():
    _EVENTS_CACHE.clear()


def _get_calendar_storage_path() -> Path:
    base = get_active_vault_path()
    p = base / "Calendar"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _get_hidden_event_ids() -> set[str]:
    """Retorna el conjunt d'IDs d'esdeveniments amagats localment."""
    session = get_mgmt_session()
    try:
        hidden = session.query(HiddenEvent.event_id).all()
        return {h[0] for h in hidden}
    except Exception as e:
        log.warning(f"Error recuperant esdeveniments amagats: {e}")
        return set()
    finally:
        session.close()


def get_frontmatter(content: str):
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        try:
            return yaml.safe_load(match.group(1)) or {}, content[match.end():]
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

@router.get("/calendars")
async def get_calendars(response: Response, email: Optional[str] = Query(None)):
    """Retorna la llista de calendaris disponibles per a un compte o per a tots.

    Si algun compte té el token de Google caducat/revocat, NO es trenca la
    resposta (es retornen els calendaris dels comptes vàlids) però s'afegeix la
    capçalera `X-Calendar-Auth-Error` amb els emails afectats perquè la UI pugui
    demanar reconnexió en lloc de mostrar una llista buida silenciosament.
    """
    from backend.services.hybrid_calendar_service import list_calendars, GoogleAuthExpired
    from backend.services.integration_manager import integration_manager

    integrations = integration_manager.get_all_safe()
    all_accounts = integrations.get("calendars", []) + integrations.get("emails", [])

    if email:
        email_list = [email]
    else:
        email_list = list({
            a.get("email") or a.get("username")
            for a in all_accounts
            if a.get("email") or a.get("username")
        })

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
            # Token caducat: no caixegem (perquè un retry post-reconnexió funcioni)
            # i marquem el compte com a afectat.
            auth_errors.append(em)
            continue
        _CALS_CACHE[em] = {"data": cals, "expiry": time.time() + _CALS_CACHE_TTL}
        results.extend(cals)

    if auth_errors:
        response.headers["X-Calendar-Auth-Error"] = ",".join(auth_errors)
    return results


# ── GET /events ────────────────────────────────────────────────────────────────

@router.get("/events")
async def get_events(
    email: Optional[str] = Query(None),
    time_min: Optional[str] = Query(None),
    time_max: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    calendar_id: Optional[str] = Query(None),
    include_vault: bool = Query(True),
):
    """
    Retorna events de Google Calendar / CalDAV directament (sense vault).
    Si include_vault=true, afegeix també les notes del vault amb data.
    """
    from backend.services.hybrid_calendar_service import list_events
    from backend.services.integration_manager import integration_manager

    t_min, t_max = _default_range()
    time_min = time_min or t_min
    time_max = time_max or t_max

    integrations = integration_manager.get_all_safe()
    all_accounts = integrations.get("calendars", []) + integrations.get("emails", [])

    if email:
        email_list = [email]
    else:
        email_list = list({
            a.get("email") or a.get("username")
            for a in all_accounts
            if a.get("email") or a.get("username")
        })

    all_events = []

    for em in email_list:
        cache_key = f"{em}|{time_min}|{time_max}|{search}|{calendar_id}"
        cached = _EVENTS_CACHE.get(cache_key)
        if cached and time.time() < cached["expiry"]:
            all_events.extend(cached["data"])
            continue
        events = await asyncio.to_thread(
            list_events, em, time_min, time_max, search, calendar_id
        )
        _EVENTS_CACHE[cache_key] = {"data": events, "expiry": time.time() + _EVENTS_CACHE_TTL}
        all_events.extend(events)

    # Filtrar esdeveniments amagats
    hidden_ids = _get_hidden_event_ids()
    if hidden_ids:
        all_events = [ev for ev in all_events if ev.get("id") not in hidden_ids]

    # Events del vault (notes locals amb camp date)
    if include_vault:
        vault_events = _get_vault_events(time_min, time_max, search)
        if hidden_ids:
            vault_events = [ev for ev in vault_events if ev.get("id") not in hidden_ids]
        all_events.extend(vault_events)

    return all_events


def _get_vault_events(time_min: str, time_max: str, search: Optional[str]) -> list[dict]:
    """Llegeix notes del vault que tinguin camp 'date' (events locals Gnosi)."""
    try:
        vault_path = get_active_vault_path()
        events = []
        q = (search or "").lower()

        # Exclou la carpeta Calendar/External (eren fitxers de sync antic)
        exclude = vault_path / "Calendar" / "External"

        for md in vault_path.rglob("*.md"):
            if str(md).startswith(str(exclude)):
                continue
            try:
                content = md.read_text(encoding="utf-8")
                meta, body = get_frontmatter(content)
                date_val = meta.get("date")
                if not date_val:
                    continue
                source = meta.get("source", "Gnosi")
                if source and source not in ("Gnosi", "Gnosi Vault") and "External" in str(md):
                    continue
                date_str = str(date_val)
                if date_str < time_min[:10] or date_str > time_max[:10]:
                    continue
                title = meta.get("title") or md.stem
                if q and q not in title.lower() and q not in body.lower():
                    continue
                events.append({
                    "id":            meta.get("id") or md.stem,
                    "vault_path":    str(md),
                    "calendar_id":   "gnosi",
                    "calendar_name": "Gnosi",
                    "title":         title,
                    "start":         date_str,
                    "end":           str(meta.get("end_date") or ""),
                    "all_day":       bool(meta.get("all_day", "T" not in date_str)),
                    "location":      meta.get("location", ""),
                    "description":   body[:500],
                    "source":        source or "Gnosi",
                    "account":       "",
                    "provider":      "vault",
                    "color":         None,
                    "status":        "confirmed",
                    "link":          "",
                    "recurrence":    meta.get("rrule"),
                    "recurring_event_id": None,
                    "is_read_only":  False,
                })
            except Exception:
                continue
        return events
    except Exception as ex:
        log.warning(f"_get_vault_events: {ex}")
        return []


# ── GET /events/{event_id} ─────────────────────────────────────────────────────

@router.get("/events/{event_id}")
async def get_event(
    event_id: str,
    email: str = Query(...),
    calendar_id: Optional[str] = Query(None),
):
    """Retorna el detall d'un event (Google Calendar o CalDAV)."""
    from backend.services.hybrid_calendar_service import get_event as _get_event
    ev = _get_event(email, event_id, calendar_id)
    if ev:
        return ev
    raise HTTPException(status_code=404, detail="Event not found")


# ── POST /events ───────────────────────────────────────────────────────────────

@router.post("/events", dependencies=[Depends(require_role("editor"))])
async def post_event(
    email: str = Query(...),
    calendar_id: str = Query("primary"),
    event_data: dict = Body(...),
):
    """Crea un nou event a Google Calendar."""
    try:
        event = create_google_calendar_event(email, event_data, calendar_id)
        if event:
            _invalidate_calendar_cache()
            return event
        raise HTTPException(status_code=500, detail="Failed to create event")
    except Exception as e:
        log.error(f"POST /events: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, "POST /events"))


# ── PATCH /events/{event_id} ───────────────────────────────────────────────────

@router.patch("/events/{event_id}", dependencies=[Depends(require_role("editor"))])
async def patch_event(
    event_id: str,
    email: str = Query(...),
    calendar_id: str = Query("primary"),
    patch_data: dict = Body(...),
):
    """Actualitza un event existent (Google Calendar o vault local)."""
    # Vault local
    if patch_data.get("provider") == "vault" or patch_data.get("vault_path"):
        vault_path = patch_data.get("vault_path")
        if vault_path:
            p = Path(vault_path)
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

    # Google Calendar — passa calendar_id via patch_data perquè update_google_event l'accepti
    patch_data.setdefault("calendar_id", calendar_id)
    ok = update_google_event(email, event_id, patch_data)
    if ok:
        _invalidate_calendar_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error updating event")


# ── DELETE /events/{event_id} ──────────────────────────────────────────────────

@router.delete("/events/{event_id}", dependencies=[Depends(require_role("editor"))])
async def delete_event(
    event_id: str,
    email: str = Query(...),
    calendar_id: str = Query("primary"),
    vault_path: Optional[str] = Query(None),
):
    """Elimina un event de Google Calendar o del vault."""
    if vault_path:
        p = Path(vault_path)
        if p.exists():
            p.unlink()
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

@router.post("/freebusy")
async def post_freebusy(
    email: str = Query(...),
    time_min: str = Body(...),
    time_max: str = Body(...),
    calendar_ids: list = Body(None),
):
    try:
        return get_google_calendar_free_busy(email, time_min, time_max, calendar_ids)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /freebusy"),
        )


# ── GET /feed.ics ──────────────────────────────────────────────────────────────

@router.get("/feed.ics", response_class=Response)
def get_ics_feed(
    time_min: Optional[str] = Query(None),
    time_max: Optional[str] = Query(None),
):
    """Genera un .ics de tots els events (vault locals + Google Calendar)."""
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


# ── POST /sync (no-op — l'arquitectura híbrida no necessita sync) ──────────────

@router.post("/sync", dependencies=[Depends(require_role("editor"))])
async def sync_calendar_accounts(email: Optional[str] = Query(None)):
    """
    Amb l'arquitectura híbrida el sync al vault ja no és necessari.
    Es manté per compatibilitat però no fa res.
    """
    log.info("POST /api/calendar/sync — no-op (arquitectura híbrida activa)")
    return {"status": "success", "synced_count": 0, "message": "Hybrid mode: direct API queries, no vault sync needed"}


# ── GET /attendees/search ──────────────────────────────────────────────────────

@router.get("/attendees/search")
async def search_attendees(q: str = Query(..., min_length=1)):
    """Cerca contactes de Google per autocomplete al formulari d'attendees."""
    from backend.services.integration_manager import integration_manager
    from backend.services.google_contacts_service import list_google_contacts, parse_google_contact_to_dict

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
                for ce in parsed.get("emails", []):
                    addr = ce.get("email", "")
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


# ── POST /events/{event_id}/rsvp ──────────────────────────────────────────────

@router.post("/events/{event_id}/rsvp", dependencies=[Depends(require_role("editor"))])
async def rsvp_event(event_id: str, body: dict = Body(...)):
    """Accepta, rebutja o marca com a tentativa una invitació de Google Calendar."""
    email = body.get("email")
    calendar_id = body.get("calendar_id", "primary")
    rsvp = body.get("rsvp")

    if not email or not rsvp:
        raise HTTPException(status_code=400, detail="email i rsvp són requerits")
    if rsvp not in ("accepted", "declined", "tentative", "needsAction"):
        raise HTTPException(status_code=400, detail="rsvp invàlid")

    ok = respond_to_invitation(email, event_id, rsvp, calendar_id)
    if not ok:
        raise HTTPException(status_code=503, detail="No s'ha pogut actualitzar la resposta a Google Calendar")

    _invalidate_calendar_cache()
    return {"ok": True, "rsvp": rsvp}


# ── POST /events/{event_id}/invite ────────────────────────────────────────────

@router.post("/events/{event_id}/invite")
async def invite_to_event(event_id: str, body: dict = Body(...)):
    """
    Afegeix convidats a un event.
    - Google Calendar: patch + sendUpdates='all' (Google envia les invitacions)
    - Vault: envia email HTML via Gmail API
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
            raise HTTPException(status_code=503, detail="No s'ha pogut actualitzar els convidats a Google Calendar")
        _invalidate_calendar_cache()
        return {"ok": True}


# ── POST /events/{event_id}/hide ─────────────────────────────────────────────

@router.post("/events/{event_id}/hide")
async def hide_event(event_id: str):
    """Amaga un esdeveniment localment."""
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


@router.post("/events/{event_id}/unhide")
async def unhide_event(event_id: str):
    """Torna a mostrar un esdeveniment amagat."""
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
