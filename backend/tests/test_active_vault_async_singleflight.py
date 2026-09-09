"""A cold routing burst must not fill the executor with blocked followers."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from backend.services import active_vault_middleware as routing


@pytest.fixture(autouse=True)
def clear_identity_cache():
    routing.reset_vault_path_cache()
    yield
    routing.reset_vault_path_cache()


def test_burst_larger_than_executor_keeps_unrelated_workers_and_vaults_available(monkeypatch):
    entered = Event()
    release = Event()
    calls = []

    def read(identifier):
        calls.append(identifier)
        if identifier == "slow":
            entered.set()
            assert release.wait(3)
        return identifier, f"/{identifier}"

    monkeypatch.setattr(routing, "_read_vault_identity", read)

    async def scenario():
        loop = asyncio.get_running_loop()
        loop.set_default_executor(ThreadPoolExecutor(max_workers=2))
        readers = [asyncio.create_task(routing._resolve_request_vault_identity("slow"))
                   for _ in range(20)]
        try:
            # The signal wait itself must still have an executor slot.
            assert await asyncio.wait_for(asyncio.to_thread(entered.wait, 1), 1.5)
            assert await asyncio.wait_for(asyncio.to_thread(lambda: "auth worker"), 1) == "auth worker"
            assert await asyncio.wait_for(
                routing._resolve_request_vault_identity("other"), 1
            ) == ("other", "/other")
            assert calls.count("slow") == 1
            assert not any(reader.done() for reader in readers)
        finally:
            release.set()
            results = await asyncio.gather(*readers)
        assert results == [("slow", "/slow")] * 20
        assert calls.count("slow") == 1
        assert not routing._request_identity_reads

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_initial_reader", [False, True])
def test_disconnected_reader_does_not_cancel_the_shared_owner(monkeypatch, cancel_initial_reader):
    entered = Event()
    release = Event()
    calls = 0

    def read(identifier):
        nonlocal calls
        calls += 1
        entered.set()
        assert release.wait(3)
        return identifier, "/shared"

    monkeypatch.setattr(routing, "_read_vault_identity", read)

    async def scenario():
        first = asyncio.create_task(routing._resolve_request_vault_identity("same"))
        assert await asyncio.to_thread(entered.wait, 1)
        second = asyncio.create_task(routing._resolve_request_vault_identity("same"))
        await asyncio.sleep(0)
        cancelled, survivor = (first, second) if cancel_initial_reader else (second, first)
        try:
            cancelled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            assert not survivor.done()
            assert calls == 1
        finally:
            release.set()
        assert await asyncio.wait_for(survivor, 2) == ("same", "/shared")
        assert await routing._resolve_request_vault_identity("same") == ("same", "/shared")
        assert calls == 1
        assert not routing._request_identity_reads

    asyncio.run(scenario())


def test_shared_failure_is_delivered_to_all_readers_and_allows_a_fresh_attempt(monkeypatch):
    entered = Event()
    release = Event()
    failure = RuntimeError("Synthetic identity failure")
    calls = 0

    def read(identifier):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            assert release.wait(3)
            raise failure
        return identifier, "/recovered"

    monkeypatch.setattr(routing, "_read_vault_identity", read)

    async def scenario():
        readers = [asyncio.create_task(routing._resolve_request_vault_identity("same"))
                   for _ in range(12)]
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            await asyncio.sleep(0)
            assert calls == 1
        finally:
            release.set()
        results = await asyncio.gather(*readers, return_exceptions=True)
        assert all(error is failure for error in results)
        assert not routing._request_identity_reads
        assert not routing._identity_reads
        assert await routing._resolve_request_vault_identity("same") == ("same", "/recovered")
        assert calls == 2

    asyncio.run(scenario())


def test_invalidation_starts_a_new_async_owner_and_old_completion_cannot_replace_it(monkeypatch):
    entered = Event()
    release = Event()
    calls = 0

    def read(identifier):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            assert release.wait(3)
            return identifier, "/old"
        return identifier, "/new"

    monkeypatch.setattr(routing, "_read_vault_identity", read)

    async def scenario():
        old = asyncio.create_task(routing._resolve_request_vault_identity("same"))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            routing.reset_vault_path_cache()
            assert await asyncio.wait_for(
                routing._resolve_request_vault_identity("same"), 1
            ) == ("same", "/new")
        finally:
            release.set()
        assert await old == ("same", "/old")
        assert await routing._resolve_request_vault_identity("same") == ("same", "/new")
        assert calls == 2
        assert not routing._request_identity_reads

    asyncio.run(scenario())
