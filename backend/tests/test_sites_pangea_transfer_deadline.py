"""Real service dispatch must preserve failure classification and PTY deadlines."""
from __future__ import annotations

import contextlib
import re
from types import SimpleNamespace

import pexpect
import pytest
from fastapi import HTTPException

from backend.domains.sites import pangea
from backend.tests.test_sites_bounded_bridge import Session, harness
from backend.tests.test_sites_pangea_read_recovery import setup_service


class ExitSession(Session):
    def __init__(self, steps, status=0):
        super().__init__(steps)
        self.status = status

    def expect(self, pattern):
        result = super().expect(pattern)
        if isinstance(pattern, re.Pattern) and "GNOSI_SITE_READ_" in pattern.pattern:
            marker = re.search(r"GNOSI_SITE_READ_[a-f0-9]+", self.sent[-1]).group()
            self.match = pattern.search(marker + str(self.status))
        return result


def commands(*outputs):
    return [(2, "operator@host:~$ "), (2, "web@host:~$ "), (0, "web@host:~$ ")] + [
        step for output in outputs for step in [(0, output), (0, "web@host:~$ ")]]


def service_transport(monkeypatch, bridge, put=lambda *args: None):
    store, site, _ = setup_service(monkeypatch, bridge)
    driver = SimpleNamespace(REMOTE_ROOT="/owned", php=lambda b, code: b.run("policy"), put=put)

    @contextlib.contextmanager
    def connection(store, *, bounded):
        with bridge:
            yield driver, bridge

    monkeypatch.setattr(pangea, "connection", connection)
    return store, site


def test_known_command_failure_is_terminal_even_when_following_prompt_is_lost(monkeypatch):
    child = ExitSession(commands("policy denied")[:-1] + [(pexpect.EOF("lost prompt"), "Connection closed")], status=1)
    bridge, _, waits, launches = harness(monkeypatch, [child])
    store, site = service_transport(monkeypatch, bridge)
    with pytest.raises(HTTPException) as failure:
        pangea.service(store, site, "test", "status", {})
    assert failure.value.status_code == 503 and len(launches) == 1 and not waits and child.closed


@pytest.mark.parametrize("raw", ["not json", '{"error":"policy"}', "[]", '{"test_mode":false}'])
def test_complete_invalid_or_application_response_does_not_retry(monkeypatch, raw):
    child = ExitSession(commands("{}", raw))
    bridge, _, waits, launches = harness(monkeypatch, [child])
    store, site = service_transport(monkeypatch, bridge)
    with pytest.raises((HTTPException, ValueError)):
        pangea.service(store, site, "test", "captured_get", {})
    assert len(launches) == 1 and not waits and child.closed


@pytest.mark.parametrize("durations", [(8, 8, 0), (1, 2, 0)])
def test_raw_transfer_waits_and_sends_share_original_recovery_deadline(monkeypatch, durations):
    class TransferSession(ExitSession):
        def __init__(self):
            super().__init__(commands("{}", "{}", '{"test_mode":true}'))
            self.in_transfer = False
            self.waits = []
            self.sends = []

        def sendline(self, value):
            if value == "transfer":
                self.in_transfer = True
            return super().sendline(value)

        def send(self, value):
            self.sends.append(value)
            return len(value)

        def expect(self, pattern):
            if not self.in_transfer:
                return super().expect(pattern)
            seconds = durations[len(self.waits)]
            self.waits.append(self.timeout)
            clock[0] += min(seconds, self.timeout)
            if seconds > self.timeout:
                raise pexpect.TIMEOUT("synthetic transfer deadline")
            if len(self.waits) == 3:
                self.in_transfer = False
            return 0

    def put(bridge, source, destination):
        # The maintained transfer uses this raw child interface after run(true).
        bridge.run("true")
        child = bridge.child
        child.delaybeforesend = None
        child.sendline("transfer")
        child.expect("ready")
        assert child.send("payload") == len("payload")
        child.expect("complete")
        child.expect("prompt")

    child = TransferSession()
    disconnected = [Session([(3, "Connection closed")]) for _ in range(3)]
    bridge, clock, waits, launches = harness(monkeypatch, disconnected + [child])
    store, site = service_transport(monkeypatch, bridge, put)
    if durations == (8, 8, 0):
        with pytest.raises(HTTPException) as failure:
            pangea.service(store, site, "test", "status", {})
        assert failure.value.status_code == 503
        assert clock[0] == bridge.deadline == 145 and child.waits == [14, 6]
    else:
        assert pangea.service(store, site, "test", "status", {}) == {"test_mode": True}
        assert child.waits == [14, 13, 11] and clock[0] == 134
    assert waits == [10, 20, 1] and len(launches) == 4
    assert child.delaybeforesend is None and child.sends == ["payload"] and child.closed


def test_transfer_cannot_send_another_chunk_after_deadline(monkeypatch):
    child = Session([(2, "operator@host:~$ "), (2, "web@host:~$ "), (0, "web@host:~$ ")])
    child.send = lambda value: pytest.fail("Expired transfer must not send bytes")
    bridge, clock, _, _ = harness(monkeypatch, [child])
    bridge.connect()
    clock[0] = bridge.deadline
    with bridge, pytest.raises(TimeoutError):
        bridge.child.send("late chunk")
    assert child.closed
