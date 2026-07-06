"""Motor del notificador de reunions amb IA (ordre del dia).

Escaneja reunions properes, genera una ORDRE DEL DIA amb IA i dispara avisos
(natiu macOS + BD + Markdown via `notify()`). Manté estat persistent a
`LOCAL_DATA/system/meeting_reminders.json` perquè:
  - no avisi dues vegades de la mateixa reunió (dedup per clau `id|start`),
  - el frontend pugui llegir els recordatoris ACTIUS (banner) amb l'agenda ja
    generada, sense tornar a cridar la IA.

L'executa la tasca `meeting_reminders` de l'scheduler (cada minut). Tot el camí
degrada amb elegància: si no hi ha proveïdor d'IA, el recordatori s'envia
igualment sense agenda; si no es poden recollir events, no peta la tasca.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_json

log = logging.getLogger(__name__)

# Serialitza el cicle SENCER load→modify→save de meeting_reminders.json. Hi ha
# QUATRE mutadors concurrents: `scan_and_notify` (fil de l'scheduler, cada
# minut), `dismiss` i `update_settings` (handlers de l'API) i el prune de
# `get_active` (GET del banner). Sense candau, dues mutacions llegien el mateix
# snapshot i l'última escriptura esclafava l'altra (p.ex. un dismiss perdut
# perquè l'escaneig desava després amb l'estat vell). És un threading.Lock (no
# asyncio.Lock) perquè l'scheduler corre en un fil propi, fora de l'event loop.
_state_lock = threading.Lock()

DEFAULT_SETTINGS = {
    "enabled": False,
    "lead_minutes": 10,
}
_GRACE_MINUTES = 5            # manté el recordatori actiu fins X min després de l'inici
_NOTIFIED_TTL_HOURS = 24      # neteja claus de dedup més velles que això


# ── Estat persistent ─────────────────────────────────────────────────────────

def _state_path() -> Optional[Path]:
    cfg = load_params(strict_env=False)
    local_data = cfg.paths.get("LOCAL_DATA")
    if not local_data:
        return None
    p = Path(local_data) / "system" / "meeting_reminders.json"
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return p


def _load_state() -> dict:
    path = _state_path()
    if path and path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("settings", {})
                data.setdefault("notified", {})
                data.setdefault("active", [])
                for k, v in DEFAULT_SETTINGS.items():
                    data["settings"].setdefault(k, v)
                return data
        except Exception as e:
            log.warning(f"meeting_reminders: estat il·legible ({e}); reinici net.")
    return {"settings": dict(DEFAULT_SETTINGS), "notified": {}, "active": []}


def _save_state(state: dict) -> None:
    path = _state_path()
    if not path:
        return
    try:
        safe_write_json(path, state, indent=2)
    except Exception as e:
        log.warning(f"meeting_reminders: no s'ha pogut desar l'estat: {e}")


# ── Settings ─────────────────────────────────────────────────────────────────

def get_settings() -> dict:
    return _load_state()["settings"]


def update_settings(patch: dict) -> dict:
    with _state_lock:
        state = _load_state()
        s = state["settings"]
        if "enabled" in patch:
            s["enabled"] = bool(patch["enabled"])
        if "lead_minutes" in patch:
            try:
                s["lead_minutes"] = max(1, min(120, int(patch["lead_minutes"])))
            except (TypeError, ValueError):
                pass
        _save_state(state)
        return s


# ── Helpers de temps ─────────────────────────────────────────────────────────

def _parse_dt(value) -> Optional[datetime]:
    """Parseja una data ISO d'event a datetime aware (UTC si no porta tz)."""
    if not value:
        return None
    raw = str(value).strip()
    try:
        if len(raw) == 10:  # all-day "2026-06-21"
            dt = datetime.fromisoformat(raw)
        else:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _event_key(ev: dict) -> str:
    return f"{ev.get('id', '')}|{ev.get('start', '')}"


def _attendees_str(attendees) -> str:
    if not isinstance(attendees, list):
        return ""
    names = []
    for a in attendees:
        if isinstance(a, dict):
            label = a.get("name") or a.get("email")
            if label:
                names.append(label)
    return ", ".join(names)


# ── Generació de l'ordre del dia amb IA ──────────────────────────────────────

def _generate_agenda(ev: dict) -> str:
    """Genera una ordre del dia breu (vinyetes Markdown) a partir del títol +
    descripció de l'event. Torna "" si la IA falla o no hi ha proveïdor."""
    title = (ev.get("title") or "").strip()
    desc = (ev.get("description") or "").strip()
    location = (ev.get("location") or "").strip()
    who = _attendees_str(ev.get("attendees"))

    prompt = (
        "Ets un assistent que prepara reunions. A partir de la informació "
        "següent, proposa una ORDRE DEL DIA breu i accionable (3-6 punts en "
        "vinyetes Markdown). Respon NOMÉS amb les vinyetes, en el mateix idioma "
        "del títol, sense cap introducció.\n\n"
        f"Títol: {title}\n"
        f"Lloc: {location or '—'}\n"
        f"Assistents: {who or '—'}\n"
        f"Descripció: {desc or '—'}\n"
    )
    try:
        from backend.agent.factory import generate_text
        content, _model = generate_text(prompt, user_message=title)
        return (content or "").strip()
    except Exception as e:
        log.info(f"meeting_reminders: sense agenda IA ({e}).")
        return ""


# ── Avís (natiu macOS + BD + MD) ─────────────────────────────────────────────

