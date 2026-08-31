"""Contracts selected by test_scheduler_maintenance_scope's isolated child."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, cast

import pytest

if TYPE_CHECKING:
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


def check_dispatch_blocks_missing_plugin_and_calls_enabled_handler() -> None:
    from backend.scheduler import task_handlers

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


def check_bounded_real_log_preserves_counts_bytes_and_inode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.config import logger_config
    from backend.scheduler import task_handlers

    data_root = tmp_path.resolve()
    log_directory = data_root / "logs"
    log_directory.mkdir()
    log_file = log_directory / "gnosi.log"
    log_file.write_text("123456", encoding="utf-8")
    inode = log_file.stat().st_ino
    monkeypatch.setattr(logger_config, "LOG_FILE", log_file)

    log_count, log_bytes = task_handlers._purge_logs(
        data_root,
        logging.getLogger(__name__),
    )
    assert (log_count, log_bytes) == (1, 6)
    assert log_file.read_bytes() == b""
    assert log_file.stat().st_ino == inode


def check_scheduler_modules_respect_source_guardrails() -> None:
    scheduler = Path(__file__).resolve().parents[1] / "scheduler"
    manager_path = scheduler / "manager.py"
    handlers_path = scheduler / "task_handlers.py"
    assert len(manager_path.read_text(encoding="utf-8").splitlines()) <= 800
    assert len(handlers_path.read_text(encoding="utf-8").splitlines()) <= 800
    assert "backend.scheduler.manager" not in handlers_path.read_text(encoding="utf-8")
