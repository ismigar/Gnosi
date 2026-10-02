"""Fail-closed, serial macOS validation under a process-tree memory budget."""

from __future__ import annotations

import logging
import os
import platform
import signal
import subprocess
from pathlib import Path
from time import monotonic, sleep
from typing import Mapping

from scripts.ci.pre_pr_commands import Step

LOG = logging.getLogger(__name__)
RSS_LIMIT_KIB = 2 * 1024 * 1024
POLL_SECONDS = 0.2


def resource_environment(parent: Mapping[str, str]) -> dict[str, str]:
    environment = dict(parent)
    environment.update({
        "CI": "true",
        "NODE_OPTIONS": "--max-old-space-size=1536",
        "GNOSI_VITEST_MAX_WORKERS": "1",
        "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1", "VECLIB_MAXIMUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1", "UV_THREADPOOL_SIZE": "1",
        "RAYON_NUM_THREADS": "1",
    })
    return environment


def pressure_level() -> int:
    result = subprocess.run(
        ("sysctl", "-n", "kern.memorystatus_vm_pressure_level"),
        capture_output=True, text=True, check=True, timeout=2,
    )
    level = int(result.stdout.strip())
    if level not in (1, 2, 4):
        raise ValueError("Unknown macOS memory pressure")
    return level


def idle_preflight() -> None:
    if platform.system() != "Darwin":
        raise ValueError("mac-idle requires macOS")
    started = monotonic()
    while True:
        if pressure_level() != 1:
            raise ValueError("Memory pressure is not normal; validation is incomplete")
        if monotonic() - started >= 30:
            return
        sleep(POLL_SECONDS)


def process_tree_rss(group: int, tracked: set[int]) -> int:
    """Include descendants that change groups, and retain reparented children."""
    result = subprocess.run(
        ("ps", "-axo", "pid=,ppid=,pgid=,rss="),
        capture_output=True, text=True, check=True, timeout=2,
    )
    rows = [tuple(map(int, line.split())) for line in result.stdout.splitlines() if line.strip()]
    if not rows or any(len(row) != 4 for row in rows):
        raise ValueError("Cannot supervise process tree")
    selected = {pid for pid, _, pgid, _ in rows if pgid == group or pid in tracked}
    previous: set[int] = set()
    while selected != previous:
        previous = selected.copy()
        selected.update(pid for pid, parent, _, _ in rows if parent in selected)
    tracked.clear()
    tracked.update(selected)
    return sum(rss for pid, _, _, rss in rows if pid in selected)


def stop_tree(process: subprocess.Popen[bytes], tracked: set[int]) -> None:
    # Kill the owned group even when its leader has already exited.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass
        for pid in tracked | {process.pid}:
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
        if sig == signal.SIGTERM:
            sleep(POLL_SECONDS)
    process.wait(timeout=3)


def step_timeout(step: Step) -> int:
    if "build" in step.name.lower():
        return 600
    if "suite" in step.name.lower() or "regressions" in step.name.lower():
        return 900
    return 300


def monitor(process: subprocess.Popen[bytes], timeout: float, tracked: set[int]) -> tuple[int, int]:
    started = monotonic()
    warning_since: float | None = None
    peak = 0
    while True:
        level = pressure_level()
        now = monotonic()
        warning_since = (warning_since if warning_since is not None else now) if level == 2 else None
        if level == 4 or (warning_since is not None and now - warning_since >= 2):
            return 75, peak
        rss = process_tree_rss(process.pid, tracked)
        peak = max(peak, rss)
        if peak > RSS_LIMIT_KIB:
            return 137, peak
        if now - started >= timeout:
            return 124, peak
        status = process.poll()
        if status is not None:
            if status == 0 and process_tree_rss(process.pid, tracked):
                # A successful parent must not leave work running in its children.
                return 125, peak
            return (status if status >= 0 else 128 - status), peak
        sleep(POLL_SECONDS)


def run_mac_idle(step: Step, root: Path, environment: Mapping[str, str]) -> subprocess.CompletedProcess[bytes]:
    idle_preflight()
    started = monotonic()
    process = subprocess.Popen(
        ("nice", "-n", "10", *step.arguments), cwd=root,
        env=resource_environment(environment), start_new_session=True,
    )
    tracked: set[int] = set()
    peak: int | None = None
    try:
        status, peak = monitor(process, step_timeout(step), tracked)
    except KeyboardInterrupt:
        status = 130
    except (OSError, ValueError, subprocess.SubprocessError):
        LOG.exception("Resource supervision failed; validation is incomplete")
        status = 125
    finally:
        stop_tree(process, tracked)
    LOG.info("Resource result: %s exit=%d duration=%.2fs peak_rss_kib=%s", step.name, status, monotonic() - started, peak)
    return subprocess.CompletedProcess(step.arguments, status)
