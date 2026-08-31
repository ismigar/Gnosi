"""Execute E2E wrappers with isolated command doubles; never contact live services."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/playwright_e2e/scripts"
SMOKE = "run_smoke.sh"
LINUX = "generate_linux_baselines.sh"
GUARD = "test.skip(process.platform !== 'darwin', 'Visual baselines are recorded on macOS only.');"
INPUTS = (
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".node-version",
    "frontend/package.json",
    "desktop/package.json",
    "tests/e2e/package.json",
    "scripts/verify-toolchain.mjs",
    "patches/emscripten-wasm-loader@3.0.3.patch",
    "tests/e2e/playwright.config.ts",
    "tests/e2e/tests/setup/auth.setup.ts",
    "tests/e2e/tests/visual/regression.spec.ts",
)
SNAPSHOTS = tuple(
    f"{route}-{viewport}-visual-linux.png"
    for route in ("home", "vault", "calendar", "contacts")
    for viewport in ("desktop", "mobile")
)

# All potentially operational executables are doubles. Docker runs the actual
# embedded shell against fixture directories, using the same fake curl/pnpm/node.
# Its child inherits only the synthetic environment assembled by Harness.run.
FAKE_EXECUTABLE = r"""
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

name = Path(sys.argv[0]).name
args = sys.argv[1:]
with Path(os.environ["FIXTURE_LOG"]).open("a", encoding="utf-8") as log:
    log.write(json.dumps({"name": name, "args": args, "cwd": os.getcwd(),
                          "base_url": os.environ.get("GNOSI_BASE_URL", "")}) + "\n")

if name == "curl":
    status = os.environ.get("FIXTURE_HTTP_STATUS", "200")
    if "FIXTURE_REDIRECT_STATUS" in os.environ:
        status = os.environ["FIXTURE_REDIRECT_STATUS"] if "--location" in args else "302"
    code = int(os.environ.get("FIXTURE_CURL_EXIT", "0"))
    if "--fail" in args and status.isdigit() and int(status) >= 400:
        code = code or 22
    if os.environ.get("FIXTURE_SELF_SIGNED") == "1" and "--insecure" not in args:
        code = 60
    sys.stdout.write(status)
    sys.exit(code)

if name == "node":
    if args == ["--version"]:
        sys.stdout.write(os.environ.get("FIXTURE_NODE_VERSION", "v22.22.2"))
    else:
        assert args == ["scripts/verify-toolchain.mjs"]
        assert os.environ.get("FIXTURE_CONTEXT") == "container"
        assert Path(args[0]).is_file()
    sys.exit(0)

if name == "pnpm":
    if args == ["--version"]:
        sys.stdout.write(os.environ.get("FIXTURE_PNPM_VERSION", "11.19.0"))
        sys.exit(0)
    if args and args[0] == "install":
        assert os.environ.get("FIXTURE_CONTEXT") == "container"
        assert args == ["install", "--frozen-lockfile", "--ignore-scripts"]
        assert Path("pnpm-lock.yaml").is_file()
        Path("node_modules").mkdir()
        Path("node_modules/container-only").write_text("synthetic installation")
        if os.environ.get("FIXTURE_MUTATE_LOCK") == "1":
            Path("pnpm-lock.yaml").write_text("unexpected lock change")
        sys.exit(int(os.environ.get("FIXTURE_INSTALL_EXIT", "0")))
    if os.environ.get("FIXTURE_CONTEXT") == "container":
        assert args == ["--filter", "@gnosi/e2e", "exec", "playwright", "test",
                        "--project=visual", "--update-snapshots", "--workers=1", "--retries=0"]
        spec = Path("tests/e2e/tests/visual/regression.spec.ts")
        assert "test.skip(" not in spec.read_text()
        assert "fixture test body" in spec.read_text()
        output = spec.parent / "regression.spec.ts-snapshots"
        output.mkdir()
        mode = os.environ.get("FIXTURE_SNAPSHOTS", "complete")
        for route in ("home", "vault", "calendar", "contacts"):
            for viewport in ("desktop", "mobile"):
                target = output / f"{route}-{viewport}-visual-linux.png"
                if mode == "empty" or (mode == "missing" and route == "contacts"):
                    continue
                if mode == "symlink":
                    target.symlink_to(spec)
                else:
                    target.write_bytes(b"bad" if mode == "invalid" else b"\x89PNG\r\n\x1a\nfixture")
        (output / "unexpected-linux.png").write_bytes(b"must not export")
        (output / "home-desktop-visual-darwin.png").write_bytes(b"must not export")
        (output / "session.json").write_bytes(b"must not export")
    else:
        assert args == ["exec", "playwright", "test", "--project=chromium-anon", "--workers=1"]
    sys.stdout.write("fixture Playwright stdout\n")
    sys.stderr.write("fixture Playwright stderr\n")
    sys.exit(int(os.environ.get("FIXTURE_PLAYWRIGHT_EXIT", "0")))

