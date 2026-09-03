"""Calendar mutation helpers independent from FastAPI transport concerns."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import re

import yaml

JsonObject = dict[str, object]


def parse_frontmatter(content: str) -> tuple[dict[object, object], str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not match:
        return {}, content
    try:
        metadata = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}, content
    return (metadata if isinstance(metadata, dict) else {}), content[match.end() :]


def patch_vault_event(
    path: Path,
    patch: JsonObject,
    write_text: Callable[[Path, str], None],
) -> None:
    metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    allowed = {"date", "end_date", "title", "location", "description", "all_day"}
    for key, value in patch.items():
        if key in allowed:
            metadata[key] = value
    frontmatter = yaml.dump(metadata, default_flow_style=False, allow_unicode=True)
    write_text(path, f"---\n{frontmatter}---\n\n{body}\n")


async def respond_to_event(
    event_id: str,
    body: JsonObject,
    responder: Callable[[str, str, str, str], bool],
    invalidate: Callable[[], None],
) -> JsonObject:
    email = body.get("email")
    calendar_id = body.get("calendar_id", "primary")
    rsvp = body.get("rsvp")
    if not isinstance(email, str) or not email or not isinstance(rsvp, str) or not rsvp:
        raise ValueError("missing")
    if rsvp not in ("accepted", "declined", "tentative", "needsAction"):
        raise ValueError("invalid")
    calendar = calendar_id if isinstance(calendar_id, str) else str(calendar_id)
    if not responder(email, event_id, rsvp, calendar):
        raise RuntimeError("provider")
    invalidate()
    return {"ok": True, "rsvp": rsvp}


def invite_google_event(
    event_id: str,
    email: str,
    attendees: list[dict[str, object]],
    calendar_id: str,
    patch_attendees: Callable[[str, str, list[dict[str, object]], str], bool],
    invalidate: Callable[[], None],
) -> JsonObject:
    if not patch_attendees(email, event_id, attendees, calendar_id):
        raise RuntimeError("provider")
    invalidate()
    return {"ok": True}


def invite_vault_event(
    email: str,
    attendees: list[dict[str, object]],
    event_data: dict[str, object],
    send_message: Callable[[str, str, str, str], bool],
) -> JsonObject:
    """Send a local Vault event invitation to every attendee."""
    title = event_data.get("title", "Cita")
    date = event_data.get("date", "")
    location = event_data.get("location", "")
    description = event_data.get("description", "")
    location_html = f"<p><strong>Lloc:</strong> {location}</p>" if location else ""
    description_html = f"<p><strong>Descripció:</strong> {description}</p>" if description else ""
    body = (
        f"<h2>T'han convidat a: {title}</h2>"
        f"<p><strong>Data:</strong> {date}</p>"
        f"{location_html}{description_html}"
        "<p style='color:#888;font-size:12px'>Invitació enviada des de "
        "<strong>Gnosi</strong>.</p>"
    )
    failed: list[str] = []
    for attendee in attendees:
        address = attendee.get("email", "")
        if not isinstance(address, str) or not address:
            continue
        if not send_message(email, address, f"Invitació: {title}", body):
            failed.append(address)
    if failed:
        return {"ok": False, "failed": failed, "sent": len(attendees) - len(failed)}
    return {"ok": True, "sent": len(attendees)}
