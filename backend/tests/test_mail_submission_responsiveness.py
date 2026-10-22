"""Synthetic submission ownership, local-file stalls and SMTP outcome tests.

No configured accounts, tokens or remote provider transports are used.
"""

import asyncio
from contextvars import ContextVar
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI, HTTPException

# Match existing Mail route tests: messages imports the router/workspace models
# before its schemas; compose imports schemas first and cannot bootstrap alone.
from backend.domains.mail.routes import messages
from backend.domains.mail.routes import compose
from backend.domains.mail.services import submission
from backend.domains.mail.sync import smtp
from backend.services import hybrid_mail_service
from backend.services.integration_manager import integration_manager


@pytest.mark.parametrize("kind", ["send", "reply"])
def test_slow_send_and_cid_preparation_leave_health_and_message_body_available(monkeypatch, kind):
    async def scenario():
        loop = asyncio.get_running_loop()
        entered, release = Event(), Event()
        marker = ContextVar("synthetic_submission_scope", default="missing")
        token = marker.set("expected-vault")
        calls = []

        def provider(*args, **kwargs):
            calls.append((args, kwargs))
            assert marker.get() == "expected-vault"
            entered.set()
            assert release.wait(2), "Send blocked the event loop"
            return True

        async def prepare(_email, body, _images, **kwargs):
            # The async legacy helper may itself do blocking local/cloud I/O.
            beat = Event()
            loop.call_soon_threadsafe(beat.set)
            assert beat.wait(2), "CID/local-image preparation blocked the event loop"
            return body

        account = {"email": "fixture@example.test", "provider": "manual"}
        monkeypatch.setattr(submission, "_account_key", lambda email: ("fixture-store", email))
        monkeypatch.setattr(integration_manager, "get_mail_account", lambda *args, **kwargs: account)
        monkeypatch.setattr(compose, "_embed_quoted_cid_images", prepare)
        monkeypatch.setattr(compose, "_is_imap_account", lambda _: True)
        monkeypatch.setattr(compose, "_is_microsoft_account", lambda _: False)
        monkeypatch.setattr(hybrid_mail_service, "imap_get_message", lambda *args: {"body_text": "Readable body"})
        from backend.services import imap_mail_sync_service

        monkeypatch.setattr(imap_mail_sync_service, "imap_smtp_send", provider)
        monkeypatch.setattr(compose, "send_reply", provider)
        app = FastAPI()

        @app.get("/health")
        async def health():
            return {"status": "ok"}

        @app.get("/body")
        async def body():
            return await messages.get_message("imap_42", account["email"], "INBOX")

        @app.post("/send")
        async def send():
            if kind == "reply":
                return await compose.reply_message(
                    message_id="42", email=account["email"], folder="INBOX",
                    body="<p>Reply</p>", to="recipient@example.test", cc=None, bcc=None,
                    attachments=[],
                )
            return await compose.send_mail(
                email=account["email"], to="recipient@example.test", subject="Synthetic",
                body="<p>Hello</p>", cc=None, bcc=None, from_name=None, from_email=None,
                attachments=[],
            )

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture") as client:
            pending = asyncio.create_task(client.post("/send"))
            try:
                assert await asyncio.to_thread(entered.wait, 1)
                health_response, body_response = await asyncio.wait_for(
                    asyncio.gather(client.get("/health"), client.get("/body")), timeout=1,
                )
                assert health_response.json() == {"status": "ok"}
                assert body_response.json()["body_text"] == "Readable body"
                assert not pending.done()
            finally:
                release.set()
                response = await pending
                marker.reset(token)
            assert response.json() == {"status": "success"}
            assert len(calls) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("disconnect", [False, True])
def test_deadline_or_disconnect_keeps_account_owned_until_actual_worker_finishes(monkeypatch, disconnect):
    async def scenario():
        entered, release, finished = Event(), Event(), Event()
        calls = 0
        monkeypatch.setattr(submission, "SUBMISSION_TIMEOUT_S", 0.03)
        monkeypatch.setattr(submission, "_account_key", lambda _: ("store", "canonical-account"))

        async def stalled():
            nonlocal calls
            calls += 1
            entered.set()
            try:
                assert release.wait(2)
                return True
            finally:
                finished.set()

        pending = asyncio.create_task(submission.submit_mail("alias@example.test", stalled))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            if disconnect:
                pending.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await pending
            else:
                with pytest.raises(HTTPException) as failure:
                    await pending
                assert failure.value.detail == {"code": "mail_delivery_unknown"}
            with pytest.raises(HTTPException) as busy:
                await submission.submit_mail("parent@example.test", stalled)
            assert busy.value.status_code == 409
            assert busy.value.detail == {"code": "mail_send_in_progress"}
            assert calls == 1
        finally:
            release.set()
            assert await asyncio.to_thread(finished.wait, 1)
            # Let the real worker finally release ownership, then its task observe completion.
            for _ in range(20):
                if ("store", "canonical-account") not in submission._owners:
                    break
                await asyncio.sleep(0.005)
        assert ("store", "canonical-account") not in submission._owners

    asyncio.run(scenario())