if name == "docker":
    assert args[0] == "run" and "--pull=never" in args and "--rm" in args
    assert "--entrypoint" in args and args[-2:] == ["fixture-image:local", "-s"]
    assert "-i" in args
    mounts = [args[i + 1] for i, arg in enumerate(args) if arg == "--mount"]
    assert len(mounts) == 2
    source_mount, export_mount = mounts
    assert source_mount.endswith(",dst=/source,readonly")
    assert export_mount.endswith(",dst=/export")
    source = Path(source_mount.split(",src=", 1)[1].split(",dst=", 1)[0])
    export = Path(export_mount.split(",src=", 1)[1].split(",dst=", 1)[0])
    assert source != Path(os.environ["FIXTURE_REPO"])
    inventory = sorted(str(p.relative_to(source)) for p in source.rglob("*") if p.is_file())
    Path(os.environ["FIXTURE_INVENTORY"]).write_text(json.dumps(inventory))
    script = sys.stdin.read()
    Path(os.environ["FIXTURE_SCRIPT"]).write_text(script)
    if "FIXTURE_DOCKER_EXIT" in os.environ:
        sys.exit(int(os.environ["FIXTURE_DOCKER_EXIT"]))
    child_env = dict(os.environ)
    for i, arg in enumerate(args):
        if arg == "--env":
            key, value = args[i + 1].split("=", 1)
            child_env[key] = value
    child_env["FIXTURE_CONTEXT"] = "container"
    child_env["FIXTURE_EXPORT"] = str(export)
    scratch = Path(os.environ["FIXTURE_TEMP"]) / "container"
    scratch.mkdir(exist_ok=True)
    script = script.replace("/source/", shlex.quote(str(source)) + "/")
    script = script.replace('"/export/$FILE"', '"${FIXTURE_EXPORT}/$FILE"')
    script = script.replace("/tmp/gnosi-linux-work.XXXXXXXX",
                            shlex.quote(str(scratch / "work.XXXXXXXX")))
    result = subprocess.run(["/bin/bash", "-s"], input=script, text=True,
                            env=child_env, cwd=scratch, check=False, timeout=10)
    if result.returncode == 0 and os.environ.get("FIXTURE_EXPORT_CORRUPT") == "1":
        (export / "contacts-mobile-visual-linux.png").unlink()
    sys.exit(result.returncode)

