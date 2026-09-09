"""Cold auth gates share policy work without occupying follower workers."""

import asyncio
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from starlette.requests import HTTPConnection

from backend.services import auth_public_surface as surface
from backend.services import auth_service as auth


@pytest.fixture(autouse=True)
def isolated_policy(monkeypatch):
    monkeypatch.delenv(auth.REQUIRE_AUTH_ENV, raising=False)
    auth.reset_auth_policy_cache()
    monkeypatch.setattr(surface, "_policy_reads", {})
    monkeypatch.setattr(auth, "deployment_is_exposed", lambda: False)
    monkeypatch.setattr(auth, "ambient_identity_available", lambda _: True)

    def database():
        yield object()

    monkeypatch.setattr(auth, "get_mgmt_db", database)
    yield
    auth.reset_auth_policy_cache()


def _connection(path="/api/calendar/calendars"):
    return HTTPConnection({
        "type": "http", "method": "GET", "path": path, "headers": [],
        "query_string": b"", "scheme": "http", "server": ("localhost", 5002),
    })


def test_gate_burst_larger_than_executor_leaves_other_workers_available(monkeypatch):
    entered, release = Event(), Event()
    reads, opened, closed = [], [], []

    def exposed():
        reads.append(1)
        entered.set()
        assert release.wait(timeout=4)
        return False

    def database():
        opened.append(1)
        try:
            yield object()
        finally:
            closed.append(1)

    monkeypatch.setattr(auth, "deployment_is_exposed", exposed)
    monkeypatch.setattr(auth, "get_mgmt_db", database)

    async def scenario():
        asyncio.get_running_loop().set_default_executor(ThreadPoolExecutor(max_workers=2))
        readers = [asyncio.create_task(surface.enforce_authentication(_connection())) for _ in range(20)]
        try:
            assert await asyncio.wait_for(asyncio.to_thread(entered.wait, 1), 2)
            assert await asyncio.wait_for(asyncio.to_thread(lambda: "available"), 1) == "available"
            await asyncio.wait_for(surface.enforce_authentication(_connection("/api/health")), 1)
            assert len(reads) == 1 and not any(reader.done() for reader in readers)
        finally:
            release.set()
        assert await asyncio.gather(*readers) == [None] * 20
        assert reads == opened == closed == [1]
        assert surface._policy_reads == {} and auth._auto_policy_pending is None
        await surface.enforce_authentication(_connection())
        assert reads == [1]

    asyncio.run(scenario())


def test_sync_readers_share_one_read_and_explicit_sessions_bypass_it(monkeypatch):
    entered, joined, release = Event(), Event(), Event()
    reads = []
    explicit = object()

    class ObservedFuture(Future):
        def result(self, timeout=None):
            joined.set()
            return super().result(timeout=timeout)

    def read():
        reads.append(1)
        entered.set()
        assert release.wait(timeout=4)
        return False

    monkeypatch.setattr(auth, "Future", ObservedFuture)
    monkeypatch.setattr(auth, "_read_auto_policy", read)
    monkeypatch.setattr(auth, "ambient_identity_available", lambda db: db is not explicit)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(auth.require_auth_enabled)
        try:
            assert entered.wait(timeout=2)
            second = pool.submit(auth.require_auth_enabled)
            assert joined.wait(timeout=2)
            assert auth.require_auth_enabled(explicit) is True
        finally:
            release.set()
        assert first.result(timeout=2) is second.result(timeout=2) is False
    assert reads == [1] and auth._auto_policy_pending is None
    assert auth.require_auth_enabled(explicit) is True
    monkeypatch.setattr(auth, "ambient_identity_available", lambda _: True)
    assert auth.require_auth_enabled(explicit) is False


@pytest.mark.parametrize("failure_at", ["config", "accounts", "cleanup"])
def test_failed_autodetection_is_closed_and_ttl_still_starts_before_the_read(monkeypatch, failure_at):
    entered, release = Event(), Event()
    clock = [100.0]
    reads = []
    monkeypatch.setattr(auth, "time", SimpleNamespace(monotonic=lambda: clock[0]))

    def exposed():
        reads.append(1)
        if len(reads) == 1:
            entered.set()
            assert release.wait(timeout=4)
            if failure_at == "config":
                raise OSError("Synthetic config unavailable")
        return False

    def ambient(_):
        if len(reads) == 1 and failure_at == "accounts":
            raise OSError("Synthetic account lookup unavailable")
        return True

    def database():
        try:
            yield object()
        finally:
            if len(reads) == 1 and failure_at == "cleanup":
                raise OSError("Synthetic database cleanup failure")

    monkeypatch.setattr(auth, "deployment_is_exposed", exposed)
    monkeypatch.setattr(auth, "ambient_identity_available", ambient)
    monkeypatch.setattr(auth, "get_mgmt_db", database)

    async def scenario():
        readers = [asyncio.create_task(surface._request_requires_auth()) for _ in range(8)]
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            clock[0] = 104.9
        finally:
            release.set()
        assert await asyncio.gather(*readers) == [True] * 8
        assert auth._auto_policy_cache == (100.0, True)
        assert auth._auto_policy_pending is None and surface._policy_reads == {}
        assert await surface._request_requires_auth() is True
        assert reads == [1]
        clock[0] = 105.01
        assert await surface._request_requires_auth() is False
        assert len(reads) == 2

    asyncio.run(scenario())


