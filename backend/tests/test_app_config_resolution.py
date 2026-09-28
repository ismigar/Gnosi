"""Characterization contracts for portable params.yaml source selection."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from backend.config import app_config


def _params_file(root: Path) -> Path:
    path = root / ".gnosi" / "params.yaml"
    path.parent.mkdir(parents=True)
    path.write_text("settings: {}\n", encoding="utf-8")
    return path


def test_active_environment_and_home_precedence(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    active = _params_file(tmp_path / "active")
    environment = _params_file(tmp_path / "environment")
    home = _params_file(tmp_path / "home")
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(environment.parents[1]))

    selected = app_config._user_params_path(  # noqa: SLF001
        {},
        local_path=tmp_path / "config" / "params.yaml",
        home_path=home,
        active_path=active,
    )
    assert selected == active

    active.unlink()
    selected = app_config._user_params_path(  # noqa: SLF001
        {},
        local_path=tmp_path / "config" / "params.yaml",
        home_path=home,
        active_path=active,
    )
    assert selected == environment

    monkeypatch.delenv("DIGITAL_BRAIN_VAULT_PATH")
    selected = app_config._user_params_path(  # noqa: SLF001
        {},
        local_path=tmp_path / "config" / "params.yaml",
        home_path=home,
        active_path=None,
    )
    assert selected == home


def test_missing_environment_file_skips_home_but_keeps_local_vault_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    missing_environment = tmp_path / "missing-environment"
    home = _params_file(tmp_path / "home")
    configured_vault = tmp_path / "configured"
    configured = _params_file(configured_vault)
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(missing_environment))

    selected = app_config._user_params_path(  # noqa: SLF001
        {"paths": {"vault": str(configured_vault)}},
        local_path=tmp_path / "config" / "params.yaml",
        home_path=home,
        active_path=None,
    )

    assert selected == configured


@pytest.mark.parametrize("loader", [yaml.SafeLoader, getattr(yaml, "CSafeLoader", yaml.SafeLoader)])
def test_config_parser_preserves_safe_yaml_values_and_merge_rules(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    loader: type,
) -> None:
    monkeypatch.setattr(app_config, "_CONFIG_YAML_LOADER", loader)
    path = _params_file(tmp_path / "vault")
    source = (
        "defaults: &defaults\n  enabled: true\n  retries: 3\n"
        "settings:\n  <<: *defaults\n  language: ca\n  gnosi_mode: org\n"
        "  label: 'Coneixement i col·laboració'\n"
        "  note: |\n    Primera línia\n    Segona línia\n"
        "  absent: null\n  tags: [recerca, '2026-09-07']\n"
    )
    path.write_text(source, encoding="utf-8")
    base = {"settings": {"retained": "base", "language": "en"}}
    result, selected = app_config._merge_user_params(base, tmp_path / "base.yaml", path)
    expected = yaml.safe_load(source)
    expected["settings"]["retained"] = "base"
    assert result == expected
    assert selected == path


@pytest.mark.parametrize("loader", [yaml.SafeLoader, getattr(yaml, "CSafeLoader", yaml.SafeLoader)])
def test_config_parser_rejects_python_constructors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    loader: type,
) -> None:
    monkeypatch.setattr(app_config, "_CONFIG_YAML_LOADER", loader)
    path = _params_file(tmp_path / "vault")
    path.write_text('settings: !!python/object/apply:builtins.dict []\n', encoding="utf-8")
    with pytest.raises(yaml.constructor.ConstructorError):
        app_config._merge_user_params({}, tmp_path / "base.yaml", path)


def test_configuration_reads_remain_fresh_and_vault_specific(tmp_path: Path) -> None:
    first = _params_file(tmp_path / "first")
    second = _params_file(tmp_path / "second")
    base = tmp_path / "base.yaml"
    first.write_text("settings: {language: ca, gnosi_mode: personal}\n", encoding="utf-8")
    second.write_text("settings: {language: fr, gnosi_mode: org}\n", encoding="utf-8")
    original, _ = app_config._merge_user_params({}, base, first)
    other, _ = app_config._merge_user_params({}, base, second)
    assert original["settings"] == {"language": "ca", "gnosi_mode": "personal"}
    assert other["settings"] == {"language": "fr", "gnosi_mode": "org"}

    first.write_text("settings: {language: es, gnosi_mode: org}\n", encoding="utf-8")
    updated, _ = app_config._merge_user_params({}, base, first)
    assert updated["settings"] == {"language": "es", "gnosi_mode": "org"}
    assert original["settings"]["language"] == "ca"


def test_cached_base_is_not_changed_by_vault_merges(tmp_path, monkeypatch):
    from backend.services.context_vars import active_vault_path

    repository = tmp_path / "repository"
    base = repository / "config" / "params.yaml"
    base.parent.mkdir(parents=True)
    base.write_text("settings: {language: en, inherited: yes}\n", encoding="utf-8")
    first = _params_file(tmp_path / "first")
    second = _params_file(tmp_path / "second")
    first.write_text("settings: {language: ca, only_first: true}\n", encoding="utf-8")
    second.write_text("settings: {language: fr}\n", encoding="utf-8")
    monkeypatch.setattr(app_config, "__file__", str(repository / "backend/config/app_config.py"))
    monkeypatch.setattr(app_config, "validation_runtime_enabled", lambda: False)
    monkeypatch.setattr(app_config, "get_paths", lambda overrides, **_kwargs: {})
    token = active_vault_path.set(first.parents[1])
    try:
        first_config = app_config.load_params(strict_env=False)
        active_vault_path.set(second.parents[1])
        second_config = app_config.load_params(strict_env=False)
        active_vault_path.set(first.parents[1])
        first_again = app_config.load_params(strict_env=False)
    finally:
        active_vault_path.reset(token)
    assert first_config.settings == first_again.settings == {
        "language": "ca", "inherited": True, "only_first": True,
    }
    assert second_config.settings == {"language": "fr", "inherited": True}


def test_frozen_bootstrap_migration_preserves_signed_resources(tmp_path, monkeypatch):
    bundle = tmp_path / "signed-bundle"
    local = bundle / "config" / "params.yaml"
    local.parent.mkdir(parents=True)
    local.write_text("settings: {language: fr}\n", encoding="utf-8")
    original = local.read_bytes()
    data = tmp_path / "device-data"
    bootstrap = data / "config" / "params.yaml"
    monkeypatch.setattr(app_config, "__file__", str(bundle / "backend/config/app_config.py"))
    monkeypatch.setattr(app_config, "load_env", lambda: None)
    monkeypatch.setattr(app_config, "is_frozen_runtime", lambda: True)
    monkeypatch.setattr(app_config, "resolve_data_dir", lambda: data)
    monkeypatch.setattr(app_config, "validation_runtime_enabled", lambda: False)
    monkeypatch.setattr(app_config, "_active_params_path", lambda: None)
    monkeypatch.setattr(app_config, "_user_params_path", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(app_config, "get_paths", lambda *_args, **_kwargs: {})
    for key in app_config.ENV_PROVIDER_MIGRATIONS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-bootstrap-test")

    first = app_config.load_params(strict_env=False)
    assert first.params_source == bootstrap
    assert bootstrap.is_file()
    assert local.read_bytes() == original
    assert "synthetic-bootstrap-test" not in bootstrap.read_text()

    bootstrap.write_text("settings: {language: ca}\n", encoding="utf-8")
    monkeypatch.delenv("OPENAI_API_KEY")
    reloaded = app_config.load_params(strict_env=False)
    assert reloaded.settings["language"] == "ca"
    assert reloaded.params_source == bootstrap
    assert local.read_bytes() == original

    vault_params = tmp_path / "vault" / ".gnosi" / "params.yaml"
    monkeypatch.setattr(app_config, "_active_params_path", lambda: vault_params)
    assert app_config.load_params(strict_env=False).params_source == vault_params
