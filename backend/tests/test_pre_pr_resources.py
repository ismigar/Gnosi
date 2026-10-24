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


@pytest.mark.parametrize("normal_required", [True, False])
def test_warning_readiness_is_explicit_interactive_policy_only(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, normal_required: bool,
) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    clock = [0.0]
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "sleep", lambda duration: clock.__setitem__(0, clock[0] + duration))
    monkeypatch.setattr(resources, "pressure_level", lambda **_: 2)
    observations: list[dict[str, int | float | str]] = []
    if normal_required:
        with pytest.raises(ValueError, match="not normal"):
            resources.idle_preflight(observations=observations)
        assert clock[0] == resources.PREFLIGHT_WAIT_SECONDS
        assert observations[0]["profile"] == "mac-idle"
    else:
        resources.idle_preflight(normal_required=False, observations=observations)
        assert 30 <= clock[0] < resources.PREFLIGHT_WAIT_SECONDS
        assert observations == [{"profile": "mac-interactive", "phase": "preflight", "elapsed_seconds": 0.0, "level": 2}]
        assert "mac-interactive: host warning pressure 2" in caplog.text


@pytest.mark.parametrize("normal_required,expected", [(True, 75), (False, 0)])
def test_sustained_warning_is_observed_but_only_interactive_can_finish(
    monkeypatch: pytest.MonkeyPatch, normal_required: bool, expected: int,
) -> None:
    from unittest.mock import Mock

    process = Mock(pid=42)
    process.poll.side_effect = [None] * 15 + [0]
    clock = [0.0]
    monkeypatch.setattr(resources, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resources, "sleep", lambda duration: clock.__setitem__(0, clock[0] + duration))
    monkeypatch.setattr(resources, "pressure_level", lambda: 2)
    monkeypatch.setattr(resources, "process_tree_rss", lambda *_: 0)
    observations: list[dict[str, int | float | str]] = []
    result, _peak = resources.monitor(process, 20, set(), normal_required=normal_required, observations=observations)
    assert result == expected
    assert observations[0]["level"] == 2
    assert observations[0]["profile"] == ("mac-idle" if normal_required else "mac-interactive")


@pytest.mark.parametrize("normal_required", [True, False])
@pytest.mark.parametrize("reason,expected", [("critical", 75), ("memory", 137), ("timeout", 124), ("orphan", 125)])
def test_both_pressure_profiles_keep_critical_owned_budget_deadline_and_orphan_failures(
    monkeypatch: pytest.MonkeyPatch, normal_required: bool, reason: str, expected: int,
) -> None:
    from unittest.mock import Mock

    process = Mock(pid=42)
    process.poll.return_value = 0 if reason == "orphan" else None
    monkeypatch.setattr(resources, "monotonic", lambda: 0.0)
    monkeypatch.setattr(resources, "pressure_level", lambda: 4 if reason == "critical" else 2)
    samples = iter([0, 10])
    monkeypatch.setattr(resources, "process_tree_rss", lambda *_: next(samples) if reason == "orphan" else resources.RSS_LIMIT_KIB + 1)
    if reason == "timeout":
        monkeypatch.setattr(resources, "process_tree_rss", lambda *_: 0)
    status, _ = resources.monitor(process, 0 if reason == "timeout" else 300, set(), normal_required=normal_required)
    assert status == expected


