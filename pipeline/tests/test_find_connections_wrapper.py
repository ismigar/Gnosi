"""Test the connection launcher offline using only synthetic executable doubles.

Never import the real backend or inherit host credentials, vaults or executables.
The uv double executes the actual inline Python against a synthetic action module.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
WRAPPER = Path("scripts/runtime/find_connections.sh")
REPORT: dict[str, object] = {
    "indexes": {"title": "Connexions sintètiques"},
    "lint": {"issues": []},
    "suggestions_queued": 2,
    "suggestions_pending": 3,
}


def _record(name: str, args: list[str]) -> None:
    with Path(os.environ["FIXTURE_LOG"]).open("a", encoding="utf-8") as output:
        output.write(json.dumps({"name": name, "args": args, "cwd": os.getcwd()}) + "\n")


def run_maintenance(*, semantic: bool = False) -> dict[str, object]:
    """Synthetic action boundary: no application code or providers are loaded."""
    _record("run_maintenance", [f"semantic={semantic}"])
    assert semantic is True
    if os.environ.get("FIXTURE_MAINTENANCE_ERROR"):
        raise RuntimeError("Synthetic maintenance failure")
    if "FIXTURE_MAINTENANCE_EXIT" in os.environ:
        raise SystemExit(int(os.environ["FIXTURE_MAINTENANCE_EXIT"]))
    return REPORT


def _fake_main() -> int:
    """Unknown executable calls fail instead of falling back to host tools."""
    name = Path(sys.argv[0]).name
    args = sys.argv[1:]
    _record(name, args)
    if name == "dirname":
        assert len(args) == 2 and args[0] == "--"
        code = int(os.environ.get("FIXTURE_DIRNAME_EXIT", "0"))
        if code:
            return code
        directory = os.environ.get("FIXTURE_SCRIPT_DIR", str(Path(args[1]).parent))
        sys.stdout.write(directory + "\n")
        return 0
    if name == "uv":
        assert len(args) == 8
        assert args[:7] == [
            "run", "--project", os.environ["FIXTURE_REPO"],
            "--frozen", "--no-sync", "python", "-c",
        ]
        assert os.getcwd() == os.environ["FIXTURE_REPO"]
        code = int(os.environ.get("FIXTURE_UV_EXIT", "0"))
        if code:
            sys.stderr.write("Synthetic uv failure\n")
            return code
        # -I excludes the real checkout and user paths. Only this fixture backend
        # is made importable; the real action source is never copied or executed.
        sys.path.insert(0, os.environ["FIXTURE_REPO"])
        sys.argv = ["-c"]
        exec(compile(args[7], "<find_connections>", "exec"), {"__name__": "__main__"})
        return 0
    raise AssertionError(f"Forbidden operational executable: {name}")


@dataclass(frozen=True)
class Call:
    name: str
    args: list[str]
    cwd: str


@dataclass(frozen=True)
class Harness:
    root: Path
    repo: Path
    bin_dir: Path
    log: Path

    def run(self, *, relative: bool = False, **settings: str) -> subprocess.CompletedProcess[str]:
        # Do not copy os.environ: even a provider key or Python path is out of scope.
        env = {
            "PATH": str(self.bin_dir),
            "HOME": str(self.root / "home"),
            "TMPDIR": str(self.root),
            "LC_ALL": "C",
            "FIXTURE_REPO": str(self.repo),
            "FIXTURE_LOG": str(self.log),
        }
        env.update(settings)
        script = self.repo / WRAPPER
        argument = os.path.relpath(script, self.root) if relative else str(script)
        return subprocess.run(
            ["/bin/bash", argument], cwd=self.root, env=env,
            capture_output=True, text=True, timeout=10, check=False,
        )

    def calls(self) -> list[Call]:
        calls: list[Call] = []
        if not self.log.exists():
            return calls
        for line in self.log.read_text(encoding="utf-8").splitlines():
            raw: object = json.loads(line)
            assert isinstance(raw, dict)
            name, args, cwd = (raw[key] for key in ("name", "args", "cwd"))
            assert isinstance(name, str) and isinstance(cwd, str)
            assert isinstance(args, list)
            arguments: list[str] = []
            for arg in args:
                assert isinstance(arg, str)
                arguments.append(arg)
            calls.append(Call(name, arguments, cwd))
        return calls


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    repo = tmp_path / "checkout with spaces"
    script = repo / WRAPPER
    script.parent.mkdir(parents=True)
    shutil.copyfile(REPO / WRAPPER, script)
    source = Path(__file__).read_text(encoding="utf-8")
    for package in (repo / "backend", repo / "backend/services"):
        package.mkdir()
        (package / "__init__.py").write_text("", encoding="utf-8")
    (repo / "backend/services/llm_wiki_actions.py").write_text(source, encoding="utf-8")
    for directory in (repo, tmp_path):
        (directory / "pyproject.toml").write_text("# Synthetic project\n", encoding="utf-8")
        (directory / "uv.lock").write_text("# Synthetic lock\n", encoding="utf-8")
    (tmp_path / "home").mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("dirname", "uv", "python", "python3", "pip", "git", "curl", "docker"):
        executable = bin_dir / name
        executable.write_text(
            f"#!{sys.executable} -IB\n{source}",
            encoding="utf-8",
        )
        executable.chmod(0o755)
    return Harness(tmp_path, repo, bin_dir, tmp_path / "calls.jsonl")


@pytest.mark.parametrize("relative", [False, True])
def test_root_frozen_runtime_and_canonical_semantic_report(
    harness: Harness, relative: bool,
) -> None:
    # CDPATH must not redirect a relative invocation to a different checkout.
    decoy = harness.root / "decoy"
    (decoy / harness.repo.name / "scripts/runtime").mkdir(parents=True)
    result = harness.run(relative=relative, CDPATH=str(decoy))
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    calls = harness.calls()
    assert [call.name for call in calls] == ["dirname", "uv", "run_maintenance"]
    uv, action = calls[1:]
    assert uv.cwd == action.cwd == str(harness.repo)
    assert uv.args[:7] == [
        "run", "--project", str(harness.repo), "--frozen", "--no-sync", "python", "-c",
    ]
    assert action.args == ["semantic=True"]
    assert json.loads(result.stdout.splitlines()[-1]) == REPORT
    assert "Connexions sintètiques" in result.stdout


@pytest.mark.parametrize("code", [1, 23, 127, 130, 143])
def test_uv_failure_is_preserved_without_fallback(harness: Harness, code: int) -> None:
    result = harness.run(FIXTURE_UV_EXIT=str(code))
    assert result.returncode == code
    assert result.stderr == "Synthetic uv failure\n"
    assert [call.name for call in harness.calls()] == ["dirname", "uv"]


@pytest.mark.parametrize("code", [1, 37, 130, 143])
def test_maintenance_exit_code_is_preserved(harness: Harness, code: int) -> None:
    result = harness.run(FIXTURE_MAINTENANCE_EXIT=str(code))
    assert result.returncode == code, result.stderr
    assert [call.name for call in harness.calls()] == ["dirname", "uv", "run_maintenance"]
    assert "suggestions_queued" not in result.stdout


def test_maintenance_exception_is_not_reported_as_success(harness: Harness) -> None:
    result = harness.run(FIXTURE_MAINTENANCE_ERROR="1")
    assert result.returncode == 1
    assert "RuntimeError: Synthetic maintenance failure" in result.stderr
    assert [call.name for call in harness.calls()] == ["dirname", "uv", "run_maintenance"]
    assert "suggestions_queued" not in result.stdout


def test_missing_uv_does_not_install_or_use_host_python(harness: Harness) -> None:
    (harness.bin_dir / "uv").unlink()
    result = harness.run()
    assert result.returncode == 127
    assert "not found" in result.stderr
    assert [call.name for call in harness.calls()] == ["dirname"]


def test_import_failure_is_not_hidden(harness: Harness) -> None:
    (harness.repo / "backend/services/llm_wiki_actions.py").unlink()
    result = harness.run()
    assert result.returncode == 1
    assert "ModuleNotFoundError" in result.stderr
    assert [call.name for call in harness.calls()] == ["dirname", "uv"]


def test_dirname_failure_stops_before_uv(harness: Harness) -> None:
    result = harness.run(FIXTURE_DIRNAME_EXIT="23")
    assert result.returncode == 23
    assert [call.name for call in harness.calls()] == ["dirname"]


def test_invalid_root_stops_before_uv(harness: Harness) -> None:
    result = harness.run(FIXTURE_SCRIPT_DIR=str(harness.root / "missing/scripts/runtime"))
    assert result.returncode != 0
    assert "No such file or directory" in result.stderr
    assert [call.name for call in harness.calls()] == ["dirname"]


if __name__ == "__main__":
    raise SystemExit(_fake_main())
