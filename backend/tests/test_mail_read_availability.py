"""Remote read failures remain distinguishable from empty mailboxes."""

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from backend.domains.mail.providers import hybrid
from backend.domains.mail.routes import messages
from backend.services import hybrid_mail_service, microsoft_mail_service
from backend.services.workspace_service import get_workspace_context


@pytest.mark.parametrize("failure", ["connect", "auth", "select", "search", "invalid-search", "fetch", "empty-fetch"])
def test_failed_imap_reads_have_an_error(monkeypatch, failure):
    email = "fixture@example.test"
    monkeypatch.setattr(hybrid, "_get_imap_account", lambda _: {"email": email})
    monkeypatch.setattr(hybrid, "_LAST_AUTH_ERROR", {email: "Reconnect this OAuth account"} if failure == "auth" else {})
    monkeypatch.setattr(hybrid.integration_manager, "is_imap_oauth_account", lambda _: False)

    def uid(command, *_):
        if command == "search":
            if failure == "search":
                return "NO", [b""]
            return "OK", [] if failure == "invalid-search" else [b"1"]
        return ("NO" if failure == "fetch" else "OK"), []

    connection = SimpleNamespace(select=lambda *a, **k: ("NO" if failure == "select" else "OK", [b"1"]), uid=uid)
    monkeypatch.setattr(hybrid, "_imap_pool_acquire", lambda _: None if failure in ("connect", "auth") else connection)
    monkeypatch.setattr(hybrid, "_imap_pool_release", Mock())
    result = hybrid.imap_list_messages(email)
    assert result["messages"] == []
    assert result["error"]
    if failure == "auth":
        assert result["error"] == "Reconnect this OAuth account"


@pytest.mark.parametrize("failure", ["provider", "exception", "timeout"])
def test_revalidation_failure_preserves_valid_message_cache_and_expiry(monkeypatch, failure):
    email = "fixture@example.test"
    cache_key = f"{email}|None|None|None|0|None"
    cached = {"messages": [{"id": "previous"}], "next_page_token": None, "total": 1}
    messages._MAIL_CACHE.clear()
    messages._MAIL_CACHE.set(cache_key, cached)
    expiry = messages._MAIL_CACHE._cache[cache_key]["expiry"]
    monkeypatch.setattr(hybrid.integration_manager, "get_mail_account", lambda *a, **k: {"email": email})
    monkeypatch.setattr(hybrid.integration_manager, "is_microsoft_account", lambda _: False)

    def unavailable(*a, **k):
        if failure == "exception":
            raise OSError("Synthetic disconnected socket")
        if failure == "timeout":
            raise TimeoutError("Synthetic socket timeout")
        return {"messages": [], "total": 0, "error": "Mail server unavailable"}

    monkeypatch.setattr(hybrid_mail_service, "imap_list_messages", unavailable)

    async def scenario():
        failed = await messages.get_messages(email, None, None, 50, 0, None, None, True)
        assert failed["error"]
        assert messages._MAIL_CACHE.get(cache_key) is cached
        assert messages._MAIL_CACHE._cache[cache_key]["expiry"] == expiry
        assert await messages.get_messages(email, None, None, 50, 0, None, None, False) is cached

    try:
        asyncio.run(scenario())
    finally:
        messages._MAIL_CACHE.clear()


def test_counts_failure_is_recoverable_http_response_not_zero(monkeypatch):
    async def unavailable(_):
        raise RuntimeError("Synthetic unavailable mailbox")

    monkeypatch.setattr(messages, "_load_mail_counts", unavailable)
    messages._COUNTS_CACHE.clear()
    app = FastAPI()
    app.include_router(messages.router)
    app.dependency_overrides[get_workspace_context] = lambda: None

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/mail/counts", params={"email": "fixture@example.test"})
        assert response.status_code == 503
        assert response.headers["retry-after"] == "3"
        assert "temporarily unavailable" in response.json()["detail"]
        assert messages._COUNTS_CACHE.get("fixture@example.test") is None

    asyncio.run(scenario())


