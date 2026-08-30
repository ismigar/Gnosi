#!/usr/bin/env python3
"""Require a real, process-specific health response from a packaged backend."""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Mapping


STARTUP_TIMEOUT_SECONDS = 120
SHUTDOWN_TIMEOUT_SECONDS = 5
POLL_SECONDS = 0.1


def packaged_executable(bundle_directory: Path) -> Path:
    """Return the platform-specific backend executable inside a COLLECT bundle."""
    name = "cervell_backend.exe" if os.name == "nt" else "cervell_backend"
    return bundle_directory / name


def probe_environment(root: Path, port: int, identity: str,
                      inherited: Mapping[str, str]) -> dict[str, str]:
    """Create empty application data without inheriting application credentials."""
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL",
               "TMP", "TEMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}
    environment = {key: value for key, value in inherited.items() if key.upper() in allowed}
    for child in ("data", "vault", "host"):
        (root / child).mkdir()
    config = root / "vault" / ".gnosi"
    config.mkdir()
    (config / "params.yaml").write_text(json.dumps({
        "server": {"host": "127.0.0.1", "backend_port": port},
        "ai": {"providers": {}},
    }), encoding="utf-8")
    (config / "plugins.json").write_text(json.dumps({
        "schema_version": 2, "enabled_builtin": [], "enabled_third_party": [],
        "disabled": ["ai-platform", "mail", "llm-wiki"],
    }), encoding="utf-8")
    environment.update({
        "GNOSI_VALIDATION_ROOT": str(root), "GNOSI_DATA_DIR": str(root / "data"),
        "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
        "VAULT_HOST_PATH": str(root / "vault"), "HOME_HOST_PATH": str(root / "host"),
        "GNOSI_DISABLE_SCHEDULER": "1", "GNOSI_FILES_PROVIDER": "local",
        "GNOSI_REQUIRE_AUTH": "false", "GNOSI_JWT_SECRET": secrets.token_hex(32),
        "GNOSI_MODE": identity, "PYTHONUNBUFFERED": "1",
    })
    return environment


def health_matches(port: int, identity: str, timeout: float) -> bool:
    """Accept only our nonce-bearing health payload, without proxies/redirects."""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    deadline = time.monotonic() + timeout
    timer: threading.Timer | None = None
    try:
        connection.connect()
        connected_socket = connection.sock
        if connected_socket is None:
            return False

        def interrupt() -> None:
            try:
                connected_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        # Socket timeouts alone reset after each byte. A trickling response
        # must not extend the overall startup deadline indefinitely.
        timer = threading.Timer(max(0, deadline - time.monotonic()), interrupt)
        timer.daemon = True
        timer.start()
        connection.request("GET", "/api/health", headers={"Connection": "close"})
        response = connection.getresponse()
        if response.status != 200:
            return False
        raw = response.read(4097)
        if len(raw) > 4096:
            return False
        payload = json.loads(raw)
        return (isinstance(payload, dict) and payload.get("status") == "ok"
                and payload.get("mode") == "FastAPI"
                and payload.get("gnosi_mode") == identity)
    except (OSError, http.client.HTTPException, ValueError, UnicodeError):
        return False
    finally:
        if timer is not None:
            timer.cancel()
            timer.join()
        connection.close()


def stop_process(process: subprocess.Popen[bytes]) -> None:
    """Reap the probe before removing its temporary files, including on Windows."""
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)
    else:
        process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)


def verify_backend(executable: Path) -> None:
    """Reject crashes, port conflicts, stalled imports and unrelated listeners."""
    executable = executable.resolve()
    if not executable.is_file():
        raise RuntimeError(f"Packaged backend executable does not exist: {executable}")

    with tempfile.TemporaryDirectory(prefix="gnosi-packaged-backend-") as directory:
        root = Path(directory).resolve()
        identity = "packaged-smoke-" + secrets.token_hex(32)
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            environment = probe_environment(root, port, identity, os.environ)
        # Only this child knows the nonce. A different listener winning the
        # released-port race cannot satisfy the probe. File logs cannot fill a pipe.
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen([str(executable)], stdout=output, stderr=output,
                                       cwd=root, env=environment)
            try:
                deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
                while process.poll() is None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise RuntimeError("Packaged backend did not become healthy before timeout")
                    if health_matches(port, identity, min(1.0, remaining)):
                        if process.poll() is not None:
                            break
                        return
                    time.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))
                raise RuntimeError(f"Packaged backend exited before readiness: {process.returncode}")
            finally:
                stop_process(process)


def main() -> int:
    """Run the startup contract without dumping child output or credentials."""
    if len(sys.argv) != 2:
        sys.stderr.write("Usage: smoke-packaged-backend.py <bundle-directory>\n")
        return 2

    try:
        verify_backend(packaged_executable(Path(sys.argv[1])))
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        sys.stderr.write(f"{error}\n")
        return 1
    sys.stdout.write("Verified packaged backend HTTP readiness and process cleanup.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
