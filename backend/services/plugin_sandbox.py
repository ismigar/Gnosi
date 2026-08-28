"""Compatibility facade for the restricted third-party plugin sandbox.

The typed process, protocol and RPC implementation lives in
``backend.domains.plugins.sandbox``. This facade retains the historical runner,
permission catalog, injected host handlers and late-bound monkeypatch seams.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from collections.abc import Mapping as _Mapping
from pathlib import Path
from typing import Any, Callable, Dict, List, cast

from backend.config.logger_config import get_logger
from backend.domains.plugins import sandbox as _sandbox
from backend.services import plugin_system as ps

logger = get_logger(__name__)

_RUNNER = Path(__file__).parent / "plugin_runtime" / "runner.mjs"
_DEFAULT_TIMEOUT_S = 15.0

_METHOD_PERMISSION: Dict[str, str] = {
    "vault.readPage": "vault:read",
    "vault.writePage": "vault:write",
    "vault.queryDB": "vault:read",
    "vault.listTables": "vault:read",
    "vault.createPage": "vault:write",
    "settings.get": "settings",
    "settings.set": "settings",
    "network.fetch": "network",
}

_host_handlers: Dict[str, Callable[[Dict[str, Any]], Any]] = {}

# Preserve the historical module attributes used by subprocess fakes and
# diagnostics. Python module objects are shared, so patching these attributes
# remains visible to the typed implementation at call time.
_COMPATIBILITY_MODULES = (json, subprocess, threading)


def set_host_handlers(handlers: Dict[str, Callable[[Dict[str, Any]], Any]]) -> None:
    """Injects the real implementations of vault.*/network.* from the routes."""

    global _host_handlers
    _host_handlers = dict(handlers or {})


def runtime_permissions() -> frozenset[str]:
    """Permissions that a sandboxed agent tool may receive at runtime."""

    return frozenset(_METHOD_PERMISSION.values())


def node_available() -> bool:
    return shutil.which("node") is not None


def run_event(
    config_dir: Path,
    manifest: Dict[str, Any],
    granted: List[str],
    event_name: str,
    payload: Dict[str, Any],
    *,
    timeout_s: float = _DEFAULT_TIMEOUT_S,
) -> Dict[str, Any]:
    """Runs a plugin's `onEvent` in the sandbox. Returns a summary of the result.

    Blocking. Meant to run inside `plugin_events`'s event thread. Never raises
    because of the plugin: it wraps errors in the return dict
    (`{ok, error?, logs, rpc_count}`).

    """

    result = _sandbox.run_event(
        config_dir,
        cast(_sandbox.SandboxManifest, manifest),
        granted,
        event_name,
        payload,
        timeout_s=timeout_s,
        runner=_RUNNER,
        method_permissions=_METHOD_PERMISSION,
        host_handlers=cast(_Mapping[str, _sandbox.HostHandler], _host_handlers),
        node_available=node_available,
        resolve_plugin_dir=ps.plugin_dir,
        environment=os.environ,
        logger=cast(_sandbox.WarningLogger, logger),
    )
    return dict(result)