def _dispatch_notification(reminder: dict) -> None:
    mins = reminder.get("minutes_until", 0)
    when = "ara" if mins <= 0 else f"en {mins} min"
    title = f"🔔 Reunió {when}: {reminder.get('title', '')}"
    parts = []
    if reminder.get("location"):
        parts.append(f"📍 {reminder['location']}")
    if reminder.get("agenda"):
        parts.append("Ordre del dia:\n" + reminder["agenda"])
    else:
        parts.append("Tens una reunió a punt de començar.")
    message = "\n".join(parts)
    try:
        from pipeline.skills.notification_service.scripts.notification_service import notify
        notify(title, message, level="INFO")
    except Exception as e:
        log.warning(f"meeting_reminders: notify ha fallat: {e}")


# ── Escaneig principal (cridat per l'scheduler) ──────────────────────────────

def scan_and_notify() -> dict:
    """Escaneja reunions dins de [ara, ara+lead] i n'avisa (un cop per reunió).

    Retorna un resum {enabled, new, active}. Pensada per a córrer cada minut.
    """
    state = _load_state()
    settings = state["settings"]
    if not settings.get("enabled"):
        return {"enabled": False, "new": 0, "active": len(state.get("active", []))}

    lead = int(settings.get("lead_minutes", 10))
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(minutes=lead)
    time_min = (now - timedelta(minutes=_GRACE_MINUTES)).isoformat()
    time_max = window_end.isoformat()

    try:
        from backend.api.calendar_routes import collect_all_events
        events = collect_all_events(time_min, time_max, include_vault=True)
    except Exception as e:
        log.warning(f"meeting_reminders: no s'han pogut recollir events: {e}")
        return {"enabled": True, "new": 0, "error": str(e)}

    notified = state["notified"]
    new_reminders: list = []
    new_count = 0

    for ev in events:
        if ev.get("all_day"):
            continue  # els esdeveniments de tot el dia no són reunions puntuals
        start = _parse_dt(ev.get("start"))
        if not start:
            continue
        if start < now - timedelta(minutes=_GRACE_MINUTES) or start > window_end:
            continue
        key = _event_key(ev)
        if key in notified:
            continue  # ja avisat

        agenda = _generate_agenda(ev)
        minutes_until = max(0, int((start - now).total_seconds() // 60))
        reminder = {
            "id": ev.get("id"),
            "key": key,
            "title": ev.get("title") or "(sense títol)",
            "start": ev.get("start"),
            "end": ev.get("end"),
            "location": ev.get("location") or "",
            "attendees": ev.get("attendees") or [],
            "agenda": agenda,
            "provider": ev.get("provider"),
            "vault_path": ev.get("vault_path"),
            "minutes_until": minutes_until,
            "dismissed": False,
            "created_at": now.isoformat(),
        }
        notified[key] = now.isoformat()
        new_reminders.append(reminder)
        new_count += 1
        _dispatch_notification(reminder)

    # Fusió sota candau: la generació d'agenda amb IA (a dalt) pot trigar
    # segons. Si mentrestant l'usuari ha fet un dismiss o ha tocat settings,
    # desar el snapshot vell ho esclafaria (recordatoris descartats que
    # "ressusciten"). Recarreguem l'estat FRESC i hi apliquem només els deltes.
    with _state_lock:
        fresh = _load_state()
        fresh_active = {a["id"]: a for a in fresh.get("active", []) if a.get("id")}
        for reminder in new_reminders:
            if reminder["key"] in fresh["notified"]:
                continue  # un altre escaneig ja l'havia registrat
            fresh_active[reminder["id"]] = reminder
            fresh["notified"][reminder["key"]] = now.isoformat()
        fresh["active"] = _prune_active(list(fresh_active.values()), now)
        fresh["notified"] = _prune_notified(fresh["notified"], now)
        _save_state(fresh)
        return {"enabled": True, "new": new_count, "active": len(fresh["active"])}


def _prune_active(active: list, now: datetime) -> list:
    out = []
    for a in active:
        if a.get("dismissed"):
            continue
        start = _parse_dt(a.get("start"))
        if start and now - start > timedelta(minutes=_GRACE_MINUTES):
            continue  # reunió començada fa estona → treu el banner
        out.append(a)
    return out


def _prune_notified(notified: dict, now: datetime) -> dict:
    out = {}
    for key, ts in notified.items():
        t = _parse_dt(ts)
        if t and now - t > timedelta(hours=_NOTIFIED_TTL_HOURS):
            continue
        out[key] = ts
    return out


# ── Consulta des del frontend (banner) ───────────────────────────────────────

def get_active(now: Optional[datetime] = None) -> list:
    """Recordatoris actius per al banner, amb `minutes_until` recalculat."""
    now = now or datetime.now(timezone.utc)
    with _state_lock:
        state = _load_state()
        pruned = _prune_active(state.get("active", []), now)
        if len(pruned) != len(state.get("active", [])):
            state["active"] = pruned
            _save_state(state)
    result = []
    for a in pruned:
        start = _parse_dt(a.get("start"))
        mins = max(0, int((start - now).total_seconds() // 60)) if start else 0
        item = dict(a)
        item["minutes_until"] = mins
        result.append(item)
    result.sort(key=lambda r: r.get("minutes_until", 0))
    return result


def dismiss(reminder_id: str) -> bool:
    with _state_lock:
        state = _load_state()
        before = len(state.get("active", []))
        state["active"] = [a for a in state.get("active", []) if a.get("id") != reminder_id]
        if len(state["active"]) != before:
            _save_state(state)
            return True
        return False
