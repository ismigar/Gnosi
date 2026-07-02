"""Sandbox de dades: executa un plugin de tercers dins d'un Node capat (fase 3).

Arrenca `plugin_runtime/runner.mjs` amb `node --permission` (bloqueja fs-write,
child_process i worker) i li passa un esdeveniment. El plugin només pot tocar el
vault via RPC sobre stdio; aquí es valida CADA crida contra els permisos que
l'usuari ha concedit (`plugin_system.has_permission`).

Disseny:
  * Comunicació newline-JSON amb el subprocés (protocol a runner.mjs).
  * Blocking I/O amb un thread lector de stdout: aquest mòdul ja s'invoca des
    d'un thread daemon de `plugin_events.emit`, així que bloquejar és correcte.
  * Timeout de paret dur: si el plugin no acaba a temps, es mata el procés.
  * Els handlers del host (readPage/writePage/queryDB/fetch) s'INJECTEN des de la
    capa de rutes per no importar vault_routes aquí (evita import circular).

Bloqueig de xarxa: el model de permisos de Node NO gita xarxa directament, però
el runner el fa DUR quan no hi ha permís `network` — un hook ESM síncron
(`module.registerHooks`) rebutja tot `import` de mòduls de xarxa i es neutralitzen
els globals (fetch/WebSocket/…). Amb child_process/worker/addons ja bloquejats per
`--permission`, un plugin ESM no pot obrir cap connexió. fs-write i exec SÍ queden
bloquejats de debò per `--permission`.
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

# Mètode RPC → permís requerit. Un mètode sense entrada aquí es denega per
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

# Handlers del host, injectats des de les rutes. Signatura: (args, plugin_id) -> Any.
# El plugin_id permet als handlers de `settings` saber a QUIN plugin pertoquen.
# Poden llançar; l'error es reenvia al plugin com a rebuig de la promesa.
_host_handlers: Dict[str, Callable[[Dict[str, Any]], Any]] = {}


def set_host_handlers(handlers: Dict[str, Callable[[Dict[str, Any]], Any]]) -> None:
    """Injecta les implementacions reals de vault.*/network.* des de les rutes."""
    global _host_handlers
    _host_handlers = dict(handlers or {})


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
    """Executa `onEvent` d'un plugin al sandbox. Retorna un resum del resultat.

    Bloquejant. Pensat per córrer dins del thread d'esdeveniment de
    `plugin_events`. Mai llança per culpa del plugin: encapsula els errors al
    dict de retorn (`{ok, error?, logs, rpc_count}`).
    """
    pid = manifest["id"]
    backend_entry = manifest.get("backend")
    if not backend_entry:
        return {"ok": False, "error": "el plugin no declara entry backend"}
    if not node_available():
        return {"ok": False, "error": "node no disponible al host"}

    try:
        pdir = ps.plugin_dir(config_dir, pid)
    except ps.PluginError as e:
        return {"ok": False, "error": str(e)}
    main_path = (pdir / backend_entry).resolve()
    if pdir.resolve() not in main_path.parents:
        return {"ok": False, "error": "entry backend fora del directori del plugin"}
    if not main_path.exists():
        return {"ok": False, "error": f"entry backend no trobat: {backend_entry}"}

    granted_set = set(granted or [])
    net = "1" if "network" in granted_set else "0"

    cmd = [
        "node",
        "--permission",
        f"--allow-fs-read={pdir}",
        str(_RUNNER),
    ]
    env = dict(os.environ)
    env["GNOSI_PLUGIN_MAIN"] = str(main_path)
    env["GNOSI_PLUGIN_NET"] = net
    # No filtrem tot l'env (node en necessita part), però traiem secrets obvis.
    for k in list(env.keys()):
        if any(s in k.upper() for s in ("SECRET", "TOKEN", "PASSWORD", "API_KEY")):
            env.pop(k, None)

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
        return {"ok": False, "error": f"no s'ha pogut arrencar node: {e}"}

    def _kill_on_timeout() -> None:
        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            logger.warning("Plugin %s: timeout, matant subprocés", pid)
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

    # Envia l'esdeveniment i llegeix el diàleg RPC fins a done/error/EOF.
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
                result = {"ok": True}
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
