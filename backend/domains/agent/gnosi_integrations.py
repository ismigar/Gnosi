"""First-party calendar, mail and contacts tools."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from typing import Any, List, TypeVar, cast

from backend.domains.agent.gnosi_support import (
    _assert_global_integration_access,
    _bounded_limit,
    _confirmation,
    _contact_snapshot,
    _json,
    _mail_message_snapshot,
    _value_revision,
    _workspace_id,
)

_F = TypeVar("_F", bound=Callable[..., Any])
_runtime_tool: Any
try:
    from langchain_core.tools import tool as imported_tool

    _runtime_tool = imported_tool
except Exception:  # pragma: no cover
    _runtime_tool = None


def _typed_tool(function: _F) -> _F:
    return function if _runtime_tool is None else cast(_F, _runtime_tool(function))


@_typed_tool
async def list_calendar_events(
    time_min: str,
    time_max: str,
    search: str = "",
    limit: int = 50,
) -> str:
    """Lists bounded calendar and Vault events in an ISO-8601 time range."""
    import asyncio

    from backend.api.calendar_routes import collect_all_events

    if _workspace_id() != "personal":
        raise PermissionError(
            "Installation-global calendar integrations are unavailable "
            "outside the personal workspace."
        )
    events = await asyncio.to_thread(
        collect_all_events,
        time_min,
        time_max,
        search or None,
        None,
        True,
        None,
    )
    return _json(events[: _bounded_limit(limit)])


@_typed_tool
async def search_mail(
    account: str,
    query: str,
    folder: str = "INBOX",
    limit: int = 20,
) -> str:
    """Searches bounded mail headers and previews for one configured account."""
    from backend.api.mail_routes import get_messages

    account = _assert_global_integration_access(account)
    result = await get_messages(
        email=account,
        folder=folder,
        category=None,
        limit=_bounded_limit(limit),
        offset=0,
        page_token=None,
        search=query,
        force=False,
    )
    messages = list(result.get("messages") or [])[: _bounded_limit(limit)]
    for message in messages:
        for key in ("body_html", "raw", "attachments"):
            message.pop(key, None)
        if "body_text" in message:
            message["body_text"] = str(message["body_text"])[:1000]
    return _json({"messages": messages, "total": result.get("total", len(messages))})


@_typed_tool
def list_contacts(search: str = "", limit: int = 50) -> str:
    """Lists bounded local Gnosi contacts, optionally filtered by name or email."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        contacts = ContactsService(db, _workspace_id()).list_contacts(None, search or None, None)
        rows = []
        for contact in contacts[: _bounded_limit(limit)]:
            rows.append(
                {
                    "id": contact.id,
                    "name": contact.name,
                    "email": contact.email,
                    "phone": contact.phone,
                    "company": contact.company,
                    "job_title": contact.job_title,
                    "source": contact.source,
                }
            )
        return _json(rows)
    finally:
        db.close()


@_typed_tool
async def create_calendar_event(
    account: str,
    title: str,
    start: str,
    end: str,
    calendar_id: str = "primary",
    description: str = "",
    location: str = "",
) -> str:
    """Prepare an external calendar event and wait for confirmation."""
    account = _assert_global_integration_access(account, calendar=True)
    return _confirmation(
        "create_calendar_event",
        {
            "account": account,
            "title": title,
            "start": start,
            "end": end,
            "calendar_id": calendar_id,
            "description": description,
            "location": location,
        },
        {
            "account": account,
            "title": title,
            "start": start,
            "end": end,
            "calendar_id": calendar_id,
            "description": description,
            "location": location,
        },
        destructive=False,
    )


