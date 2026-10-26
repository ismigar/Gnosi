"""Transient SSH login recovery must never replay a private service command."""
from __future__ import annotations

import re

import pexpect
import pytest
from fastapi import HTTPException

from backend.domains.sites.bounded_bridge import BoundedBridge


class Session:
    def __init__(self, steps):
        self.steps = list(steps)
        self.before = ""
        self.timeout = 0.0
        self.delaybeforesend = None
        self.sent = []
        self.closed = False
        self.match = None

    def expect(self, pattern):
        value, self.before = self.steps.pop(0)
        if isinstance(value, Exception):
            raise value
        if isinstance(pattern, re.Pattern) and "GNOSI_SITE_READ_" in pattern.pattern:
            marker = re.search(r"GNOSI_SITE_READ_[a-f0-9]+", self.sent[-1]).group()
            self.match = pattern.search(marker + "0")
        return value

    def sendline(self, value):
        self.sent.append(value)
        return len(value)

    def close(self, force=True):
        self.closed = True


def harness(monkeypatch, sessions, timeout=45):
    clock = [100.0]
    waits = []
    launches = []

    def sleep(seconds):
        waits.append(seconds)
        clock[0] += seconds

    def spawn(command, arguments, **kwargs):
        assert command == "ssh" and "StrictHostKeyChecking=yes" in arguments
        launches.append(kwargs["timeout"])
        sessions[len(launches) - 1].child_fd = len(launches) - 1
        return sessions[len(launches) - 1]

    def write_pty(fd, payload, remaining):
        remaining()
        value = payload.decode("utf-8")
        child = sessions[fd]
        if value.endswith("\n"):
            return child.sendline(value[:-1]) + 1
        return child.send(value)

    monkeypatch.setattr("backend.domains.sites.bounded_bridge.time.monotonic", lambda: clock[0])
    monkeypatch.setattr("backend.domains.sites.bounded_bridge.time.sleep", sleep)
    monkeypatch.setattr(pexpect, "spawn", spawn)
    monkeypatch.setattr("backend.domains.sites.bounded_child.write_pty", write_pty)
    bridge = BoundedBridge({
        "SSH_HOST": "staging.invalid", "SSH_PORT": "22", "SSH_USER": "operator",
        "SSH_PASSWORD": "synthetic-password", "SSH_SUWEB_PASSWORD": "synthetic-suweb",
        "DRUPAL_PATH": "/owned",
    }, timeout=timeout)
    return bridge, clock, waits, launches


def successful_session():
    return Session([(0, "Password:"), (0, "operator@host:~$ "), (2, "web@host:~$ "),
                    (0, "web@host:~$ "), (0, '{"ok":true}'), (0, "web@host:~$ ")])


def test_recovers_only_before_login_then_sends_private_command_once(monkeypatch):
    children = [Session([(3, "Connection closed by server port 22")]),
                Session([(3, "kex_exchange_identification: Connection reset")]), successful_session()]
    bridge, _, waits, launches = harness(monkeypatch, children)
    with bridge:
        assert bridge.run("private-operation") == '{"ok":true}'
    assert waits == [10.0, 20.0] and launches == [45.0, 35.0, 15.0]
    assert children[0].sent == children[1].sent == []
    assert children[2].sent[:3] == ["synthetic-password", "suweb", "stty -echo"]
    assert len([value for child in children for value in child.sent if "GNOSI_SITE_READ_" in value]) == 1
    assert all(child.closed for child in children)


@pytest.mark.parametrize(("event", "output"), [
    (1, "Host key verification failed; yes/no"),
    (3, "Hostkey verification failed; Connection closed"),
    (3, "REMOTE HOST IDENTIFICATION HAS CHANGED! Connection closed"),
    (3, "Permission denied; Connection closed"),
    (3, "Too many authentication failures; Connection closed"),
    (3, "Unknown SSH failure"),
])
def test_refuses_unverified_host_or_authentication_failure_without_retry(monkeypatch, event, output):
    child = Session([(event, output)])
    bridge, _, waits, launches = harness(monkeypatch, [child])
    with pytest.raises(HTTPException) as error:
        bridge.run("private-operation")
    assert error.value.status_code == 503
    assert len(launches) == 1 and waits == [] and child.sent == [] and child.closed


def test_does_not_retry_after_sending_password(monkeypatch):
    child = Session([(0, "Password:"), (pexpect.EOF("closed"), "Connection reset")])
    bridge, _, waits, launches = harness(monkeypatch, [child])
    with pytest.raises(HTTPException):
        bridge.run("private-operation")
    assert len(launches) == 1 and waits == []
    assert child.sent == ["synthetic-password"] and child.closed


def test_does_not_retry_failed_suweb_or_replay_uncertain_command(monkeypatch):
    for steps in [
        [(2, "operator@host:~$ "), (3, "Connection closed")],
        [(2, "operator@host:~$ "), (2, "web@host:~$ "), (0, "web@host:~$ "),
         (pexpect.EOF("closed"), "Connection closed")],
    ]:
        child = Session(steps)
        bridge, _, waits, launches = harness(monkeypatch, [child])
        with pytest.raises(HTTPException):
            bridge.run("private-operation")
        assert len(launches) == 1 and waits == [] and child.closed
        assert len([value for value in child.sent if "GNOSI_SITE_READ_" in value]) <= 1


def test_disconnect_recovery_stops_after_three_attempts(monkeypatch):
    children = [Session([(3, "Connection closed")]) for _ in range(3)]
    bridge, _, waits, launches = harness(monkeypatch, children)
    with pytest.raises(HTTPException):
        bridge.run("private-operation")
    assert len(launches) == 3 and waits == [10.0, 20.0]
    assert all(child.closed and child.sent == [] for child in children)


def test_backoff_consumes_original_deadline_and_cannot_start_late_login(monkeypatch):
    child = Session([(3, "Connection closed")])
    bridge, clock, waits, launches = harness(monkeypatch, [child], timeout=0.5)
    with pytest.raises(HTTPException):
        bridge.run("private-operation")
    assert clock[0] == bridge.deadline == 100.5
    assert waits == [0.5] and launches == [0.5] and child.closed and child.sent == []
