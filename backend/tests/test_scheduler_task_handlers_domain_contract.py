"""Behavior and architecture contracts for extracted scheduler task handlers."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import cast

from backend.scheduler import manager as scheduler_manager_module
from backend.scheduler import task_handlers


class _Manager:
    TASK_PLUGIN_REQUIREMENTS = {"fetch_mail": ("mail",)}

    def __init__(self) -> None:
        self.called: list[str] = []

    def __getattr__(self, name: str) -> Callable[[], task_handlers.TaskResult]:
        def run() -> task_handlers.TaskResult:
            self.called.append(name)
            return {"handler": name}

        return run


def test_dispatch_blocks_missing_plugin_and_calls_enabled_handler() -> None:
    fake = _Manager()
    manager = cast(task_handlers.SchedulerTaskPort, fake)

    paused = task_handlers.execute_task(
        manager,
        "fetch_mail",
        lambda: {},
        lambda _state, _plugin_id: False,
    )
    enabled = task_handlers.execute_task(
        manager,
        "fetch_mail",
        lambda: {},
        lambda _state, _plugin_id: True,
    )

    assert paused["skipped"] is True
    assert enabled == {"handler": "_task_fetch_mail"}
    assert fake.called == ["_task_fetch_mail"]


def test_bounded_cleanup_helpers_preserve_counts_and_bytes(tmp_path: Path) -> None:
    pipeline = tmp_path / "pipeline"
    log_directory = tmp_path / "logs"
    log_directory.mkdir()
    log_file = log_directory / "backend.log"
    log_file.write_text("123456", encoding="utf-8")
    sandbox = pipeline / "sandbox"
    sandbox.mkdir(parents=True)
    temporary = sandbox / "result.txt"
    temporary.write_text("1234", encoding="utf-8")

    log_count, log_bytes = task_handlers._purge_logs(
        log_directory,
        pipeline,
        logging.getLogger(__name__),
    )
    temporary_count, temporary_bytes = task_handlers._purge_temporary_files(
        pipeline,
        logging.getLogger(__name__),
    )

    assert (log_count, log_bytes) == (1, 6)
    assert log_file.read_text(encoding="utf-8").startswith("# Log purged at ")
    assert (temporary_count, temporary_bytes) == (1, 4)
    assert not temporary.exists()


def test_scheduler_modules_respect_source_guardrails() -> None:
    manager_path = Path(scheduler_manager_module.__file__ or "")
    handlers_path = Path(task_handlers.__file__ or "")
    assert len(manager_path.read_text(encoding="utf-8").splitlines()) <= 800
    assert len(handlers_path.read_text(encoding="utf-8").splitlines()) <= 800
    assert "backend.scheduler.manager" not in handlers_path.read_text(encoding="utf-8")
