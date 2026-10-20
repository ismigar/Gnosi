"""Authenticated mail lanes respect configuration changes and invalidation."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.domains.mail.providers import hybrid
from backend.services.context_vars import active_vault_path


@pytest.fixture
def pool(monkeypatch):
    for name in ("_IMAP_POOL", "_IMAP_LOCKS", "_IMAP_MESSAGE_POOL", "_IMAP_MESSAGE_LOCKS",
                 "_IMAP_CONNECTION_KEYS", "_IMAP_CONNECTION_GENERATIONS"):
        monkeypatch.setattr(hybrid, name, {})
    connections = []

    def connect(account):
        connection = SimpleNamespace(
            account=dict(account), noop=Mock(return_value=("OK", [])), logout=Mock(),
        )
        connections.append(connection)
        return connection

    monkeypatch.setattr(hybrid, "_imap_connect_fresh", connect)
    return connections


def test_credentials_invalidate_both_authenticated_lanes(pool):
    account = {"email": "fixture@example.test", "imap_host": "old.example.test"}
    for message in (False, True):
        assert hybrid._imap_pool_acquire(account, message=message) is not None
        hybrid._imap_pool_release(account["email"], message=message)
    hybrid._imap_pool_invalidate(account["email"])
    assert not hybrid._IMAP_POOL and not hybrid._IMAP_MESSAGE_POOL
    assert all(connection.logout.call_count == 1 for connection in pool)
    current = hybrid._imap_pool_acquire({**account, "imap_host": "new.example.test"}, message=True)
    try:
        assert current.account["imap_host"] == "new.example.test" and len(pool) == 3
    finally:
        hybrid._imap_pool_release(account["email"], message=True)


@pytest.mark.parametrize("field,value", [
    ("imap_host", "new.example.test"), ("imap_port", 143),
    ("imap_password", "changed-synthetic-password"), ("refresh_token", "changed-synthetic-token"),
])
def test_changed_configuration_cannot_reuse_old_body_connection(pool, field, value):
    account = {"email": "fixture@example.test", "imap_host": "old.example.test"}
    previous = hybrid._imap_pool_acquire(account, message=True)
    hybrid._imap_pool_release(account["email"], message=True)
    current = hybrid._imap_pool_acquire({**account, field: value}, message=True)
    try:
        assert current is not previous and current.account[field] == value
        previous.logout.assert_called_once()
    finally:
        hybrid._imap_pool_release(account["email"], message=True)


def test_changed_vault_cannot_reuse_an_authenticated_connection(pool, tmp_path):
    account = {"email": "fixture@example.test"}
    token = active_vault_path.set(tmp_path / "first")
    try:
        previous = hybrid._imap_pool_acquire(account, message=True)
        hybrid._imap_pool_release(account["email"], message=True)
        active_vault_path.set(tmp_path / "second")
        current = hybrid._imap_pool_acquire(account, message=True)
        assert current is not previous and len(pool) == 2
        hybrid._imap_pool_release(account["email"], message=True)
    finally:
        active_vault_path.reset(token)


def test_list_transport_failure_does_not_close_the_reader_lane(pool):
    account = {"email": "fixture@example.test"}
    for message in (False, True):
        hybrid._imap_pool_acquire(account, message=message)
        hybrid._imap_pool_release(account["email"], message=message)
    reader = pool[1]
    hybrid._imap_pool_invalidate(account["email"], message=False)
    assert hybrid._imap_pool_acquire(account, message=True) is reader
    hybrid._imap_pool_release(account["email"], message=True)
    reader.logout.assert_not_called()
    pool[0].logout.assert_called_once()


def test_invalidation_during_login_cannot_publish_obsolete_credentials(pool, monkeypatch):
    entered, release = Event(), Event()
    connect = hybrid._imap_connect_fresh

    def slow_connect(account):
        entered.set()
        assert release.wait(2)
        return connect(account)

    monkeypatch.setattr(hybrid, "_imap_connect_fresh", slow_connect)
    account = {"email": "fixture@example.test", "imap_host": "old.example.test"}
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(hybrid._imap_pool_acquire, account, message=True)
        try:
            assert entered.wait(1)
            hybrid._imap_pool_invalidate(account["email"])
        finally:
            release.set()
        assert pending.result(timeout=2) is None
    assert not hybrid._IMAP_MESSAGE_POOL
    assert not hybrid._IMAP_MESSAGE_LOCKS[account["email"]].locked()
    pool[0].logout.assert_called_once()
