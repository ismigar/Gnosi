#!/usr/bin/env python3
"""Verify that the packaged backend imports successfully and remains runnable."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile


STARTUP_TIMEOUT_SECONDS = 30
SHUTDOWN_TIMEOUT_SECONDS = 5


def packaged_executable(bundle_directory: Path) -> Path:
    """Return the platform-specific backend executable inside a COLLECT bundle."""
    name = "cervell_backend.exe" if os.name == "nt" else "cervell_backend"
    return bundle_directory / name


def stop_process(process: subprocess.Popen[str]) -> tuple[str, str]:
    """Stop a successful smoke process and collect its buffered output."""
    process.terminate()
    try:
        return process.communicate(timeout=SHUTDOWN_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        return process.communicate()


def verify_backend(executable: Path) -> None:
    """Fail when the executable cannot finish imports and enter server runtime."""
    if not executable.is_file():
        raise RuntimeError(f"Packaged backend executable does not exist: {executable}")

    with tempfile.TemporaryDirectory(prefix="gnosi-packaged-backend-") as local_data:
        process = subprocess.Popen(
            [str(executable)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={
                **os.environ,
                "GNOSI_DATA_DIR": local_data,
                "PYTHONUNBUFFERED": "1",
            },
        )
        try:
            stdout, stderr = process.communicate(timeout=STARTUP_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            stop_process(process)
            print(f"Verified packaged backend startup: {executable}")
            return

    combined_output = f"{stdout}\n{stderr}".strip()
    if "address already in use" in combined_output.lower():
        print(f"Verified packaged backend imports (port already occupied): {executable}")
        return

    raise RuntimeError(
        f"Packaged backend exited during startup with code {process.returncode}:\n"
        f"{combined_output[-4000:]}"
    )


def main() -> int:
    """Run the packaged-backend startup contract."""
    if len(sys.argv) != 2:
        print("Usage: smoke-packaged-backend.py <bundle-directory>", file=sys.stderr)
        return 2

    try:
        verify_backend(packaged_executable(Path(sys.argv[1])))
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
