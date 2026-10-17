"""Complete date pagination and bounded snapshots need no live IMAP account."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import pytest

from backend.domains.mail.cache import _MAIL_CACHE
from backend.domains.mail.providers.hybrid import _imap_list_item
from backend.domains.mail.providers.imap_listing import (
    _MAX_HEADER_BATCH_CACHE_BYTES,
    list_all_mailboxes,
)
from backend.services.context_vars import active_vault_path

ACCOUNT = "fixture@example.test"
WHEN = datetime(2026, 10, 1, tzinfo=timezone.utc)


@dataclass
class HeaderRow:
    uid: int
    subject: str
    when: datetime = WHEN
    labels: str = ""


class HeaderMailbox:
    def __init__(self, folders, uidvalidity=b"1"):
        self.folders = folders
        self.uidvalidity = uidvalidity
        self.selected = ""
        self.searches = []
        self.fetches = []

    def select(self, name, readonly=False):
        assert readonly, "Header listing must preserve unread state"
        self.selected = name.strip('"')
        return ("OK", []) if self.selected in self.folders else ("NO", [])

    def response(self, name):
        assert name == "UIDVALIDITY"
        return name, [self.uidvalidity]

    def uid(self, command, *args):
        rows = self.folders[self.selected]
        if command == "search":
            self.searches.append((self.selected, args))
            return "OK", [b" ".join(str(row.uid).encode() for row in rows)]
        assert command == "fetch"
        requested = args[0].split(",")
        assert len(requested) <= 200
        self.fetches.append((self.selected, requested, args[1]))
        result = []
        for row in rows:
            if str(row.uid) not in requested:
                continue
            raw = (
                f"Date: {format_datetime(row.when)}\r\nSubject: {row.subject}\r\n"
                f"From: sender@example.test\r\nTo: {ACCOUNT}\r\n"
                f"Cc: copy@example.test\r\nMessage-ID: <{row.uid}@example.test>\r\n\r\n"
            ).encode()
            info = (
                f"1 (UID {row.uid} FLAGS (\\Seen) X-GM-THRID {1000 + row.uid} "
                f"X-GM-LABELS ({row.labels}) BODY[HEADER.FIELDS (DATE SUBJECT FROM TO CC MESSAGE-ID)] {{{len(raw)}}}"
            ).encode()
            result.extend([(info, raw), b")"])
        return "OK", result


@pytest.fixture(autouse=True)
def isolated_cache():
    _MAIL_CACHE.clear()
    yield
    _MAIL_CACHE.clear()


def listing(
    mailbox, *, folders=None, email=ACCOUNT, criteria="ALL", limit=50,
    offset=0, gmail=False, logical_folder="all",
):
    return list_all_mailboxes(
        mailbox, email, folders if folders is not None else [("Native all", "All")],
        criteria, limit, offset, _imap_list_item, gmail=gmail,
        logical_folder=logical_folder,
    )


@pytest.mark.parametrize("logical_folder", ["all", "ARCHIVE"])
def test_native_all_orders_imported_messages_by_date_before_pagination(logical_folder):
    mailbox = HeaderMailbox({"Native all": [
        HeaderRow(1, "Newest date, lowest UID", WHEN + timedelta(days=2)),
        HeaderRow(2, "Middle date", WHEN + timedelta(days=1)),
        HeaderRow(3, "Imported old date, highest UID", WHEN),
    ]})
    pages = [listing(mailbox, gmail=True, logical_folder=logical_folder, limit=1, offset=offset)
             for offset in range(3)]
    rows = [row for page in pages for row in page["messages"]]
    assert [page["total"] for page in pages] == [3, 3, 3]
    assert [row["imap_uid"] for row in rows] == ["1", "2", "3"]
    assert {row["imap_folder"] for row in rows} == {"Native all"}
    assert all(row["archived"] for row in rows)
    assert len(mailbox.searches) == 3 and len(mailbox.fetches) == 1
    assert mailbox.fetches[0][2] == (
        "(UID FLAGS X-GM-THRID X-GM-LABELS "
        "BODY.PEEK[HEADER.FIELDS (DATE SUBJECT FROM TO CC MESSAGE-ID)])"
    )


def test_archive_combines_every_selected_archive_before_date_pagination():
    mailbox = HeaderMailbox({
        "Archive": [HeaderRow(1, "Root archive")],
        "Archive/2025": [HeaderRow(1, "Historical archive", WHEN + timedelta(days=1))],
    })
    folders = [(name, "Archived") for name in mailbox.folders]
    pages = [listing(mailbox, folders=folders, logical_folder="ARCHIVE", limit=1, offset=offset)
             for offset in range(2)]
    rows = [row for page in pages for row in page["messages"]]
    assert [page["total"] for page in pages] == [2, 2]
    assert [row["subject"] for row in rows] == ["Historical archive", "Root archive"]
    assert [(row["imap_folder"], row["imap_uid"]) for row in rows] == [
        ("Archive/2025", "1"), ("Archive", "1"),
    ]
    assert all(row["archived"] for row in rows)


def test_generic_all_keeps_folder_types_and_archive_metadata():
    kinds = {
        "INBOX": "Received", "Archivo": "Archived", "Projects": "Custom",
        "Enviados": "Sent", "Borradores": "Draft",
    }
    mailbox = HeaderMailbox({name: [HeaderRow(1, name)] for name in kinds})
    result = listing(mailbox, folders=list(kinds.items()))
    rows = {row["imap_folder"]: row for row in result["messages"]}
    assert result["total"] == 5
    assert {name for name, row in rows.items() if row["archived"]} == {"Archivo", "Projects"}
    assert rows["Enviados"]["type"] == "Sent"
    assert rows["Borradores"]["type"] == "Draft"
    assert rows["Archivo"]["type"] == rows["Projects"]["type"] == "Received"
    assert all(fetch[2] == (
        "(UID FLAGS BODY.PEEK[HEADER.FIELDS (DATE SUBJECT FROM TO CC MESSAGE-ID)])"
    ) for fetch in mailbox.fetches)


@pytest.mark.parametrize("physical_folder", ["Native all", "ARCHIVE"])
def test_native_gmail_all_preserves_per_message_label_classification(physical_folder):
    mailbox = HeaderMailbox({physical_folder: [
        HeaderRow(1, "Inbox", labels="\\Inbox"),
        HeaderRow(2, "Sent", labels="\\Sent"),
        HeaderRow(3, "Draft", labels="\\Drafts"),
        HeaderRow(4, "Unlabelled"),
    ]})
    result = listing(mailbox, gmail=True, folders=[(physical_folder, "All")])
    rows = {row["subject"]: row for row in result["messages"]}
    assert {name for name, row in rows.items() if row["archived"]} == {"Sent", "Unlabelled"}
    assert rows["Sent"]["type"] == "Sent" and rows["Draft"]["type"] == "Draft"
    assert rows["Unlabelled"]["type"] == "Received"
    assert rows["Inbox"]["gm_thrid"] == "1001"
    assert {row["imap_folder"] for row in rows.values()} == {physical_folder}


@pytest.mark.parametrize("fault", ["non_ok", "missing", "duplicate", "unexpected", "empty", "invalid"])
def test_fetch_must_return_each_requested_uid_exactly_once(monkeypatch, fault):
    mailbox = HeaderMailbox({"Native all": [HeaderRow(1, "First"), HeaderRow(2, "Second")]})
    original = mailbox.uid

    def faulty_uid(command, *args):
        status, data = original(command, *args)
        if command != "fetch":
            return status, data
        if fault == "non_ok":
            return "NO", data
        if fault == "missing":
            return status, data[:2]
        if fault == "duplicate":
            return status, data + data[:2]
        if fault == "unexpected":
            info, raw = data[2]
            data[2] = (info.replace(b"UID 2 ", b"UID 3 "), raw)
        if fault == "empty":
            return status, []
        if fault == "invalid":
            info, raw = data[2]
            data[2] = (info.replace(b"UID 2 ", b""), raw)
        return status, data

    monkeypatch.setattr(mailbox, "uid", faulty_uid)
    with pytest.raises(RuntimeError, match="message headers"):
        listing(mailbox, gmail=True)
    assert len(_MAIL_CACHE) == 0


def test_failure_in_later_batch_does_not_publish_an_earlier_complete_batch(monkeypatch):
    mailbox = HeaderMailbox({"Native all": [HeaderRow(uid, str(uid)) for uid in range(1, 202)]})
    original = mailbox.uid

    def faulty_uid(command, *args):
        if command == "fetch" and args[0] == "201":
            return "OK", []
        return original(command, *args)

    monkeypatch.setattr(mailbox, "uid", faulty_uid)
    with pytest.raises(RuntimeError, match="message headers"):
        listing(mailbox, limit=1)


@pytest.mark.parametrize("fault", ["select", "search_non_ok", "search_missing", "search_duplicate"])
def test_incomplete_search_or_selection_never_returns_success(monkeypatch, fault):
    mailbox = HeaderMailbox({"Native all": [HeaderRow(1, "First")]})
    if fault == "select":
        monkeypatch.setattr(mailbox, "select", lambda *args, **kwargs: ("NO", []))
    else:
        status, data = {
            "search_non_ok": ("NO", [b"1"]),
            "search_missing": ("OK", [None]),
            "search_duplicate": ("OK", [b"1 1"]),
        }[fault]
        monkeypatch.setattr(mailbox, "uid", lambda *args: (status, data))
    with pytest.raises(RuntimeError):
        listing(mailbox)


def test_more_than_two_thousand_headers_reuse_bounded_batches_and_refresh_membership():
    rows = [HeaderRow(uid, f"Message {uid}", WHEN + timedelta(seconds=uid))
            for uid in range(1, 2002)]
    mailbox = HeaderMailbox({"Native all": rows})
    first = listing(mailbox, limit=50)
    second = listing(mailbox, limit=50, offset=50)
    last = listing(mailbox, limit=50, offset=2000)
    assert first["total"] == second["total"] == last["total"] == 2001
    assert first["messages"][0]["imap_uid"] == "2001"
    assert second["messages"][0]["imap_uid"] == "1951"
    assert [row["imap_uid"] for row in last["messages"]] == ["1"]
    assert len(mailbox.searches) == 3 and len(mailbox.fetches) == 11
    assert len(_MAIL_CACHE) == 11
    assert all(isinstance(entry["value"], bytes) and len(entry["value"]) <= _MAX_HEADER_BATCH_CACHE_BYTES
               for entry in _MAIL_CACHE._cache.values())

    # Membership changes invalidate all batch snapshots, including batches whose
    # own UID range has stayed the same.
    rows[0].subject = "Changed alongside membership"
    rows.append(HeaderRow(2002, "New arrival", WHEN + timedelta(seconds=2002)))
    changed = listing(mailbox, limit=2002)
    assert changed["total"] == 2002 and len(mailbox.fetches) == 22
    assert changed["messages"][0]["subject"] == "New arrival"
    assert changed["messages"][-1]["subject"] == "Changed alongside membership"

    # A reset can reuse the entire UID set for different content.
    rows[0].subject = "New UID generation"
    mailbox.uidvalidity = b"2"
    reset = listing(mailbox, limit=1, offset=2001)
    assert reset["messages"][0]["subject"] == "New UID generation"
    assert len(mailbox.fetches) == 33


@pytest.mark.parametrize("uidvalidity", [None, b"0", b"invalid"])
def test_missing_or_invalid_uidvalidity_disables_unsafe_reuse(uidvalidity):
    row = HeaderRow(1, "Old content")
    mailbox = HeaderMailbox({"Native all": [row]}, uidvalidity=uidvalidity)
    listing(mailbox)
    row.subject = "Same UID after a reset"
    assert listing(mailbox)["messages"][0]["subject"] == "Same UID after a reset"
    assert len(mailbox.fetches) == 2 and len(_MAIL_CACHE) == 0


@pytest.mark.parametrize("scope", ["vault", "account", "folder", "criteria", "logical_folder", "gmail", "kind"])
def test_header_batch_cache_keeps_every_context_scope_separate(tmp_path, scope):
    row = HeaderRow(1, "First context")
    mailbox = HeaderMailbox({"Native all": [row]})
    vault_token = active_vault_path.set(tmp_path / "first-vault")
    try:
        listing(mailbox)
        row.subject = "Second context"
        options = {}
        if scope == "vault":
            active_vault_path.set(tmp_path / "second-vault")
        elif scope == "account":
            options["email"] = "other@example.test"
        elif scope == "folder":
            mailbox.folders["Other all"] = [row]
            options["folders"] = [("Other all", "All")]
        elif scope == "criteria":
            options["criteria"] = "SEEN"
        elif scope == "logical_folder":
            options["logical_folder"] = "ARCHIVE"
        elif scope == "gmail":
            options["gmail"] = True
        elif scope == "kind":
            options["folders"] = [("Native all", "Archived")]
        assert listing(mailbox, **options)["messages"][0]["subject"] == "Second context"
        assert len(mailbox.fetches) == 2
    finally:
        active_vault_path.reset(vault_token)


def test_oversized_optional_snapshot_is_skipped_without_truncating_results():
    subject = "A" * (_MAX_HEADER_BATCH_CACHE_BYTES + 1)
    mailbox = HeaderMailbox({"Native all": [HeaderRow(1, subject)]})
    for _ in range(2):
        result = listing(mailbox)
        assert result["total"] == 1 and result["messages"][0]["subject"] == subject
    assert len(mailbox.fetches) == 2 and len(_MAIL_CACHE) == 0


def test_returned_rows_do_not_mutate_cached_snapshots():
    mailbox = HeaderMailbox({"Native all": [HeaderRow(1, "Original")]})
    result = listing(mailbox)
    result["messages"][0]["subject"] = "Changed by a caller"
    assert listing(mailbox)["messages"][0]["subject"] == "Original"
    assert len(mailbox.fetches) == 1