@pytest.mark.parametrize("interactive", [False, True])
@pytest.mark.parametrize("failure", ["critical", "unknown", "probe-error"])
def test_pressure_profiles_never_launch_after_critical_unknown_or_failed_preflight_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, interactive: bool, failure: str,
) -> None:
    monkeypatch.setattr(resources.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(resources, "monotonic", lambda: 0.0)
    probes = []

    def pressure(**kwargs: object) -> int:
        probes.append(kwargs)
        if failure == "probe-error":
            raise subprocess.CalledProcessError(1, "synthetic sysctl")
        return 4 if failure == "critical" else 3

    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Preflight failure launched an owned command")

    monkeypatch.setattr(resources, "pressure_level", pressure)
    monkeypatch.setattr(resources.subprocess, "Popen", forbidden)
    runner = resources.run_mac_interactive if interactive else resources.run_mac_idle
    with pytest.raises((ValueError, subprocess.SubprocessError)):
        runner(Step("fixture", ("never-start",)), tmp_path, {})
    assert len(probes) == 1  # No probe retry or implicit fallback profile.


@pytest.mark.parametrize("failure,expected", [(0, 0), (75, 75), (124, 124), (137, 137), ("probe-error", 125), ("interrupt", 130)])
def test_interactive_runner_preserves_environment_priority_status_and_owned_cleanup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
    failure: int | str, expected: int,
) -> None:
    from unittest.mock import Mock
    import logging

    caplog.set_level(logging.INFO)
    process = Mock(pid=42)
    starts = Mock(return_value=process)
    stopped = Mock()
    observed: list[dict[str, int | float | str]] = []

    def preflight(*, normal_required: bool = True, observations: list | None = None) -> None:
        assert normal_required is False and observations is not None
        observed.append({"profile": "mac-interactive", "phase": "preflight", "level": 2})
        observations.extend(observed)

    def monitor(process: object, timeout: int, tracked: set[int], *, normal_required: bool = True,
                observations: list | None = None) -> tuple[int, int]:
        assert normal_required is False and observations == observed and timeout == 300
        if failure == "probe-error":
            raise ValueError("Unsupervised pressure")
        if failure == "interrupt":
            raise KeyboardInterrupt
        assert isinstance(failure, int)
        return failure, 1234

    monkeypatch.setattr(resources, "idle_preflight", preflight)
    monkeypatch.setattr(resources, "monitor", monitor)
    monkeypatch.setattr(resources.subprocess, "Popen", starts)
    monkeypatch.setattr(resources, "stop_tree", stopped)
    step = Step("fixture", ("synthetic", "literal argument"))
    environment = {"NODE_OPTIONS": "--max-old-space-size=9999", "GNOSI_VITEST_MAX_WORKERS": "99"}
    result = resources.run_mac_interactive(step, tmp_path, environment)
    assert result.returncode == expected
    starts.assert_called_once()
    assert starts.call_args.args[0] == ("nice", "-n", "10", *step.arguments)
    assert starts.call_args.kwargs["start_new_session"] is True
    assert starts.call_args.kwargs["env"] == resources.resource_environment(environment)
    assert starts.call_args.kwargs["env"]["NODE_OPTIONS"] == "--max-old-space-size=1536"
    assert starts.call_args.kwargs["env"]["GNOSI_VITEST_MAX_WORKERS"] == "1"
    stopped.assert_called_once_with(process, set())
    assert "Resource result: fixture" in caplog.text
    assert "Resource profile observations: mac-interactive" in caplog.text
    assert environment["NODE_OPTIONS"] == "--max-old-space-size=9999"


def test_interactive_observations_record_only_level_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import Mock

    process = Mock(pid=42)
    process.poll.side_effect = [None, None, None, 0]
    levels = iter([2, 2, 1, 2])
    monkeypatch.setattr(resources, "monotonic", lambda: 0.0)
    monkeypatch.setattr(resources, "sleep", lambda _: None)
    monkeypatch.setattr(resources, "pressure_level", lambda: next(levels))
    monkeypatch.setattr(resources, "process_tree_rss", lambda *_: 0)
    observations: list[dict[str, int | float | str]] = []
    assert resources.monitor(process, 300, set(), normal_required=False, observations=observations)[0] == 0
    assert [item["level"] for item in observations] == [2, 1, 2]


@pytest.mark.parametrize("profile", ["mac-idle", "mac-interactive", "unknown"])
def test_pre_pr_uses_only_explicit_named_pressure_runner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, profile: str,
) -> None:
    from scripts.ci import pre_pr

    calls = []

    def run(name: str):
        def invoke(step: Step, root: Path, environment: dict[str, str]) -> subprocess.CompletedProcess[bytes]:
            calls.append(name)
            return subprocess.CompletedProcess(step.arguments, 0)
        return invoke

    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Explicit resource profile silently downgraded to an unbounded command")

    monkeypatch.setattr(pre_pr, "run_mac_idle", run("mac-idle"))
    monkeypatch.setattr(pre_pr, "run_mac_interactive", run("mac-interactive"))
    monkeypatch.setattr(pre_pr.subprocess, "run", forbidden)
    if profile == "unknown":
        with pytest.raises(ValueError, match="Unknown explicit"):
            pre_pr.run_steps(tmp_path, [Step("fixture", ("synthetic",))], {}, resource_profile=profile)
        assert calls == []
    else:
        assert pre_pr.run_steps(tmp_path, [Step("fixture", ("synthetic",))], {}, resource_profile=profile) == 0
        assert calls == [profile]


@pytest.mark.parametrize(("name", "expected"), [
    ("Frontend lint", 600),
    ("Frontend lint preparation", 300),
    ("Frontend types", 300),
    ("Python lint", 300),
    ("Complete backend types", 300),
    ("Production frontend build", 600),
    ("Documentation build", 600),
    ("Complete frontend suite", 900),
    ("CI and pre-PR regressions", 900),
])
def test_only_complete_frontend_lint_has_a_longer_static_deadline(name: str, expected: int) -> None:
    assert resources.step_timeout(Step(name, ("fixture",))) == expected
