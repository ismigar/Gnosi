"""Archive and All Mail expose every folder and page with their original scope."""

from datetime import datetime, timedelta, timezone
from contextlib import nullcontext
from email.utils import format_datetime
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml

from backend.domains.mail.cache import _MAIL_CACHE
from backend.domains.mail.providers import gmail, hybrid
from backend.domains.mail.providers.imap_listing import search_uids
from backend.domains.mail.sync.imap_core import ImapMailSyncCore
from backend.domains.mail.sync.imap_mutations import ImapMailMutationService
from backend.domains.mail.sync.imap_protocol import _discover_folders


class MailboxFixture:
    def __init__(self, folders):
        self.folders = folders
        self.selected = ""
        self.searches = []
        self.fetches = []

    def list(self):
        return "OK", [f'({flags}) "/" "{name}"'.encode() for name, (flags, _) in self.folders.items()]

    def response(self, name):
        assert name == "UIDVALIDITY"
        return "UIDVALIDITY", [b"1"]

    def select(self, name, readonly=False):
        assert readonly, "A listing must never change read flags"
        self.selected = name.strip('"')
        return ("OK", []) if self.selected in self.folders else ("NO", [])

    def uid(self, command, *args):
        rows = self.folders[self.selected][1]
        if command == "search":
            self.searches.append((self.selected, args))
            if "X-GM-RAW" in str(args[-1]):
                rows = [row for row in rows if "\\Inbox" not in row[3]]
            return "OK", [b" ".join(str(row[0]).encode() for row in rows)]
        assert command == "fetch"
        assert "BODY.PEEK[HEADER.FIELDS" in args[1]
        self.fetches.append((self.selected, args))
        selected = set(args[0].split(","))
        result = []
        for uid, subject, when, labels in rows:
            if str(uid) not in selected:
                continue
            raw = (f"Subject: {subject}\r\nDate: {format_datetime(when)}\r\n"
                   f"Message-ID: <{subject}@example.test>\r\n\r\n").encode()
            result.extend([(f"1 (UID {uid} FLAGS () X-GM-THRID {uid} X-GM-LABELS ({labels}) BODY[HEADER] {{99}}".encode(), raw), b")"])
        return "OK", result


@pytest.fixture(autouse=True)
def isolated_mail_cache():
    _MAIL_CACHE.clear()
    yield
    _MAIL_CACHE.clear()


def use_mailbox(monkeypatch, mailbox, gmail=False):
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: {"email": "fixture@example.test"})
    monkeypatch.setattr(hybrid, "_imap_pool_acquire", lambda _: mailbox)
    monkeypatch.setattr(hybrid, "_imap_pool_release", Mock())
    monkeypatch.setattr(hybrid.integration_manager, "is_imap_oauth_account", lambda _: gmail)