def test_recipient_history_cloud_file_stall_is_bounded_and_coalesced(monkeypatch):
    async def scenario():
        entered, release = Event(), Event()
        calls = []

        def blocked_history(_email):
            calls.append(True)
            entered.set()
            assert release.wait(2), "A cached local mail read blocked the event loop"
            return {}, {}

        monkeypatch.setattr(compose, "_sent_recipient_history", blocked_history)
        monkeypatch.setattr(compose, "_RECIPIENT_HISTORY_TIMEOUT_S", 0.03)
        monkeypatch.setattr(compose, "_contact_suggestions", lambda *args: ([], set()))
        try:
            result = await compose.suggest_recipients("fixture", "fixture@example.test", "personal", None)
            assert entered.is_set()
            assert result["suggestions"] == []
            result = await compose.suggest_recipients("fixture2", "fixture@example.test", "personal", None)
            assert result["suggestions"] == []
            assert len(calls) == 1
            # Real message-body handling can still serve a separate local record.
            monkeypatch.setattr(messages, "_get_saved_message", lambda *args: {"body_text": "Local body"})
            assert (await messages.get_message("saved-fixture", None, None))["body_text"] == "Local body"
        finally:
            release.set()
            await asyncio.gather(*list(compose._recipient_history_reads.values()))

    asyncio.run(scenario())


def test_account_ownership_is_shared_by_alias_but_isolated_by_integration_store(monkeypatch, tmp_path):
    monkeypatch.setattr(integration_manager, "get_mail_account", lambda *args, **kwargs: None)
    monkeypatch.setattr(integration_manager, "_mail_account_refs", lambda: [
        {"email": "parent@example.test", "aliases": [{"email": "alias@example.test"}]},
    ])
    monkeypatch.setattr(integration_manager, "config_file", tmp_path / "a" / "integrations.json")
    parent = submission._account_key("PARENT@example.test")
    alias = submission._account_key("alias@example.test")
    assert parent == alias
    monkeypatch.setattr(integration_manager, "config_file", tmp_path / "b" / "integrations.json")
    assert submission._account_key("alias@example.test") != alias


@pytest.mark.parametrize("outcome", ["accepted-quit-disconnect", "unknown-after-data", "rejected-data"])
def test_smtp_acceptance_survives_quit_failure_and_transport_failure_is_unknown(monkeypatch, outcome):
    import smtplib

    server = SimpleNamespace(sock=Mock(), ehlo=Mock(), close=Mock())
    server.quit = Mock(side_effect=OSError("Synthetic QUIT disconnect"))
    if outcome == "unknown-after-data":
        server.sendmail = Mock(side_effect=TimeoutError("Synthetic response lost after DATA"))
    elif outcome == "rejected-data":
        server.sendmail = Mock(side_effect=smtplib.SMTPDataError(550, b"Synthetic rejection"))
    else:
        server.sendmail = Mock(return_value={})
    monkeypatch.setattr(smtplib, "SMTP", lambda *args, **kwargs: server)
    monkeypatch.setattr(integration_manager, "resolve_imap_defaults", lambda account: account)
    monkeypatch.setattr(integration_manager, "is_imap_oauth_account", lambda _: False)
    monkeypatch.setattr(submission, "_account_key", lambda _: ("fixture-store", "fixture-account"))

    async def deliver():
        return smtp.imap_smtp_send(
            {"email": "fixture@example.test", "smtp_host": "fixture.invalid", "smtp_port": 25,
             "smtp_encryption": "plain"},
            "recipient@example.test", "Synthetic", "<p>Fixture</p>",
        )

    if outcome == "unknown-after-data":
        with pytest.raises(HTTPException) as failure:
            asyncio.run(submission.submit_mail("fixture@example.test", deliver))
        assert failure.value.detail == {"code": "mail_delivery_unknown"}
    else:
        assert asyncio.run(submission.submit_mail("fixture@example.test", deliver)) is (
            outcome == "accepted-quit-disconnect"
        )
    server.sendmail.assert_called_once()
    server.close.assert_called_once()


