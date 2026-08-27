"""Mail account and provider selection helpers."""

from __future__ import annotations

from backend.domains.mail.repositories.vault import (
    _find_message_files,
    get_mail_vault_path,
    parse_frontmatter,
)


def _is_imap_account(email: str) -> bool:
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)
    return bool(acc and integration_manager.is_imap_account(acc))


def _is_microsoft_account(email: str) -> bool:
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)
    return bool(acc and integration_manager.is_microsoft_account(acc))


def _resolve_gmail_id(message_id: str) -> str:
    """Returns thread_id from vault if available, otherwise the message_id as-is."""
    mail_path = get_mail_vault_path()
    files = _find_message_files(mail_path, message_id)
    if files:
        try:
            content = files[0].read_text(encoding="utf-8")
            meta, _ = parse_frontmatter(content, files[0])
            return meta.get("thread_id") or message_id
        except Exception:
            pass
    return message_id
