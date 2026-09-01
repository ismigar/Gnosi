"""Characterization contracts for portable params.yaml source selection."""

from __future__ import annotations

from pathlib import Path

import pytest

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