@pytest.mark.parametrize("accepted", [True, False])
def test_loopback_smtp_single_data_with_attachment_and_lost_response(monkeypatch, accepted):
    import socket
    import socketserver
    from threading import Thread

    transactions = []
    # SMTP resolves its EHLO name after connecting. Keep this loopback fixture
    # independent of host DNS/mDNS latency without relaxing its socket deadline.
    monkeypatch.setattr(socket, "getfqdn", lambda *args: "smtp-fixture.invalid")

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.connection.settimeout(2)
            self.wfile.write(b"220 fixture ESMTP\r\n")
            while command := self.rfile.readline():
                verb = command.split(b" ", 1)[0].strip().upper()
                if verb in (b"EHLO", b"HELO"):
                    self.wfile.write(b"250 fixture\r\n")
                elif verb in (b"MAIL", b"RCPT"):
                    self.wfile.write(b"250 OK\r\n")
                elif verb == b"DATA":
                    self.wfile.write(b"354 Send data\r\n")
                    size = 0
                    while (line := self.rfile.readline()) != b".\r\n":
                        if not line:
                            return
                        size += len(line)
                    transactions.append(size)
                    if not accepted:
                        return  # DATA received; acceptance response is lost.
                    self.wfile.write(b"250 Accepted\r\n")
                elif verb == b"QUIT":
                    return  # Acceptance already known; QUIT response is lost.
                else:
                    self.wfile.write(b"500 Unexpected command\r\n")

    monkeypatch.setattr(integration_manager, "resolve_imap_defaults", lambda account: account)
    monkeypatch.setattr(integration_manager, "is_imap_oauth_account", lambda _: False)
    monkeypatch.setattr(submission, "_account_key", lambda _: ("fixture-store", "loopback-account"))
    with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.handle_request, daemon=True)
        thread.start()

        async def deliver():
            return smtp.imap_smtp_send(
                {"email": "fixture@example.test", "smtp_host": "127.0.0.1",
                 "smtp_port": server.server_address[1], "smtp_encryption": "plain"},
                "recipient@example.test", "Synthetic attachment", "<p>Fixture</p>",
                attachments=[{"filename": "fixture.png", "content_type": "image/png",
                              "data": b"\x89PNG" + bytes(414 * 1024 - 4)}],
            )

        if accepted:
            assert asyncio.run(submission.submit_mail("fixture@example.test", deliver)) is True
        else:
            with pytest.raises(HTTPException) as failure:
                asyncio.run(submission.submit_mail("fixture@example.test", deliver))
            assert failure.value.detail == {"code": "mail_delivery_unknown"}
        thread.join(timeout=2)
        assert not thread.is_alive()
    assert len(transactions) == 1
    assert transactions[0] > 414 * 1024


@pytest.mark.parametrize("failure_kind", ["transport", "explicit-rejection"])
def test_gmail_api_submission_distinguishes_lost_transport_from_rejection(monkeypatch, failure_kind):
    import httplib2
    from googleapiclient.errors import HttpError
    from backend.services import google_mail_service

    service = Mock()
    execute = service.users.return_value.messages.return_value.send.return_value.execute
    execute.side_effect = (
        TimeoutError("Synthetic lost response") if failure_kind == "transport" else
        HttpError(httplib2.Response({"status": "400"}), b'{"error":{"message":"Synthetic rejection"}}')
    )
    monkeypatch.setattr(google_mail_service, "get_gmail_service", lambda _: service)
    monkeypatch.setattr(submission, "_account_key", lambda _: ("fixture-store", "gmail-fixture"))

    async def deliver():
        return google_mail_service.send_new_message(
            "fixture@example.test", "recipient@example.test", "Synthetic", "Hello",
        )

    if failure_kind == "transport":
        with pytest.raises(HTTPException) as failure:
            asyncio.run(submission.submit_mail("fixture@example.test", deliver))
        assert failure.value.detail == {"code": "mail_delivery_unknown"}
    else:
        assert asyncio.run(submission.submit_mail("fixture@example.test", deliver)) is False
    execute.assert_called_once()
