"""Behavior contracts for Gmail-to-Vault mail synchronization."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from backend.services.vault_mail_sync_service import VaultMailSyncService


class _Request:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def execute(self) -> dict[str, Any]:
        return self._payload


class _Messages:
    def __init__(self, message: dict[str, Any]) -> None:
        self._message = message

    def get(self, **_kwargs: object) -> _Request:
        return _Request(self._message)


class _Users:
    def __init__(self, message: dict[str, Any]) -> None:
        self._messages = _Messages(message)

    def messages(self) -> _Messages:
        return self._messages


class _Service:
    def __init__(self, message: dict[str, Any]) -> None:
        self._users = _Users(message)

    def users(self) -> _Users:
        return self._users


def _service(mail_folder: Path) -> VaultMailSyncService:
    service = object.__new__(VaultMailSyncService)
    service.config = None
    service.vault_path = mail_folder.parent
    service.mail_folder = mail_folder
    mail_folder.mkdir(parents=True)
    return service


def test_sync_message_preserves_metadata_bodies_and_deduplicates(tmp_path: Path) -> None:
    service = _service(tmp_path / "Mail")
    message = {
        "threadId": "thread-1",
        "labelIds": ["SENT", "STARRED", "CATEGORY_UPDATES"],
        "payload": {
            "headers": [
                {"name": "Subject", "value": 'A "quoted" subject'},
                {"name": "From", "value": "sender@example.test"},
                {"name": "To", "value": "reader@example.test"},
            ],
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {"data": "SGVsbG8gVmF1bHQ="},
                },
                {
                    "mimeType": "text/html",
                    "body": {"data": "PHA-SGVsbG88L3A-"},
                },
                {
                    "mimeType": "application/pdf",
                    "body": {"attachmentId": "attachment-1"},
                },
            ],
        },
    }

    assert service._sync_single_message(_Service(message), "gmail-1", "me@example.test", "Received")
    markdown_path = next((tmp_path / "Mail").glob("gmail-1_*.md"))
    markdown = markdown_path.read_text(encoding="utf-8")
    frontmatter = yaml.safe_load(markdown.split("---", 2)[1])
    assert frontmatter["type"] == "Sent"
    assert frontmatter["category"] == "Updates"
    assert frontmatter["has_attachments"] is True
    assert frontmatter["is_starred"] is True
    assert "Hello Vault" in markdown
    assert markdown_path.with_suffix(".html").read_text(encoding="utf-8") == "<p>Hello</p>"

    assert not service._sync_single_message(
        _Service(message), "gmail-1", "me@example.test", "Received"
    )


def test_sync_without_mail_folder_fails_closed() -> None:
    service = object.__new__(VaultMailSyncService)
    service.config = None
    service.vault_path = None
    service.mail_folder = None
    assert not service._sync_single_message(_Service({}), "gmail-2", "me@example.test", "Received")
