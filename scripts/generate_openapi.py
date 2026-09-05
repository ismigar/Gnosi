#!/usr/bin/env python3
"""Generate Gnosi's deterministic OpenAPI contract without touching user data."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPOSITORY_ROOT / "openapi" / "openapi.json"
DEFAULT_HASH_OUTPUT = REPOSITORY_ROOT / "backend" / "tests" / "contracts" / "openapi.sha256"


def _configure_isolated_runtime(runtime_root: Path) -> None:
    """Point every application-owned data selector at an ephemeral runtime."""
    runtime_root = runtime_root.resolve()
    vault_path = runtime_root / "vault"
    data_path = runtime_root / "data"
    host_path = runtime_root / "host"
    vault_path.mkdir(parents=True)
    data_path.mkdir(parents=True)
    host_path.mkdir(parents=True)
    vault_config_path = vault_path / ".gnosi" / "params.yaml"
    vault_config_path.parent.mkdir(parents=True)
    vault_config_path.write_text("{}\n", encoding="utf-8")

    isolated_values = {
        "GNOSI_VALIDATION_ROOT": str(runtime_root),
        "DIGITAL_BRAIN_VAULT_PATH": str(vault_path),
        "VAULT_HOST_PATH": str(vault_path),
        "HOME_HOST_PATH": str(host_path),
        "GNOSI_DATA_DIR": str(data_path),
        "GNOSI_SHARED_ENV_FILE": str(runtime_root / "disabled.env"),
        "GNOSI_DISABLE_SCHEDULER": "1",
        "GNOSI_FILES_PROVIDER": "local",
    }
    os.environ.update(isolated_values)

    # Local development may have credentials in the system secure store. Mark
    # every known credential as explicitly unavailable so importing the app for
    # schema generation never queries that store or serializes a real secret.
    env_config = importlib.import_module("backend.config.env_config")
    keychain_mapping = getattr(env_config, "KEYCHAIN_ENV_MAPPING")
    for variable_name in keychain_mapping:
        os.environ[variable_name] = "openapi-generation-disabled"


def deterministic_openapi() -> dict[str, Any]:
    """Import the canonical application and return its OpenAPI document."""
    # CI bounds this command at the process level. A background traceback
    # watchdog can itself hang while dumping frames under translated Python,
    # preventing cancellation even after schema generation has returned.
    server = importlib.import_module("backend.server")
    return dict(server.app.openapi())


def serialize_openapi(payload: dict[str, Any]) -> str:
    """Return the canonical byte representation committed to the repository."""
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def _digest(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--hash-output",
        type=Path,
        help="Override the frozen SHA-256 path (primarily for isolated tests).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the committed artifact differs instead of writing it.",
    )
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    hash_output = (
        args.hash_output.expanduser().resolve()
        if args.hash_output is not None
        else DEFAULT_HASH_OUTPUT
    )

    if str(REPOSITORY_ROOT) not in sys.path:
        sys.path.insert(0, str(REPOSITORY_ROOT))

    with tempfile.TemporaryDirectory(prefix="gnosi-openapi-") as temporary_dir:
        _configure_isolated_runtime(Path(temporary_dir))
        content = serialize_openapi(deterministic_openapi())

    if args.check:
        if not output.is_file():
            print(f"OpenAPI artifact is missing: {output}", file=sys.stderr)
            return 1
        current = output.read_text(encoding="utf-8")
        if current != content:
            print(
                "OpenAPI artifact is stale: "
                f"expected sha256={_digest(content)}, actual sha256={_digest(current)}. "
                "Run the generator and review the contract diff.",
                file=sys.stderr,
            )
            return 1
        if not hash_output.is_file():
            print(f"OpenAPI hash artifact is missing: {hash_output}", file=sys.stderr)
            return 1
        expected_digest = hash_output.read_text(encoding="utf-8").strip()
        actual_digest = _digest(content)
        if expected_digest != actual_digest:
            print(
                "OpenAPI hash artifact is stale: "
                f"expected sha256={actual_digest}, recorded sha256={expected_digest}. "
                "Regenerate both artifacts and review the contract diff.",
                file=sys.stderr,
            )
            return 1
        print(f"OpenAPI artifact is current ({_digest(content)}).")
        return 0

    _write_atomic(output, content)
    if output == DEFAULT_OUTPUT or args.hash_output is not None:
        _write_atomic(hash_output, f"{_digest(content)}\n")
    print(f"Wrote {output} ({_digest(content)}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
