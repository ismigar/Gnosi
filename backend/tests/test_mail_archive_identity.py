"""Archive discovery and actions preserve complete, account-scoped identities."""

import asyncio
from contextlib import nullcontext
from datetime import datetime, timezone
from email.utils import format_datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml
from fastapi import HTTPException

from backend.domains.mail.providers import hybrid
from backend.domains.mail.routes import messages
from backend.domains.mail.sync.imap_core import ImapMailSyncCore
from backend.domains.mail.sync.imap_mutations import ImapMailMutationService
from backend.domains.mail.sync.imap_protocol import _discover_folders, _imap_name
from backend.services.integration_manager import integration_manager


class SyntheticMailboxes:
    def __init__(self, folders, literal_archive=False):
        self.folders = folders
        self.literal_archive = literal_archive
        self.selected = None
        self.selected_names = []

    def list(self):
        responses = []
        for name, (flag, _) in self.folders.items():
            if self.literal_archive and name == "Archive":
                responses.extend([(b'(\\Archive) "/" {7}', b'Archive'), b''])
            else:
                responses.append(f'({flag}) "/" "{name}"'.encode())
        return "OK", responses

    def select(self, name, readonly=False):
        self.selected = name.strip('"')
        self.selected_names.append(self.selected)
        return ("OK", []) if self.selected in self.folders else ("NO", [])

    def uid(self, operation, *args):
        rows = self.folders[self.selected][1]
        if operation.lower() == "search":
            return "OK", [b" ".join(str(uid).encode() for uid, _ in rows)]
        assert operation.lower() == "fetch"
        wanted = args[0].split(",")
        result = []
        for uid, subject in rows:
            if str(uid) not in wanted:
                continue
            raw = (
                f"Subject: {subject}\r\nDate: {format_datetime(datetime(2026, 10, 1, tzinfo=timezone.utc))}\r\n"
                f"Message-ID: <{uid}@example.test>\r\n\r\n"
            ).encode()
            result.extend([(
                f"1 (UID {uid} FLAGS () X-GM-LABELS () BODY[HEADER] {{99}}".encode(), raw,
            ), b")"])
        return "OK", result


@pytest.fixture(autouse=True)
def empty_cache():
    messages._MAIL_CACHE.clear()
    yield
    messages._MAIL_CACHE.clear()


def install_listing(monkeypatch, mailbox, gmail=False):
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: {"email": "fixture@example.test"})
    monkeypatch.setattr(hybrid, "_imap_pool_acquire", lambda *a, **kw: mailbox)
    monkeypatch.setattr(hybrid, "_imap_pool_release", Mock())
    monkeypatch.setattr(hybrid, "_imap_pool_invalidate", Mock())
    monkeypatch.setattr(integration_manager, "is_imap_oauth_account", lambda _: gmail)


