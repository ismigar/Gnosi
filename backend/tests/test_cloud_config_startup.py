"""Unavailable cloud configuration must block startup without losing its data."""
from __future__ import annotations

import os
import subprocess
import sys
import time

import pytest

from backend.config import app_config
from backend.utils.metadata_io import MetadataUnavailable


def test_import_time_cloud_failure_has_a_private_desktop_error(tmp_path):
    vault = tmp_path / "vault"
    params = vault / ".gnosi/params.yaml"
    params.parent.mkdir(parents=True)
    original = b"settings: {language: ca}\nai: {private_fixture: never-display-this}\n"
    params.write_bytes(original)
    script = """
import runpy
from backend.utils import metadata_io
metadata_io.is_cloud_placeholder = lambda path, stat: path.name == 'params.yaml' and '.gnosi' in path.parts
metadata_io._download = lambda path: False
runpy.run_module('backend.server', run_name='__main__')
"""
    environment = {key: value for key, value in os.environ.items()
                   if key in {'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'}}
    identity = "a" * 64
    environment.update(HOME=str(tmp_path), GNOSI_DATA_DIR=str(tmp_path / "data"),
                       DIGITAL_BRAIN_VAULT_PATH=str(vault), GNOSI_DESKTOP_INSTANCE=identity,
                       GNOSI_DISABLE_AUTOMATIONS="1")
    result = subprocess.run([sys.executable, "-c", script], env=environment,
                            capture_output=True, text=True, timeout=45)
    assert result.returncode == 74, result.stderr[-2000:]
    assert f"GNOSI_STARTUP_ERROR {identity} cloud_metadata_unavailable\n" in result.stderr
    assert "Traceback" not in result.stderr
    assert "never-display-this" not in result.stdout + result.stderr
    assert params.read_bytes() == original
    assert not (tmp_path / "data/config/params.yaml").exists()


def test_unreadable_user_config_cannot_fall_back_or_run_migrations(tmp_path, monkeypatch):
    path = tmp_path / ".gnosi/params.yaml"
    path.parent.mkdir()
    path.write_text("settings: {language: fr}\n")
    original = path.read_bytes()
    def unavailable(*_args):
        raise OSError("Synthetic provider read failure")
    monkeypatch.setattr(app_config._CONFIG_YAML_CACHE, "read", unavailable)
    with pytest.raises(MetadataUnavailable):
        app_config._merge_user_params({"settings": {"language": "en"}}, tmp_path / "base", path)
    assert path.read_bytes() == original


def test_config_recovers_without_cached_defaults_or_changes(tmp_path, monkeypatch):
    from backend.config import yaml_cache
    path = tmp_path / ".gnosi/params.yaml"
    path.parent.mkdir()
    path.write_text("settings: {language: fr, custom: retained}\n")
    original = path.read_bytes()
    def unavailable(_path):
        raise MetadataUnavailable("Synthetic provider unavailable")
    monkeypatch.setattr(yaml_cache, "ensure_metadata_local", unavailable)
    with pytest.raises(MetadataUnavailable):
        app_config._merge_user_params({}, tmp_path / "base", path)
    monkeypatch.setattr(yaml_cache, "ensure_metadata_local", lambda _path: None)
    recovered, selected = app_config._merge_user_params({}, tmp_path / "base", path)
    assert selected == path
    assert recovered["settings"] == {"language": "fr", "custom": "retained"}
    assert path.read_bytes() == original


@pytest.mark.parametrize("identity", [None, "invalid"])
def test_non_desktop_cloud_error_keeps_its_exception(monkeypatch, capsys, identity):
    from backend.config.startup_errors import desktop_startup_errors
    if identity is None:
        monkeypatch.delenv("GNOSI_DESKTOP_INSTANCE", raising=False)
    else:
        monkeypatch.setenv("GNOSI_DESKTOP_INSTANCE", identity)
    with pytest.raises(MetadataUnavailable), desktop_startup_errors():
        raise MetadataUnavailable("Synthetic private diagnostic")
    assert not capsys.readouterr().err


