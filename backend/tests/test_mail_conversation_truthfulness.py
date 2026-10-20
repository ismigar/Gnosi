"""Conversation errors remain retryable and saved message IDs remain readable."""

import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI

from backend.domains.mail.routes import messages
from backend.domains.mail.providers import hybrid
from backend.services import hybrid_mail_service
from backend.services.imap_mail_sync_service import imap_sync_service
from backend.services.integration_manager import integration_manager


ACCOUNT = "fixture@example.test"
FOLDER = "[Gmail]/Tot el correu"


def install_thread_provider(monkeypatch, fault=None):
    def uid(operation, *args):
        if fault == "socket":
            raise TimeoutError("Synthetic provider socket deadline")
        if operation == "search":
            return ("NO", [b"[UNAVAILABLE] Try again later"]) if fault == "search" else ("OK", [b"101 102"])
        assert operation == "fetch"
        if fault == "fetch":
            return "NO", [b"[UNAVAILABLE] Try again later"]
        result = []
        for number in (101, 102):
            if fault == "partial" and number == 102:
                continue
            raw = (
                f"Date: Thu, 01 Oct 2026 10:00:00 +0000\r\nSubject: Member {number}\r\n"
                f"Message-ID: <member-{number}@example.test>\r\n\r\n"
            ).encode()
            result.extend([(
                f"1 (UID {number} FLAGS () X-GM-THRID 555 X-GM-LABELS () BODY[HEADER] {{{len(raw)}}}".encode(), raw,
            ), b")"])
        return "OK", result

    connection = SimpleNamespace(
        capability=lambda: ("OK", [b"IMAP4rev1 X-GM-EXT-1"]),
        list=lambda: ("OK", [f'(\\All) "/" "{FOLDER}"'.encode()]),
        select=lambda *args, **kwargs: ("NO", [b"[UNAVAILABLE]"]) if fault == "select" else ("OK", [b"2"]),
        uid=uid,
    )
    monkeypatch.setattr(imap_sync_service, "_connect", lambda email: nullcontext(None if fault == "connect" else connection))
    monkeypatch.setattr(integration_manager, "get_mail_account", lambda *args, **kwargs: {"email": ACCOUNT})
    monkeypatch.setattr(integration_manager, "is_imap_oauth_account", lambda account: True)
    app = FastAPI()
    app.include_router(messages.router)
    return app


def thread_response(app):
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/api/mail/threads/555", params={"email": ACCOUNT})

    return asyncio.run(request())


def test_conversation_fixture_reads_both_members(monkeypatch):
    response = thread_response(install_thread_provider(monkeypatch))
    assert response.status_code == 200, response.text
    assert {row["imap_uid"] for row in response.json()["messages"]} == {"101", "102"}


@pytest.mark.parametrize("fault", ["connect", "select", "search", "fetch", "socket"])
def test_conversation_provider_failures_are_retryable(monkeypatch, fault):
    response = thread_response(install_thread_provider(monkeypatch, fault))
    assert response.status_code == 503, f"{fault} became HTTP {response.status_code}: {response.text}"
    assert response.headers["Retry-After"] == "3"


def test_conversation_cannot_publish_partial_headers_as_success(monkeypatch):
    response = thread_response(install_thread_provider(monkeypatch, "partial"))
    assert response.status_code == 503, f"SEARCH returned 101 102 but partial FETCH became HTTP {response.status_code}: {response.text}"
    assert response.headers["Retry-After"] == "3"


def test_saved_rfc_id_still_reads_with_an_imap_account(tmp_path, monkeypatch):
    message_id = "saved@example.test"
    (tmp_path / f"{message_id}_Synthetic.md").write_text(
        f"---\nid: {message_id}\naccount: {ACCOUNT}\ntitle: Saved synthetic message\n---\nLocal saved body\n"
    )
    monkeypatch.setattr(messages, "get_mail_vault_path", lambda: tmp_path)
    monkeypatch.setattr(integration_manager, "get_mail_account", lambda *args, **kwargs: {"email": ACCOUNT})
    monkeypatch.setattr(integration_manager, "is_microsoft_account", lambda account: False)
    monkeypatch.setattr(integration_manager, "is_imap_account", lambda account: True)
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda email: {"email": ACCOUNT})
    connection = SimpleNamespace(
        select=Mock(return_value=("OK", [])),
        uid=Mock(return_value=("BAD", [b"Invalid UID message set"])),
    )
    acquire = Mock(return_value=connection)
    monkeypatch.setattr(hybrid, "_imap_pool_acquire", acquire)
    monkeypatch.setattr(hybrid, "_imap_pool_release", Mock())
    monkeypatch.setattr(hybrid, "_imap_pool_invalidate", Mock())
    monkeypatch.setattr(hybrid_mail_service, "imap_get_message", hybrid.imap_get_message)
    app = FastAPI()
    app.include_router(messages.router)

    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            unscoped = await client.get(f"/api/mail/messages/{message_id}")
            assert unscoped.status_code == 200, unscoped.text
            assert "Local saved body" in unscoped.json()["body_text"]
            return await client.get(f"/api/mail/messages/{message_id}", params={"email": ACCOUNT})

    response = asyncio.run(request())
    assert response.status_code == 200, f"Valid account-scoped saved mail became HTTP {response.status_code}: {response.text}"
    assert "Local saved body" in response.json()["body_text"]
    acquire.assert_not_called()
