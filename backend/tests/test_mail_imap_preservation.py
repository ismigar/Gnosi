"""Background IMAP searches must not destroy the user's local archive."""

from unittest.mock import Mock

import pytest

from backend.domains.mail.sync.imap_core import ImapMailSyncCore


@pytest.mark.parametrize("server_result", [b"", b"2", b"9001 9002"])
def test_pull_preserves_local_copies_when_uids_disappear(tmp_path, server_result):
    core = object.__new__(ImapMailSyncCore)
    core.mail_folder = tmp_path
    originals = {}
    for stem, account, folder in [
        ("missing", "one@example.test", "INBOX"),
        ("other-account", "two@example.test", "INBOX"),
        ("other-folder", "one@example.test", "Sent"),
    ]:
        markdown = tmp_path / f"{stem}.md"
        markdown.write_text(
            f"---\naccount: {account}\nimap_folder: {folder}\nimap_uid: '1'\n"
            "---\n\nLocally preserved body\n"
        )
        markdown.with_suffix(".html").write_text("<p>Original HTML</p>")
    for file in tmp_path.iterdir():
        originals[file.name] = file.read_bytes()

    imap = Mock()
    imap.select.return_value = ("OK", [b"2"])
    imap.uid.return_value = ("OK", [server_result])
    core._sync_single_uid = Mock(return_value=True)
    core._sync_flags = Mock()

    result = core._sync_folder(imap, "one@example.test", "INBOX", "Received", 10)

    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == originals
    assert result == len(server_result.split())
    assert {call.args[1] for call in core._sync_single_uid.call_args_list} == set(
        server_result.split()
    )
    imap.select.assert_called_once_with('INBOX', readonly=True)
    core._sync_flags.assert_called_once()


def test_preserving_old_message_still_downloads_new_message_and_updates_flags(tmp_path):
    core = object.__new__(ImapMailSyncCore)
    core.mail_folder = tmp_path
    old = tmp_path / "old_Original.md"
    old.write_text(
        "---\naccount: one@example.test\nimap_folder: INBOX\nimap_uid: '1'\n"
        "---\n\nOriginal body\n"
    )
    old_html = old.with_suffix(".html")
    old_html.write_text("<p>Original HTML</p>")
    before = (old.read_bytes(), old_html.read_bytes())
    raw = (
        b"From: sender@example.test\r\nTo: one@example.test\r\n"
        b"Subject: New message\r\nMessage-ID: <new@example.test>\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n\r\nNew body"
    )
    imap = Mock()
    imap.select.return_value = ("OK", [b"1"])

    def uid(command, *args):
        if command == "search":
            return "OK", [b"2"]
        if args[-1] == "(RFC822 FLAGS)":
            return "OK", [(b"1 (UID 2 FLAGS () RFC822)", raw)]
        return "OK", [b"1 (UID 2 FLAGS (\\Seen \\Flagged))"]

    imap.uid.side_effect = uid
    assert core._sync_folder(imap, "one@example.test", "INBOX", "Received", 10) == 1
    assert (old.read_bytes(), old_html.read_bytes()) == before
    downloaded = next(p for p in tmp_path.glob("*.md") if p != old)
    metadata = core._parse_meta(downloaded.read_text())
    assert metadata["imap_uid"] == "2"
    assert metadata["is_read"] is True
    assert metadata["is_starred"] is True
    assert "New body" in downloaded.read_text()
    assert core._sync_folder(imap, "one@example.test", "INBOX", "Received", 10) == 0
    assert len(list(tmp_path.glob("*.md"))) == 2
