"""Configuration prepares new paths promptly without repeating successful checks."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event

import pytest

from backend.config import app_config, paths_config
from backend.config.directory_preparation import DirectoryPreparationCache


@pytest.fixture
def directory_clock(monkeypatch):
    clock = [0.0]
    cache = DirectoryPreparationCache(clock=lambda: clock[0])
    monkeypatch.setattr(paths_config, "_DIRECTORY_PREPARATION", cache)
    return clock


def _config(root):
    return app_config.Config({}, root / "params.yaml", strict_env=False)


def test_configuration_burst_does_not_repeat_prepared_directory_stats(
    isolated_validation_runtime, directory_clock, monkeypatch
):
    root = isolated_validation_runtime
    first = _config(root)
    tracked = {
        first.paths[key] for key in (
            "DATABASES", "ASSETS", "CALENDAR", "MAIL", "PLANTILLES", "DIBUIXOS",
            "WIKI", "DASHBOARDS", "GNOSI_CONFIG", "AGENT_INSTRUCTIONS", "AGENT_TOOLS",
            "LOCAL_CACHE", "LOGS", "AUDIO", "OUT_DIR", "BACKUPS", "CHECKPOINTS", "SECRETS",
        )
    }
    original = Path.stat
    stats = []

    def counted(path, *args, **kwargs):
        if path in tracked:
            stats.append(path)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", counted)
    for _ in range(20):
        assert _config(root).paths == first.paths
    assert stats == []


def test_first_parallel_preparations_share_one_check_and_other_paths_progress(tmp_path):
    cache = DirectoryPreparationCache()
    entered = Event()
    release = Event()
    started = Barrier(5)
    calls = []
    target = tmp_path / "first"

    def prepare(path):
        calls.append(path)
        if path == target:
            entered.set()
            assert release.wait(3)
        path.mkdir()

    def follower():
        started.wait(timeout=2)
        cache.ensure(target, prepare)

    with ThreadPoolExecutor(max_workers=6) as executor:
        requests = [executor.submit(follower) for _ in range(4)]
        started.wait(timeout=2)
        try:
            assert entered.wait(2)
            other = executor.submit(cache.ensure, tmp_path / "other", prepare)
            other.result(timeout=2)
            assert (tmp_path / "other").is_dir()
        finally:
            release.set()
        for request in requests:
            request.result(timeout=2)
    assert calls.count(target) == 1


def test_new_vault_and_data_roots_are_prepared_immediately(
    isolated_validation_runtime, directory_clock, monkeypatch
):
    first = _config(isolated_validation_runtime)
    second_root = isolated_validation_runtime.parent / "other-runtime"
    for name in ("data", "vault", "host"):
        (second_root / name).mkdir(parents=True)
    monkeypatch.setenv("GNOSI_VALIDATION_ROOT", str(second_root))
    for key, name in (
        ("GNOSI_DATA_DIR", "data"), ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"), ("HOME_HOST_PATH", "host"),
    ):
        monkeypatch.setenv(key, str(second_root / name))
    second = _config(second_root)
    assert first.paths["VAULT"] != second.paths["VAULT"]
    assert first.paths["LOCAL_DATA"] != second.paths["LOCAL_DATA"]
    assert second.paths["AGENT_TOOLS"].is_dir()
    assert second.paths["CHECKPOINTS"].is_dir()
    assert second.paths["SECRETS"].is_dir()


def test_failed_preparation_is_retried_on_the_next_configuration_read(
    isolated_validation_runtime, directory_clock, monkeypatch
):
    root = isolated_validation_runtime
    target = root / "data" / "out"
    original = Path.mkdir
    attempts = []

    def fail_once(path, *args, **kwargs):
        if path == target:
            attempts.append(path)
            if len(attempts) == 1:
                raise PermissionError("Synthetic temporary failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", fail_once)
    _config(root)
    assert not target.exists()
    _config(root)
    assert target.is_dir()
    assert attempts == [target, target]


@pytest.mark.parametrize("repair", ["expiry", "direct"])
def test_removed_directory_is_repaired_after_expiry_or_by_direct_get_paths(
    isolated_validation_runtime, directory_clock, repair
):
    root = isolated_validation_runtime
    first = _config(root)
    target = first.paths["OUT_DIR"]
    target.rmdir()
    _config(root)
    assert not target.exists()
    if repair == "expiry":
        directory_clock[0] = 31.0
        _config(root)
    else:
        paths_config.get_paths()
    assert target.is_dir()


def test_yaml_values_stay_fresh_inside_the_directory_reuse_window(
    isolated_validation_runtime, directory_clock, monkeypatch
):
    root = isolated_validation_runtime
    _config(root)
    document = root / "vault" / ".gnosi" / "params.yaml"
    monkeypatch.setattr(app_config, "_persist_provider_migration", lambda *_args: None)
    document.write_text("settings: {language: ca}\n", encoding="utf-8")
    first = app_config.load_params(strict_env=False)
    document.write_text("settings: {language: fr}\n", encoding="utf-8")
    second = app_config.load_params(strict_env=False)
    assert first.settings["language"] == "ca"
    assert second.settings["language"] == "fr"
    assert first.paths == second.paths


def test_success_cache_has_a_fixed_bound_and_evicted_paths_are_checked_again(tmp_path):
    cache = DirectoryPreparationCache(max_entries=2)
    calls = []

    def prepare(path):
        calls.append(path)
        path.mkdir(exist_ok=True)

    for name in ("one", "two", "three", "one"):
        cache.ensure(tmp_path / name, prepare)
    assert calls == [tmp_path / name for name in ("one", "two", "three", "one")]
    assert len(cache._successful) == 2


def test_direct_invalidation_supersedes_a_pending_preparation(tmp_path):
    cache = DirectoryPreparationCache()
    entered = Event()
    release = Event()
    target = tmp_path / "directory"
    calls = []

    def old_preparation(path):
        path.mkdir()
        entered.set()
        assert release.wait(3)

    with ThreadPoolExecutor(max_workers=1) as executor:
        old = executor.submit(cache.ensure, target, old_preparation)
        try:
            assert entered.wait(2)
            target.rmdir()
            cache.invalidate(target)
        finally:
            release.set()
        old.result(timeout=2)

    def current_preparation(path):
        calls.append(path)
        path.mkdir()

    cache.ensure(target, current_preparation)
    assert calls == [target]
    assert target.is_dir()