def test_unexpected_shared_exception_does_not_leave_pending_work_stuck(monkeypatch):
    entered, release = Event(), Event()
    failure = RuntimeError("Synthetic policy reader failure")
    reads = []

    def read():
        reads.append(1)
        if len(reads) == 1:
            entered.set()
            assert release.wait(timeout=4)
            raise failure
        return True

    monkeypatch.setattr(auth, "_read_auto_policy", read)

    async def scenario():
        readers = [asyncio.create_task(surface._request_requires_auth()) for _ in range(8)]
        try:
            assert await asyncio.to_thread(entered.wait, 2)
        finally:
            release.set()
        results = await asyncio.gather(*readers, return_exceptions=True)
        assert all(error is failure for error in results)
        assert auth._auto_policy_cache is None and auth._auto_policy_pending is None
        assert surface._policy_reads == {}
        assert await surface._request_requires_auth() is True
        assert reads == [1, 1]

    asyncio.run(scenario())


def test_reset_starts_a_new_generation_and_old_result_cannot_reopen_the_gate(monkeypatch):
    entered, release = Event(), Event()
    reads = []

    def read():
        reads.append(1)
        if len(reads) == 1:
            entered.set()
            assert release.wait(timeout=4)
            return False
        return True

    monkeypatch.setattr(auth, "_read_auto_policy", read)

    async def scenario():
        old = asyncio.create_task(surface._request_requires_auth())
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            generation, _ = auth.auth_policy_cache_state()
            auth.reset_auth_policy_cache()
            assert auth.auth_policy_cache_state() == (generation + 1, None)
            assert await asyncio.wait_for(surface._request_requires_auth(), 1) is True
        finally:
            release.set()
        assert await old is True
        assert await surface._request_requires_auth() is True
        assert auth.auth_policy_cache_state()[1] is True
        assert len(reads) == 2 and auth._auto_policy_pending is None and surface._policy_reads == {}

    asyncio.run(scenario())


@pytest.mark.parametrize("override, expected", [("1", True), ("0", False)])
def test_overrides_stay_fresh_during_pending_work_and_never_enter_auto_cache(monkeypatch, override, expected):
    entered, release = Event(), Event()
    reads = []

    def read():
        reads.append(1)
        entered.set()
        assert release.wait(timeout=4)
        return not expected

    monkeypatch.setattr(auth, "_read_auto_policy", read)

    async def scenario():
        old = asyncio.create_task(surface._request_requires_auth())
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            monkeypatch.setenv(auth.REQUIRE_AUTH_ENV, override)
            assert await asyncio.wait_for(surface._request_requires_auth(), 1) is expected
            assert auth.require_auth_enabled() is expected
        finally:
            release.set()
        assert await old is expected
        monkeypatch.delenv(auth.REQUIRE_AUTH_ENV)
        assert await surface._request_requires_auth() is not expected
        assert reads == [1] and auth._auto_policy_pending is None and surface._policy_reads == {}

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_initial", [False, True])
def test_cancelled_follower_or_initial_request_leaves_shared_policy_running(monkeypatch, cancel_initial):
    entered, release = Event(), Event()
    reads = []

    def read():
        reads.append(1)
        entered.set()
        assert release.wait(timeout=4)
        return False

    monkeypatch.setattr(auth, "_read_auto_policy", read)

    async def scenario():
        first = asyncio.create_task(surface._request_requires_auth())
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            second = asyncio.create_task(surface._request_requires_auth())
            await asyncio.sleep(0)
            cancelled, survivor = (first, second) if cancel_initial else (second, first)
            cancelled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            assert not survivor.done() and reads == [1]
        finally:
            release.set()
        assert await asyncio.wait_for(survivor, 2) is False
        assert auth._auto_policy_pending is None and surface._policy_reads == {}
        assert await surface._request_requires_auth() is False
        assert reads == [1]

    asyncio.run(scenario())


def test_temporary_worker_override_cannot_be_shared_after_returning_to_auto(monkeypatch):
    reads = []
    original_to_thread = asyncio.to_thread

    def read():
        reads.append(1)
        return True

    async def with_temporary_override(function, *args, **kwargs):
        monkeypatch.setenv(auth.REQUIRE_AUTH_ENV, "0")
        try:
            return await original_to_thread(function, *args, **kwargs)
        finally:
            monkeypatch.delenv(auth.REQUIRE_AUTH_ENV)

    monkeypatch.setattr(auth, "_read_auto_policy", read)
    monkeypatch.setattr(surface.asyncio, "to_thread", with_temporary_override)
    assert asyncio.run(surface._request_requires_auth()) is True
    assert reads == [1] and auth.auth_policy_cache_state()[1] is True