@pytest.mark.parametrize("delimiter", ["/", ".", ":", "^"])
@pytest.mark.parametrize("container", [False, True])
def test_archive_uses_declared_hierarchy_including_nonselectable_parents(monkeypatch, delimiter, container):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    child = f"Archive{delimiter}2025"
    mailbox = MailboxFixture({
        "INBOX": ("", []),
        "Archive": ("\\Archive \\Noselect" if container else "\\Archive", [] if container else [(1, "Root archive", when, "")]),
        child: ("", [(1, "Child archive", when, "")]),
        "ArchiveOther": ("", [(1, "Unrelated sibling", when, "")]),
    })
    mailbox.list = lambda: ("OK", [
        f'({flags}) {json.dumps(delimiter)} {json.dumps(name)}'.encode()
        for name, (flags, _) in mailbox.folders.items()
    ])
    use_mailbox(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", "ARCHIVE")
    assert not result.get("error"), result
    expected = {child} if container else {"Archive", child}
    assert result["total"] == len(expected)
    assert {row["imap_folder"] for row in result["messages"]} == expected
    assert all(row["imap_uid"] == "1" for row in result["messages"])
    assert {name for name, _ in mailbox.searches} == expected


def test_flat_namespace_does_not_invent_archive_children_from_slashes(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    mailbox = MailboxFixture({
        "INBOX": ("", []),
        "Archive": ("\\Archive", [(1, "Archive", when, "")]),
        "Archive/2025": ("", [(1, "Separate flat mailbox", when, "")]),
    })
    mailbox.list = lambda: ("OK", [
        f'({flags}) NIL {json.dumps(name)}'.encode()
        for name, (flags, _) in mailbox.folders.items()
    ])
    use_mailbox(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", "ARCHIVE")
    assert not result.get("error"), result
    assert result["total"] == 1
    assert [row["imap_folder"] for row in result["messages"]] == ["Archive"]


@pytest.mark.parametrize("delimiter", ["/", ".", ":", "^"])
@pytest.mark.parametrize("child_name", ["Sent", "Drafts", "All Mail"])
@pytest.mark.parametrize("view", ["ARCHIVE", "all"])
def test_archive_display_names_cannot_override_hierarchy_or_hide_other_mail(monkeypatch, delimiter, child_name, view):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    child = f"Archive{delimiter}{child_name}"
    mailbox = MailboxFixture({
        "INBOX": ("", [(1, "Inbox", when, "")]),
        "Archive": ("\\Archive", [(1, "Root archive", when, "")]),
        child: ("", [(1, "Archived child", when, "")]),
    })
    mailbox.list = lambda: ("OK", [
        f'({flags}) {json.dumps(delimiter)} {json.dumps(name)}'.encode()
        for name, (flags, _) in mailbox.folders.items()
    ])
    use_mailbox(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", view)
    assert not result.get("error"), result
    expected = {"Archive", child} | ({"INBOX"} if view == "all" else set())
    assert result["total"] == len(expected)
    assert {row["imap_folder"] for row in result["messages"]} == expected
    archive_rows = [row for row in result["messages"] if row["imap_folder"] != "INBOX"]
    assert all(row["archived"] and row["type"] == "Received" for row in archive_rows)


def test_unflagged_all_mail_name_cannot_claim_the_native_all_role(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    mailbox = MailboxFixture({
        "INBOX": ("", [(1, "Inbox", when, "")]),
        "All Mail": ("", [(1, "An ordinary folder", when, "")]),
    })
    use_mailbox(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", "all")
    assert not result.get("error"), result
    assert result["total"] == 2
    assert {row["imap_folder"] for row in result["messages"]} == {"INBOX", "All Mail"}


def test_explicit_special_use_role_precedes_a_name_inside_the_archive_hierarchy(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    mailbox = MailboxFixture({
        "INBOX": ("", []),
        "Archive": ("\\Archive", [(1, "Root archive", when, "")]),
        "Archive/Sent": ("", [(1, "Ordinary archived child", when, "")]),
        "Archive/Actual sent": ("\\Sent", [(1, "Server-designated sent folder", when, "")]),
    })
    use_mailbox(monkeypatch, mailbox)
    result = hybrid.imap_list_messages("fixture@example.test", "ARCHIVE")
    assert not result.get("error"), result
    assert {row["imap_folder"] for row in result["messages"]} == {"Archive", "Archive/Sent"}
    assert ("Archive/Actual sent", "Sent") in _discover_folders(mailbox, strict=True)


def test_discovery_preserves_localized_all_mail_archives_and_custom_folders():
    fixture = MailboxFixture({
        "INBOX": ("\\HasNoChildren", []),
        "[Gmail]/Tot el correu": ("\\All \\HasNoChildren", []),
        "Archive": ("\\Archive", []),
        "Archive/2025": ("\\Archive", []),
        "Projects": ("\\HasNoChildren", []),
        "Container": ("\\Noselect", []),
    })
    assert _discover_folders(fixture) == [
        ("INBOX", "Received"), ("[Gmail]/Tot el correu", "All"),
        ("Archive", "Archived"), ("Archive/2025", "Archived"), ("Projects", "Custom"),
    ]


def test_all_mail_uses_the_localized_provider_mailbox_and_keeps_archived_rows(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    fixture = MailboxFixture({
        "INBOX": ("", [(1, "Inbox", when, "\\Inbox")]),
        "[Gmail]/Tot el correu": ("\\All", [
            (101, "Inbox", when, "\\Inbox"), (102, "Archived", when, "\\Sent"),
            (103, "Unlabelled", when, ""),
        ]),
    })
    use_mailbox(monkeypatch, fixture, gmail=True)
    result = hybrid.imap_list_messages("fixture@example.test", "all")
    assert result["total"] == 3
    assert {row["subject"] for row in result["messages"]} == {"Inbox", "Archived", "Unlabelled"}
    assert {row["imap_folder"] for row in result["messages"]} == {"[Gmail]/Tot el correu"}
    assert next(row for row in result["messages"] if row["subject"] == "Archived")["archived"] is True
    assert next(row for row in result["messages"] if row["subject"] == "Unlabelled")["archived"] is True
    archived = hybrid.imap_list_messages("fixture@example.test", "ARCHIVE")
    assert {row["subject"] for row in archived["messages"]} == {"Archived", "Unlabelled"}
    assert "-in:inbox" in fixture.searches[-1][1][-1]


def test_gmail_api_archive_keeps_sent_and_unlabelled_messages(monkeypatch):
    rows = {
        "sent": {"id": "sent", "labelIds": ["SENT"]},
        "unlabelled": {"id": "unlabelled", "labelIds": []},
    }

    def list_messages(**params):
        ids = [key for key in rows if key != "sent" or "-in:sent" not in params["q"]]
        return SimpleNamespace(execute=lambda: {
            "messages": [{"id": key} for key in ids], "resultSizeEstimate": len(ids),
        })

    endpoint = SimpleNamespace(list=list_messages)
    service = SimpleNamespace(users=lambda: SimpleNamespace(messages=lambda: endpoint))
    monkeypatch.setattr(gmail, "get_gmail_service", lambda _: service)
    monkeypatch.setattr(gmail, "_gmail_batch_metadata", lambda _, account, ids: [
        gmail._parse_gmail_meta(rows[key], account) for key in ids
    ])
    result = gmail.gmail_list_messages("fixture@example.test", "ARCHIVE")
    assert {row["id"] for row in result["messages"]} == {"sent", "unlabelled"}
    assert result["total"] == 2
    assert all(row["archived"] for row in result["messages"])


def test_generic_all_mail_has_complete_sorted_pagination_across_reused_uids(monkeypatch):
    when = datetime(2026, 10, 1, tzinfo=timezone.utc)
    fixture = MailboxFixture({
        "INBOX": ("", [(i, f"inbox-{i}", when + timedelta(minutes=i), "") for i in range(1, 62)]),
        "Archive": ("\\Archive", [(i, f"archive-{i}", when + timedelta(minutes=150-i), "") for i in range(1, 61)]),
        "Projects/2025": ("", [(1, "custom", when, "")]),
        "Trash": ("\\Trash", [(1, "deleted", when, "")]),
    })
    use_mailbox(monkeypatch, fixture)
    pages = [hybrid.imap_list_messages("fixture@example.test", "all", limit=50, offset=offset) for offset in (0, 50, 100)]
    rows = [row for page in pages for row in page["messages"]]
    assert [page["total"] for page in pages] == [122, 122, 122]
    assert len(rows) == len({(row["imap_folder"], row["imap_uid"]) for row in rows}) == 122
    assert [row["timestamp"] for row in rows] == sorted((row["timestamp"] for row in rows), reverse=True)
    assert {row["subject"] for row in rows} == {
        *(f"inbox-{i}" for i in range(1, 62)), *(f"archive-{i}" for i in range(1, 61)), "custom",
    }
    assert len(fixture.fetches) == 3, "Unchanged header snapshots should be reused across pages"
    assert all(row["archived"] for row in rows if row["imap_folder"] != "INBOX")


def test_search_quotes_control_characters_and_preserves_unicode():
    assert hybrid._imap_search_criteria("INBOX", 'a"b\\c\r\nd') == 'TEXT "a\\"b\\\\c  d"'
    assert hybrid._imap_search_criteria("STARRED", "Ada") == 'FLAGGED TEXT "Ada"'
    request = Mock(return_value=("OK", [b""]))
    search_uids(SimpleNamespace(uid=request), 'TEXT "reunió"')
    request.assert_called_once_with("search", "CHARSET", "UTF-8", 'TEXT "reunió"'.encode())


@pytest.mark.parametrize("kind", ["Archived", "Custom"])
def test_archive_sync_preserves_received_type_instead_of_deleted(tmp_path, kind):
    raw = b"Subject: Archive fixture\r\nMessage-ID: <archive-fixture@example.test>\r\n\r\nBody"
    mailbox = SimpleNamespace(uid=lambda *args: ("OK", [(b"1 (FLAGS (\\Seen))", raw)]))
    service = SimpleNamespace(mail_folder=tmp_path, _extract_body=lambda _: ("Body", ""))
    assert ImapMailSyncCore._sync_single_uid(service, mailbox, b"7", "fixture@example.test", "Archive", kind)
    saved = next(tmp_path.glob("*.md"))
    metadata = yaml.safe_load(saved.read_text().split("---")[1])
    assert metadata["type"] == "Received" and metadata["archived"] is True
    assert metadata["imap_folder"] == "Archive" and metadata["imap_uid"] == "7"


@pytest.mark.parametrize("gmail,success", [(False, True), (False, False), (True, True), (True, False)])
def test_archiving_keeps_gmail_labels_and_reports_server_failures(gmail, success):
    mailbox = SimpleNamespace(
        capabilities=(b"X-GM-EXT-1",) if gmail else (),
        select=Mock(return_value=("OK", [])),
        uid=Mock(return_value=("OK" if success else "NO", [])),
        expunge=Mock(),
    )
    move = Mock(return_value=success)
    service = SimpleNamespace(
        _find_vault_file=lambda _, **kwargs: None,
        _connect=lambda _: nullcontext(mailbox),
        _find_server_folder=lambda *args: "[Gmail]/All Mail" if gmail else "Archive",
        _move_on_server=move,
    )
    assert ImapMailMutationService.archive_message(service, "fixture@example.test", "imap_42", "INBOX") is success
    if gmail:
        mailbox.uid.assert_called_once_with("store", "42", "-X-GM-LABELS", "(\\Inbox)")
        move.assert_not_called()
        mailbox.expunge.assert_not_called()
    else:
        move.assert_called_once_with(mailbox, "42", "INBOX", "Archive")


def test_content_identity_does_not_flatten_valid_message_id_characters():
    def parse(message_id):
        raw = f"Message-ID: <{message_id}>\r\n\r\n".encode()
        return hybrid._imap_list_item([(b"1 (UID 1 FLAGS () BODY[HEADER] {99}", raw), b")"], 0, "INBOX", "fixture@example.test", "INBOX")

    assert parse("a/b@example.test")["internet_message_id"] == "a/b@example.test"
    assert parse("ab@example.test")["internet_message_id"] == "ab@example.test"
