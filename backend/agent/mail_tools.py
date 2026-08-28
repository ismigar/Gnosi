"""Governed adapters for exact mail reads and mutations."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool


def _account(account: str) -> str:
    from backend.agent.gnosi_tools import _assert_global_integration_access

    return _assert_global_integration_access(account)


def _bounded(value: Any) -> Any:
    from backend.agent.gnosi_tools import _bounded_json_value

    return _bounded_json_value(value)


@tool
async def read_mail_message(
    account: str,
    message_id: str,
    folder: str = "INBOX",
) -> str:
    """Read one exact message from one configured mail account."""
    from backend.api.mail_routes import get_message

    result = await get_message(message_id, email=_account(account), folder=folder)
    bounded = _bounded(result)
    if isinstance(bounded, dict):
        bounded.pop("body_html", None)
        bounded["body_text"] = str(bounded.get("body_text") or "")[:12_000]
        bounded["truncated"] = len(str(result.get("body_text") or "")) > 12_000
    return json.dumps(bounded, ensure_ascii=False, default=str)


@tool
async def read_mail_thread(
    account: str,
    thread_id: str,
    limit: int = 30,
) -> str:
    """Read a bounded exact mail thread from one configured account."""
    from backend.api.mail_routes import get_thread

    result = await get_thread(thread_id, email=_account(account))
    messages = []
    for message in list(result.get("messages") or [])[:max(1, min(int(limit), 50))]:
        bounded = _bounded(message)
        if isinstance(bounded, dict):
            bounded.pop("body_html", None)
            bounded["body_text"] = str(bounded.get("body_text") or "")[:4_000]
        messages.append(bounded)
    return json.dumps({"messages": messages}, ensure_ascii=False, default=str)


@tool
async def list_mail_folders(account: str) -> str:
    """List folders for one configured mail account."""
    from backend.api.mail_routes import get_folders

    result = await get_folders(email=_account(account))
    return json.dumps(_bounded(result), ensure_ascii=False, default=str)


@tool
async def mark_mail_read(
    account: str,
    message_id: str,
    read: bool = True,
    folder: str = "INBOX",
) -> str:
    """Change the read flag of one remote mail message after confirmation."""
    from backend.api.mail_routes import mark_as_read, update_message

    normalized = _account(account)
    if read:
        result = await mark_as_read(message_id, email=normalized, folder=folder)
    else:
        result = await update_message(message_id, {"is_read": False})
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def star_mail_message(
    account: str,
    message_id: str,
    starred: bool = True,
) -> str:
    """Change the star flag of one remote mail message after confirmation."""
    from backend.api.mail_routes import star_msg

    result = await star_msg(message_id, email=_account(account), starred=starred)
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def snooze_mail_message(message_id: str, snooze_until: str) -> str:
    """Persist a local snooze timestamp after an explicit request."""
    from backend.api.mail_routes import snooze_message

    result = await snooze_message(message_id, {"snooze_until": snooze_until})
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def reply_mail_message(
    account: str,
    message_id: str,
    body: str,
    folder: str = "INBOX",
    to: str = "",
    cc: str = "",
    bcc: str = "",
) -> str:
    """Send a reply to one exact mail message after confirmation."""
    from backend.api.mail_routes import reply_message

    result = await reply_message(
        message_id,
        email=_account(account),
        folder=folder,
        body=body,
        to=to or None,
        cc=cc or None,
        bcc=bcc or None,
        attachments=[],
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def batch_mail_action(
    account: str,
    message_ids: list[str],
    action: str,
) -> str:
    """Apply one supported remote action to at most 100 messages after confirmation."""
    from backend.api.mail_routes import batch_action

    normalized_action = str(action).strip().lower()
    if normalized_action not in {"archive", "read", "star", "trash"}:
        raise ValueError("Unsupported mail batch action.")
    ids = [str(value) for value in message_ids if str(value)][:100]
    if not ids:
        raise ValueError("At least one message ID is required.")
    result = await batch_action(
        email=_account(account),
        payload={"action": normalized_action, "ids": ids},
    )
    return json.dumps(result, ensure_ascii=False, default=str)


MAIL_READ_TOOLS = [read_mail_message, read_mail_thread, list_mail_folders]
MAIL_LOCAL_WRITE_TOOLS = [snooze_mail_message]
MAIL_EXTERNAL_WRITE_TOOLS = [
    mark_mail_read,
    star_mail_message,
    reply_mail_message,
    batch_mail_action,
]
