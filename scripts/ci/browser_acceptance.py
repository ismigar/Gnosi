"""Run production-browser acceptance against an owned disposable Gnosi instance."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Mapping, Sequence

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.ci.acceptance_proxy import owned_proxy
from scripts.ci.pre_pr import check_checkout, isolated_environment, source_fingerprint

ROOT = Path(__file__).resolve().parents[2]
PROJECTS = ("chromium-anon", "disposable-web", "chromium-auth", "accessibility", "critical-workflows")


def require_free_port(port: int) -> None:
    if not 1024 <= port <= 65535:
        raise ValueError("Acceptance ports must be unprivileged TCP ports")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", port))


def report_counts(report: Path) -> dict[str, int]:
    document = json.loads(report.read_text(encoding="utf-8"))
    stats = document.get("stats")
    if not isinstance(stats, dict):
        raise ValueError("Browser report has no execution statistics")
    result = {}
    for name in ("expected", "unexpected", "flaky", "skipped"):
        value = stats.get(name)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(f"Browser report has invalid {name} statistics")
        result[name] = value
    if result["expected"] == 0 or any(result[key] for key in ("unexpected", "flaky", "skipped")):
        raise ValueError(f"Browser acceptance is incomplete: {result}")
    return result


def file_inventory(directory: Path) -> str:
    digest = hashlib.sha256()
    for filename in sorted(path for path in directory.rglob("*") if path.is_file()):
        digest.update(filename.relative_to(directory).as_posix().encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(filename.read_bytes()).digest())
    return digest.hexdigest()


def run(command: Sequence[str], cwd: Path, environment: Mapping[str, str], log: Path) -> None:
    with log.open("wb") as output:
        result = subprocess.run(command, cwd=cwd, env=dict(environment), stdout=output, stderr=subprocess.STDOUT, check=False)
    if result.returncode:
        raise RuntimeError(f"Acceptance phase exited {result.returncode}; see {log.name}")


def stop_owned(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def wait_ready(url: str, process: subprocess.Popen[bytes], *, deadline: float = 90) -> None:
    end = time.monotonic() + deadline
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.monotonic() < end:
        if process.poll() is not None:
            raise RuntimeError("Owned acceptance service exited before HTTP readiness")
        try:
            with opener.open(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise RuntimeError("Owned acceptance service did not become ready before its deadline")


def fixture_environment(environment: dict[str, str], state: dict[str, object], temporary: Path) -> None:
    owner = state.get("owner")
    if not isinstance(owner, dict):
        raise ValueError("Acceptance fixture has no owner account")
    vaults = state.get("vaults")
    primary = vaults.get("primary") if isinstance(vaults, dict) else None
    if not isinstance(primary, dict):
        raise ValueError("Acceptance fixture has no primary vault")
    values = {
        "GNOSI_TEST_EMAIL": owner.get("email"),
        "GNOSI_TEST_PASSWORD": owner.get("password"),
        "GNOSI_TEST_WORKSPACE_ID": state.get("workspace_id"),
        "GNOSI_TEST_VAULT_ID": primary.get("id"),
        "GNOSI_TEST_TABLE_ID": state.get("table_id"),
    }
    for name, value in values.items():
        if not isinstance(value, str) or not value:
            raise ValueError(f"Acceptance fixture is missing {name}")
        environment[name] = value
    environment["GNOSI_TEST_STORAGE_STATE"] = str(temporary / "browser-auth.json")
    environment["GNOSI_ACCEPTANCE_STATE"] = str(temporary / "fixture-state.json")
    environment["GNOSI_ACCEPTANCE_EXPECTED"] = str(temporary / "expected-content.json")


def accept(output: Path, frontend_port: int, backend_port: int) -> None:
    check_checkout(ROOT)
    initial = source_fingerprint(ROOT)
    for port in (frontend_port, backend_port):
        require_free_port(port)
    if frontend_port == backend_port:
        raise ValueError("Frontend and backend require different owned ports")
    output.mkdir(parents=True, exist_ok=False)
    result: dict[str, object] = {"status": "incomplete", "source_commit": initial[0], "source_diff_sha256": initial[1], "projects": list(PROJECTS), "installed_app_acceptance": False}
    (output / "acceptance.json").write_text(json.dumps(result, indent=2) + "\n")
    node = shutil.which("node")
    if node is None:
        raise ValueError("The pinned Node toolchain is unavailable")
    with tempfile.TemporaryDirectory(prefix="gnosi-browser-acceptance-") as name, owned_proxy(frontend_port, backend_port) as proxy:
        temporary = Path(name).resolve()
        environment = isolated_environment(os.environ, temporary)
        # Respect a caller's bounded resource profile rather than raising its heap.
        if os.environ.get("NODE_OPTIONS"):
            environment["NODE_OPTIONS"] = os.environ["NODE_OPTIONS"]
        environment.update({
            "CI": "true", "VITE_DEV_HTTPS": "false", "VITE_BACKEND_HOST": "127.0.0.1",
            "VITE_BACKEND_PORT": str(backend_port), "VITE_FRONTEND_PORT": str(frontend_port),
            "GNOSI_BASE_URL": f"http://127.0.0.1:{frontend_port}",
            "GNOSI_BACKEND_URL": f"http://127.0.0.1:{backend_port}",
            "GNOSI_MODE": "organization", "GNOSI_VITEST_MAX_WORKERS": "1",
            "GNOSI_TEST_STORAGE_STATE": str(temporary / "browser-auth.json"),
            "PLAYWRIGHT_HTML_OPEN": "never",
            "GNOSI_ACCEPTANCE_PYTHON": sys.executable,
            "GNOSI_ACCEPTANCE_PROXY": proxy,
        })
        # The full product build retains reader validation and the bundle budget.
        vite = ROOT / "frontend/node_modules/vite/bin/vite.js"
        playwright = ROOT / "tests/e2e/node_modules/@playwright/test/cli.js"
        run((node, str(vite), "build"), ROOT / "frontend", environment, output / "production-build.log")
        run((node, "scripts/check-bundle-size.ts"), ROOT / "frontend", environment, output / "bundle-budget.log")
        result["compiled_frontend_sha256"] = file_inventory(ROOT / "frontend/dist")
        processes: list[subprocess.Popen[bytes]] = []
        handles = []
        try:
            backend_command = (sys.executable, "scripts/ci/acceptance_backend.py", "--root", str(temporary), "--port", str(backend_port), "--frontend-port", str(frontend_port), "--state", str(temporary / "fixture-state.json"))
            backend_log = (output / "backend.log").open("wb"); handles.append(backend_log)
            backend = subprocess.Popen(backend_command, cwd=ROOT, env=environment, stdout=backend_log, stderr=subprocess.STDOUT, start_new_session=True)
            processes.append(backend)
            wait_ready(f"http://127.0.0.1:{backend_port}/api/health", backend)
            end = time.monotonic() + 30
            while not (temporary / "fixture-state.json").is_file() and time.monotonic() < end:
                if backend.poll() is not None:
                    raise RuntimeError("Fixture backend exited before seed readiness")
                time.sleep(0.1)
            state = json.loads((temporary / "fixture-state.json").read_text())
            if Path(str(state.get("source_root"))).resolve() != ROOT:
                raise ValueError("Acceptance fixture belongs to a different source checkout")
            fixture_environment(environment, state, temporary)
            preview_log = (output / "frontend-preview.log").open("wb"); handles.append(preview_log)
            preview = subprocess.Popen((node, str(vite), "preview", "--host", "127.0.0.1", "--port", str(frontend_port), "--strictPort"), cwd=ROOT / "frontend", env=environment, stdout=preview_log, stderr=subprocess.STDOUT, start_new_session=True)
            processes.append(preview)
            wait_ready(environment["GNOSI_BASE_URL"] + "/", preview)
            for phase, projects in (("functional", PROJECTS), ("restart", ("persistence-restart",))):
                if phase == "restart":
                    stop_owned(backend)
                    backend = subprocess.Popen(backend_command, cwd=ROOT, env=environment, stdout=backend_log, stderr=subprocess.STDOUT, start_new_session=True)
                    processes.append(backend)
                    wait_ready(f"http://127.0.0.1:{backend_port}/api/health", backend)
                report = output / f"{phase}-report.json"
                environment["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(report)
                command = [node, str(playwright), "test", "--workers=1", "--retries=0", "--reporter=line,json", "--output", str(output / phase)]
                command.extend(f"--project={project}" for project in projects)
                run(command, ROOT / "tests/e2e", environment, output / f"{phase}-browser.log")
                result[phase] = report_counts(report)
            if source_fingerprint(ROOT) != initial:
                raise RuntimeError("Source changed during acceptance; candidate evidence is incomplete")
            if file_inventory(ROOT / "frontend/dist") != result["compiled_frontend_sha256"]:
                raise RuntimeError("The served production build changed during acceptance")
            result["status"] = "passed"
        finally:
            for process in reversed(processes):
                stop_owned(process)
            for handle in handles:
                handle.close()
            (output / "acceptance.json").write_text(json.dumps(result, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="New directory for candidate-bound acceptance evidence")
    parser.add_argument("--frontend-port", type=int, default=5198)
    parser.add_argument("--backend-port", type=int, default=5008)
    args = parser.parse_args()
    output = args.output or ROOT / ".tmp/browser-acceptance" / uuid.uuid4().hex
    try:
        accept(output.resolve(), args.frontend_port, args.backend_port)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"Browser acceptance incomplete: {exc}", file=sys.stderr)
        return 1
    print(f"Browser acceptance passed; evidence: {output / 'acceptance.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
