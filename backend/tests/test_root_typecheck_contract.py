"""Root quality gates execute complete targets in order and stop on failure."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from yaml.nodes import MappingNode, Node, SequenceNode

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
    from scripts.check_backend_types import ARGUMENTS

    backend = _scripts()["typecheck:backend-boundaries"]
    assert shlex.split(backend) == [
        "uv",
        "run",
        "python",
        "scripts/check_backend_types.py",
    ]
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    backend_job = workflow.split("\n  backend:\n", 1)[1].split("\n  native-smoke:\n", 1)[0]
    assert "run: " + backend in backend_job
    assert ARGUMENTS == [
        "--native-parser", "--num-workers", "0", "--strict",
        "--exclude", "^backend/tests/", "backend",
    ]


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
        "node", "scripts/lint.mjs",
    ]
    assert shlex.split(_scripts()["guardrails:frontend"]) == [
        "uv", "run", "python", "scripts/check_frontend_guardrails.py", "--require-zero",
    ]
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "run: pnpm guardrails:frontend" in workflow
    assert "run: pnpm lint:frontend" in workflow
    assert _scripts()["lint:frontend"] == "pnpm --filter @gnosi/frontend lint"


@pytest.mark.parametrize("cached,status,failure_position", [
    (False, 0, "final"), (True, 0, "final"),
    (False, 2, "early"), (True, 23, "early"),
    (False, 2, "final"), (True, 23, "final"),
])
@pytest.mark.parametrize("file_count", [1, 17, 384, 385])
def test_shared_frontend_lint_preserves_scope_cache_arguments_and_failure(
    tmp_path: Path, cached: bool, status: int, failure_position: str, file_count: int,
) -> None:
    scripts = tmp_path / "frontend/scripts"
    scripts.mkdir(parents=True)
    runner = scripts / "lint.mjs"
    for name in ("lint.mjs", "lint-files.mjs", "lint-worker.mjs"):
        (scripts / name).write_text((ROOT / "frontend/scripts" / name).read_text())
    source = scripts.parent / "src"
    source.mkdir()
    files = [source / f"source {index:03} [fixture].ts" for index in range(file_count)]
    for path in files:
        path.write_text("export {};\n")
    eslint_root = scripts.parent / "node_modules/eslint"
    eslint = eslint_root / "bin/eslint.js"
    eslint.parent.mkdir(parents=True)
    (eslint_root / "package.json").write_text(json.dumps({
        "name": "eslint", "type": "commonjs", "exports": "./api.mjs",
    }))
    # The real discovery helper executes against a deterministic API shim.
    # Real ESLint traversal/rules/cache are exercised by the frontend contracts.
    (eslint_root / "api.mjs").write_text(
        "import assert from 'node:assert/strict';\n"
        "import { readdirSync } from 'node:fs';\n"
        "import { resolve } from 'node:path';\n"
        "export class ESLint { async lintFiles(patterns) {\n"
        "  assert.deepEqual(patterns, ['.']);\n"
        "  return readdirSync('src').sort().map(name => ({filePath: resolve('src', name)}));\n"
        "} }\n"
    )
    calls = tmp_path / "lint-calls.jsonl"
    cleanup = tmp_path / "lint-cleanup.txt"
    final_batch = (file_count - 1) // 16
    # Preserve both early-stop and final-batch failure coverage across workers.
    failure_batch = min(1, final_batch) if failure_position == "early" else final_batch
    eslint.write_text(
        "require('../lib/cli.js').execute(process.argv, undefined).then(status => { process.exitCode = status; });\n"
    )
    cli = eslint_root / "lib/cli.js"
    cli.parent.mkdir()
    cli.write_text(
        "const assert = require('node:assert/strict');\n"
        "const { appendFileSync, existsSync, readFileSync } = require('node:fs');\n"
        f"const log = {json.dumps(str(calls))};\n"
        "exports.execute = async (args, text) => {\n"
        "assert.strictEqual(args, process.argv);\n"
        "assert.equal(text, undefined);\n"
        f"assert.equal(args[1], {json.dumps(str(eslint))});\n"
        "assert.equal(typeof globalThis.gc, 'function');\n"
        "const previous = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\\n').length : 0;\n"
        "appendFileSync(log, JSON.stringify({args: args.slice(2), cwd: process.cwd(), pid: process.pid}) + '\\n');\n"
        "console.log('synthetic lint output');\n"
        "console.error('synthetic lint diagnostic');\n"
        f"return previous === {failure_batch} ? {status} : 0;\n"
        "};\n"
    )
    # Mirror the installed parser's public entrypoint and dependency resolution.
    typescript_eslint = scripts.parent / "node_modules/typescript-eslint"
    typescript_eslint.mkdir()
    (typescript_eslint / "package.json").write_text(json.dumps({
        "name": "typescript-eslint", "main": "index.cjs",
    }))
    (typescript_eslint / "index.cjs").write_text("module.exports = {};\n")
    parser = scripts.parent / "node_modules/@typescript-eslint/parser"
    parser.mkdir(parents=True)
    (parser / "package.json").write_text(json.dumps({
        "name": "@typescript-eslint/parser", "main": "index.cjs",
    }))
    (parser / "index.cjs").write_text(
        "const { appendFileSync } = require('node:fs');\n"
        f"exports.clearCaches = () => appendFileSync({json.dumps(str(cleanup))}, 'cleared\\n');\n"
    )
    environment = dict(os.environ)
    environment.pop("GNOSI_ESLINT_CACHE", None)
    cache = str(tmp_path / "cache with spaces/$(must-not-execute)")
    if cached:
        environment["GNOSI_ESLINT_CACHE"] = cache
    result = subprocess.run(
        ("node", str(runner)), cwd=tmp_path, env=environment,
        capture_output=True, text=True, check=False, timeout=30,
    )
    assert result.returncode == status
    payloads = [json.loads(line) for line in calls.read_text().splitlines()]
    assert len(payloads) == failure_batch + 1
    executed_file_count = min(file_count, len(payloads) * 16)
    workers = (executed_file_count + 383) // 384
    assert len({payload["pid"] for payload in payloads}) == workers
    assert cleanup.read_text() == "cleared\n" * workers
    for index, payload in enumerate(payloads):
        expected = ["--max-warnings=0", "--concurrency=off"]
        if cached:
            expected.extend(["--cache", "--cache-strategy", "content", "--cache-location", cache])
        expected.extend(["--", *(str(path) for path in files[index * 16:(index + 1) * 16])])
        assert payload["args"] == expected
        assert Path(payload["cwd"]).resolve() == (tmp_path / "frontend").resolve()
    visited_files = [argument for payload in payloads
                     for argument in payload["args"][payload["args"].index("--") + 1:]]
    assert visited_files == [str(path) for path in files[:executed_file_count]]
    if status and failure_position == "early" and file_count >= 384:
        assert executed_file_count == 32 < file_count
        assert workers == 1  # A failed worker must not launch remaining batches/workers.
    if status and failure_position == "final" and file_count == 385:
        assert executed_file_count == file_count
        assert workers == 2  # The final failure must also clear the second parser worker.
        assert payloads[0]["pid"] != payloads[-1]["pid"]
    assert result.stdout.count("synthetic lint output") == len(payloads)
    assert "synthetic lint diagnostic" in result.stderr


def test_documentation_workflow_never_consumes_hosted_runner_budget() -> None:
    workflow = (ROOT / ".github/workflows/documentation-pages.yml").read_text()

    assert "ubuntu-latest" not in workflow
    assert workflow.count("runs-on: [self-hosted, Linux, ARM64]") == 2


def test_release_workflow_never_consumes_hosted_runner_budget() -> None:
    workflow = (ROOT / ".github/workflows/build-release.yml").read_text()

    for hosted_label in (
        "ubuntu-latest",
        "ubuntu-24.04-arm",
        "macos-15",
        "macos-15-intel",
        "windows-2025",
    ):
        assert hosted_label not in workflow
    assert workflow.count("runs-on: [self-hosted, Linux, ARM64]") == 3
    assert 'runs-on: [self-hosted, macOS, "${{ matrix.runner_arch }}"]' in workflow
    assert "runs-on: [self-hosted, Windows, X64]" in workflow


def _assert_unique_yaml_keys(node: Node, location: str) -> None:
    if isinstance(node, MappingNode):
        seen: set[tuple[str, str]] = set()
        for key_node, value_node in node.value:
            key = (key_node.tag, key_node.value)
            assert key not in seen, f"duplicate YAML key {key_node.value!r} at {location}"
            seen.add(key)
            _assert_unique_yaml_keys(value_node, f"{location}.{key_node.value}")
    elif isinstance(node, SequenceNode):
        for index, value_node in enumerate(node.value):
            _assert_unique_yaml_keys(value_node, f"{location}[{index}]")


def test_every_workflow_has_unique_yaml_mapping_keys() -> None:
    for workflow_path in sorted((ROOT / ".github/workflows").glob("*.yml")):
        document = yaml.compose(workflow_path.read_text(encoding="utf-8"))
        assert document is not None
        _assert_unique_yaml_keys(document, workflow_path.name)


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


def _synthetic_typecheck_cache_project(
    tmp_path: Path, status: int = 0,
) -> tuple[Path, Path, dict[str, str], Path]:
    """Protocol fixture only: this helper does not verify or claim real typing."""
    import hashlib

    frontend = tmp_path / "frontend"
    scripts = frontend / "scripts"
    scripts.mkdir(parents=True)
    runner = scripts / "typecheck.mjs"
    runner.write_bytes((ROOT / "frontend/scripts/typecheck.mjs").read_bytes())
    python = tmp_path / ".venv/bin/python"
    python.parent.mkdir(parents=True)
    python.symlink_to(Path(sys.executable).resolve())
    cache = tmp_path / "type-cache"
    cache.mkdir(mode=0o700)
    calls = tmp_path / "synthetic-helper-calls.json"
    helper = cache / "verify-typecheck-cache.py"
    helper.write_text(
        "# SYNTHETIC PROTOCOL UNIT FIXTURE; NO TYPECHECK RESULT\n"
        "import json,sys\nfrom pathlib import Path\n"
        f"Path({str(calls)!r}).write_text(json.dumps(sys.argv[1:]))\n"
        f"raise SystemExit({status})\n"
    )
    manifest = cache / "manifest.json"
    manifest.write_text(json.dumps({
        "schema": 1, "status": "VERIFIED_WHOLE_FRONTEND_TYPES_CACHE",
        "project_root": str(frontend.resolve()), "candidate": "a" * 40,
        "helper": {"path": str(helper.resolve()), "sha256": hashlib.sha256(helper.read_bytes()).hexdigest()},
        "python": {"path": str(python), "realpath": str(python.resolve()),
                   "sha256": hashlib.sha256(python.read_bytes()).hexdigest()},
    }))
    environment = dict(os.environ)
    environment["GNOSI_TYPECHECK_CACHE"] = str(manifest.resolve())
    environment["GNOSI_TYPECHECK_CACHE_SHA256"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    return runner, manifest, environment, calls


@pytest.mark.parametrize("status", [0, 2, 23])
def test_optional_typecheck_cache_verifies_protocol_and_preserves_status(
    tmp_path: Path, status: int,
) -> None:
    runner, manifest, environment, calls = _synthetic_typecheck_cache_project(tmp_path, status)
    result = subprocess.run(("node", str(runner)), env=environment,
                            capture_output=True, text=True, check=False, timeout=30)
    assert result.returncode == status
    assert json.loads(calls.read_text()) == [
        "--manifest", str(manifest), "--manifest-sha256", environment["GNOSI_TYPECHECK_CACHE_SHA256"],
    ]
    assert ("VERIFIED_CACHED_WHOLE_FRONTEND_TYPES" in result.stdout) is (status == 0)
    assert "TypeScript semantic batch" not in result.stdout


@pytest.mark.parametrize("corruption", [
    "path-only", "sha-only", "empty", "bad-sha", "manifest-hash", "helper-hash",
    "python-hash", "wrong-helper", "wrong-project", "malformed", "oversized", "symlink", "mode",
])
def test_optional_typecheck_cache_rejects_invalid_bindings_without_fallback(
    tmp_path: Path, corruption: str,
) -> None:
    import hashlib

    runner, manifest, environment, calls = _synthetic_typecheck_cache_project(tmp_path)
    data = json.loads(manifest.read_text())
    if corruption == "path-only":
        environment.pop("GNOSI_TYPECHECK_CACHE_SHA256")
    elif corruption == "sha-only":
        environment.pop("GNOSI_TYPECHECK_CACHE")
    elif corruption == "empty":
        environment["GNOSI_TYPECHECK_CACHE"] = ""
    elif corruption == "bad-sha":
        environment["GNOSI_TYPECHECK_CACHE_SHA256"] = "not-a-hash"
    elif corruption == "manifest-hash":
        environment["GNOSI_TYPECHECK_CACHE_SHA256"] = "0" * 64
    elif corruption == "helper-hash":
        Path(data["helper"]["path"]).write_text("raise SystemExit(0)\n")
    elif corruption == "python-hash":
        data["python"]["sha256"] = "0" * 64
    elif corruption == "wrong-helper":
        data["helper"]["path"] = str(tmp_path / "other.py")
    elif corruption == "wrong-project":
        data["project_root"] = str(tmp_path)
    elif corruption == "mode":
        manifest.parent.chmod(0o755)
    if corruption in {"python-hash", "wrong-helper", "wrong-project"}:
        manifest.write_text(json.dumps(data))
        environment["GNOSI_TYPECHECK_CACHE_SHA256"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if corruption in {"malformed", "oversized"}:
        manifest.write_text("{" if corruption == "malformed" else " " * 65537)
        environment["GNOSI_TYPECHECK_CACHE_SHA256"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if corruption == "symlink":
        original = manifest.with_name("original.json")
        manifest.rename(original)
        manifest.symlink_to(original)
    result = subprocess.run(("node", str(runner)), env=environment,
                            capture_output=True, text=True, check=False, timeout=30)
    assert result.returncode != 0
    assert not calls.exists()
    assert "TypeScript worker failed" not in result.stderr  # No legacy retry.
    assert "VERIFIED_CACHED_WHOLE_FRONTEND_TYPES" not in result.stdout


def test_optional_typecheck_cache_rejects_arguments_before_helper(
    tmp_path: Path,
) -> None:
    runner, _manifest, environment, calls = _synthetic_typecheck_cache_project(tmp_path)
    result = subprocess.run(("node", str(runner), "--skipLibCheck"), env=environment,
                            capture_output=True, text=True, check=False, timeout=30)
    assert result.returncode != 0 and not calls.exists()


def test_optional_typecheck_cache_absent_preserves_legacy_discovery(tmp_path: Path) -> None:
    runner, _manifest, environment, calls = _synthetic_typecheck_cache_project(tmp_path)
    environment.pop("GNOSI_TYPECHECK_CACHE")
    environment.pop("GNOSI_TYPECHECK_CACHE_SHA256")
    (runner.parent / "typecheck-worker.mjs").write_text(
        "import {readFileSync,writeFileSync} from 'node:fs';\n"
        "const request=JSON.parse(readFileSync(process.argv[2],'utf8'));\n"
        "if(request.phase!=='discover') throw new Error('unexpected retry');\n"
        "writeFileSync(process.argv[3],JSON.stringify({checkTypes:false,diagnostics:[]}));\n"
    )
    result = subprocess.run(("node", str(runner)), env=environment,
                            capture_output=True, text=True, check=False, timeout=30)
    assert result.returncode == 1 and not calls.exists()
    assert "verification incomplete" not in result.stderr


@pytest.mark.parametrize("profile", [None, "mac-idle"])
def test_pre_pr_typecheck_cache_pair_is_scoped_to_exact_type_phase(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, profile: str | None,
) -> None:
    from scripts.ci import pre_pr
    from scripts.ci.pre_pr_commands import Step

    keys = ("GNOSI_TYPECHECK_CACHE", "GNOSI_TYPECHECK_CACHE_SHA256")
    parent = {keys[0]: str(tmp_path / "manifest.json"), keys[1]: "a" * 64}
    (tmp_path / "runtime").mkdir()
    environment = pre_pr.isolated_environment(parent, tmp_path / "runtime")
    original = dict(environment)
    steps = [Step(name, ("synthetic",)) for name in [
        "Frontend types", "Complete frontend suite", "Frontend types extra", "Complete documentation update gate",
    ]]
    observed: list[dict[str, str]] = []

    def run(args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        observed.append(dict(kwargs["env"]))  # type: ignore[arg-type]
        return subprocess.CompletedProcess(args, 0)  # type: ignore[arg-type]

    def idle(step: Step, root: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        observed.append(dict(env))
        return subprocess.CompletedProcess(step.arguments, 0)

    monkeypatch.setattr(pre_pr.subprocess, "run", run)
    monkeypatch.setattr(pre_pr, "run_mac_idle", idle)
    assert pre_pr.run_steps(tmp_path, steps, environment, resource_profile=profile) == 0
    assert environment == original
    assert all(observed[0][name] == parent[name] for name in keys)
    assert all(name not in item for item in observed[1:] for name in keys)


@pytest.mark.parametrize("pair", [
    {"GNOSI_TYPECHECK_CACHE": "/manifest.json"},
    {"GNOSI_TYPECHECK_CACHE_SHA256": "a" * 64},
    {"GNOSI_TYPECHECK_CACHE": "", "GNOSI_TYPECHECK_CACHE_SHA256": "a" * 64},
])
def test_pre_pr_rejects_partial_type_cache_pair(tmp_path: Path, pair: dict[str, str]) -> None:
    from scripts.ci import pre_pr

    (tmp_path / "runtime").mkdir()
    with pytest.raises(ValueError, match="both explicit"):
        pre_pr.isolated_environment(pair, tmp_path / "runtime")


def test_optional_typecheck_cache_preserves_helper_signal_without_retry(tmp_path: Path) -> None:
    import hashlib
    import signal

    runner, manifest, environment, calls = _synthetic_typecheck_cache_project(tmp_path)
    data = json.loads(manifest.read_text())
    helper = Path(data["helper"]["path"])
    helper.write_text(
        "# SYNTHETIC SIGNAL PROTOCOL FIXTURE; NO TYPECHECK RESULT\n"
        "import os,signal\nfrom pathlib import Path\n"
        f"Path({str(calls)!r}).write_text('one invocation')\n"
        "os.kill(os.getpid(),signal.SIGTERM)\n"
    )
    data["helper"]["sha256"] = hashlib.sha256(helper.read_bytes()).hexdigest()
    manifest.write_text(json.dumps(data))
    environment["GNOSI_TYPECHECK_CACHE_SHA256"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    result = subprocess.run(("node", str(runner)), env=environment,
                            capture_output=True, text=True, check=False, timeout=30)
    assert result.returncode == 128 + signal.SIGTERM
    assert calls.read_text() == "one invocation"
    assert "VERIFIED_CACHED_WHOLE_FRONTEND_TYPES" not in result.stdout
