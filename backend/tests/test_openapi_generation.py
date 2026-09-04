"""Deterministic, data-isolated OpenAPI artifact generation."""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path

import pytest

from backend.config import env_config
from backend.config.validation_runtime import validation_runtime_enabled
from scripts.generate_openapi import _configure_isolated_runtime

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPOSITORY_ROOT / "scripts" / "generate_openapi.py"
EXPECTED_HASH = REPOSITORY_ROOT / "backend" / "tests" / "contracts" / "openapi.sha256"
COMMITTED_SCHEMA = REPOSITORY_ROOT / "openapi" / "openapi.json"


def _generate(output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), "--output", str(output)],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def test_openapi_generator_is_byte_stable_and_matches_frozen_contract(tmp_path: Path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    first_run = _generate(first)
    second_run = _generate(second)

    assert first_run.returncode == 0, first_run.stderr
    assert second_run.returncode == 0, second_run.stderr
    assert first.read_bytes() == second.read_bytes()
    assert first.read_bytes() == COMMITTED_SCHEMA.read_bytes()
    assert (
        hashlib.sha256(first.read_bytes()).hexdigest()
        == EXPECTED_HASH.read_text(encoding="utf-8").strip()
    )

    check_run = subprocess.run(
        [sys.executable, str(GENERATOR), "--output", str(first), "--check"],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert check_run.returncode == 0, check_run.stderr


def test_generator_activates_complete_isolation_before_loading_configuration(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The generator normally runs in its own process; isolate its env changes
    # here too, so the rest of pytest does not inherit a deleted probe root.
    monkeypatch.setattr(os, "environ", dict(os.environ))

    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("OpenAPI generation must not consult environment files or credentials")

    monkeypatch.setattr(env_config, "_read_env_file", forbidden)
    monkeypatch.setattr(env_config, "_load_keychain", forbidden)
    monkeypatch.setattr("backend.security.keychain_manager.get_keychain", forbidden)
    _configure_isolated_runtime(tmp_path)
    assert validation_runtime_enabled()
    env_config.load_env(force_reload=True)
    assert env_config.get_env("UNMAPPED_FIXTURE_CREDENTIAL") is None

    from backend.config import app_config

    repository = tmp_path / "synthetic-repository"
    local_params = repository / "config/params.yaml"
    local_params.parent.mkdir(parents=True)
    local_params.write_text("private_probe_sentinel: must-not-load\n", encoding="utf-8")
    monkeypatch.setattr(app_config, "__file__", str(repository / "backend/config/app_config.py"))
    params = app_config.load_params(strict_env=False)
    assert "private_probe_sentinel" not in params.params
    assert params.params_source == tmp_path / "vault/.gnosi/params.yaml"
    assert local_params.read_text(encoding="utf-8") == "private_probe_sentinel: must-not-load\n"


def test_check_rejects_a_stale_frozen_hash(tmp_path: Path) -> None:
    schema = tmp_path / "openapi.json"
    frozen_hash = tmp_path / "openapi.sha256"
    generated = subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--output",
            str(schema),
            "--hash-output",
            str(frozen_hash),
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert generated.returncode == 0, generated.stderr
    frozen_hash.write_text("0" * 64 + "\n", encoding="utf-8")

    checked = subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--output",
            str(schema),
            "--hash-output",
            str(frozen_hash),
            "--check",
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert checked.returncode == 1
    assert "OpenAPI hash artifact is stale" in checked.stderr
