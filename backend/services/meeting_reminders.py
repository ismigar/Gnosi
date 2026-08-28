"""AI-powered meeting reminder engine (agenda).

Scans upcoming meetings, generates an AGENDA with AI, and fires notifications
(native macOS + BD + Markdown via `notify()`). Keeps persistent state in
`LOCAL_DATA/system/meeting_reminders.json` so that:
  - the same meeting isn't notified twice (dedup by key `id|start`),
  - the frontend can read the ACTIVE reminders (banner) with the agenda already
    generated, without calling the AI again.

Run by the scheduler's `meeting_reminders` task (every minute). The whole path
degrades gracefully: if there's no AI provider, the reminder is still sent
without an agenda; if events can't be collected, the task doesn't crash.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional, cast

from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_json

log = logging.getLogger(__name__)
JsonObject = dict[str, Any]

# Serializes the WHOLE load→modify→save cycle of meeting_reminders.json. There are
# FOUR concurrent mutators: `scan_and_notify` (scheduler thread, every
# minute), `dismiss` and `update_settings` (API handlers), and the prune of
# `get_active` (banner GET). Without a lock, two mutations would read the same
# snapshot and the last write clobbered the other (e.g. a lost dismiss
# because the scan saved afterward with the old state). It's a threading.Lock (not
# asyncio.Lock) because the scheduler runs on its own thread, outside the event loop.
_state_lock = threading.Lock()

DEFAULT_SETTINGS = {
    "enabled": False,
    "lead_minutes": 10,
}
_GRACE_MINUTES = 5            # keeps the reminder active until X min after the start
_NOTIFIED_TTL_HOURS = 24      # cleans up dedup keys older than this


# ── Persistent state ─────────────────────────────────────────────────────────

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


def _load_state() -> JsonObject:
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
                return cast(JsonObject, data)
        except Exception as e:
            log.warning(f"meeting_reminders: unreadable state ({e}); starting clean.")
    return {"settings": dict(DEFAULT_SETTINGS), "notified": {}, "active": []}


def _save_state(state: JsonObject) -> None:
    path = _state_path()
    if not path:
        return
    try:
        safe_write_json(path, state, indent=2)
    except Exception as e:
        log.warning(f"meeting_reminders: could not save state: {e}")


# ── Settings ─────────────────────────────────────────────────────────────────

def get_settings() -> JsonObject:
    return cast(JsonObject, _load_state()["settings"])


def update_settings(patch: JsonObject) -> JsonObject:
    with _state_lock:
        state = _load_state()
        s = cast(JsonObject, state["settings"])
        if "enabled" in patch:
            s["enabled"] = bool(patch["enabled"])
        if "lead_minutes" in patch:
            try:
                s["lead_minutes"] = max(1, min(120, int(patch["lead_minutes"])))
            except (TypeError, ValueError):
                pass
        _save_state(state)
        return s


# ── Time helpers ─────────────────────────────────────────────────────────

def _parse_dt(value: object) -> Optional[datetime]:
    """Parses an event's ISO date into an aware datetime (UTC if it has no tz)."""
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


def _event_key(ev: JsonObject) -> str:
    return f"{ev.get('id', '')}|{ev.get('start', '')}"


def _attendees_str(attendees: object) -> str:
    if not isinstance(attendees, list):
        return ""
    names = []
    for a in attendees:
        if isinstance(a, dict):
            label = a.get("name") or a.get("email")
            if label:
                names.append(str(label))
    return ", ".join(names)


# ── AI agenda generation ──────────────────────────────────────

def _generate_agenda(ev: JsonObject) -> str:
    """Generates a brief agenda (Markdown bullets) from the event's title +
    description. Returns "" if the AI fails or there's no provider."""
    title = str(ev.get("title") or "").strip()
    desc = str(ev.get("description") or "").strip()
    location = str(ev.get("location") or "").strip()
    who = _attendees_str(ev.get("attendees"))

    prompt = (
        "You are an assistant who prepares meetings. From the following "
        "information, propose a brief, actionable AGENDA with 3–6 Markdown "
        "bullet points. Respond ONLY with the bullet points, in the same "
        "language as the title, without an introduction.\n\n"
        f"Title: {title}\n"
        f"Location: {location or '—'}\n"
        f"Attendees: {who or '—'}\n"
        f"Description: {desc or '—'}\n"
    )
    try:
        from backend.agent.factory import generate_text
        content, _model = generate_text(prompt, user_message=title)
        return str(content or "").strip()
    except Exception as e:
        log.info(f"meeting_reminders: AI agenda unavailable ({e}).")
        return ""


# ── Notification (native macOS + BD + MD) ─────────────────────────────────────────────

def _dispatch_notification(reminder: JsonObject) -> None:
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
        log.warning(f"meeting_reminders: notification failed: {e}")


# ── Main scan (called by the scheduler) ──────────────────────────────

def scan_and_notify() -> JsonObject:
    """Scans meetings within [now, now+lead] and notifies about them (once per meeting).

    Returns a summary {enabled, new, active}. Designed to run every minute.
    
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
        log.warning(f"meeting_reminders: could not collect events: {e}")
        return {"enabled": True, "new": 0, "error": str(e)}

    notified = state["notified"]
    new_reminders: list[JsonObject] = []
    new_count = 0

    for ev in events:
        if ev.get("all_day"):
            continue  # all-day events are not point-in-time meetings
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

    # Merge under lock: AI agenda generation (above) can take
    # seconds. If meanwhile the user has dismissed it or touched settings,
    # saving the old snapshot would clobber it (dismissed reminders that
    # "resurrect"). We reload the FRESH state and apply only the deltas to it.
    with _state_lock:
        fresh = _load_state()
        fresh_active = {a["id"]: a for a in fresh.get("active", []) if a.get("id")}
        for reminder in new_reminders:
            if reminder["key"] in fresh["notified"]:
                continue  # another scan had already registered it
            fresh_active[reminder["id"]] = reminder
            fresh["notified"][reminder["key"]] = now.isoformat()
        fresh["active"] = _prune_active(list(fresh_active.values()), now)
        fresh["notified"] = _prune_notified(fresh["notified"], now)
        _save_state(fresh)
        return {"enabled": True, "new": new_count, "active": len(fresh["active"])}


def _prune_active(active: list[JsonObject], now: datetime) -> list[JsonObject]:
    out: list[JsonObject] = []
    for a in active:
        if a.get("dismissed"):
            continue
        start = _parse_dt(a.get("start"))
        if start and now - start > timedelta(minutes=_GRACE_MINUTES):
            continue  # meeting started a while ago → removes the banner
        out.append(a)
    return out


def _prune_notified(notified: JsonObject, now: datetime) -> JsonObject:
    out: JsonObject = {}
    for key, ts in notified.items():
        t = _parse_dt(ts)
        if t and now - t > timedelta(hours=_NOTIFIED_TTL_HOURS):
            continue
        out[key] = ts
    return out


# ── Query from the frontend (banner) ───────────────────────────────────────

def get_active(now: Optional[datetime] = None) -> list[JsonObject]:
    """Active reminders for the banner, with `minutes_until` recalculated."""
    now = now or datetime.now(timezone.utc)
    with _state_lock:
        state = _load_state()
        pruned = _prune_active(state.get("active", []), now)
        if len(pruned) != len(state.get("active", [])):
            state["active"] = pruned
            _save_state(state)
    result: list[JsonObject] = []
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
