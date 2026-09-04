"""Scheduler startup grace-period contracts."""

from __future__ import annotations

from pytest import MonkeyPatch

from backend.scheduler.startup_policy import startup_delay_seconds


def test_scheduler_waits_before_first_automatic_dispatch(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.delenv("GNOSI_SCHEDULER_STARTUP_DELAY_SECONDS", raising=False)

    assert startup_delay_seconds() == 30.0


def test_scheduler_startup_delay_can_be_disabled(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("GNOSI_SCHEDULER_STARTUP_DELAY_SECONDS", "0")

    assert startup_delay_seconds() == 0.0
