"""Confirmed handlers for pages, contacts, mail and calendars."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, cast

from backend.domains.agent.gnosi_support import (
    ActionConflictError,
    _assert_global_integration_access,
    _contact_snapshot,
    _require_file_revision,
    _require_mail_message_revision,
    _resolve_page,
    _value_revision,
)

ActionHandler = Callable[[dict[str, Any], str, Any], Awaitable[dict[str, Any]]]


async def _delete_page(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.vault_routes import _move_page_to_trash

    path = _resolve_page(str(arguments["page_id"]))
    if not path:
        raise LookupError("Page not found.")
    _require_file_revision(path, str(arguments.get("page_revision") or ""), "The page")
    _move_page_to_trash(str(arguments["page_id"]), path)
    return {"status": "trashed", "page_id": str(arguments["page_id"])}


async def _delete_contact(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del background_tasks
    from backend.data.management_db import get_mgmt_session
    from backend.services.contacts_service import ContactsService

    db = get_mgmt_session()
    try:
        service = ContactsService(db, workspace_id)
        contact_id = str(arguments["contact_id"])
        contact = service.get_contact(contact_id)
        if not contact:
            raise LookupError("Contact not found.")
        if _value_revision(_contact_snapshot(contact)) != str(
            arguments.get("contact_revision") or ""
        ):
            raise ActionConflictError("The contact changed after the confirmation preview.")
        if not service.delete_contact(contact_id):
            raise RuntimeError("The contact could not be deleted.")
        return {"status": "deleted", "contact_id": contact_id}
    finally:
        db.close()


async def _send_mail(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.mail_routes import send_mail as route_send_mail

    account = _assert_global_integration_access(str(arguments["account"]))
    typed_send_mail = cast(Callable[..., Awaitable[Any]], route_send_mail)
    result = await typed_send_mail(
        email=account,
        to=str(arguments["to"]),
        subject=str(arguments.get("subject") or ""),
        body=str(arguments["body"]),
        cc=str(arguments.get("cc") or "") or None,
        bcc=str(arguments.get("bcc") or "") or None,
        from_name=None,
        from_email=None,
        attachments=[],
    )
    return dict(result)


async def _save_mail_draft(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.mail_routes import save_draft

    account = _assert_global_integration_access(str(arguments["account"]))
    result = await save_draft(
        {
            "account": account,
            "to": str(arguments["to"]),
            "subject": str(arguments.get("subject") or ""),
            "body": str(arguments["body"]),
            "cc": str(arguments.get("cc") or ""),
            "bcc": str(arguments.get("bcc") or ""),
        }
    )
    return dict(result)


async def _archive_mail(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.mail_routes import archive_msg

    account = _assert_global_integration_access(str(arguments["account"]))
    await _require_mail_message_revision(
        account,
        str(arguments["message_id"]),
        str(arguments.get("message_revision") or ""),
        expected_source=str(arguments.get("message_source") or ""),
        folder=str(arguments.get("folder") or ""),
    )
    result = await archive_msg(
        str(arguments["message_id"]),
        account,
        str(arguments.get("folder") or "") or None,
    )
    return dict(result)


async def _move_mail(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.mail_routes import move_message

    account = _assert_global_integration_access(str(arguments["account"]))
    await _require_mail_message_revision(
        account,
        str(arguments["message_id"]),
        str(arguments.get("message_revision") or ""),
        expected_source=str(arguments.get("message_source") or ""),
        folder=str(arguments.get("folder") or ""),
    )
    result = await move_message(
        str(arguments["message_id"]),
        account,
        {
            "target_folder": str(arguments["target_folder"]),
            "imap_uid": str(arguments.get("imap_uid") or ""),
            "imap_folder": str(arguments.get("imap_folder") or ""),
        },
    )
    return dict(result)


async def _invite_attendees(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.calendar_routes import invite_to_event
    from backend.services.hybrid_calendar_service import get_event

    account = _assert_global_integration_access(str(arguments["account"]), calendar=True)
    event_id = str(arguments["event_id"])
    calendar_id = str(arguments.get("calendar_id") or "primary")
    event = await asyncio.to_thread(get_event, account, event_id, calendar_id)
    if not event:
        raise LookupError("Calendar event not found.")
    event_snapshot = {
        "id": str(event.get("id") or event_id),
        "title": str(event.get("title") or ""),
        "start": str(event.get("start") or ""),
        "end": str(event.get("end") or ""),
        "calendar_id": str(event.get("calendar_id") or calendar_id),
        "attendees": list(event.get("attendees") or []),
    }
    if _value_revision(event_snapshot) != str(arguments.get("event_revision") or ""):
        raise ActionConflictError("The calendar event changed after the confirmation preview.")
    result = await invite_to_event(
        event_id,
        {
            "email": account,
            "attendees": [{"email": str(address)} for address in arguments.get("attendees") or []],
            "calendar_id": calendar_id,
        },
    )
    return dict(result)


async def _create_calendar_event(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.calendar_routes import _invalidate_calendar_cache
    from backend.services.google_calendar_service import create_google_calendar_event

    account = _assert_global_integration_access(str(arguments["account"]), calendar=True)
    payload = {
        "summary": str(arguments.get("title") or ""),
        "start": {"dateTime": str(arguments["start"])},
        "end": {"dateTime": str(arguments["end"])},
        "description": str(arguments.get("description") or ""),
        "location": str(arguments.get("location") or ""),
    }
    event = await asyncio.to_thread(
        create_google_calendar_event,
        account,
        payload,
        str(arguments.get("calendar_id") or "primary"),
    )
    if not event:
        raise RuntimeError("The calendar event could not be created.")
    cast(Callable[[], None], _invalidate_calendar_cache)()
    return {"status": "created", "event_id": str(event.get("id") or "")}


BASIC_HANDLERS: dict[str, ActionHandler] = {
    "delete_page": _delete_page,
    "delete_contact": _delete_contact,
    "send_mail": _send_mail,
    "save_mail_draft": _save_mail_draft,
    "archive_mail": _archive_mail,
    "move_mail": _move_mail,
    "invite_attendees": _invite_attendees,
    "create_calendar_event": _create_calendar_event,
}
