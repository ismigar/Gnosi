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
    times = iter([0.0, 0.0, 29.9, 30.0])
    levels = []
    monkeypatch.setattr(resources, "monotonic", lambda: next(times))
    monkeypatch.setattr(resources, "pressure_level", lambda: levels.append(1) or 1)
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    resources.idle_preflight()
    assert len(levels) == 3


@pytest.mark.parametrize("level", [2, 4])
def test_preflight_never_starts_under_pressure(monkeypatch: pytest.MonkeyPatch, level: int) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(resources, "pressure_level", lambda: level)
    with pytest.raises(ValueError, match="not normal"):
        resources.idle_preflight()


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
