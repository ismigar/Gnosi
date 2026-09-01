"""Offline maintenance tests: only the wrapper runs in the parent pytest suite.

Run this file to select both maintenance and scheduler domain checks in a fresh
child. Validation selectors are installed before any backend import, even when
the parent has cached configuration. No service, provider or live data is used.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from types import ModuleType

import pytest


def _validation_environment(root: Path) -> dict[str, str]:
    for name in ("data", "vault", "host"):
        (root / name).mkdir(parents=True, exist_ok=True)
    return {
        "GNOSI_VALIDATION_ROOT": str(root),
        "GNOSI_DATA_DIR": str(root / "data"),
        "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
        "VAULT_HOST_PATH": str(root / "vault"),
        "HOME_HOST_PATH": str(root / "host"),
        "GNOSI_SHARED_ENV_FILE": str(root / "disabled.env"),
        "GNOSI_DISABLE_SCHEDULER": "1",
        "GNOSI_FILES_PROVIDER": "local",
        "GNOSI_RUN_LIVE_E2E": "0",
    }


def test_maintenance_in_isolated_subprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    """Exercise collection with poisoned parent configuration and no selectors."""
    monkeypatch.delenv("GNOSI_VALIDATION_ROOT", raising=False)
    if "backend.config.paths_config" not in sys.modules:
        monkeypatch.setitem(
            sys.modules, "backend.config.paths_config", ModuleType("backend.config.paths_config")
        )
    with tempfile.TemporaryDirectory(prefix="gnosi-maintenance-tests-") as temporary:
        root = Path(temporary).resolve()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            **_validation_environment(root),
        }
        result = subprocess.run(
            [
                sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                "--basetemp", str(root / "pytest"),
                "-o", "python_functions=check_*",
                "backend/tests/test_scheduler_maintenance_scope.py",
                "backend/tests/test_scheduler_task_handlers_domain_contract.py",
            ],
            cwd=Path(__file__).resolve().parents[2], env=environment,
            capture_output=True, text=True, timeout=120, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        # Include child evidence in pytest's captured report without raw fixture data.
        sys.stdout.write(result.stdout)


@pytest.fixture
def data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()
    root = tmp_path.resolve()
    for name, value in _validation_environment(root).items():
        monkeypatch.setenv(name, value)
    assert validation_runtime_enabled()
    from backend.config import logger_config

    monkeypatch.setattr(logger_config, "LOG_FILE", root / "data/logs/gnosi.log")
    return root / "data"


def _write(path: Path, content: bytes = b"preserve this synthetic fixture") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _snapshot(paths: list[Path]) -> dict[Path, tuple[bytes, int, int, int, int]]:
    result: dict[Path, tuple[bytes, int, int, int, int]] = {}
    for path in paths:
        info = path.lstat()
        content = os.fsencode(os.readlink(path)) if path.is_symlink() else path.read_bytes()
        result[path] = (content, info.st_ino, info.st_mtime_ns, info.st_mode, info.st_nlink)
    return result


def _expected(logs: int = 0, size: int = 0) -> dict[str, object]:
    return {
        "message": "System maintenance completed successfully",
        "freed_bytes": size,
        "details": {
            "logs_cleared": logs,
            "mailbox_archive_purged": 0,
            "temporary_files_deleted": 0,
            "pycache_dirs_removed": 0,
            "global_cache_cleared": True,
        },
    }


def check_only_real_log_changes_and_second_run_preserves_source_and_data(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.scheduler import task_handlers
    from backend.utils.cache import global_cache

    host = data_root.parent / "host"
    project = host / "Projectes"
    repository = project / "gnosi"
    monkeypatch.setenv("REPO_ROOT", str(project))
    monkeypatch.setattr(
        task_handlers, "__file__", str(repository / "backend/scheduler/task_handlers.py")
    )
    protected = [
        _write(project / ".antigravity/team/mailbox/archive/worker.msg"),
        _write(repository / "pipeline/sandbox/result.txt"),
        _write(repository / "pipeline/sandbox/worker.log"),
        _write(repository / "pipeline/.tmp/gnosi-old.tmp"),
        _write(repository / "pipeline/.tmp/worker.log"),
        _write(repository / "backend/__pycache__/server.pyc"),
        _write(repository / "pipeline/__pycache__/worker.pyc"),
        _write(data_root.parent / "user.log"),
    ]
    protected.extend(_write(data_root / relative) for relative in (
        "user.log", "logs/user.log", "logs/gnosi.log.1", "logs/notifications.md",
        "secrets/integrations.json", "secrets/.env", "vault/page.md", "docs/notes.md",
        "audio/recording.wav", "out/export.md", "backups/backup.sqlite",
        "system/checkpoints/agent.sqlite", "cache/content_cache.json",
        "cache/vault_page_index.json", "cache/management.sqlite",
        "cache/management.db", "cache/gnosi-user.md", "cache/.env", "cache/user.tmp",
        "cache/gnosi-secret.json", "cache/__init__.py",
        "cache/gnosi-nested.tmp/gnosi-child.tmp", ".tmp/gnosi-result.tmp",
        "llm_wiki/tmp/gnosi-active.tmp",
    ))
    protected.append(_write(data_root.parent / "vault/.gnosi/params.yaml"))
    database = data_root / "system/management.sqlite"
    with closing(sqlite3.connect(database)) as connection, connection:
        connection.execute("CREATE TABLE sentinel (value TEXT)")
        connection.execute("INSERT INTO sentinel VALUES ('keep')")
    protected.append(database)
    # Do not create synthetic WAL/SHM before SQLite opens the DB: SQLite can
    # remove those files itself. Close it first, then establish the sentinels.
    protected.extend(_write(data_root / relative) for relative in (
        "system/management.sqlite-wal", "system/management.sqlite-shm",
    ))
    protected.append(_write(data_root / "cache/gnosi-completed.tmp", b"abcd"))
    protected.append(_write(data_root / "cache/gnosi-empty.tmp", b""))
    before = _snapshot(protected)
    log = _write(data_root / "logs/gnosi.log", b"log bytes\n")
    inode = log.stat().st_ino
    global_cache.set("maintenance-sentinel", "in memory only")

    assert task_handlers.system_maintenance() == _expected(logs=1, size=10)
    assert log.read_bytes() == b""
    assert log.stat().st_ino == inode
    assert global_cache.get("maintenance-sentinel") is None
    assert len(global_cache) == 0
    assert _snapshot(protected) == before
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot(protected) == before


def check_config_and_external_logs_are_never_loaded_or_modified(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.config import app_config, logger_config
    from backend.scheduler import task_handlers

    external = data_root.parent / "host/user-logs"
    protected = [_write(external / "gnosi.log"), _write(external.parent / "parent.log"),
                 _write(data_root / "logs/gnosi.log")]
    before = _snapshot(protected)
    monkeypatch.setattr(logger_config, "LOG_DIR", external)
    monkeypatch.setattr(logger_config, "LOG_FILE", external / "gnosi.log")
    monkeypatch.setenv("LOG_DIR", str(external))

    def forbidden_config(*, strict_env: bool = True) -> None:
        raise AssertionError("Maintenance must not load or migrate vault configuration")

    monkeypatch.setattr(app_config, "load_params", forbidden_config)
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot(protected) == before


def check_real_log_writer_remains_usable_after_truncation(data_root: Path) -> None:
    from backend.config.logger_config import LOG_FILE
    from backend.scheduler import task_handlers

    assert LOG_FILE == data_root / "logs/gnosi.log"
    LOG_FILE.parent.mkdir(parents=True)
    with closing(logging.FileHandler(LOG_FILE, encoding="utf-8")) as handler:
        record = logging.LogRecord("synthetic", logging.INFO, "fixture", 1, "before", (), None)
        handler.emit(record)
        inode = LOG_FILE.stat().st_ino
        assert task_handlers.system_maintenance() == _expected(logs=1, size=7)
        record.msg = "after"
        handler.emit(record)
        assert LOG_FILE.read_text(encoding="utf-8") == "after\n"
        assert LOG_FILE.stat().st_ino == inode


@pytest.mark.parametrize("selector", ["none", "relative", "traversal", "other-log", "database"])
def check_noncanonical_log_selectors_preserve_all_files(
    data_root: Path, monkeypatch: pytest.MonkeyPatch, selector: str,
) -> None:
    from backend.config import logger_config
    from backend.scheduler import task_handlers

    canonical = _write(data_root / "logs/gnosi.log")
    other = _write(data_root / "logs/user.log")
    database = _write(data_root / "system/management.sqlite")
    protected = [canonical, other, database]
    before = _snapshot(protected)
    selectors = {
        "none": None,
        "relative": Path("logs/gnosi.log"),
        "traversal": data_root / "logs/../logs/gnosi.log",
        "other-log": other,
        "database": database,
    }
    monkeypatch.setattr(logger_config, "LOG_FILE", selectors[selector])
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot(protected) == before


@pytest.mark.parametrize("selector", ["relative", "traversal", "root"])
def check_unsafe_data_selectors_fail_closed(
    data_root: Path, monkeypatch: pytest.MonkeyPatch, selector: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from backend.scheduler import task_handlers
    from backend.utils.cache import global_cache

    log = _write(data_root / "logs/gnosi.log")
    temporary = _write(data_root / "cache/gnosi-result.tmp")
    before = _snapshot([log, temporary])
    values = {
        "relative": "data",
        "traversal": str(data_root / ".." / "data"),
        "root": data_root.anchor,
    }
    monkeypatch.setenv("GNOSI_DATA_DIR", values[selector])
    global_cache.set("keep-clearing-ram", True)
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot([log, temporary]) == before
    assert len(global_cache) == 0
    assert "Disk maintenance skipped" in caplog.text


@pytest.mark.parametrize("key", ["GNOSI_DATA_DIR", "GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR"])
def check_canonical_resolver_and_legacy_aliases_keep_the_same_scope(
    data_root: Path, monkeypatch: pytest.MonkeyPatch, key: str,
) -> None:
    from backend.config.data_dir import reset_data_dir_warning_for_tests
    from backend.config.paths_config import get_paths
    from backend.scheduler import task_handlers

    assert get_paths()["LOCAL_DATA"] == data_root
    for selector in ("GNOSI_DATA_DIR", "GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR"):
        monkeypatch.delenv(selector, raising=False)
    monkeypatch.setenv(key, str(data_root))
    _write(data_root / "logs/gnosi.log", b"abc")
    reset_data_dir_warning_for_tests()
    if key == "GNOSI_DATA_DIR":
        result = task_handlers.system_maintenance()
    else:
        with pytest.warns(FutureWarning, match="deprecated"):
            result = task_handlers.system_maintenance()
    assert result == _expected(logs=1, size=3)


@pytest.mark.parametrize("component", ["data-root", "ancestor", "logs", "cache"])
def check_directory_symlinks_cannot_escape(
    data_root: Path, monkeypatch: pytest.MonkeyPatch, component: str,
) -> None:
    from backend.config import logger_config
    from backend.scheduler import task_handlers

    target = data_root.parent / "outside"
    if component == "data-root":
        link = data_root.parent / "linked-data"
        monkeypatch.setenv("GNOSI_DATA_DIR", str(link))
        monkeypatch.setattr(logger_config, "LOG_FILE", link / "logs/gnosi.log")
        protected = [_write(target / "logs/gnosi.log"),
                     _write(target / "cache/gnosi-result.tmp")]
    elif component == "ancestor":
        link = data_root.parent / "linked-parent"
        monkeypatch.setenv("GNOSI_DATA_DIR", str(link / "data"))
        monkeypatch.setattr(logger_config, "LOG_FILE", link / "data/logs/gnosi.log")
        protected = [_write(target / "data/logs/gnosi.log"),
                     _write(target / "data/cache/gnosi-result.tmp")]
    elif component == "logs":
        link = data_root / "logs"
        protected = [_write(target / "gnosi.log")]
    else:
        link = data_root / "cache"
        protected = [_write(target / "gnosi-result.tmp")]
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(target, target_is_directory=True)
    protected.append(link)
    before = _snapshot(protected)
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot(protected) == before


@pytest.mark.parametrize("kind", ["external", "internal", "dangling", "loop", "hardlink"])
def check_file_aliases_preserve_both_link_and_target(
    data_root: Path, kind: str,
) -> None:
    from backend.scheduler import task_handlers

    protected: list[Path] = []
    for relative in ("logs/gnosi.log", "cache/gnosi-result.tmp"):
        link = data_root / relative
        link.parent.mkdir(parents=True, exist_ok=True)
        base = data_root / "system" if kind == "internal" else data_root.parent / "external"
        target = base / (link.name + ".sqlite")
        if kind not in {"dangling", "loop"}:
            protected.append(_write(target))
        if kind == "hardlink":
            link.hardlink_to(target)
        else:
            link.symlink_to(link if kind == "loop" else target)
        protected.append(link)
    before = _snapshot(protected)
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot(protected) == before


def check_nonregular_entries_are_preserved_without_blocking(data_root: Path) -> None:
    from backend.scheduler import task_handlers

    log = data_root / "logs/gnosi.log"
    temporary = data_root / "cache/gnosi-pipe.tmp"
    for entry in (log, temporary):
        entry.parent.mkdir(parents=True, exist_ok=True)
        os.mkfifo(entry)
    before = {entry: entry.lstat() for entry in (log, temporary)}
    assert task_handlers.system_maintenance() == _expected()
    assert {entry: entry.lstat() for entry in (log, temporary)} == before


def check_log_replaced_by_symlink_during_open_cannot_truncate_target(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.scheduler import task_handlers

    log = _write(data_root / "logs/gnosi.log", b"original app log")
    saved_log = log.with_name("saved.log")
    target = _write(data_root.parent / "user.log", b"external user log")
    before = _snapshot([target])
    original = os.open

    def open_with_swap(
        name: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int, mode: int = 0o777, *, dir_fd: int | None = None,
    ) -> int:
        if name == "gnosi.log" and dir_fd is not None:
            log.rename(saved_log)
            log.symlink_to(target)
        return original(name, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", open_with_swap)
    monkeypatch.setattr(os, "supports_dir_fd", os.supports_dir_fd | {open_with_swap})
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot([target]) == before
    assert saved_log.read_bytes() == b"original app log"
    assert log.is_symlink() and log.readlink() == target


def check_missing_log_directory_is_not_created(data_root: Path) -> None:
    from backend.scheduler import task_handlers

    assert task_handlers.system_maintenance() == _expected()
    assert list(data_root.iterdir()) == []


def check_missing_data_root_is_not_created(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.scheduler import task_handlers

    missing = data_root / "absent"
    monkeypatch.setenv("GNOSI_DATA_DIR", str(missing))
    assert task_handlers.system_maintenance() == _expected()
    assert not missing.exists()


def check_unsupported_platform_keeps_disk_and_clears_ram(
    data_root: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    from backend.scheduler import task_handlers
    from backend.utils.cache import global_cache

    protected = [_write(data_root / "logs/gnosi.log"),
                 _write(data_root / "cache/gnosi-result.tmp")]
    before = _snapshot(protected)
    monkeypatch.setattr(os, "supports_dir_fd", set())
    global_cache.set("temporary", True)
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot(protected) == before
    assert len(global_cache) == 0
    assert "unavailable on this platform" in caplog.text


def check_failed_truncation_counts_no_bytes_and_ram_clear_continues(
    data_root: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    from backend.scheduler import task_handlers
    from backend.utils.cache import global_cache

    log = _write(data_root / "logs/gnosi.log")
    temporary = _write(data_root / "cache/gnosi-result.tmp", b"123")
    before = _snapshot([log, temporary])
    global_cache.set("ram-sentinel", True)

    def denied(descriptor: int, length: int) -> None:
        raise PermissionError("synthetic truncate denial")

    monkeypatch.setattr(os, "ftruncate", denied)
    assert task_handlers.system_maintenance() == _expected()
    assert _snapshot([log, temporary]) == before
    assert len(global_cache) == 0
    assert "synthetic truncate denial" in caplog.text


def check_maintenance_never_lists_directories_or_unlinks_entries(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.scheduler import task_handlers

    _write(data_root / "logs/gnosi.log", b"log")
    temporary = _write(data_root / "cache/gnosi-result.tmp")
    before = _snapshot([temporary])

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("Maintenance must not enumerate or unlink any path")

    monkeypatch.setattr(os, "listdir", forbidden)
    monkeypatch.setattr(os, "scandir", forbidden)
    monkeypatch.setattr(os, "unlink", forbidden)
    assert task_handlers.system_maintenance() == _expected(logs=1, size=3)
    assert _snapshot([temporary]) == before


def check_memory_clear_failure_is_not_reported_as_success(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.scheduler import task_handlers
    from backend.utils.cache import global_cache

    def denied() -> None:
        raise RuntimeError("synthetic RAM cache failure")

    monkeypatch.setattr(global_cache, "clear", denied)
    with pytest.raises(RuntimeError, match="synthetic RAM cache failure"):
        task_handlers.system_maintenance()


def check_scheduler_maintenance_dispatch_and_manager_forwarding(
    data_root: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.scheduler import task_handlers
    from backend.scheduler.manager import SchedulerManager

    manager = object.__new__(SchedulerManager)
    payload = _expected()
    monkeypatch.setattr(task_handlers, "system_maintenance", lambda: payload)
    assert manager._task_system_maintenance() is payload
    assert task_handlers.execute_task(manager, "system_maintenance", lambda: {},
                                      lambda _state, _plugin: False) is payload
    assert task_handlers.execute_task(manager, "unknown", lambda: {},
                                      lambda _state, _plugin: False) == {
        "error": "Unknown task: unknown",
    }
