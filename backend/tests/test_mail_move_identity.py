"""Moving one message must preserve unrelated messages and truthful failures."""
from contextlib import nullcontext
from unittest.mock import Mock

import pytest
from backend.domains.mail.sync.imap_mutations import ImapMailMutationService

class Mailbox:
    def __init__(self, *, capabilities=(b"UIDPLUS",), select="OK", move="NO", store="OK", expunge="OK"):
        self.capabilities = capabilities
        self.select_status, self.move_status, self.store_status, self.expunge_status = select, move, store, expunge
        self.source = {42, 99}
        self.deleted = {99}
        self.destination = set()
        self.commands = []
    def select(self, name):
        self.commands.append(("select", name))
        return self.select_status, []
    def uid(self, command, uid, *args):
        command = command.upper()
        self.commands.append((command, uid, *args))
        number = int(uid)
        if command == "MOVE":
            if self.move_status == "OK":
                self.destination.add(number)
                self.source.discard(number)
            return self.move_status, []
        if command == "COPY":
            self.destination.add(number)
        elif command == "STORE":
            if self.store_status == "OK": self.deleted.add(number)
            return self.store_status, []
        elif command == "EXPUNGE":
            if self.expunge_status == "OK" and number in self.deleted: self.source.discard(number)
            return self.expunge_status, []
        return "OK", []
    def expunge(self):
        self.commands.append(("mailbox-expunge",))
        self.source.difference_update(self.deleted)
        return "OK", []

def move(imap, uid="42"):
    return ImapMailMutationService._move_on_server(object(), imap, uid, "INBOX", "Archive")

@pytest.mark.parametrize("capabilities", [(b"UIDPLUS",), (b"IMAP4REV2",)])
def test_move_fallback_only_expunge_the_requested_uid(capabilities):
    imap = Mailbox(capabilities=capabilities)
    assert move(imap) is True
    assert imap.source == {99}
    assert imap.destination == {42}
    assert ("mailbox-expunge",) not in imap.commands

def test_server_without_safe_move_or_uid_expunge_stays_unchanged():
    imap = Mailbox(capabilities=())
    assert move(imap) is False
    assert imap.source == {42, 99}
    assert imap.destination == set()
    assert all(command[0] not in ("COPY", "STORE", "mailbox-expunge") for command in imap.commands)

def test_failed_selection_does_not_issue_commands_against_the_previous_mailbox():
    imap = Mailbox(select="NO", move="OK")
    assert move(imap) is False
    assert imap.source == {42, 99}
    assert imap.destination == set()
    assert len(imap.commands) == 1

@pytest.mark.parametrize("failure", ["store", "expunge"])
def test_failed_move_fallback_never_reports_success_or_expunge_other_messages(failure):
    imap = Mailbox(**{failure: "NO"})
    assert move(imap) is False
    assert 99 in imap.source
    assert ("mailbox-expunge",) not in imap.commands

def test_native_move_succeeds_without_uidplus_and_preserves_unrelated_deleted_mail():
    imap = Mailbox(capabilities=(), move="OK")
    assert move(imap) is True
    assert imap.source == {99}
    assert imap.destination == {42}
    assert ("mailbox-expunge",) not in imap.commands

def test_non_uid_never_enters_a_move_wire_command():
    imap = Mailbox()
    assert move(imap, "42,99") is False
    assert imap.commands == []


@pytest.mark.parametrize("failure", ["unsupported", "store", "expunge"])
def test_trash_preserves_saved_metadata_when_the_server_refuses(tmp_path, monkeypatch, failure):
    metadata = (
        "---\nid: saved@example.test\naccount: fixture@example.test\n"
        "imap_uid: '42'\nimap_folder: Projects/Reference\ntype: Received\narchived: false\n---\n\nBody\n"
    )
    path = tmp_path / "saved@example.test_Fixture.md"
    path.write_text(metadata)
    service = object.__new__(ImapMailMutationService)
    service.mail_folder = tmp_path
    mailbox = Mailbox(capabilities=() if failure == "unsupported" else (b"UIDPLUS",),
                      **({failure: "NO"} if failure != "unsupported" else {}))
    monkeypatch.setattr(service, "_connect", lambda _: nullcontext(mailbox))
    monkeypatch.setattr(service, "_find_server_folder", lambda *args: "Trash")

    assert service.trash_message("fixture@example.test", "saved@example.test", "Projects/Reference") is False
    assert path.read_text() == metadata
    assert 99 in mailbox.source


def test_trash_scopes_saved_identity_and_replaces_the_destination_uid(tmp_path, monkeypatch):
    for account, uid in (("other@example.test", "99"), ("fixture@example.test", "42")):
        path = tmp_path / f"saved@example.test_{uid}.md"
        path.write_text(
            f"---\nid: saved@example.test\naccount: {account}\nimap_uid: '{uid}'\n"
            "imap_folder: Projects/Reference\ninternet_message_id: '<raw/id@example.test>'\n"
            "type: Received\narchived: false\n---\n\nBody\n"
        )
    other_path = tmp_path / "saved@example.test_99.md"
    other_before = other_path.read_text()
    service = object.__new__(ImapMailMutationService)
    service.mail_folder = tmp_path
    mailbox = Mailbox(move="OK")
    monkeypatch.setattr(service, "_connect", lambda _: nullcontext(mailbox))
    monkeypatch.setattr(service, "_find_server_folder", lambda *args: "Trash")
    lookup = Mock(return_value="142")
    monkeypatch.setattr(service, "_lookup_uid_by_message_id", lookup)

    assert service.trash_message("fixture@example.test", "saved@example.test") is True
    lookup.assert_called_once_with(mailbox, "Trash", "<raw/id@example.test>")
    meta = service._parse_meta((tmp_path / "saved@example.test_42.md").read_text())
    assert (meta["imap_folder"], str(meta["imap_uid"]), meta["type"]) == ("Trash", "142", "Deleted")
    assert meta["archived"] is True
    assert other_path.read_text() == other_before