def test_counts_deadline_keeps_a_shared_read_alive_for_another_waiter(monkeypatch):
    async def scenario():
        release = asyncio.Event()
        calls = []

        async def load(email):
            calls.append(email)
            await release.wait()
            return {"INBOX": {"total": 1, "unread": 1}}

        monkeypatch.setattr(messages, "_load_mail_counts", load)
        monkeypatch.setattr(messages, "_COUNTS_READ_TIMEOUT_S", 0.01)
        messages._COUNTS_CACHE.clear()
        with pytest.raises(HTTPException) as result:
            await messages.get_mail_counts("fixture@example.test")
        assert result.value.status_code == 503
        assert len(messages._COUNTS_INFLIGHT) == 1
        monkeypatch.setattr(messages, "_COUNTS_READ_TIMEOUT_S", 2)
        retry = asyncio.create_task(messages.get_mail_counts("fixture@example.test"))
        await asyncio.sleep(0)
        release.set()
        assert (await retry)["INBOX"]["unread"] == 1
        assert len(calls) == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("invalidation", ["account", "all"])
def test_counts_invalidated_during_read_do_not_replace_or_join_post_mutation_counts(monkeypatch, invalidation):
    async def scenario():
        email = "fixture@example.test"
        entered, release_old = asyncio.Event(), asyncio.Event()
        calls = []

        async def load(account):
            calls.append(account)
            if len(calls) == 1:
                entered.set()
                await release_old.wait()
                return {"INBOX": {"total": 3, "unread": 3}}
            return {"INBOX": {"total": 3, "unread": 2}}

        monkeypatch.setattr(messages, "_load_mail_counts", load)
        messages._COUNTS_CACHE.clear()
        old_read = asyncio.create_task(messages.get_mail_counts(email))
        try:
            await asyncio.wait_for(entered.wait(), 2)
            if invalidation == "account":
                messages._COUNTS_CACHE.pop(email)
            else:
                messages._invalidate_mail_cache()
            current = await asyncio.wait_for(messages.get_mail_counts(email), 2)
            assert current["INBOX"]["unread"] == 2
            assert len(calls) == 2
            expiry = messages._COUNTS_CACHE._cache[email]["expiry"]
            release_old.set()
            with pytest.raises(HTTPException) as result:
                await old_read
            assert result.value.status_code == 503
            assert messages._COUNTS_CACHE.get(email) is current
            assert messages._COUNTS_CACHE._cache[email]["expiry"] == expiry
            assert await messages.get_mail_counts(email) is current
        finally:
            release_old.set()
            await asyncio.gather(old_read, return_exceptions=True)
            messages._COUNTS_CACHE.clear()

    asyncio.run(scenario())


def test_counts_invalidating_another_account_keeps_the_current_read_generation():
    cache = messages._COUNTS_CACHE
    cache.clear()
    generation = cache.read_generation("fixture@example.test")
    cache.pop("other@example.test")
    counts = {"INBOX": {"total": 1, "unread": 1}}
    try:
        assert cache.read_generation("fixture@example.test") is generation
        assert cache.set_if_current("fixture@example.test", generation, counts)
        assert cache.get("fixture@example.test") is counts
    finally:
        cache.clear()


def test_microsoft_count_failure_is_not_an_empty_success(monkeypatch):
    monkeypatch.setattr(microsoft_mail_service, "_authed_get", lambda *a, **k: None)
    with pytest.raises(RuntimeError, match="temporarily unavailable"):
        microsoft_mail_service.microsoft_get_counts("fixture@example.test")


@pytest.mark.parametrize("read", [microsoft_mail_service.microsoft_list_messages, microsoft_mail_service.microsoft_get_counts])
def test_microsoft_list_and_count_network_reads_have_a_socket_deadline(monkeypatch, read):
    request = Mock(return_value={"value": []})
    monkeypatch.setattr(microsoft_mail_service, "_authed_get", request)
    read("fixture@example.test")
    assert request.call_args.kwargs["timeout"] == 20