@pytest.mark.skipif(sys.platform != "darwin", reason="File Provider helpers run on macOS")
@pytest.mark.parametrize("spawn_race", [False, True])
def test_quit_during_import_time_hydration_reaps_the_helper(tmp_path, spawn_race):
    import psutil

    params = tmp_path / "vault/.gnosi/params.yaml"
    params.parent.mkdir(parents=True)
    params.write_text("settings: {language: ca, retained: original}\n")
    (tmp_path / "data").mkdir()
    (tmp_path / "host").mkdir()
    original = params.read_bytes()
    pid_file = tmp_path / "helper.pid"
    helper = tmp_path / "provider.py"
    helper.write_text(
        f"#!{sys.executable}\nimport os,time\nfrom pathlib import Path\n"
        f"Path({str(pid_file)!r}).write_text(str(os.getpid()))\ntime.sleep(30)\n"
    )
    helper.chmod(0o700)
    script = """
import asyncio, runpy
from backend.utils import metadata_io
from backend.platform.files import coordinated
metadata_io.is_cloud_placeholder = lambda path, stat: path.name == 'params.yaml' and '.gnosi' in path.parts
"""
    if spawn_race:
        script += """
spawn = coordinated.asyncio.create_subprocess_exec
async def delayed_spawn(*args, **kwargs):
    process = await spawn(*args, **kwargs)
    await asyncio.sleep(0.4)
    return process
coordinated.asyncio.create_subprocess_exec = delayed_spawn
"""
    script += "runpy.run_module('backend.server', run_name='__main__')\n"
    environment = {key: value for key, value in os.environ.items()
                   if key in {'PATH', 'TMPDIR', 'LANG', 'LC_ALL'}}
    environment.update(HOME=str(tmp_path), GNOSI_VALIDATION_ROOT=str(tmp_path),
                       GNOSI_DATA_DIR=str(tmp_path / "data"), GNOSI_FILES_PROVIDER="local",
                       DIGITAL_BRAIN_VAULT_PATH=str(params.parents[1]),
                       VAULT_HOST_PATH=str(params.parents[1]), HOME_HOST_PATH=str(tmp_path / "host"),
                       GNOSI_FILE_ACCESS_HELPER=str(helper), GNOSI_DESKTOP_INSTANCE="d" * 64)
    child = subprocess.Popen([sys.executable, "-c", script], env=environment,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    owned_helper = None
    try:
        deadline = time.monotonic() + 15
        while not pid_file.exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        if not pid_file.exists():
            output, errors = child.communicate(timeout=2)
            pytest.fail("Synthetic provider did not start: " + errors.decode()[-2000:])
        owned_helper = psutil.Process(int(pid_file.read_text()))
        assert owned_helper.ppid() == child.pid and str(helper) in owned_helper.cmdline()
        child.terminate()
        output, errors = child.communicate(timeout=4)
        assert child.returncode == 0, errors.decode()[-2000:]
        assert not owned_helper.is_running() or owned_helper.status() == psutil.STATUS_ZOMBIE
        assert b"Traceback" not in output + errors
        assert params.read_bytes() == original
    finally:
        if child.poll() is None:
            child.kill()
            child.communicate(timeout=3)
        if owned_helper and owned_helper.is_running() and str(helper) in owned_helper.cmdline():
            owned_helper.kill()


@pytest.mark.parametrize("fails", [False, True])
def test_startup_restores_the_previous_termination_handler(monkeypatch, fails):
    import signal
    from backend.config.startup_errors import desktop_startup_errors

    monkeypatch.setenv("GNOSI_DESKTOP_INSTANCE", "e" * 64)
    previous = signal.getsignal(signal.SIGTERM)
    try:
        if fails:
            with pytest.raises(SystemExit, match="74"), desktop_startup_errors():
                raise MetadataUnavailable("Private fixture")
        else:
            with desktop_startup_errors():
                assert signal.getsignal(signal.SIGTERM) != previous
        assert signal.getsignal(signal.SIGTERM) == previous
    finally:
        signal.signal(signal.SIGTERM, previous)
