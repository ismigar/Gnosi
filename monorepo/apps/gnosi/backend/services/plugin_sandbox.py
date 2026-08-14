"""Data sandbox: runs a third-party plugin inside a restricted Node (phase 3).

Launches `plugin_runtime/runner.mjs` with `node --permission` (blocks fs-write,
child_process and worker) and passes it an event. The plugin can only touch the
vault via RPC over stdio; here EVERY call is validated against the permissions
the user has granted (`plugin_system.has_permission`).

Design:
  * Newline-JSON communication with the subprocess (protocol in runner.mjs).
  * Blocking I/O with a stdout-reading thread: this module is already invoked
    from a daemon thread of `plugin_events.emit`, so blocking is fine.
  * Hard wall-clock timeout: if the plugin doesn't finish in time, the process is killed.
  * The host handlers (readPage/writePage/queryDB/fetch) are INJECTED from the
    routes layer so as not to import vault_routes here (avoids a circular import).

Network blocking: Node's permission model does NOT gate network access directly,
but the runner makes it HARD when there's no `network` permission — a synchronous
ESM hook (`module.registerHooks`) rejects every `import` of network modules and
neutralizes the globals (fetch/WebSocket/…). With child_process/worker/addons
already blocked by `--permission`, an ESM plugin cannot open any connection.
fs-write and exec ARE genuinely blocked by `--permission`.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List

from backend.config.logger_config import get_logger
from backend.services import plugin_system as ps

logger = get_logger(__name__)

_RUNNER = Path(__file__).parent / "plugin_runtime" / "runner.mjs"
_DEFAULT_TIMEOUT_S = 15.0

# RPC method → required permission. A method without an entry here is denied by
# defecte (fail-closed).
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

# Host handlers, injected from the routes. Signature: (args, plugin_id) -> Any.
# The plugin_id lets `settings` handlers know WHICH plugin they belong to.
# They may raise; the error is forwarded to the plugin as a promise rejection.
_host_handlers: Dict[str, Callable[[Dict[str, Any]], Any]] = {}


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
    pid = manifest["id"]
    backend_entry = manifest.get("backend")
    if not backend_entry:
        return {"ok": False, "error": "the plugin does not declare a backend entry"}
    if not node_available():
        return {"ok": False, "error": "Node.js is unavailable on the host"}

    try:
        pdir = ps.plugin_dir(config_dir, pid)
    except ps.PluginError as e:
        return {"ok": False, "error": str(e)}
    main_path = (pdir / backend_entry).resolve()
    if pdir.resolve() not in main_path.parents:
        return {"ok": False, "error": "backend entry is outside the plugin directory"}
    if not main_path.exists():
        return {"ok": False, "error": f"backend entry not found: {backend_entry}"}

    granted_set = set(granted or [])
    net = "1" if "network" in granted_set else "0"

    cmd = [
        "node",
        "--permission",
        f"--allow-fs-read={pdir}",
        str(_RUNNER),
    ]
    # Construct the child environment from an explicit runtime allowlist. Name-based
    # secret filtering is not sufficient because credentials can use arbitrary names.
    env = {
        key: os.environ[key]
        for key in (
            "PATH", "SYSTEMROOT", "WINDIR", "PATHEXT", "LANG", "LC_ALL",
            "TMPDIR", "TEMP", "TMP",
        )
        if os.environ.get(key)
    }
    env["GNOSI_PLUGIN_MAIN"] = str(main_path)
    env["GNOSI_PLUGIN_NET"] = net

    logs: List[Dict[str, str]] = []
    rpc_count = 0
    result: Dict[str, Any] = {"ok": False, "error": "timeout o sortida inesperada"}

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            cwd=str(pdir),
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"could not start Node.js: {e}"}

    def _kill_on_timeout() -> None:
        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            logger.warning("Plugin %s: timed out; terminating subprocess", pid)
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass

    watchdog = threading.Thread(target=_kill_on_timeout, daemon=True)
    watchdog.start()

    def _write(obj: Dict[str, Any]) -> None:
        try:
            proc.stdin.write(json.dumps(obj) + "\n")
            proc.stdin.flush()
        except Exception:  # noqa: BLE001
            pass

    # Sends the event and reads the RPC dialogue until done/error/EOF.
    _write({"type": "event", "event": {"name": event_name, "payload": payload}})
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            mtype = msg.get("type")
            if mtype == "rpc":
                rpc_count += 1
                rid = msg.get("id")
                method = msg.get("method")
                args = msg.get("args") or {}
                perm = _METHOD_PERMISSION.get(method)
                if perm is None or perm not in granted_set:
                    _write({"type": "rpc-result", "id": rid, "ok": False,
                            "error": f"permís denegat per {method}"})
                    continue
                handler = _host_handlers.get(method)
                if handler is None:
                    _write({"type": "rpc-result", "id": rid, "ok": False,
                            "error": f"host no implementa {method}"})
                    continue
                try:
                    res = handler(args, pid)
                    _write({"type": "rpc-result", "id": rid, "ok": True, "result": res})
                except Exception as e:  # noqa: BLE001
                    _write({"type": "rpc-result", "id": rid, "ok": False, "error": str(e)})
            elif mtype == "log":
                logs.append({"level": str(msg.get("level") or "info"),
                             "message": str(msg.get("message") or "")})
            elif mtype == "done":
                result = {"ok": True, "result": msg.get("result")}
                break
            elif mtype == "error":
                result = {"ok": False, "error": str(msg.get("message") or "error del plugin")}
                break
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": f"error llegint del sandbox: {e}"}
    finally:
        try:
            proc.stdin.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            proc.wait(timeout=2)
        except Exception:  # noqa: BLE001
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass

    result["logs"] = logs
    result["rpc_count"] = rpc_count
    return result