raise AssertionError(f"Forbidden operational call: {name} {args}")
"""


@dataclass(frozen=True)
class Call:
    name: str
    args: list[str]
    cwd: str
    base_url: str


@dataclass(frozen=True)
class Harness:
    root: Path
    repo: Path
    bin_dir: Path
    temporary: Path
    log: Path

    @property
    def output(self) -> Path:
        return self.root / "linux candidates"

    def run(self, script: str, *args: str, **settings: str) -> subprocess.CompletedProcess[str]:
        env = {
            "PATH": str(self.bin_dir),
            "LC_ALL": "C",
            "TMPDIR": str(self.temporary),
            "FIXTURE_TEMP": str(self.temporary),
            "FIXTURE_LOG": str(self.log),
            "FIXTURE_REPO": str(self.repo),
            "FIXTURE_INVENTORY": str(self.root / "inventory.json"),
            "FIXTURE_SCRIPT": str(self.root / "container.sh"),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        env.update(settings)
        return subprocess.run(
            [
                "/bin/bash",
                str(self.repo / "pipeline/skills/playwright_e2e/scripts" / script),
                *args,
            ],
            cwd=self.root,
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def linux(self, **settings: str) -> subprocess.CompletedProcess[str]:
        options = {
            "GNOSI_BASE_URL": "https://host.docker.internal:5173/path?fixture=1",
            "GNOSI_PLAYWRIGHT_IMAGE": "fixture-image:local",
        }
        options.update(settings)
        return self.run(LINUX, "--update-snapshots", "--output-dir", str(self.output), **options)

    def calls(self, name: str | None = None) -> list[Call]:
        calls: list[Call] = []
        if not self.log.exists():
            return calls
        for line in self.log.read_text(encoding="utf-8").splitlines():
            raw: object = json.loads(line)
            assert isinstance(raw, dict)
            command, args, cwd, base = (raw[k] for k in ("name", "args", "cwd", "base_url"))
            assert isinstance(command, str) and isinstance(cwd, str) and isinstance(base, str)
            assert isinstance(args, list)
            arguments: list[str] = []
            for arg in args:
                assert isinstance(arg, str)
                arguments.append(arg)
            if name is None or name == command:
                calls.append(Call(command, arguments, cwd, base))
        return calls


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    repo = tmp_path / "checkout with spaces"
    scripts = repo / "pipeline/skills/playwright_e2e/scripts"
    scripts.mkdir(parents=True)
    for name in (SMOKE, LINUX):
        shutil.copyfile(SCRIPTS / name, scripts / name)
    for relative in INPUTS:
        target = repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"fixture {relative}\n", encoding="utf-8")
    (repo / INPUTS[-1]).write_text(f"{GUARD}\n// fixture test body\n", encoding="utf-8")
    for relative in (
        "node_modules/host-dependency",
        "tests/e2e/node_modules/host-dependency",
        "tests/e2e/tests/.auth/state.json",
        "frontend/certs/localhost-key.pem",
        ".env",
        ".npmrc",
        "vault/private.md",
        "tests/e2e/tests/visual/regression.spec.ts-snapshots/home-desktop-visual-darwin.png",
    ):
        target = repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"fixture private sentinel; never stage or modify")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    # Restrict PATH to safe local file utilities and operational command doubles.
    for utility in (
        "dirname",
        "basename",
        "mkdir",
        "cp",
        "rm",
        "mktemp",
        "cmp",
        "awk",
        "mv",
        "od",
        "tr",
        "chmod",
        "bash",
    ):
        executable = shutil.which(utility)
        assert executable is not None, utility
        (bin_dir / utility).symlink_to(executable)
    for command in ("curl", "pnpm", "docker", "node", "corepack", "npm", "npx", "git", "uvicorn"):
        executable_path = bin_dir / command
        executable_path.write_text(f"#!{sys.executable}\n{FAKE_EXECUTABLE}", encoding="utf-8")
        executable_path.chmod(0o755)
    temporary = tmp_path / "temporary with spaces"
    temporary.mkdir()
    return Harness(tmp_path, repo, bin_dir, temporary, tmp_path / "calls.jsonl")


def assert_probe(call: Call, url: str) -> None:
    assert call.name == "curl"
    assert call.args[0] == "--disable"
    assert call.args[-1] == url
    for flag in ("--fail", "--location", "--insecure", "--globoff"):
        assert flag in call.args
    for flag, value in (
        ("--max-time", "3"),
        ("--max-redirs", "5"),
        ("--proto", "=http,https"),
        ("--proto-redir", "=http,https"),
        ("--output", "/dev/null"),
        ("--write-out", "%{http_code}"),
    ):
        assert call.args[call.args.index(flag) + 1] == value


@pytest.mark.parametrize("strict", [None, "0", "1"])
@pytest.mark.parametrize("status,code", [("000", "7"), ("200", "28"), ("503", "0")])
def test_smoke_unavailable_never_passes(
    harness: Harness, strict: str | None, status: str, code: str
) -> None:
    settings = {"FIXTURE_HTTP_STATUS": status, "FIXTURE_CURL_EXIT": code}
    if strict is not None:
        settings["STRICT"] = strict
    result = harness.run(SMOKE, **settings)
    assert result.returncode == 2
    assert "did not run" in result.stderr
    assert [call.name for call in harness.calls()] == ["curl"]


@pytest.mark.parametrize("status", ["100", "301", "302", "304", "404", "500", "200x", "200\n500"])
def test_smoke_rejects_nonfinal_or_error_responses(harness: Harness, status: str) -> None:
    assert harness.run(SMOKE, FIXTURE_HTTP_STATUS=status).returncode == 2
    assert not harness.calls("pnpm")


@pytest.mark.parametrize("code", [0, 1, 2, 42, 127, 130, 143])
def test_smoke_preserves_playwright_status_and_streams(harness: Harness, code: int) -> None:
    result = harness.run(SMOKE, FIXTURE_PLAYWRIGHT_EXIT=str(code))
    assert result.returncode == code
    assert "fixture Playwright stdout" in result.stdout
    assert "fixture Playwright stderr" in result.stderr
    assert [call.name for call in harness.calls()] == ["curl", "pnpm"]
    command = harness.calls("pnpm")[0]
    assert command.cwd == str(harness.repo / "tests/e2e")
    assert command.base_url == "http://localhost:5173"


@pytest.mark.parametrize("cert", [False, True])
@pytest.mark.parametrize(
    "override", [None, "", "http://127.0.0.1:8800/path?x=1", "https://[::1]:8443/"]
)
def test_smoke_url_and_certificate_policy(
    harness: Harness, cert: bool, override: str | None
) -> None:
    if cert:
        (harness.repo / "frontend/certs/localhost.pem").write_text("fixture certificate")
    default = "https://localhost:5173" if cert else "http://localhost:5173"
    settings = {"FIXTURE_SELF_SIGNED": "1"}
    if override is not None:
        settings["GNOSI_BASE_URL"] = override
    result = harness.run(SMOKE, **settings)
    assert result.returncode == 0, result.stderr
    base = override or default
    origin = base.split("/", 3)[:3]
    assert_probe(harness.calls("curl")[0], "/".join(origin) + "/")
    assert harness.calls("pnpm")[0].base_url == base


@pytest.mark.parametrize(
    "url",
    ["file:///fixture", "ftp://fixture", "--help", "http://", "http://a b", "http://u:p@host"],
)
def test_smoke_rejects_invalid_url_before_commands(harness: Harness, url: str) -> None:
    assert harness.run(SMOKE, GNOSI_BASE_URL=url).returncode == 2
    assert not harness.calls()


@pytest.mark.parametrize("final_status,expected", [("200", 0), ("404", 2), ("503", 2)])
def test_redirects_use_the_final_http_result(
    harness: Harness, final_status: str, expected: int
) -> None:
    result = harness.run(SMOKE, FIXTURE_REDIRECT_STATUS=final_status)
    assert result.returncode == expected
    assert_probe(harness.calls("curl")[0], "http://localhost:5173/")


def test_linux_requires_explicit_generation_and_inputs(harness: Harness) -> None:
    assert harness.run(LINUX).returncode == 2
    assert harness.run(LINUX, "--update-snapshots").returncode == 2
    assert (
        harness.run(LINUX, "--update-snapshots", "--output-dir", str(harness.output)).returncode
        == 2
    )
    assert harness.linux(GNOSI_BASE_URL="").returncode == 2
    assert harness.linux(GNOSI_PLAYWRIGHT_IMAGE="").returncode == 2
    assert not harness.calls()
    assert not harness.output.exists()


def repository_bytes(repo: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(repo)): path.read_bytes() for path in repo.rglob("*") if path.is_file()
    }


def test_linux_exports_only_reviewed_candidates_without_host_mutation(harness: Harness) -> None:
    before = repository_bytes(harness.repo)
    result = harness.linux(GNOSI_TEST_VAULT_ID="fixture-vault")
    assert result.returncode == 0, result.stdout + result.stderr
    assert sorted(path.name for path in harness.output.iterdir()) == sorted(SNAPSHOTS)
    assert all(
        path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n") for path in harness.output.iterdir()
    )
    assert repository_bytes(harness.repo) == before
    inventory: object = json.loads((harness.root / "inventory.json").read_text())
    assert inventory == sorted(INPUTS)
    calls = harness.calls()
    assert {call.name for call in calls} == {"docker", "curl", "pnpm", "node"}
    assert len(harness.calls("docker")) == 1
    assert_probe(harness.calls("curl")[0], "https://host.docker.internal:5173/")
    for call in calls:
        if call.name != "docker":
            assert not Path(call.cwd).is_relative_to(harness.repo)
    pnpm = harness.calls("pnpm")
    assert [call.args for call in pnpm[:2]] == [
        ["--version"],
        ["install", "--frozen-lockfile", "--ignore-scripts"],
    ]
    assert pnpm[-1].base_url == "https://host.docker.internal:5173/path?fixture=1"
    assert not list(harness.temporary.glob("gnosi-linux-baselines.*"))


@pytest.mark.parametrize("code", [1, 2, 42, 130, 143])
def test_linux_preserves_playwright_failure_without_export(harness: Harness, code: int) -> None:
    before = repository_bytes(harness.repo)
    result = harness.linux(FIXTURE_PLAYWRIGHT_EXIT=str(code))
    assert result.returncode == code
    assert not harness.output.exists()
    assert repository_bytes(harness.repo) == before
    assert not list(harness.temporary.glob("gnosi-linux-baselines.*"))


@pytest.mark.parametrize("mode", ["empty", "missing", "invalid", "symlink"])
def test_linux_success_requires_all_eight_regular_pngs(harness: Harness, mode: str) -> None:
    result = harness.linux(FIXTURE_SNAPSHOTS=mode)
    assert result.returncode == 2, result.stdout + result.stderr
    assert not harness.output.exists()


def test_linux_rechecks_outputs_after_container_success(harness: Harness) -> None:
    assert harness.linux(FIXTURE_EXPORT_CORRUPT="1").returncode == 2
    assert not harness.output.exists()


@pytest.mark.parametrize(
    "setting,value,expected",
    [
        ("FIXTURE_NODE_VERSION", "v24.1.0", 2),
        ("FIXTURE_PNPM_VERSION", "10.0.0", 2),
        ("FIXTURE_CURL_EXIT", "7", 2),
        ("FIXTURE_HTTP_STATUS", "404", 2),
        ("FIXTURE_HTTP_STATUS", "302", 2),
        ("FIXTURE_REDIRECT_STATUS", "500", 2),
        ("FIXTURE_INSTALL_EXIT", "45", 45),
        ("FIXTURE_MUTATE_LOCK", "1", 1),
        ("FIXTURE_DOCKER_EXIT", "125", 125),
    ],
)
def test_linux_preflight_and_install_errors_do_not_launch_tests(
    harness: Harness, setting: str, value: str, expected: int
) -> None:
    result = harness.linux(**{setting: value})
    assert result.returncode == expected, result.stdout + result.stderr
    assert not any("playwright" in call.args for call in harness.calls("pnpm"))
    assert not harness.output.exists()


@pytest.mark.parametrize("guard", ["// platform contract changed", f"{GUARD}\n{GUARD}"])
def test_linux_refuses_unknown_visual_guard(harness: Harness, guard: str) -> None:
    (harness.repo / INPUTS[-1]).write_text(f"{guard}\n// fixture test body\n")
    result = harness.linux()
    assert result.returncode == 2
    assert not any("playwright" in call.args for call in harness.calls("pnpm"))
    assert not harness.output.exists()


def test_linux_refuses_existing_output_and_symlink_inputs(harness: Harness) -> None:
    harness.output.mkdir()
    sentinel = harness.output / "existing.png"
    sentinel.write_bytes(b"existing candidate")
    assert harness.linux().returncode == 2
    assert sentinel.read_bytes() == b"existing candidate"
    assert not harness.calls()
    other_output = harness.root / "new candidates"
    source = harness.repo / "pnpm-lock.yaml"
    source.unlink()
    source.symlink_to(sentinel)
    result = harness.run(
        LINUX,
        "--update-snapshots",
        "--output-dir",
        str(other_output),
        GNOSI_BASE_URL="http://fixture:5173",
        GNOSI_PLAYWRIGHT_IMAGE="fixture-image:local",
    )
    assert result.returncode == 2
    assert not harness.calls()
    assert sentinel.read_bytes() == b"existing candidate"


@pytest.mark.parametrize("relative", ["new-output", "node_modules/new-output", ".git/new-output"])
def test_linux_cannot_export_into_checkout(harness: Harness, relative: str) -> None:
    output = harness.repo / relative
    output.parent.mkdir(exist_ok=True)
    result = harness.run(
        LINUX,
        "--update-snapshots",
        "--output-dir",
        str(output),
        GNOSI_BASE_URL="http://fixture:5173",
        GNOSI_PLAYWRIGHT_IMAGE="fixture-image:local",
    )
    assert result.returncode == 2
    assert not harness.calls()
    assert not output.exists()
