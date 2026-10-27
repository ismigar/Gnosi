"""Concurrent private panels must not open overlapping SSH sessions."""
from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.domains.sites import pangea
from backend.domains.sites.bounded_bridge import BoundedBridge


def transport(monkeypatch):
    driver = SimpleNamespace(bridge=lambda: SimpleNamespace(settings={}))
    monkeypatch.setattr(pangea, 'driver', lambda store: driver)
    return driver


def test_concurrent_panel_requests_hold_only_one_bounded_connection(monkeypatch):
    transport(monkeypatch)
    real_lock = threading.Lock()
    first_entered = threading.Event()
    second_attempted = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()
    errors = []

    class Slot:
        def acquire(self, *, timeout):
            if first_entered.is_set():
                second_attempted.set()
            return real_lock.acquire(timeout=timeout)

        def release(self):
            real_lock.release()

    monkeypatch.setattr(pangea, '_BOUNDED_CONNECTION_LOCK', Slot())

    def first():
        try:
            with pangea.connection(None, bounded=True):
                first_entered.set()
                assert release_first.wait(2)
        except BaseException as error:
            errors.append(error)

    def second():
        try:
            with pangea.connection(None, bounded=True):
                second_entered.set()
        except BaseException as error:
            errors.append(error)

    a = threading.Thread(target=first)
    b = threading.Thread(target=second)
    a.start()
    try:
        assert first_entered.wait(2)
        b.start()
        assert second_attempted.wait(2)
        assert not second_entered.is_set()
    finally:
        release_first.set()
        a.join(2)
        if b.ident is not None:
            b.join(2)
    assert not a.is_alive() and not b.is_alive() and not errors
    assert second_entered.is_set() and not real_lock.locked()


def test_connection_slot_wait_consumes_deadline_and_releases_on_error(monkeypatch):
    transport(monkeypatch)
    clock = [100.0]
    releases = []
    observed = []
    monkeypatch.setattr('backend.domains.sites.bounded_bridge.time.monotonic', lambda: clock[0])

    class Slot:
        def acquire(self, *, timeout):
            observed.append(timeout)
            clock[0] += 20
            return True

        def release(self):
            releases.append(True)

    monkeypatch.setattr(pangea, '_BOUNDED_CONNECTION_LOCK', Slot())
    with pytest.raises(ValueError, match='caller failure'):
        with pangea.connection(None, bounded=True) as (_, bridge):
            assert isinstance(bridge, BoundedBridge)
            assert bridge.deadline == 145 and bridge.remaining() == 25
            raise ValueError('caller failure')
    assert observed == [45] and releases == [True]


@pytest.mark.parametrize('acquired', [False, True])
def test_expired_connection_wait_cannot_enter_or_send_command(monkeypatch, acquired):
    transport(monkeypatch)
    clock = [100.0]
    releases = []
    monkeypatch.setattr('backend.domains.sites.bounded_bridge.time.monotonic', lambda: clock[0])

    class Slot:
        def acquire(self, *, timeout):
            assert timeout == 45
            clock[0] += 45
            return acquired

        def release(self):
            releases.append(True)

    monkeypatch.setattr(pangea, '_BOUNDED_CONNECTION_LOCK', Slot())
    with pytest.raises(HTTPException) as error:
        with pangea.connection(None, bounded=True):
            pytest.fail('An expired request must not reach the private operation')
    assert error.value.status_code == 503
    assert releases == ([True] if acquired else [])


@pytest.mark.parametrize('caller_error', [False, True])
def test_connection_slot_covers_slow_child_close(monkeypatch, caller_error):
    transport(monkeypatch)
    real_lock = threading.Lock()
    closing = threading.Event()
    second_attempted = threading.Event()
    finish_close = threading.Event()
    second_entered = threading.Event()
    errors = []

    class Slot:
        def acquire(self, *, timeout):
            if closing.is_set():
                second_attempted.set()
            return real_lock.acquire(timeout=timeout)

        def release(self):
            real_lock.release()

    class Child:
        def close(self, force=True):
            closing.set()
            assert finish_close.wait(2)

    monkeypatch.setattr(pangea, '_BOUNDED_CONNECTION_LOCK', Slot())

    def first():
        try:
            with pangea.connection(None, bounded=True) as (_, bridge):
                bridge.child = Child()
                if caller_error:
                    raise ValueError('caller failure')
        except ValueError as error:
            if not caller_error or str(error) != 'caller failure':
                errors.append(error)
        except BaseException as error:
            errors.append(error)

    def second():
        try:
            with pangea.connection(None, bounded=True):
                second_entered.set()
        except BaseException as error:
            errors.append(error)

    a = threading.Thread(target=first)
    b = threading.Thread(target=second)
    a.start()
    try:
        assert closing.wait(2)
        assert real_lock.locked()
        b.start()
        assert second_attempted.wait(2)
        assert not second_entered.is_set()
    finally:
        finish_close.set()
        a.join(2)
        if b.ident is not None:
            b.join(2)
    assert not a.is_alive() and not b.is_alive() and not errors
    assert second_entered.is_set() and not real_lock.locked()


def test_connection_slot_releases_if_child_close_raises(monkeypatch):
    transport(monkeypatch)
    lock = threading.Lock()
    monkeypatch.setattr(pangea, '_BOUNDED_CONNECTION_LOCK', lock)

    class Child:
        def close(self, force=True):
            raise RuntimeError('synthetic close failure')

    with pytest.raises(RuntimeError, match='synthetic close failure'):
        with pangea.connection(None, bounded=True) as (_, bridge):
            bridge.child = Child()
    assert not lock.locked()
