"""Mail context reads retain both account and folder identity."""

from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from backend.domains.agent.sources.scopes import MAX_EXCERPT_CHARS, MAX_RECORD_CHARS, _plain_text

_RECORD_PREFIX = "mail:v2:"


def mail_folders(scope: dict[str, Any], account: str) -> list[str]:
    return list(
        scope.get("folders_by_account", {}).get(account) or [scope.get("folder") or "INBOX"]
    )


def _record_id(account: str, folder: str, message_id: str) -> str:
    payload = json.dumps([account, folder, message_id], ensure_ascii=False).encode()
    return _RECORD_PREFIX + base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _record_parts(record_id: str, scope: dict[str, Any]) -> tuple[str, str, str]:
    if record_id.startswith(_RECORD_PREFIX):
        try:
            raw = record_id[len(_RECORD_PREFIX) :]
            if len(raw) > 16_384:
                raise ValueError("Mail identifier is too long.")
            parts = json.loads(
                base64.b64decode(raw + "=" * (-len(raw) % 4), altchars=b"-_", validate=True)
            )
            if (
                not isinstance(parts, list)
                or len(parts) != 3
                or not all(isinstance(part, str) and part for part in parts)
            ):
                raise ValueError("Invalid mail identifier.")
            return parts[0], parts[1], parts[2]
        except (ValueError, UnicodeError, binascii.Error) as error:
            raise ValueError("Invalid mail identifier. Search again.") from error
    if "::" not in record_id:
        raise ValueError("Mail record ids must come from a previous search.")
    account, message_id = record_id.split("::", 1)
    folders = mail_folders(scope, account)
    if len(folders) != 1:
        raise ValueError("This old mail identifier has no folder. Search again.")
    return account, folders[0], message_id


def _read_mail_message(account: str, folder: str, message_id: str) -> dict[str, Any]:
    """Never fall back to an unrelated vault message or the default mailbox."""
    from backend.services.integration_manager import integration_manager

    configured = integration_manager.get_mail_account(account)
    if not configured:
        raise PermissionError("The requested mail account is unavailable.")
    if integration_manager.is_microsoft_account(configured):
        from backend.services.microsoft_mail_service import microsoft_get_message_in_folder

        message = microsoft_get_message_in_folder(account, message_id, folder)
    elif integration_manager.is_imap_account(configured):
        from backend.services.hybrid_mail_service import imap_get_message

        uid = message_id[5:] if message_id.startswith("imap_") else message_id
        message = imap_get_message(account, uid, folder)
    else:
        raise PermissionError("This mail account does not support scoped reads.")
    if not message:
        raise KeyError("The message is no longer available in the selected folder.")
    return message


def _date_key(value: str) -> datetime:
    try:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = parsedate_to_datetime(value)
        return (
            parsed.replace(tzinfo=timezone.utc)
            if parsed.tzinfo is None
            else parsed.astimezone(timezone.utc)
        )
    except (ValueError, TypeError, OverflowError):
        return datetime.min.replace(tzinfo=timezone.utc)


def _mail_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    from backend.api.mail_routes import get_messages
    from backend.domains.agent.sources.integrations import _allowed_accounts, _run_async

    rows: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, str]] = []
    for account in _allowed_accounts(scope["accounts"]):
        for folder in mail_folders(scope, account):
            try:
                result = _run_async(
                    get_messages(
                        email=account,
                        folder=folder,
                        category=None,
                        limit=scope["limit"],
                        offset=0,
                        page_token=None,
                        search=str(query_text or "").strip(),
                        force=False,
                    )
                )
                if result.get("error"):
                    failures.append(
                        {
                            "account": account,
                            "folder": folder,
                            "error": "Folder could not be read. Try again.",
                        }
                    )
                for message in result.get("messages") or []:
                    message_id = str(message.get("id") or "")
                    if not message_id:
                        continue
                    identifier = _record_id(account, folder, message_id)
                    rows[identifier] = {
                        "id": identifier,
                        "account": account,
                        "folder": folder,
                        "subject": str(message.get("subject") or "")[:500],
                        "sender": str(message.get("sender") or "")[:500],
                        "date": str(message.get("date") or "")[:100],
                        "preview": _plain_text(
                            message.get("body_text") or message.get("snippet") or "",
                            MAX_EXCERPT_CHARS,
                        ),
                    }
            except Exception:  # noqa: BLE001 - keep successful folders and report an incomplete search
                failures.append(
                    {
                        "account": account,
                        "folder": folder,
                        "error": "Folder could not be read. Try again.",
                    }
                )
    records = sorted(rows.values(), key=lambda row: _date_key(row["date"]), reverse=True)[
        : scope["limit"]
    ]
    return {
        "source": "mail",
        "records": records,
        **({"partial": True, "errors": failures} if failures else {}),
    }


def _mail_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    from backend.domains.agent.sources.integrations import _allowed_accounts

    account, folder, message_id = _record_parts(record_id, scope)
    if account not in _allowed_accounts(scope["accounts"]) or folder not in mail_folders(
        scope, account
    ):
        raise PermissionError("The requested message is outside this source scope.")
    message = _read_mail_message(account, folder, message_id)
    return {
        "id": record_id,
        "account": account,
        "folder": folder,
        "subject": str(message.get("subject") or "")[:500],
        "sender": str(message.get("sender") or "")[:500],
        "recipient": str(message.get("recipient") or "")[:500],
        "date": str(message.get("date") or "")[:100],
        "body": _plain_text(message.get("body_text") or "", MAX_RECORD_CHARS),
    }
