"""Provider failures and Gmail labels preserve complete, scoped mail reads."""

import asyncio
import socket
from contextlib import nullcontext
from datetime import datetime, timezone
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml
from fastapi import HTTPException

from backend.domains.mail.providers import hybrid
from backend.domains.mail.routes import messages
from backend.domains.mail.sync.imap_mutations import ImapMailMutationService
from backend.services.integration_manager import integration_manager
from backend.tests.test_mail_archive_listing import MailboxFixture, use_mailbox


@pytest.fixture(autouse=True)
def clear_cache():
    hybrid_cache = messages._MAIL_CACHE
    hybrid_cache.clear()
    yield
    hybrid_cache.clear()


def install_detail_dispatch(monkeypatch):
    monkeypatch.setattr(integration_manager, "get_mail_account", lambda *a, **kw: {"email": "fixture@example.test"})
    monkeypatch.setattr(integration_manager, "is_microsoft_account", lambda _: False)
    monkeypatch.setattr(integration_manager, "is_imap_account", lambda _: True)
    provider = SimpleNamespace(imap_get_message=hybrid.imap_get_message)
    monkeypatch.setattr(messages.importlib, "import_module", lambda _: provider)

    def absent(_):
        raise HTTPException(status_code=404, detail="Message not found")

    monkeypatch.setattr(messages, "_get_saved_message", absent)
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: {"email": "fixture@example.test"})


@pytest.mark.parametrize("stall", ["socket", "detail-lock"])
def test_actual_imap_read_stalls_are_recoverable(monkeypatch, stall):
    install_detail_dispatch(monkeypatch)
    if stall == "socket":
        mailbox = SimpleNamespace(
            select=Mock(return_value=("OK", [])),
            uid=Mock(side_effect=socket.timeout("Synthetic provider deadline")),
            logout=Mock(),
        )
        monkeypatch.setattr(hybrid, "_imap_pool_acquire", lambda *a, **kw: mailbox)
        monkeypatch.setattr(hybrid, "_imap_pool_release", Mock())
        monkeypatch.setattr(hybrid, "_imap_pool_invalidate", Mock())
        monkeypatch.setattr(integration_manager, "is_imap_oauth_account", lambda _: False)
        lock = None
    else:
        lock = Lock()
        lock.acquire()
        monkeypatch.setattr(hybrid, "_IMAP_MESSAGE_LOCKS", {"fixture@example.test": lock})
        monkeypatch.setattr(hybrid, "_IMAP_MESSAGE_POOL", {})
        monkeypatch.setattr(hybrid, "_IMAP_TIMEOUT", 0.01)
    try:
        with pytest.raises(HTTPException) as failure:
            asyncio.run(messages.get_message("imap_42", "fixture@example.test", "INBOX"))
        assert failure.value.status_code == 503, "Transient remote read failure must not become a 404"
        assert failure.value.headers["Retry-After"] == "3"
    finally:
        if lock is not None:
            lock.release()


def test_gmail_archive_uses_real_all_folder_despite_archive_label(tmp_path, monkeypatch):
    service = object.__new__(ImapMailMutationService)
    service.mail_folder = tmp_path
    message = tmp_path / "fixture@example.test_Synthetic.md"
    message.write_text("---\nid: fixture@example.test\naccount: fixture@example.test\nimap_folder: INBOX\nimap_uid: '42'\ntype: Received\narchived: false\n---\nBody\n")
    selected = []
    searches = []

    def select(folder, readonly=False):
        selected.append(folder.strip('"'))
        return "OK", []

    def uid(command, *args):
        if command.lower() == "store":
            return "OK", []
        assert command.lower() == "search"
        searches.append((selected[-1], args))
        return "OK", [b"99" if selected[-1] == "[Gmail]/All Mail" else b""]

    mailbox = SimpleNamespace(
        capabilities=(b"X-GM-EXT-1",),
        list=lambda: ("OK", [b'() "/" "INBOX"', b'() "/" "Archive"', b'(\\All) "/" "[Gmail]/All Mail"']),
        select=select,
        uid=uid,
    )
    monkeypatch.setattr(service, "_connect", lambda _: nullcontext(mailbox))
    assert service.archive_message("fixture@example.test", "fixture@example.test", "INBOX") is True
    metadata = yaml.safe_load(message.read_text().split("---")[1])
    assert metadata["imap_folder"] == "[Gmail]/All Mail", f"Wrong recorded archive destination; searches={searches}"
    assert metadata["imap_uid"] == "99"


def test_archive_listing_includes_archived_mail_outside_archive_label(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    mailbox = MailboxFixture({
        "INBOX": ("", []),
        "Archive": ("", []),
        "[Gmail]/All Mail": ("\\All", [(99, "Archived outside label", when, "")]),
    })
    use_mailbox(monkeypatch, mailbox, gmail=True)
    result = hybrid.imap_list_messages("fixture@example.test", "ARCHIVE")
    assert [row["subject"] for row in result["messages"]] == ["Archived outside label"]


def test_all_mail_discovery_failure_is_not_an_inbox_success(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    mailbox = MailboxFixture({"INBOX": ("", [(1, "Inbox only", when, "")])})
    mailbox.list = lambda: ("NO", [b"Synthetic LIST failure"])
    use_mailbox(monkeypatch, mailbox)
    try:
        result = hybrid.imap_list_messages("fixture@example.test", "all")
    except RuntimeError:
        return
    assert result.get("error"), "Failed discovery must not silently hide all other mailboxes"


def test_nul_does_not_reach_imap_search_wire():
    criteria = hybrid._imap_search_criteria("INBOX", "before\x00after")
    assert "\x00" not in criteria, "NUL cannot appear in an IMAP quoted search string"
