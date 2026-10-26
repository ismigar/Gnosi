"""Transient private reads recover; uncertain writes are never replayed."""
from __future__ import annotations

import contextlib
from types import SimpleNamespace

import pexpect
import pytest
from fastapi import HTTPException

from backend.domains.sites import pangea
from backend.domains.sites.bounded_bridge import PangeaTransportInterrupted
from backend.domains.sites.private_service import ALLOWED_ACTIONS
from backend.tests.test_sites_bounded_bridge import Session, harness, successful_session


READS = {"status", "messages_list", "messages_export", "subscribers_list", "subscribers_export", "campaigns_list", "queue_list", "captured_get"}


def setup_service(monkeypatch, bridge):
    store = SimpleNamespace(private_root=SimpleNamespace(name="scope"))
    site = SimpleNamespace(id="synthetic", targets=[SimpleNamespace(id="test", environment="staging")])
    transport = SimpleNamespace(REMOTE_ROOT="/owned")
    entered = []

    @contextlib.contextmanager
    def connection(store, *, bounded):
        assert bounded
        entered.append(True)
        with bridge:
            yield transport, bridge

    monkeypatch.setattr(pangea, "connection", connection)
    monkeypatch.setattr(pangea, "validate_target", lambda *args: None)
    return store, site, entered


def test_recovers_observed_three_preauth_disconnects_without_manual_refresh(monkeypatch):
    children = [Session([(3, "Connection closed by server port 22")]) for _ in range(3)] + [successful_session()]
    bridge, _, waits, launches = harness(monkeypatch, children)
    store, site, entered = setup_service(monkeypatch, bridge)
    monkeypatch.setattr(pangea, "_service_request", lambda driver, session, *args: {"output": session.run("read-only")})
    assert pangea.service(store, site, "test", "status", {}) == {"output": '{"ok":true}'}
    assert waits == [10, 20, 1] and launches == [45, 35, 15, 14]
    assert entered == [True] and all(child.closed for child in children)
    assert children[-1].sent[:3] == ["synthetic-password", "suweb", "stty -echo"]
    assert all(not child.sent for child in children[:-1])


@pytest.mark.parametrize("action", sorted(READS))
@pytest.mark.parametrize("error", [PangeaTransportInterrupted, lambda: pexpect.EOF("lost response"), lambda: pexpect.TIMEOUT("lost response")])
def test_only_transient_reads_retry_in_same_slot_and_deadline(monkeypatch, action, error):
    bridge, clock, waits, _ = harness(monkeypatch, [])
    store, site, entered = setup_service(monkeypatch, bridge)
    calls = []

    def request(*args):
        calls.append(args[-2:])
        assert args[1] is bridge and bridge.deadline == 145
        if len(calls) == 1:
            clock[0] += 30
            raise error()
        return {"items": ["synthetic"]}

    monkeypatch.setattr(pangea, "_service_request", request)
    assert pangea.service(store, site, "test", action, {}) == {"items": ["synthetic"]}
    assert len(calls) == 2 and entered == [True] and waits == [1] and bridge.remaining() == 14


@pytest.mark.parametrize("action", sorted((ALLOWED_ACTIONS | {"forms_sync", "unknown"}) - READS))
@pytest.mark.parametrize("error", [PangeaTransportInterrupted, lambda: pexpect.EOF("result unconfirmed")])
def test_never_replays_uncertain_mutation(monkeypatch, action, error):
    bridge, _, waits, _ = harness(monkeypatch, [])
    store, site, _ = setup_service(monkeypatch, bridge)
    effects = []

    def request(*args):
        effects.append("committed")
        raise error()

    monkeypatch.setattr(pangea, "_service_request", request)
    with pytest.raises(HTTPException) as failure:
        pangea.service(store, site, "test", action, {})
    assert failure.value.status_code == 503 and effects == ["committed"] and not waits


@pytest.mark.parametrize("error", [HTTPException(403, "policy"), HTTPException(503, "application failure"), ValueError("invalid JSON")])
def test_service_and_policy_failures_are_not_transport_retries(monkeypatch, error):
    bridge, _, waits, _ = harness(monkeypatch, [])
    store, site, _ = setup_service(monkeypatch, bridge)
    calls = []

    def request(*args):
        calls.append(True)
        raise error

    monkeypatch.setattr(pangea, "_service_request", request)
    with pytest.raises(type(error)):
        pangea.service(store, site, "test", "status", {})
    assert calls == [True] and not waits


def test_recovery_cannot_extend_expired_deadline_or_loop_forever(monkeypatch):
    for seconds, expected_calls in [(45, 1), (44.5, 1), (0, 2)]:
        bridge, clock, _, _ = harness(monkeypatch, [])
        store, site, _ = setup_service(monkeypatch, bridge)
        calls = []

        def request(*args):
            calls.append(True)
            clock[0] += seconds
            raise PangeaTransportInterrupted()

        monkeypatch.setattr(pangea, "_service_request", request)
        with pytest.raises(HTTPException) as failure:
            pangea.service(store, site, "test", "captured_get", {})
        assert failure.value.status_code == 503 and len(calls) == expected_calls


def test_remote_response_loss_recovers_read_but_not_login_failure(monkeypatch):
    interrupted = Session([(2, "operator@host:~$ "), (2, "web@host:~$ "), (0, "web@host:~$ "),
                           (pexpect.EOF("lost"), "Connection closed")])
    bridge, _, waits, launches = harness(monkeypatch, [interrupted, successful_session()])
    store, site, _ = setup_service(monkeypatch, bridge)
    monkeypatch.setattr(pangea, "_service_request", lambda driver, session, *args: {"output": session.run("read-only")})
    assert pangea.service(store, site, "test", "captured_get", {})["output"] == '{"ok":true}'
    assert len(launches) == 2 and waits == [1] and interrupted.closed

    child = Session([(0, "Password:"), (pexpect.EOF("rejected"), "Permission denied")])
    bridge, _, waits, launches = harness(monkeypatch, [child])
    store, site, _ = setup_service(monkeypatch, bridge)
    with pytest.raises(HTTPException):
        pangea.service(store, site, "test", "status", {})
    assert len(launches) == 1 and not waits and child.sent == ["synthetic-password"]


@pytest.mark.parametrize("event,output", [
    (1, "yes/no"), (3, "Host key verification failed; Connection closed"),
    (3, "Permission denied; Connection closed"), (3, "Unknown SSH failure"),
])
def test_read_recovery_cannot_bypass_host_or_authentication_rejection(monkeypatch, event, output):
    child = Session([(event, output)])
    bridge, _, waits, launches = harness(monkeypatch, [child])
    store, site, _ = setup_service(monkeypatch, bridge)
    monkeypatch.setattr(pangea, "_service_request", lambda driver, session, *args: {"output": session.run("read-only")})
    with pytest.raises(HTTPException):
        pangea.service(store, site, "test", "status", {})
    assert len(launches) == 1 and not waits and not child.sent and child.closed