def test_explicit_all_flag_precedes_an_ordinary_folder_name(monkeypatch):
    mailbox = SyntheticMailboxes({
        "INBOX": ("", []),
        "All Mail": ("", [(1, "User label subset")]),
        "[Gmail]/Tot el correu": ("\\All", [(99, "Complete archived message")]),
    })
    install_listing(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", "all")
    assert {row["imap_folder"] for row in result["messages"]} == {"[Gmail]/Tot el correu"}, result
    assert [row["subject"] for row in result["messages"]] == ["Complete archived message"]


def test_literal_list_names_preserve_all_messages(monkeypatch):
    mailbox = SyntheticMailboxes({
        "INBOX": ("", [(1, "Inbox")]),
        "Archive": ("\\Archive", [(7, "Archived")]),
    }, literal_archive=True)
    install_listing(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", "all")
    assert not result.get("error")
    assert {row["subject"] for row in result["messages"]} == {"Inbox", "Archived"}, result


def test_quoted_mailbox_names_round_trip_and_invalid_discovery_is_explicit():
    name = 'Archive "2025" \\ Projects'
    wire_name = _imap_name(name, always_quote=True)
    mailbox = SimpleNamespace(list=lambda: ("OK", [f'(\\Archive) "/" {wire_name}'.encode()]))
    assert (name, "Archived") in _discover_folders(mailbox, strict=True)
    invalid = SimpleNamespace(list=lambda: ("OK", [b'not a LIST response']))
    with pytest.raises(RuntimeError, match="incomplete"):
        _discover_folders(invalid, strict=True)


@pytest.mark.parametrize("failure", ["select", "fetch"])
def test_unavailable_imap_command_is_retryable(monkeypatch, failure):
    mailbox = SimpleNamespace(
        select=lambda *a, **kw: ("NO", [b"[UNAVAILABLE] Try again later"]) if failure == "select" else ("OK", []),
        uid=lambda *a: ("NO", [b"[UNAVAILABLE] Try again later"]),
    )
    install_listing(monkeypatch, mailbox)
    monkeypatch.setattr(integration_manager, "get_mail_account", lambda *a, **kw: {"email": "fixture@example.test"})
    monkeypatch.setattr(integration_manager, "is_microsoft_account", lambda _: False)
    monkeypatch.setattr(integration_manager, "is_imap_account", lambda _: True)
    original_import = messages.importlib.import_module
    monkeypatch.setattr(messages.importlib, "import_module", lambda name, *a, **kw: (
        SimpleNamespace(imap_get_message=hybrid.imap_get_message)
        if name == "backend.services.hybrid_mail_service" else original_import(name, *a, **kw)
    ))

    def absent(_):
        raise HTTPException(404, "Message not found")

    monkeypatch.setattr(messages, "_get_saved_message", absent)
    with pytest.raises(HTTPException) as response:
        asyncio.run(messages.get_message("imap_42", "fixture@example.test", "INBOX"))
    assert response.value.status_code == 503, "A provider UNAVAILABLE response must not be a saved-message 404"
    assert response.value.headers["Retry-After"] == "3"


def test_archive_never_uses_another_accounts_saved_uid(tmp_path, monkeypatch):
    service = object.__new__(ImapMailMutationService)
    service.mail_folder = tmp_path
    note = tmp_path / "shared@example.test_Synthetic.md"
    original = (
        "---\nid: shared@example.test\naccount: first@example.test\n"
        "imap_folder: Projects\nimap_uid: '7'\narchived: false\n---\nBody\n"
    )
    note.write_text(original)
    mailbox = SimpleNamespace(capabilities=(b"X-GM-EXT-1",), select=Mock(return_value=("OK", [])), uid=Mock(return_value=("OK", [b"99"])))
    monkeypatch.setattr(service, "_connect", lambda _: nullcontext(mailbox))
    monkeypatch.setattr(service, "_find_server_folder", lambda *a: "[Gmail]/All Mail")
    result = service.archive_message("second@example.test", "shared@example.test", "INBOX")
    assert not mailbox.uid.called, f"Wrong-account server operation: {mailbox.uid.call_args_list}; result={result}"
    assert note.read_text() == original


def test_saved_read_respects_account_and_exact_id(tmp_path, monkeypatch):
    for account in ("first", "second"):
        (tmp_path / f"shared@example.test_{account}.md").write_text(
            f"---\nid: shared@example.test\naccount: {account}@example.test\n---\n{account} body\n"
        )
    monkeypatch.setattr(messages, "get_mail_vault_path", lambda: tmp_path)
    result = messages._get_saved_message("shared@example.test", "second@example.test")
    assert result["account"] == "second@example.test" and "second body" in result["body_text"]
    with pytest.raises(HTTPException) as wrong_account:
        messages._get_saved_message("shared@example.test", "third@example.test")
    assert wrong_account.value.status_code == 404
    with pytest.raises(HTTPException) as partial_id:
        messages._get_saved_message("shared", "second@example.test")
    assert partial_id.value.status_code == 404


def test_archive_recovers_destination_uid_with_original_rfc_message_id(tmp_path, monkeypatch):
    service = object.__new__(ImapMailMutationService)
    service.mail_folder = tmp_path
    raw_id = "a/b@example.test"
    raw = f"Subject: Synthetic\r\nMessage-ID: <{raw_id}>\r\n\r\nBody".encode()
    sync_mailbox = SimpleNamespace(uid=lambda *a: ("OK", [(b"1 (FLAGS ())", raw)]))
    assert ImapMailSyncCore._sync_single_uid(service, sync_mailbox, b"7", "fixture@example.test", "INBOX", "Received")
    note = next(tmp_path.glob("*.md"))
    metadata = yaml.safe_load(note.read_text().split("---")[1])
    searches = []

    def uid(operation, *args):
        if operation.lower() == "store":
            return "OK", []
        assert operation.lower() == "search"
        searches.append(args)
        return "OK", [b"99" if args[-1] == f"<{raw_id}>" else b""]

    mailbox = SimpleNamespace(capabilities=(b"X-GM-EXT-1",), select=lambda *a, **kw: ("OK", []), uid=uid)
    monkeypatch.setattr(service, "_connect", lambda _: nullcontext(mailbox))
    monkeypatch.setattr(service, "_find_server_folder", lambda *a: "[Gmail]/All Mail")
    assert service.archive_message("fixture@example.test", metadata["id"], "INBOX")
    saved = yaml.safe_load(note.read_text().split("---")[1])
    assert saved["imap_uid"] == "99", f"Lost destination identity; searches={searches}; metadata={saved}"


def test_destination_uid_lookup_does_not_send_header_controls():
    mailbox = SimpleNamespace(select=Mock(return_value=("OK", [])), uid=Mock())
    service = object.__new__(ImapMailMutationService)
    assert service._lookup_uid_by_message_id(mailbox, "Archive", "bad\r\nA2 LOGOUT") is None
    mailbox.uid.assert_not_called()
