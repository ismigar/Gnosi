"""Root quality gates execute complete targets in order and stop on failure."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_COMMANDS = [
    ["pnpm", "--filter", "@gnosi/frontend", "typecheck"],
    ["pnpm", "typecheck:backend-boundaries"],
    ["pnpm", "typecheck:pipeline"],
    [
        "uv",
        "run",
        "python",
        "-m",
        "compileall",
        "-q",
        "backend",
        "pipeline",
        "scripts",
        "extensions",
    ],
]
E2E_COMMANDS = [
    ["pnpm", "--filter", "@gnosi/e2e", "test:contracts"],
    ["pnpm", "--filter", "@gnosi/e2e", "typecheck"],
]


def _scripts() -> dict[str, str]:
    manifest: object = json.loads((ROOT / "package.json").read_text())
    assert isinstance(manifest, dict)
    raw_scripts: object = manifest["scripts"]
    assert isinstance(raw_scripts, dict)
    scripts: dict[str, str] = {}
    for key, value in raw_scripts.items():
        assert isinstance(key, str) and isinstance(value, str)
        scripts[key] = value
    return scripts


def test_root_typecheck_includes_every_strict_gate() -> None:
    commands = [shlex.split(command.strip()) for command in _scripts()["typecheck"].split("&&")]
    assert commands == EXPECTED_COMMANDS


def test_backend_target_remains_complete_and_matches_ci() -> None:
    backend = _scripts()["typecheck:backend-boundaries"]
    assert shlex.split(backend) == [
        "uv",
        "run",
        "mypy",
        "--strict",
        "--exclude",
        "^backend/tests/",
        "backend",
    ]
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    backend_job = workflow.split("\n  backend:\n", 1)[1].split("\n  native-smoke:\n", 1)[0]
    assert "run: " + backend in backend_job


def test_pipeline_target_uses_the_complete_indexed_source_checker() -> None:
    pipeline = _scripts()["typecheck:pipeline"]
    assert shlex.split(pipeline) == [
        "uv",
        "run",
        "python",
        "scripts/check_public_pipeline.py",
        "--typecheck",
    ]
    assert (ROOT / "scripts/check_public_pipeline.py").is_file()


def test_e2e_contract_gate_checks_all_active_typescript_sources() -> None:
    commands = [shlex.split(command.strip())
                for command in _scripts()["test:e2e:contracts"].split("&&")]
    assert commands == E2E_COMMANDS
    manifest = json.loads((ROOT / "tests/e2e/package.json").read_text())
    assert manifest["scripts"]["typecheck"] == (
        "node ../../frontend/node_modules/typescript/bin/tsc --project tsconfig.json"
    )
    assert "typecheck:auth" in manifest["scripts"]  # Backwards-compatible focused alias.
    configuration = json.loads((ROOT / "tests/e2e/tsconfig.json").read_text())
    assert configuration["include"] == ["**/*.ts", "**/*.tsx"]
    assert configuration["exclude"] == ["node_modules", "playwright-report", "test-results"]
    for option in ("strict", "noEmit", "noUncheckedIndexedAccess"):
        assert configuration["compilerOptions"][option] is True
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "run: pnpm test:e2e:contracts" in workflow


def test_frontend_lint_and_guardrails_fail_closed() -> None:
    frontend_manifest: object = json.loads((ROOT / "frontend/package.json").read_text())
    assert isinstance(frontend_manifest, dict)
    frontend_scripts: object = frontend_manifest["scripts"]
    assert isinstance(frontend_scripts, dict)
    assert shlex.split(frontend_scripts["lint"]) == [
        "eslint", ".", "--max-warnings=0",
    ]
    assert shlex.split(_scripts()["guardrails:frontend"]) == [
        "uv", "run", "python", "scripts/check_frontend_guardrails.py", "--require-zero",
    ]
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "run: pnpm guardrails:frontend" in workflow
    assert "run: pnpm lint:frontend" in workflow


def test_documentation_workflow_never_consumes_hosted_runner_budget() -> None:
    workflow = (ROOT / ".github/workflows/documentation-pages.yml").read_text()

    assert "ubuntu-latest" not in workflow
    assert workflow.count("runs-on: [self-hosted, Linux, ARM64]") == 2


@pytest.mark.parametrize(("script_name", "commands", "failure_at"), [
    ("typecheck", EXPECTED_COMMANDS, failure_at) for failure_at in range(5)
] + [
    ("test:e2e:contracts", E2E_COMMANDS, failure_at) for failure_at in range(3)
])
@pytest.mark.skipif(os.name != "posix", reason="Executable shims exercise the POSIX shell contract")
def test_root_command_preserves_order_and_failure_status(
    script_name: str, commands: list[list[str]], failure_at: int, tmp_path: Path,
) -> None:
    executables = tmp_path / "bin"
    executables.mkdir()
    calls_path = tmp_path / "calls.jsonl"
    # Each shim logs only its supplied arguments. No real pnpm, uv, dependencies
    # or backend module is invoked by this deterministic shell-contract fixture.
    shim = (
        f"#!{sys.executable}\n"
        + """\
import json
import os
import sys
from pathlib import Path

calls = Path(os.environ["GNOSI_GATE_CALLS"])
previous = calls.read_text().splitlines() if calls.exists() else []
with calls.open("a") as stream:
    stream.write(json.dumps([Path(sys.argv[0]).name, *sys.argv[1:]]) + "\\n")
stage = len(previous) + 1
failure_at = int(os.environ["GNOSI_GATE_FAILURE"])
raise SystemExit(16 + stage if stage == failure_at else 0)
"""
    )
    for name in ("pnpm", "uv"):
        executable = executables / name
        executable.write_text(shim)
        executable.chmod(0o700)
    environment = {
        "PATH": str(executables),
        "PYTHONDONTWRITEBYTECODE": "1",
        "GNOSI_GATE_CALLS": str(calls_path),
        "GNOSI_GATE_FAILURE": str(failure_at),
    }
    result = subprocess.run(
        ["/bin/sh", "-c", _scripts()[script_name]],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == (16 + failure_at if failure_at else 0), result.stderr
    expected_count = failure_at or len(commands)
    recorded: object = [json.loads(line) for line in calls_path.read_text().splitlines()]
    assert recorded == commands[:expected_count]
