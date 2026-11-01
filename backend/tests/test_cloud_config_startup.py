"""Unavailable cloud configuration must block startup without losing its data."""
from __future__ import annotations

import os
import subprocess
import sys

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
                   if not key.startswith(('GNOSI_', 'DIGITAL_BRAIN_', 'VAULT_', 'OPENAI_', 'ANTHROPIC_'))}
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
