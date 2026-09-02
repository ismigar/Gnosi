"""Exercise native wrappers with synthetic files and fail-closed command doubles.

Do not source dotenv files: shell evaluation executes commands and loses Python's
quoting/precedence rules. Copy the canonical loaders into an isolated checkout and
replace only credential/storage boundaries. Never import the real application,
inherit the host environment, install tools, discover services or open sockets.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

import pytest

REPO = Path(__file__).resolve().parents[2]
BACKEND = "run_native_dev.sh"
FRONTEND = "run_native_frontend.sh"
INVALID_PORTS = ("", "0", "65536", "9999999999999999999999", "-1", "+1", "1.5",
                 " 5002", "5002 ", "1+2", "0x138a", "1\n2", "１２３", "$(exit 88)")
CONFIG_KEYS = (
    "GNOSI_DATA_DIR", "GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR",
    "DIGITAL_BRAIN_VAULT_PATH", "VAULT_HOST_PATH", "HOME_HOST_PATH",
    "AI_PROVIDER", "AI_MODEL_URL", "OLLAMA_BASE_URL", "TRANSLATION_SERVER_URL",
    "TZ", "ONEDRIVE_WARMUP_MODE", "PYTHONPATH", "PYTHONUNBUFFERED",
    "VITE_BACKEND_HOST", "VITE_BACKEND_PORT", "VITE_FRONTEND_PORT",
    "VITE_GNOSI_CHECKOUT_LABEL", "VITE_GNOSI_STALE_CHECKOUT", "COREPACK_ENABLE_NETWORK",
    "OPENAI_API_KEY", "JWT_SECRET_KEY", "FIXTURE_SHARED_ONLY", "FIXTURE_QUOTED",
    "FIXTURE_MULTILINE", "FIXTURE_EXPANDED", "FIXTURE_LITERAL", "FIXTURE_BACKTICK",
)


def _record(name: str, args: Sequence[str]) -> None:
    """Record only the whitelisted synthetic child environment in a fixture file."""
    with Path(os.environ["FIXTURE_LOG"]).open("a", encoding="utf-8") as output:
        output.write(json.dumps({
            "name": name, "args": list(args), "cwd": os.getcwd(),
            "env": {key: os.environ[key] for key in CONFIG_KEYS if key in os.environ},
        }) + "\n")


def _forbid_storage(*args: object, **kwargs: object) -> None:
    raise AssertionError("The environment loader must not write storage")


class _EmptyKeychain:
    def get_credential(self, key: str) -> None:
        return None


def _fake_keychain() -> _EmptyKeychain:
    _record("keychain-double", [])
    return _EmptyKeychain()


def _install_loader_boundaries() -> None:
    """Keep the actual loader/resolver, replacing their external I/O boundaries."""
    safe_io = ModuleType("backend.utils.safe_io")
    safe_io.__dict__["safe_write_text"] = _forbid_storage
    sys.modules[safe_io.__name__] = safe_io
    keychain = ModuleType("backend.security.keychain_manager")
    keychain.__dict__["get_keychain"] = _fake_keychain
    sys.modules[keychain.__name__] = keychain


def _fake_git(args: list[str]) -> int:
    assert args[:2] == ["-C", os.environ["FIXTURE_REPO"]]
    command = args[2:]
    mode = os.environ.get("FIXTURE_GIT", "current")
    branch = "" if mode == "detached" else "codex/native-fixture"
    if mode == "unavailable":
        return 128
    answers = {
        ("rev-parse", "--show-toplevel"): os.environ["FIXTURE_REPO"],
        ("rev-parse", "HEAD"): "fixture-head",
        ("branch", "--show-current"): branch,
        ("rev-parse", "refs/remotes/origin/main"): (
            "fixture-main" if mode in {"stale", "unpublished"} else "fixture-head"
        ),
        ("rev-parse", "--short", "HEAD"): "abc1234",
    }
    answer = answers.get(tuple(command))
    if answer is not None:
        sys.stdout.write(answer + "\n")
        return 0
    if command == ["show-ref", "--verify", "--quiet", f"refs/remotes/origin/{branch}"]:
        return 1 if mode in {"unpublished", "detached"} else 0
    if command == ["merge-base", "--is-ancestor", "fixture-head", "fixture-main"]:
        return 0
    raise AssertionError("Unexpected or mutating Git operation")


def _fake_main() -> int:
    """Run as the executable double; unknown operational calls always fail."""
    name = Path(sys.argv[0]).stem
    args = sys.argv[1:]
    _record(name, args)
    if name == "git":
        return _fake_git(args)
    if name == "uv":
        assert args[:7] == [
            "run", "--project", os.environ["FIXTURE_REPO"],
            "--frozen", "--no-sync", "python", "-",
        ]
        code = int(os.environ.get("FIXTURE_UV_EXIT", "0"))
        if code:
            return code
        source = sys.stdin.read()
        _install_loader_boundaries()
        # The only importable backend is a copy of the three public config files.
        sys.path.insert(0, os.environ["FIXTURE_REPO"])
        sys.argv = ["-", *args[7:]]
        exec(compile(source, "<native-wrapper>", "exec"), {"__name__": "__main__"})
        raise AssertionError("The backend wrapper must replace itself")
    if name == "uvicorn":
        assert args[:1] == ["backend.server:app"]
        assert "backend.server" not in sys.modules
        return int(os.environ.get("FIXTURE_CHILD_EXIT", "0"))
    if name == "corepack":
        assert args[:4] == ["pnpm", "--filter", "@gnosi/frontend", "dev"]
        assert os.environ["COREPACK_ENABLE_NETWORK"] == "0"
        return int(os.environ.get("FIXTURE_CHILD_EXIT", "0"))
    raise AssertionError("Forbidden operational executable")


@dataclass(frozen=True)
class Call:
    name: str
    args: list[str]
    cwd: str
    env: dict[str, str]


@dataclass(frozen=True)
class Harness:
    root: Path
    repo: Path
    bin_dir: Path
    log: Path

    def run(self, script: str, *args: str, **settings: str) -> subprocess.CompletedProcess[str]:
        # No host environment, credential files, Python paths or executable fallback.
        env = {
            "PATH": str(self.bin_dir), "HOME": str(self.root / "home"), "LC_ALL": "C",
            "TMPDIR": str(self.root), "PYTHONDONTWRITEBYTECODE": "1",
            "FIXTURE_LOG": str(self.log), "FIXTURE_REPO": str(self.repo),
        }
        env.update(settings)
        return subprocess.run(
            ["/bin/bash", str(self.repo / "scripts/runtime" / script), *args],
            cwd=self.root, env=env, text=True, capture_output=True, timeout=20, check=False,
        )

    def calls(self, name: str | None = None) -> list[Call]:
        calls: list[Call] = []
        if not self.log.exists():
            return calls
        for line in self.log.read_text(encoding="utf-8").splitlines():
            raw: object = json.loads(line)
            assert isinstance(raw, dict)
            command, args, cwd, env = (raw[key] for key in ("name", "args", "cwd", "env"))
            assert isinstance(command, str) and isinstance(cwd, str)
            assert isinstance(args, list) and isinstance(env, dict)
            arguments: list[str] = []
            for arg in args:
                assert isinstance(arg, str)
                arguments.append(arg)
            environment: dict[str, str] = {}
            for key, value in env.items():
                assert isinstance(key, str) and isinstance(value, str)
                environment[key] = value
            if name is None or command == name:
                calls.append(Call(command, arguments, cwd, environment))
        return calls

    def child(self, name: str) -> Call:
        calls = self.calls(name)
        assert len(calls) == 1
        assert calls[0].cwd == str(self.repo)
        return calls[0]


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    repo = tmp_path / "checkout with spaces"
    scripts = repo / "scripts/runtime"
    scripts.mkdir(parents=True)
    for script in (BACKEND, FRONTEND):
        shutil.copyfile(REPO / "scripts/runtime" / script, scripts / script)
    for package in ("backend", "backend/config", "backend/utils", "backend/security"):
        target = repo / package
        target.mkdir(exist_ok=True)
        (target / "__init__.py").write_text("", encoding="utf-8")
    for module in ("env_config.py", "data_dir.py", "validation_runtime.py"):
        shutil.copyfile(REPO / "backend/config" / module, repo / "backend/config" / module)
    (repo / "pyproject.toml").write_text("# Synthetic root project\n", encoding="utf-8")
    (repo / "uv.lock").write_text("# Synthetic root lock\n", encoding="utf-8")
    (repo / "package.json").write_text('{"packageManager":"pnpm@11.19.0"}', encoding="utf-8")
    (tmp_path / "home").mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    dirname = shutil.which("dirname")
    assert dirname is not None
    (bin_dir / "dirname").symlink_to(dirname)
    # Reuse this typed module for every executable; no untyped fake program strings.
    source = Path(__file__).read_text(encoding="utf-8")
    for name in (
        "uv", "corepack", "git", "python", "python3", "pnpm", "npm", "npx", "node",
        "docker", "curl", "uvicorn", "launchctl", "kill", "lsof", "open", "touch",
    ):
        executable = bin_dir / name
        executable.write_text(f"#!{sys.executable}\n{source}", encoding="utf-8")
        executable.chmod(0o755)
    (repo / "uvicorn.py").write_text(source, encoding="utf-8")
    return Harness(tmp_path, repo, bin_dir, tmp_path / "calls.jsonl")


def test_backend_root_frozen_defaults_without_host_assumptions(harness: Harness) -> None:
    result = harness.run(BACKEND)
    assert result.returncode == 0, result.stderr
    uv = harness.child("uv")
    assert uv.args == [
        "run", "--project", str(harness.repo), "--frozen", "--no-sync", "python", "-", "5002",
    ]
    child = harness.child("uvicorn")
    assert child.args == [
        "backend.server:app", "--host", "127.0.0.1", "--port", "5002",
        "--reload", "--reload-dir", "backend",
    ]
    expected = (Path("/data") if Path("/.dockerenv").exists() else
                harness.root / "home" / ("Library/Application Support/Gnosi"
                                        if sys.platform == "darwin" else ".local/share/gnosi"))
    assert child.env == {"GNOSI_DATA_DIR": str(expected), "PYTHONUNBUFFERED": "1"}
    assert not (harness.root / "home/Library").exists()
    assert not (harness.root / "home/.local").exists()
    assert result.stdout == ""


@pytest.mark.parametrize("port", ["1", "65535", "05002"])
def test_backend_port_bounds_and_argument_boundaries(harness: Harness, port: str) -> None:
    arguments = ["--log-config", "configuration with spaces.json", "--header", "X-Note: a=b"]
    result = harness.run(BACKEND, port, *arguments)
    assert result.returncode == 0, result.stderr
    child = harness.child("uvicorn")
    assert child.args[child.args.index("--port") + 1] == str(int(port))
    assert child.args[-len(arguments):] == arguments


@pytest.mark.parametrize("port", INVALID_PORTS)
def test_backend_invalid_ports_fail_before_tools(harness: Harness, port: str) -> None:
    result = harness.run(BACKEND, port)
    assert result.returncode == 2
    assert "integer between 1 and 65535" in result.stderr
    assert harness.calls() == []


@pytest.mark.parametrize("alias", ["GNOSI_DATA_DIR", "GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR"])
@pytest.mark.parametrize("source", ["process", "local", "shared"])
def test_backend_data_aliases_use_python_resolver(
    harness: Harness, alias: str, source: str,
) -> None:
    configured = "data with spaces"
    settings: dict[str, str] = {}
    if source == "process":
        settings[alias] = configured
    else:
        file = harness.repo / (".env" if source == "local" else "shared fixture.env")
        file.write_text(f'export {alias}="{configured}"\n', encoding="utf-8")
        if source == "shared":
            settings["GNOSI_SHARED_ENV_FILE"] = file.name
    result = harness.run(BACKEND, **settings)
    assert result.returncode == 0, result.stderr
    child = harness.child("uvicorn")
    expected = configured if alias == "GNOSI_DATA_DIR" else str(harness.repo / configured)
    assert child.env["GNOSI_DATA_DIR"] == expected
    assert child.env[alias] == configured
    assert not (harness.repo / configured).exists()
    assert ("deprecated" in result.stderr) == (alias != "GNOSI_DATA_DIR")


def test_backend_canonical_and_legacy_alias_priority(harness: Harness) -> None:
    result = harness.run(
        BACKEND, GNOSI_DATA_DIR="canonical", GNOSI_LOCAL_DATA="legacy", LOCAL_DATA_DIR="oldest",
    )
    assert result.returncode == 0, result.stderr
    env = harness.child("uvicorn").env
    assert env["GNOSI_DATA_DIR"] == "canonical"
    assert env["GNOSI_LOCAL_DATA"] == "legacy"
    assert env["LOCAL_DATA_DIR"] == "oldest"
    assert "deprecated" not in result.stderr


def test_backend_empty_canonical_uses_legacy_alias_order(harness: Harness) -> None:
    result = harness.run(
        BACKEND, GNOSI_DATA_DIR="", GNOSI_LOCAL_DATA="legacy", LOCAL_DATA_DIR="oldest",
    )
    assert result.returncode == 0, result.stderr
    env = harness.child("uvicorn").env
    assert env["GNOSI_DATA_DIR"] == str(harness.repo / "legacy")
    assert env["LOCAL_DATA_DIR"] == "oldest"


@pytest.mark.parametrize("script", [BACKEND, FRONTEND])
def test_explicit_process_configuration_is_not_replaced(harness: Harness, script: str) -> None:
    settings = {
        "GNOSI_DATA_DIR": "explicit data", "GNOSI_LOCAL_DATA": "explicit legacy",
        "LOCAL_DATA_DIR": "explicit oldest", "DIGITAL_BRAIN_VAULT_PATH": "explicit vault",
        "VAULT_HOST_PATH": "different vault", "HOME_HOST_PATH": "explicit home",
        "AI_PROVIDER": "explicit-provider", "AI_MODEL_URL": "http://model.invalid/path",
        "OLLAMA_BASE_URL": "http://ollama.invalid", "TRANSLATION_SERVER_URL": "",
        "TZ": "Pacific/Auckland", "ONEDRIVE_WARMUP_MODE": "direct",
        "PYTHONPATH": str(harness.root / "unused python path"), "PYTHONUNBUFFERED": "0",
        "OPENAI_API_KEY": "synthetic-sensitive-api-value",
        "JWT_SECRET_KEY": "synthetic-sensitive-jwt-value",
    }
    (harness.repo / ".env").write_text(
        "\n".join(f'{key}="file default"' for key in settings), encoding="utf-8",
    )
    result = harness.run(script, **settings)
    assert result.returncode == 0, result.stderr
    child = harness.child("uvicorn" if script == BACKEND else "corepack")
    for key, expected in settings.items():
        assert child.env[key] == expected
        if expected:
            assert expected not in result.stdout + result.stderr


def test_python_dotenv_precedence_quotes_exports_and_literal_shell(harness: Harness) -> None:
    (harness.repo / "shared fixture.env").write_text(
        'TZ="shared timezone"\nAI_PROVIDER=shared-provider\n'
        'FIXTURE_SHARED_ONLY="shared value"\n', encoding="utf-8",
    )
    marker = harness.root / "must not execute"
    literal = f"$(touch '{marker}')"
    backtick = f"`touch '{marker}'`"
    (harness.repo / ".env").write_text(
        'export TZ="local timezone"\nexport AI_PROVIDER="local provider"\n'
        'FIXTURE_QUOTED="value # with = signs" # outside comment\n'
        'FIXTURE_MULTILINE="first\nsecond"\n'
        'FIXTURE_EXPANDED="${FIXTURE_SHARED_ONLY}/expanded"\n'
        f'FIXTURE_LITERAL="{literal}"\nFIXTURE_BACKTICK="{backtick}"\n'
        'export OPENAI_API_KEY="synthetic-sensitive-file-value"\n', encoding="utf-8",
    )
    result = harness.run(
        BACKEND, GNOSI_SHARED_ENV_FILE="shared fixture.env", AI_PROVIDER="process provider",
    )
    assert result.returncode == 0, result.stderr
    env = harness.child("uvicorn").env
    assert env["TZ"] == "local timezone"
    assert env["AI_PROVIDER"] == "process provider"
    assert env["FIXTURE_SHARED_ONLY"] == "shared value"
    assert env["FIXTURE_QUOTED"] == "value # with = signs"
    assert env["FIXTURE_MULTILINE"] == "first\nsecond"
    # The canonical loader parses files separately, before merging their values.
    assert env["FIXTURE_EXPANDED"] == "/expanded"
    assert env["FIXTURE_LITERAL"] == literal
    assert env["FIXTURE_BACKTICK"] == backtick
    assert env["OPENAI_API_KEY"] == "synthetic-sensitive-file-value"
    assert not marker.exists()
    assert result.stdout == result.stderr == ""


def test_shared_file_is_never_inferred_from_parent_directory(harness: Harness) -> None:
    (harness.root / ".env_shared").write_text("AI_PROVIDER=must-not-load\n", encoding="utf-8")
    result = harness.run(BACKEND)
    assert result.returncode == 0, result.stderr
    assert "AI_PROVIDER" not in harness.child("uvicorn").env


def test_loader_failure_does_not_start_backend_or_fall_back(harness: Harness) -> None:
    result = harness.run(BACKEND, GNOSI_VALIDATION_ROOT="invalid-relative-root")
    assert result.returncode == 1
    assert "GNOSI_VALIDATION_ROOT" in result.stderr
    assert [call.name for call in harness.calls()] == ["uv"]


@pytest.mark.parametrize("code", [1, 23, 127])
def test_frozen_toolchain_failure_is_propagated(harness: Harness, code: int) -> None:
    result = harness.run(BACKEND, FIXTURE_UV_EXIT=str(code))
    assert result.returncode == code
    assert [call.name for call in harness.calls()] == ["uv"]


@pytest.mark.parametrize("script", [BACKEND, FRONTEND])
@pytest.mark.parametrize("code", [0, 1, 37, 130, 143])
def test_child_exit_status_is_preserved(harness: Harness, script: str, code: int) -> None:
    result = harness.run(script, FIXTURE_CHILD_EXIT=str(code))
    assert result.returncode == code, result.stderr
    assert len(harness.calls("uvicorn" if script == BACKEND else "corepack")) == 1


def test_frontend_root_arguments_and_checkout_label(harness: Harness) -> None:
    arguments = ["--host", "127.0.0.1", "--base", "/fixture with spaces/"]
    result = harness.run(FRONTEND, *arguments)
    assert result.returncode == 0, result.stderr
    child = harness.child("corepack")
    assert child.args == ["pnpm", "--filter", "@gnosi/frontend", "dev", *arguments]
    assert child.env == {
        "VITE_BACKEND_HOST": "localhost", "VITE_BACKEND_PORT": "5002",
        "COREPACK_ENABLE_NETWORK": "0",
        "VITE_GNOSI_CHECKOUT_LABEL": "codex/native-fixture@abc1234",
        "VITE_GNOSI_STALE_CHECKOUT": "0",
    }


@pytest.mark.parametrize("mode", ["current", "stale", "detached", "unpublished", "unavailable"])
def test_frontend_git_metadata_is_optional_and_read_only(harness: Harness, mode: str) -> None:
    result = harness.run(FRONTEND, FIXTURE_GIT=mode)
    assert result.returncode == 0, result.stderr
    env = harness.child("corepack").env
    if mode == "unavailable":
        assert "VITE_GNOSI_CHECKOUT_LABEL" not in env
        assert "VITE_GNOSI_STALE_CHECKOUT" not in env
    else:
        branch = "detached" if mode == "detached" else "codex/native-fixture"
        assert env["VITE_GNOSI_CHECKOUT_LABEL"] == f"{branch}@abc1234"
        assert env["VITE_GNOSI_STALE_CHECKOUT"] == ("1" if mode == "stale" else "0")
    assert ("behind origin/main" in result.stdout) == (mode == "stale")


def test_frontend_preserves_explicit_ports_label_and_metadata(harness: Harness) -> None:
    settings = {
        "VITE_BACKEND_HOST": "backend.invalid", "VITE_BACKEND_PORT": "65535",
        "VITE_FRONTEND_PORT": "1", "VITE_GNOSI_CHECKOUT_LABEL": "synthetic-sensitive-label",
        "VITE_GNOSI_STALE_CHECKOUT": "0",
    }
    result = harness.run(FRONTEND, FIXTURE_GIT="stale", **settings)
    assert result.returncode == 0, result.stderr
    env = harness.child("corepack").env
    for key, value in settings.items():
        assert env[key] == value
    assert settings["VITE_GNOSI_CHECKOUT_LABEL"] not in result.stdout + result.stderr


@pytest.mark.parametrize("key", ["VITE_BACKEND_PORT", "VITE_FRONTEND_PORT"])
@pytest.mark.parametrize("port", INVALID_PORTS)
def test_frontend_invalid_environment_ports_fail_before_tools(
    harness: Harness, key: str, port: str,
) -> None:
    result = harness.run(FRONTEND, **{key: port})
    assert result.returncode == 2
    assert f"{key} must be an integer between 1 and 65535" in result.stderr
    assert harness.calls() == []


def test_frontend_never_evaluates_dotenv_shell(harness: Harness) -> None:
    (harness.repo / ".env").write_text(
        'export VITE_BACKEND_PORT="$(exit 88)"\n'
        'export VITE_GNOSI_CHECKOUT_LABEL="synthetic-sensitive-file-label"\n', encoding="utf-8",
    )
    result = harness.run(FRONTEND)
    assert result.returncode == 0, result.stderr
    env = harness.child("corepack").env
    assert env["VITE_BACKEND_PORT"] == "5002"
    assert env["VITE_GNOSI_CHECKOUT_LABEL"] == "codex/native-fixture@abc1234"
    assert "synthetic-sensitive-file-label" not in result.stdout + result.stderr


def test_frontend_leaves_absent_port_to_vite_dotenv(harness: Harness) -> None:
    # Exporting a default here masks Vite's own file configuration. Keep it unset.
    frontend = harness.repo / "frontend"
    frontend.mkdir()
    dotenv = frontend / ".env"
    content = 'export VITE_FRONTEND_PORT="6200"\n'
    dotenv.write_text(content, encoding="utf-8")
    result = harness.run(FRONTEND)
    assert result.returncode == 0, result.stderr
    assert "VITE_FRONTEND_PORT" not in harness.child("corepack").env
    assert dotenv.read_text(encoding="utf-8") == content


@pytest.mark.parametrize("script", [BACKEND, FRONTEND])
@pytest.mark.parametrize("equals", [False, True])
@pytest.mark.parametrize("port", ["6400", "0", "65536", "$(exit 88)", ""])
def test_forwarded_port_options_are_validated_without_rewriting(
    harness: Harness, script: str, equals: bool, port: str,
) -> None:
    prefix = ["5002"] if script == BACKEND else []
    options = [f"--port={port}"] if equals else ["--port", port]
    result = harness.run(script, *prefix, *options)
    if port == "6400":
        assert result.returncode == 0, result.stderr
        child = harness.child("uvicorn" if script == BACKEND else "corepack")
        assert child.args[-len(options):] == options
    else:
        assert result.returncode == 2
        assert "integer between 1 and 65535" in result.stderr
        assert harness.calls() == []


@pytest.mark.parametrize("script", [BACKEND, FRONTEND])
def test_forwarded_port_option_requires_a_value(harness: Harness, script: str) -> None:
    prefix = ["5002"] if script == BACKEND else []
    result = harness.run(script, *prefix, "--port")
    assert result.returncode == 2
    assert harness.calls() == []


@pytest.mark.parametrize(("script", "tool"), [(BACKEND, "uv"), (FRONTEND, "corepack")])
def test_missing_tool_does_not_install_or_fall_back(
    harness: Harness, script: str, tool: str,
) -> None:
    # Only the fixture executable is removed, never an installed host tool.
    (harness.bin_dir / tool).unlink()
    result = harness.run(script)
    assert result.returncode == 127
    assert "not found" in result.stderr
    assert all(call.name == "git" for call in harness.calls())


if __name__ == "__main__":
    raise SystemExit(_fake_main())
