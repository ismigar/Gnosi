"""Resource failures must never be reported as successful validation."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.ci import pre_pr_resources as resources
from scripts.ci.pre_pr_commands import Step


def test_resource_environment_replaces_heap_and_threads() -> None:
    result = resources.resource_environment({"NODE_OPTIONS": "--max-old-space-size=4096"})
    assert result["NODE_OPTIONS"] == "--max-old-space-size=1536"
    assert result["CI"] == "true"
    assert result["OMP_NUM_THREADS"] == result["UV_THREADPOOL_SIZE"] == "1"


def test_process_tree_includes_escaped_and_reparented_children(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = "10 1 10 100\n11 10 99 200\n12 11 99 300\n13 1 99 400\n20 1 20 900\n"
    monkeypatch.setattr(resources.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=rows))
    tracked = {13, 999}
    assert resources.process_tree_rss(10, tracked) == 1000
    assert tracked == {10, 11, 12, 13}


@pytest.mark.parametrize("reason, expected", [("critical", 75), ("warning", 75), ("memory", 137), ("timeout", 124), ("orphan", 125), ("signal", 137)])
def test_monitor_enforces_real_conditions(monkeypatch: pytest.MonkeyPatch, reason: str, expected: int) -> None:
    from unittest.mock import Mock
    process = Mock(pid=42)
    process.poll.return_value = 0 if reason == "orphan" else -9 if reason == "signal" else None
    times = iter([0.0, 0.0, 2.1])
    monkeypatch.setattr(resources, "monotonic", lambda: next(times))
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    monkeypatch.setattr(resources, "pressure_level", lambda: 4 if reason == "critical" else 2 if reason == "warning" else 1)
    monkeypatch.setattr(resources, "process_tree_rss", lambda *_: resources.RSS_LIMIT_KIB + 1 if reason == "memory" else 10)
    status, _ = resources.monitor(process, 0 if reason == "timeout" else 10, set())
    assert status == expected


def test_preflight_requires_thirty_normal_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    clock = [0.0]
    readings = iter([0.0, 29.9, 30.0])
    levels = []
    def pressure(**kwargs: object) -> int:
        clock[0] = next(readings)
        levels.append(1)
        return 1
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "pressure_level", pressure)
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    resources.idle_preflight()
    assert len(levels) == 3


@pytest.mark.parametrize("level", [2, 4])
def test_preflight_never_starts_under_pressure(monkeypatch: pytest.MonkeyPatch, level: int) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(resources, "pressure_level", lambda **_: level)
    times = iter([0.0, float(resources.PREFLIGHT_WAIT_SECONDS)])
    monkeypatch.setattr(resources, "monotonic", lambda: next(times))
    with pytest.raises(ValueError, match="not normal"):
        resources.idle_preflight()


def test_preflight_resets_normal_streak_after_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    clock = [0.0]
    readings = iter([(0.0, 1), (29.0, 1), (30.0, 2), (40.0, 1), (69.9, 1), (70.0, 1)])
    observed = []
    def pressure(**kwargs: object) -> int:
        clock[0], level = next(readings)
        observed.append((clock[0], level))
        return level
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "pressure_level", pressure)
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    resources.idle_preflight()
    assert observed[-1] == (70.0, 1)


def test_preflight_timeout_never_launches_a_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(resources, "pressure_level", lambda **_: 2)
    times = iter([0.0, float(resources.PREFLIGHT_WAIT_SECONDS)])
    monkeypatch.setattr(resources, "monotonic", lambda: next(times))
    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("A command started without its normal-pressure precondition")
    monkeypatch.setattr(resources.subprocess, "Popen", forbidden)
    with pytest.raises(ValueError, match="not normal"):
        resources.run_mac_idle(Step("fixture", (sys.executable, "-c", "pass")), tmp_path, {})


def test_normal_streak_after_readiness_deadline_never_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    clock = [0.0]
    readings = iter([(0.0, 1), (59.0, 2), (61.0, 1), (91.0, 1)])
    def pressure(**kwargs: object) -> int:
        clock[0], level = next(readings)
        return level
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "pressure_level", pressure)
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    with pytest.raises(ValueError, match="not normal"):
        resources.idle_preflight()


def test_slow_pressure_probes_and_sleep_respect_remaining_readiness_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    clock = [0.0]
    timeouts = []
    def pressure(timeout: float = 2) -> int:
        timeouts.append(timeout)
        clock[0] += min(1.99, timeout)
        return 2
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "pressure_level", pressure)
    monkeypatch.setattr(resources, "sleep", lambda duration: clock.__setitem__(0, clock[0] + duration))
    with pytest.raises(ValueError, match="not normal"):
        resources.idle_preflight()
    assert clock[0] <= resources.PREFLIGHT_WAIT_SECONDS
    assert timeouts[-1] < 2


def test_normal_streak_at_expiry_never_launches_a_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    clock = [0.0]
    readings = iter([(0.0, 2), (60.0, 1), (90.0, 1)])
    def pressure(timeout: float = 2) -> int:
        clock[0], level = next(readings)
        return level
    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("A command launched at the expired readiness boundary")
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "pressure_level", pressure)
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    monkeypatch.setattr(resources.subprocess, "Popen", forbidden)
    with pytest.raises(ValueError, match="not normal"):
        resources.run_mac_idle(Step("fixture", (sys.executable, "-c", "pass")), tmp_path, {})


@pytest.mark.parametrize("failure", [124, 137, 75, 125, 130])
def test_failures_cleanup_and_remain_nonzero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: int,
) -> None:
    monkeypatch.setattr(resources, "idle_preflight", lambda: None)
    processes = []
    def monitor(process: subprocess.Popen[bytes], timeout: float, tracked: set[int]) -> tuple[int, int]:
        processes.append(process)
        if failure == 125:
            raise ValueError("supervisor unavailable")
        if failure == 130:
            raise KeyboardInterrupt
        return failure, 12
    monkeypatch.setattr(resources, "monitor", monitor)
    result = resources.run_mac_idle(Step("fixture", (sys.executable, "-c", "import time; time.sleep(30)")), tmp_path, os.environ)
    assert result.returncode == failure
    assert processes[0].poll() is not None


def test_timeout_stops_child_and_propagates_heap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(resources, "idle_preflight", lambda: None)
    monkeypatch.setattr(resources, "pressure_level", lambda: 1)
    monkeypatch.setattr(resources, "step_timeout", lambda _: 0.8)
    output = tmp_path / "child.txt"
    script = (
        "import os, subprocess, sys, time; from pathlib import Path; "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
        f"Path({str(output)!r}).write_text(str(child.pid)+' '+os.environ['NODE_OPTIONS']); "
        "time.sleep(30)"
    )
    result = resources.run_mac_idle(Step("fixture", (sys.executable, "-c", script)), tmp_path, os.environ)
    assert result.returncode == 124
    pid, heap = output.read_text().split()
    assert heap == "--max-old-space-size=1536"
    state = subprocess.run(("ps", "-p", pid, "-o", "stat="), capture_output=True, text=True, check=False)
    assert not state.stdout.strip() or state.stdout.strip().startswith("Z")
