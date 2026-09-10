"""Conversation reads include sent mail and preserve mailbox-scoped identities."""

from contextlib import nullcontext
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from backend.api import mail_routes as _mail_routes  # noqa: F401
from backend.domains.mail.sync.imap_service import ImapMailSyncService
from backend.domains.mail.providers.hybrid import _imap_fetch_payload


@pytest.mark.parametrize("metadata_after_body", [False, True])
def test_gmail_thread_reads_localized_all_mail_and_every_header(monkeypatch, metadata_after_body):
    folder = "[Gmail]/Tot el correu"
    account = "reader@example.test"
    headers = [
        b"Date: Thu, 10 Sep 2026 09:00:00 +0000\r\nFrom: Ada <ada@example.test>\r\n"
        b"To: reader@example.test\r\nMessage-ID: <received@example.test>\r\nSubject: Conversation\r\n\r\n",
        b"Date: Thu, 10 Sep 2026 10:00:00 +0000\r\nFrom: reader@example.test\r\n"
        b"To: ada@example.test\r\nCc: copy@example.test\r\nMessage-ID: <sent@example.test>\r\n"
        b"Subject: Re: Conversation\r\n\r\n",
    ]
    payload = []
    for index, header in enumerate(headers):
        metadata = f"UID {101 + index} FLAGS (\\Seen) X-GM-THRID 123 X-GM-LABELS (".encode()
        metadata += b"\\Sent)" if index else b"\\Inbox)"
        if metadata_after_body:
            payload.extend([(b"1 (BODY[HEADER] {200}", header), b" " + metadata + b")"])
        else:
            payload.extend([(b"1 (" + metadata + b" BODY[HEADER] {200}", header), b")"])
    connection = SimpleNamespace(
        capability=lambda: ("OK", [b"IMAP4rev1 X-GM-EXT-1"]),
        list=lambda: ("OK", [
            b'(\\HasNoChildren \\Archive) "/" "Archive"',
            f'(\\HasNoChildren \\All) "/" "{folder}"'.encode(),
        ]),
        select=Mock(side_effect=lambda name, **_: ("OK" if name.strip('"') == folder else "NO", [b"2"])),
        uid=Mock(side_effect=lambda command, *_: ("OK", [b"101 102"] if command == "search" else payload)),
    )
    service = ImapMailSyncService()
    monkeypatch.setattr(service, "_connect", lambda _: nullcontext(connection))

    messages = service.fetch_thread_by_gm_thrid(account, "123")

    assert [message["id"] for message in messages] == ["imap_101", "imap_102"]
    assert all(message["imap_folder"] == folder for message in messages)
    assert all(message["thread_id"] == "123" for message in messages)
    assert messages[0]["timestamp"] < messages[1]["timestamp"]
    assert messages[1]["type"] == "Sent"
    assert messages[1]["cc"] == "copy@example.test"
    assert messages[1]["internet_message_id"]
    assert "BODY.PEEK[HEADER]" in connection.uid.call_args.args[2]
    connection.select.assert_called_once_with(f'"{folder}"', readonly=True)


def test_message_detail_retains_thread_metadata_after_the_body_literal():
    body = b"Subject: Conversation\r\n\r\nMessage body"
    assert _imap_fetch_payload([
        (b"1 (BODY[] {44}", body), b" UID 42 FLAGS (\\Seen) X-GM-THRID 123)",
    ]) == (body, "\\seen", "123")


def test_successful_reply_invalidates_mail_list_and_counts(monkeypatch):
    from backend.domains.mail.routes import compose

    monkeypatch.setattr(compose, "_is_microsoft_account", lambda _: False)
    monkeypatch.setattr(compose, "extract_vault_inline_images", lambda body: (body, []))
    monkeypatch.setattr(compose, "_embed_quoted_cid_images", AsyncMock(return_value="Synthetic reply"))
    monkeypatch.setattr(compose, "send_reply", Mock(return_value=True))
    invalidate = Mock()
    monkeypatch.setattr(compose, "_invalidate_mail_cache", invalidate)
    result = asyncio.run(compose.reply_message(
        "synthetic-message", "reader@example.test", "INBOX", "Synthetic reply",
        "ada@example.test", None, None, [],
    ))
    assert result == {"status": "success"}
    invalidate.assert_called_once()
