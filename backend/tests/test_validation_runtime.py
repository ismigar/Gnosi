"""Isolation cannot reach environment files, system or legacy secret stores."""

from __future__ import annotations

import pytest

from backend.config import env_config
from backend.config.validation_runtime import validation_runtime_enabled
from backend.security.keychain_manager import KeychainManager


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    for directory in ('data', 'vault', 'host'):
        (tmp_path / directory).mkdir()
    monkeypatch.setenv('GNOSI_VALIDATION_ROOT', str(tmp_path))
    for name, directory in (
        ('GNOSI_DATA_DIR', 'data'), ('DIGITAL_BRAIN_VAULT_PATH', 'vault'),
        ('VAULT_HOST_PATH', 'vault'), ('HOME_HOST_PATH', 'host'),
    ):
        monkeypatch.setenv(name, str(tmp_path / directory))
    return tmp_path


def test_normal_runtime_unchanged(monkeypatch):
    monkeypatch.delenv('GNOSI_VALIDATION_ROOT', raising=False)
    assert validation_runtime_enabled() is False


def test_explicit_complete_validation_root(isolated):
    assert validation_runtime_enabled() is True


@pytest.mark.parametrize('name', [
    'GNOSI_DATA_DIR', 'DIGITAL_BRAIN_VAULT_PATH', 'VAULT_HOST_PATH', 'HOME_HOST_PATH',
])
def test_external_or_missing_selector_fails_closed(isolated, monkeypatch, name):
    monkeypatch.delenv(name)
    with pytest.raises(RuntimeError, match='inside its probe root'):
        validation_runtime_enabled()
    monkeypatch.setenv(name, str(isolated.parent))
    with pytest.raises(RuntimeError, match='inside its probe root'):
        validation_runtime_enabled()


@pytest.mark.parametrize('root', ['', '.', '/'])
def test_invalid_root_fails_closed(isolated, monkeypatch, root):
    monkeypatch.setenv('GNOSI_VALIDATION_ROOT', root)
    with pytest.raises(RuntimeError):
        validation_runtime_enabled()


def test_isolated_loading_never_reads_env_or_keychain(isolated, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('external source must not be consulted')
    monkeypatch.setattr(env_config, '_read_env_file', forbidden)
    monkeypatch.setattr(env_config, '_load_keychain', forbidden)
    monkeypatch.setattr('backend.security.keychain_manager.get_keychain', forbidden)
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    env_config.load_env(force_reload=True)
    assert env_config.get_env('OPENAI_API_KEY') is None
    monkeypatch.setenv('OPENAI_API_KEY', 'explicit-fixture')
    assert env_config.get_env('OPENAI_API_KEY') == 'explicit-fixture'


@pytest.mark.parametrize('system', ['Darwin', 'Windows', 'Linux'])
@pytest.mark.parametrize('docker', [False, True])
def test_direct_secret_operations_are_disabled(isolated, monkeypatch, system, docker):
    manager = KeychainManager()
    manager.system, manager._is_docker = system, docker
    def forbidden(*args, **kwargs):
        pytest.fail('must not access real or fallback credentials')
    for method in (
        '_macos_get', '_macos_save', '_macos_delete', '_macos_list',
        '_portable_get', '_portable_save', '_portable_delete',
        '_docker_get', '_docker_save', '_file_get', '_file_save', '_file_delete',
        '_read_file_data', '_read_legacy_data',
    ):
        monkeypatch.setattr(manager, method, forbidden)
    assert manager.get_credential('token') is None
    assert manager.save_credential('token', 'synthetic') is False
    assert manager.delete_credential('token') is False
    assert manager.list_credentials() == []
    assert manager.has_credential('token') is False


def test_no_legacy_secret_copy_during_path_resolution(isolated, tmp_path, monkeypatch):
    from backend.config import paths_config

    repository = tmp_path / 'synthetic-repository'
    legacy = repository / 'pipeline/private_skills/secrets/integrations.json'
    legacy.parent.mkdir(parents=True)
    legacy.write_text('{"fixture": "must-not-import"}', encoding='utf-8')
    monkeypatch.setattr(paths_config, '__file__', str(repository / 'backend/config/paths_config.py'))
    paths = paths_config.get_paths()
    assert paths['SECRETS'] == isolated / 'data/secrets'
    assert not (isolated / 'data/secrets/integrations.json').exists()
    assert legacy.read_text(encoding='utf-8') == '{"fixture": "must-not-import"}'


def test_probe_does_not_load_repository_config(isolated, monkeypatch):
    from backend.config import app_config

    repository = isolated / 'synthetic-repository'
    local_config = repository / 'config/params.yaml'
    local_config.parent.mkdir(parents=True)
    local_config.write_text('private_probe_sentinel: must-not-load\n', encoding='utf-8')
    config = isolated / 'vault/.gnosi/params.yaml'
    config.parent.mkdir()
    config.write_text('{}\n', encoding='utf-8')
    monkeypatch.setattr(app_config, '__file__', str(repository / 'backend/config/app_config.py'))
    params = app_config.load_params(strict_env=False)
    assert 'private_probe_sentinel' not in params.params
    assert params.params_source == config
