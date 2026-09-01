"""Deterministic, data-isolated OpenAPI artifact generation."""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPOSITORY_ROOT / "scripts" / "generate_openapi.py"
EXPECTED_HASH = REPOSITORY_ROOT / "backend" / "tests" / "contracts" / "openapi.sha256"
LOCAL_PARAMS = REPOSITORY_ROOT / "config" / "params.yaml"


def _generate(output: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), "--output", str(output)],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def test_openapi_generator_is_byte_stable_and_matches_frozen_contract(tmp_path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    local_params_before = LOCAL_PARAMS.read_bytes() if LOCAL_PARAMS.exists() else None

    first_run = _generate(first)
    second_run = _generate(second)

    assert first_run.returncode == 0, first_run.stderr
    assert second_run.returncode == 0, second_run.stderr
    assert first.read_bytes() == second.read_bytes()
    assert hashlib.sha256(first.read_bytes()).hexdigest() == EXPECTED_HASH.read_text(
        encoding="utf-8"
    ).strip()

    check_run = subprocess.run(
        [sys.executable, str(GENERATOR), "--output", str(first), "--check"],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert check_run.returncode == 0, check_run.stderr
    local_params_after = LOCAL_PARAMS.read_bytes() if LOCAL_PARAMS.exists() else None
    assert local_params_after == local_params_before
