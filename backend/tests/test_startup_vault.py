"""Contracts for cloud Vault configuration recovery before app imports."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend.config import startup_vault


class _Provider:
    def __init__(self, *, online_only: bool, result: bool = True) -> None:
        self.online_only = online_only
        self.result = result
        self.materialized: list[Path] = []

    def is_online_only(self, _path: Path, _stat: object) -> bool:
        return self.online_only

    async def materialize(self, path: Path) -> bool:
        self.materialized.append(path)
        return self.result


def test_native_vault_path_does_not_load_vault_configuration(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(tmp_path / "vault"))
    monkeypatch.setattr(startup_vault, "load_env", lambda: None)

    assert startup_vault._configured_vault_path() == tmp_path / "vault"  # noqa: SLF001


def test_online_only_params_are_materialized_without_rewriting(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    params = tmp_path / "vault/.gnosi/params.yaml"
    params.parent.mkdir(parents=True)
    params.write_text("settings: {}\n", encoding="utf-8")
    provider = _Provider(online_only=True)
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(params.parents[1]))
    monkeypatch.setattr(startup_vault, "load_env", lambda: None)
    monkeypatch.setattr(startup_vault, "get_files_provider", lambda: provider)

    assert startup_vault.materialize_startup_vault_files() is True
    assert provider.materialized == [params]
    assert params.read_text(encoding="utf-8") == "settings: {}\n"


def test_local_params_do_not_call_materializer(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    params = tmp_path / "vault/.gnosi/params.yaml"
    params.parent.mkdir(parents=True)
    params.write_text("settings: {}\n", encoding="utf-8")
    provider = _Provider(online_only=False)
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(params.parents[1]))
    monkeypatch.setattr(startup_vault, "load_env", lambda: None)
    monkeypatch.setattr(startup_vault, "get_files_provider", lambda: provider)

    assert startup_vault.materialize_startup_vault_files() is True
    assert provider.materialized == []


def test_startup_materializes_active_registry_before_optional_plugin_state(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    registry = vault / "BD/vault_db_registry.json"
    plugins = vault / ".gnosi/plugins.json"
    registry.parent.mkdir(parents=True)
    plugins.parent.mkdir(parents=True)
    registry.write_text("{}\n", encoding="utf-8")
    plugins.write_text("{}\n", encoding="utf-8")
    provider = _Provider(online_only=True)
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(vault))
    monkeypatch.setattr(startup_vault, "load_env", lambda: None)
    monkeypatch.setattr(startup_vault, "get_files_provider", lambda: provider)

    assert startup_vault.materialize_startup_vault_files() is True
    assert provider.materialized == [registry, plugins]


def test_running_event_loop_materializes_in_a_dedicated_thread(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    params = tmp_path / "vault/.gnosi/params.yaml"
    params.parent.mkdir(parents=True)
    params.write_text("settings: {}\n", encoding="utf-8")
    provider = _Provider(online_only=True)
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(params.parents[1]))
    monkeypatch.setattr(startup_vault, "load_env", lambda: None)
    monkeypatch.setattr(startup_vault, "get_files_provider", lambda: provider)

    async def exercise() -> bool:
        return startup_vault.materialize_startup_vault_files()

    assert asyncio.run(exercise()) is True
    assert provider.materialized == [params]
