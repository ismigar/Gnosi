"""Folder counters cannot hold up list reads or change message read flags."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from backend.domains.mail.providers import hybrid
from backend.domains.mail.routes import messages
from backend.services import imap_mail_sync_service


@pytest.mark.parametrize("oauth", [False, True])
def test_list_fetches_only_needed_headers_without_changing_flags(monkeypatch, oauth):
    account = {"email": "fixture@example.test"}
    calls = []
    raw_headers = (b"Date: Tue, 8 Sep 2026 10:00:00 +0000\r\nSubject: Synthetic\r\n"
                   b"From: sender@example.test\r\nTo: fixture@example.test\r\n"
                   b"Cc: copy@example.test\r\nMessage-ID: <synthetic@example.test>\r\n\r\n")

    def uid(command, *args):
        calls.append((command, args))
        if command == "search":
            return "OK", [b"1 2"]
        return "OK", [(b"1 (UID 2 FLAGS (\\Flagged) X-GM-THRID 123 BODY[HEADER.FIELDS] {99}", raw_headers), b")"]

    connection = SimpleNamespace(select=Mock(return_value=("OK", [b"2"])), uid=uid)
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: account)
    monkeypatch.setattr(hybrid, "_imap_pool_acquire", lambda _: connection)
    release = Mock()
    monkeypatch.setattr(hybrid, "_imap_pool_release", release)
    monkeypatch.setattr(hybrid.integration_manager, "is_imap_oauth_account", lambda _: oauth)
    result = hybrid.imap_list_messages(account["email"], limit=1)
    assert result["total"] == 2
    message = result["messages"][0]
    assert message["id"] == "imap_2" and message["thread_id"] == "123"
    assert message["subject"] == "Synthetic"
    assert message["cc"] == "copy@example.test"
    assert message["is_starred"] is True and message["is_read"] is False
    connection.select.assert_called_once_with('"INBOX"', readonly=True)
    requested = calls[-1][1][1]
    assert "BODY.PEEK[HEADER.FIELDS (DATE SUBJECT FROM TO CC MESSAGE-ID)]" in requested
    assert "RFC822.HEADER" not in requested
    assert ("X-GM-THRID" in requested) is oauth
    release.assert_called_once_with(account["email"])


def test_slow_counts_leave_the_message_connection_available(monkeypatch):
    entered, release_counts = Event(), Event()

    def status(*_):
        entered.set()
        assert release_counts.wait(3)
        return "OK", [b'"INBOX" (UNSEEN 2 MESSAGES 10)']

    counts_connection = SimpleNamespace(status=status, logout=Mock())
    list_connection = SimpleNamespace(select=lambda *a, **k: ("OK", [b"0"]), uid=lambda *a: ("OK", [b""]))
    acquire = Mock(return_value=list_connection)
    release_list = Mock()
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: {"email": "fixture@example.test"})
    monkeypatch.setattr(hybrid, "_imap_connect_fresh", lambda _: counts_connection)
    monkeypatch.setattr(hybrid, "_imap_pool_acquire", acquire)
    monkeypatch.setattr(hybrid, "_imap_pool_release", release_list)
    monkeypatch.setattr(imap_mail_sync_service, "_discover_folders", lambda _: [("INBOX", "Received")])
    with ThreadPoolExecutor(max_workers=2) as pool:
        counts = pool.submit(hybrid.imap_get_counts, "fixture@example.test")
        try:
            assert entered.wait(2)
            listing = pool.submit(hybrid.imap_list_messages, "fixture@example.test").result(timeout=2)
            assert listing == {"messages": [], "total": 0}
        finally:
            release_counts.set()
        assert counts.result(timeout=2)["INBOX"] == {"total": 10, "unread": 2}
    acquire.assert_called_once()
    release_list.assert_called_once()
    counts_connection.logout.assert_called_once()


@pytest.mark.parametrize("failure", ["status", "invalid", "connect"])
def test_failed_counts_are_errors_and_close_the_temporary_connection(monkeypatch, failure):
    connection = SimpleNamespace(
        status=Mock(return_value=("NO", [b""]) if failure == "status" else ("OK", [b"invalid"])),
        logout=Mock(),
    )
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: {"email": "fixture@example.test"})
    monkeypatch.setattr(hybrid, "_imap_connect_fresh", lambda _: None if failure == "connect" else connection)
    monkeypatch.setattr(imap_mail_sync_service, "_discover_folders", lambda _: [("INBOX", "Received")])
    with pytest.raises(RuntimeError):
        hybrid.imap_get_counts("fixture@example.test")
    assert connection.logout.call_count == (0 if failure == "connect" else 1)


@pytest.mark.parametrize("outcome", ["success", "failure", "cancel-one"])
def test_overlapping_count_reads_share_work_and_failures_are_retryable(monkeypatch, outcome):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def load(email):
            calls.append(email)
            entered.set()
            await release.wait()
            if outcome == "failure" and len(calls) == 1:
                raise RuntimeError("Synthetic provider failure")
            return {"INBOX": {"total": 3, "unread": 1}}

        monkeypatch.setattr(messages, "_load_mail_counts", load)
        messages._COUNTS_CACHE.clear()
        first = asyncio.create_task(messages.get_mail_counts("fixture@example.test"))
        await entered.wait()
        second = asyncio.create_task(messages.get_mail_counts("fixture@example.test"))
        await asyncio.sleep(0)
        if outcome == "cancel-one":
            first.cancel()
        release.set()
        results = await asyncio.gather(first, second, return_exceptions=True)
        assert len(calls) == 1
        if outcome == "failure":
            assert all(isinstance(result, HTTPException) and result.status_code == 503 for result in results)
            assert messages._COUNTS_CACHE.get("fixture@example.test") is None
            assert (await messages.get_mail_counts("fixture@example.test"))["INBOX"]["total"] == 3
            assert len(calls) == 2
        else:
            assert results[1] == {"INBOX": {"total": 3, "unread": 1}}
            if outcome == "cancel-one":
                assert isinstance(results[0], asyncio.CancelledError)
            else:
                assert results[0] == results[1]
        assert not messages._COUNTS_INFLIGHT

    asyncio.run(scenario())