@_typed_tool
def create_contact(
    name: str,
    email: str,
    phone: str = "",
    company: str = "",
    notes: str = "",
) -> str:
    """Creates a local Gnosi contact after an explicit user request."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        contact = ContactsService(db, _workspace_id()).create_contact(
            {
                "name": name,
                "email": email,
                "phone": phone,
                "company": company,
                "notes": notes,
                "source": "local",
            }
        )
        return _json({"status": "created", "id": contact.id, "name": contact.name})
    finally:
        db.close()


@_typed_tool
async def save_mail_draft(
    account: str,
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
) -> str:
    """Prepare an external mail draft and wait for confirmation."""
    account = _assert_global_integration_access(account)
    return _confirmation(
        "save_mail_draft",
        {
            "account": account,
            "to": to,
            "subject": subject,
            "body": body,
            "cc": cc,
            "bcc": bcc,
        },
        {
            "account": account,
            "to": to,
            "cc": cc,
            "bcc": bcc,
            "subject": subject,
            "body": body,
        },
        destructive=False,
    )


@_typed_tool
def delete_contact(contact_id: str) -> str:
    """Prepares deleting a contact and waits for interactive confirmation."""
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        service = ContactsService(db, _workspace_id())
        contact = service.get_contact(contact_id)
        if not contact:
            return _json({"error": "Contact not found."})
        snapshot = _contact_snapshot(contact)
        return _confirmation(
            "delete_contact",
            {
                "contact_id": contact_id,
                "contact_revision": _value_revision(snapshot),
            },
            {
                "contact": contact.name,
                "email": contact.email,
                "phone": contact.phone,
                "company": contact.company,
            },
        )
    finally:
        db.close()


@_typed_tool
async def send_mail(
    account: str,
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
) -> str:
    """Prepares sending mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    return _confirmation(
        "send_mail",
        {
            "account": account,
            "to": to,
            "subject": subject,
            "body": body,
            "cc": cc,
            "bcc": bcc,
        },
        {
            "account": account,
            "to": to,
            "cc": cc,
            "bcc": bcc,
            "subject": subject,
            "body": body,
            "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        },
        destructive=False,
    )


@_typed_tool
async def archive_mail(account: str, message_id: str, folder: str = "") -> str:
    """Prepares archiving mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    message = await _mail_message_snapshot(account, message_id, folder)
    if not message:
        return _json({"error": "Mail message not found for this account."})
    return _confirmation(
        "archive_mail",
        {
            "account": account,
            "message_id": message_id,
            "folder": folder,
            "message_revision": message["message_revision"],
            "message_source": message["message_source"],
        },
        {
            "account": account,
            "folder": folder,
            **message,
        },
        destructive=False,
    )


@_typed_tool
async def move_mail(
    account: str,
    message_id: str,
    target_folder: str,
    folder: str = "",
) -> str:
    """Prepares moving mail and waits for interactive confirmation."""
    account = _assert_global_integration_access(account)
    message = await _mail_message_snapshot(account, message_id, folder)
    if not message:
        return _json({"error": "Mail message not found for this account."})
    return _confirmation(
        "move_mail",
        {
            "account": account,
            "message_id": message_id,
            "target_folder": target_folder,
            "folder": folder,
            "imap_uid": message["imap_uid"],
            "imap_folder": message["imap_folder"],
            "message_revision": message["message_revision"],
            "message_source": message["message_source"],
        },
        {
            "account": account,
            "target_folder": target_folder,
            "folder": folder,
            **message,
        },
        destructive=False,
    )


@_typed_tool
async def invite_attendees(
    account: str,
    event_id: str,
    attendees: List[str],
    calendar_id: str = "primary",
) -> str:
    """Prepares invitations and waits for interactive confirmation."""
    import asyncio

    from backend.services.hybrid_calendar_service import get_event

    account = _assert_global_integration_access(account, calendar=True)
    event = await asyncio.to_thread(
        get_event,
        account,
        event_id,
        calendar_id,
    )
    if not event:
        return _json({"error": "Calendar event not found."})
    event_snapshot = {
        "id": str(event.get("id") or event_id),
        "title": str(event.get("title") or ""),
        "start": str(event.get("start") or ""),
        "end": str(event.get("end") or ""),
        "calendar_id": str(event.get("calendar_id") or calendar_id),
        "attendees": list(event.get("attendees") or []),
    }
    return _confirmation(
        "invite_attendees",
        {
            "account": account,
            "event_id": event_id,
            "attendees": attendees,
            "calendar_id": calendar_id,
            "event_revision": _value_revision(event_snapshot),
        },
        {
            "account": account,
            "event_id": event_id,
            "title": event_snapshot["title"],
            "start": event_snapshot["start"],
            "end": event_snapshot["end"],
            "calendar_id": calendar_id,
            "attendees": ", ".join(attendees),
            "existing_attendee_count": len(event_snapshot["attendees"]),
        },
        destructive=False,
    )
