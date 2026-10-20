"""Opening a message cannot queue behind background mailbox reads."""

import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from backend.domains.mail.providers import hybrid
from backend.domains.mail.routes import messages
from backend.domains.mail.routes import actions, compose
from backend.domains.mail.schemas import MailSpamRequest, MailStarRequest
from backend.services.imap_mail_sync_service import imap_sync_service


def test_message_opens_while_the_mailbox_connection_is_busy(monkeypatch):
    account = {"email": "fixture@example.test"}
    raw = b"Subject: Synthetic detail\r\nBcc: blind@example.test\r\nMessage-ID: <fixture@example.test>\r\n\r\nReadable body"
    connections = []

    def connect(_):
        connection = SimpleNamespace(
            noop=Mock(return_value=("OK", [])),
            select=Mock(return_value=("OK", [])),
            uid=Mock(return_value=("OK", [(b"1 (UID 42 FLAGS () BODY[] {99}", raw), b")"])),
            logout=Mock(),
        )
        connections.append(connection)
        return connection

    monkeypatch.setattr(hybrid, "_IMAP_POOL", {})
    monkeypatch.setattr(hybrid, "_IMAP_LOCKS", {})
    monkeypatch.setattr(hybrid, "_IMAP_MESSAGE_POOL", {}, raising=False)
    monkeypatch.setattr(hybrid, "_IMAP_MESSAGE_LOCKS", {}, raising=False)
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: account)
    monkeypatch.setattr(hybrid, "_imap_connect_fresh", connect)
    monkeypatch.setattr(hybrid.integration_manager, "is_imap_oauth_account", lambda _: False)
    background = hybrid._imap_pool_acquire(account)
    assert background is not None
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(hybrid.imap_get_message, account["email"], "42", "INBOX")
        try:
            try:
                result = pending.result(timeout=1)
            except TimeoutError:
                raise AssertionError("Message detail waited for the background mailbox connection") from None
            assert result["body_text"] == "Readable body"
            assert result["bcc"] == "blind@example.test"
            assert len(connections) == 2
            # Another message reuses the independent authenticated connection.
            assert hybrid.imap_get_message(account["email"], "43", "INBOX")["id"] == "imap_43"
            assert len(connections) == 2
            connections[1].noop.assert_called_once()
            background.uid.assert_not_called()
            assert all("BODY.PEEK[]" in call.args[-1] for call in connections[1].uid.call_args_list)
        finally:
            hybrid._imap_pool_release(account["email"])
            pending.result(timeout=2)


@pytest.mark.parametrize("operation", ["mark-read", "archive", "trash", "star", "spam"])
def test_slow_mail_actions_leave_the_event_loop_available(monkeypatch, operation):
    async def scenario():
        loop = asyncio.get_running_loop()

        def remote_action(*args, **kwargs):
            served = Event()
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "A mail mutation blocked the event loop and message reads"
            return True

        for module in (actions, compose):
            monkeypatch.setattr(module, "_is_imap_account", lambda _: True)
            monkeypatch.setattr(module, "_is_microsoft_account", lambda _: False)
        for method in ("mark_read", "archive_message", "trash_message", "star_message", "move_message"):
            monkeypatch.setattr(imap_sync_service, method, remote_action)
        monkeypatch.setattr(imap_sync_service, "list_folders", lambda _: [{"name": "Junk", "type": "Spam"}])
        email = "fixture@example.test"
        if operation == "mark-read":
            result = await compose.mark_as_read("imap_42", email, "INBOX")
        elif operation == "archive":
            result = await actions.archive_msg("imap_42", email, "INBOX")
        elif operation == "trash":
            result = await actions.trash_msg("imap_42", email, "INBOX")
        elif operation == "star":
            result = await actions.star_msg("imap_42", MailStarRequest(starred=True), email)
        else:
            result = await actions.spam_msg("imap_42", MailSpamRequest(spam=True), email)
        assert result == {"status": "success"}

    asyncio.run(scenario())


def test_a_stalled_body_read_ends_with_a_retryable_response(monkeypatch):
    async def scenario():
        entered, release = Event(), Event()

        def stalled():
            entered.set()
            assert release.wait(2)
            return {"body_text": "Late content"}

        monkeypatch.setattr(messages, "_MESSAGE_READ_TIMEOUT_S", 0.02)
        try:
            with pytest.raises(HTTPException) as failure:
                await messages._read_message_provider(stalled)
            assert entered.is_set()
            assert failure.value.status_code == 503
            assert failure.value.headers["Retry-After"] == "3"
        finally:
            release.set()

    asyncio.run(scenario())


@pytest.mark.parametrize("provider", ["imap", "microsoft"])
def test_failed_trash_does_not_fall_through_to_another_provider(monkeypatch, provider):
    from backend.services import microsoft_mail_service

    monkeypatch.setattr(actions, "_is_imap_account", lambda _: provider == "imap")
    monkeypatch.setattr(actions, "_is_microsoft_account", lambda _: provider == "microsoft")
    monkeypatch.setattr(imap_sync_service, "trash_message", lambda *args, **kwargs: False)
    monkeypatch.setattr(microsoft_mail_service, "microsoft_trash_message", lambda *args: False)
    gmail = Mock(side_effect=AssertionError("A failed provider action must not reach Gmail"))
    monkeypatch.setattr(actions, "trash_thread", gmail)

    with pytest.raises(HTTPException) as failure:
        asyncio.run(actions.trash_msg("imap_42", "fixture@example.test", "Projects/Reference"))
    assert failure.value.status_code == 503
    assert failure.value.headers["Retry-After"] == "3"
    gmail.assert_not_called()
