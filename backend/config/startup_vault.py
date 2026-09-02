"""Materialize startup-critical Vault files before app imports."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path

from backend.config.env_config import load_env
from backend.platform.files import get_files_provider


log = logging.getLogger(__name__)

_STARTUP_RELATIVE_PATHS = (
    Path(".gnosi/params.yaml"),
    Path("BD/vault_db_registry.json"),
    Path(".gnosi/plugins.json"),
)


def _configured_vault_path() -> Path | None:
    """Return the native Vault path without loading Vault configuration."""
    load_env()
    raw_vault = os.environ.get("DIGITAL_BRAIN_VAULT_PATH", "").strip()
    if not raw_vault:
        return None
    return Path(raw_vault).expanduser()


async def _materialize_path(path: Path) -> bool:
    provider = get_files_provider()
    try:
        stat_result = path.stat()
    except FileNotFoundError:
        return True
    except OSError:
        return False
    if not provider.is_online_only(path, stat_result):
        return True
    return await provider.materialize(path)


async def _materialize_startup_paths(vault_path: Path) -> bool:
    for relative_path in _STARTUP_RELATIVE_PATHS:
        if not await _materialize_path(vault_path / relative_path):
            return False
    return True


def materialize_startup_vault_files() -> bool:
    """Perform bounded files-on-demand recovery before importing the app.

    The Uvicorn and packaged entrypoint call this while no event loop is active.
    It never creates or rewrites configuration: unavailable files remain an
    explicit warning and normal configuration fallback remains recoverable.
    """
    vault_path = _configured_vault_path()
    if vault_path is None:
        return True

    def run() -> bool:
        return asyncio.run(_materialize_startup_paths(vault_path))

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        materialized = run()
    else:
        # Uvicorn can import an application after its own loop has started.
        # Keep the pre-import boundary synchronous without nesting event loops.
        result: list[bool] = []

        def run_in_thread() -> None:
            result.append(run())

        worker = threading.Thread(
            target=run_in_thread,
            name="gnosi-startup-vault",
            daemon=True,
        )
        worker.start()
        worker.join()
        materialized = result[0] if result else False
    if not materialized:
        log.warning("Startup Vault files are not locally available: %s", vault_path)
    return materialized
