"""Restricted Node subprocess execution for third-party plugins."""

from __future__ import annotations

import json
import subprocess
import threading
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NotRequired, Protocol, Required, TypedDict, cast

from backend.domains.plugins.contracts import PluginError


class SandboxManifest(TypedDict):
    """Manifest fields consumed by the sandbox runtime."""

    id: str
    backend: NotRequired[str | None]


class SandboxLog(TypedDict):
    """One normalized log line returned by a plugin."""

    level: str
    message: str


class SandboxResult(TypedDict, total=False):
    """Bounded result returned by one sandbox event."""

    ok: Required[bool]
    error: str
    result: object
    logs: list[SandboxLog]
    rpc_count: int


class WarningLogger(Protocol):
    """Narrow logger port needed by the watchdog."""

    def warning(self, message: str, *args: object) -> None:
        """Record a sandbox timeout warning."""


HostHandler = Callable[[dict[str, Any], str], Any]
PluginDirResolver = Callable[[Path, str], Path]


def _default_sandbox_result() -> SandboxResult:
    return {"ok": False, "error": "timeout o sortida inesperada"}


@dataclass(frozen=True)
class SandboxTarget:
    """Contained plugin paths accepted for process execution."""

    plugin_id: str
    plugin_dir: Path
    main_path: Path


@dataclass
class SandboxConversation:
    """Mutable state of one newline-JSON conversation."""

    result: SandboxResult = field(default_factory=_default_sandbox_result)
    logs: list[SandboxLog] = field(default_factory=list)
    rpc_count: int = 0
    done: bool = False


def _resolve_target(
    config_dir: Path,
    manifest: SandboxManifest,
    *,
    node_available: Callable[[], bool],
    resolve_plugin_dir: PluginDirResolver,
) -> tuple[SandboxTarget | None, SandboxResult | None]:
    plugin_id = manifest["id"]
    backend_entry = manifest.get("backend")
    if not backend_entry:
        return None, {
            "ok": False,
            "error": "the plugin does not declare a backend entry",
        }
    if not node_available():
        return None, {"ok": False, "error": "Node.js is unavailable on the host"}
    try:
        plugin_path = resolve_plugin_dir(config_dir, plugin_id)
    except PluginError as exc:
        return None, {"ok": False, "error": str(exc)}
    main_path = (plugin_path / backend_entry).resolve()
    if plugin_path.resolve() not in main_path.parents:
        return None, {
            "ok": False,
            "error": "backend entry is outside the plugin directory",
        }
    if not main_path.exists():
        return None, {
            "ok": False,
            "error": f"backend entry not found: {backend_entry}",
        }
    return SandboxTarget(plugin_id, plugin_path, main_path), None


def _runtime_environment(
    environment: Mapping[str, str],
    main_path: Path,
    network_enabled: bool,
) -> dict[str, str]:
    allowed_names = (
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "PATHEXT",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TEMP",
        "TMP",
    )
    child_environment = {key: environment[key] for key in allowed_names if environment.get(key)}
    child_environment["GNOSI_PLUGIN_MAIN"] = str(main_path)
    child_environment["GNOSI_PLUGIN_NET"] = "1" if network_enabled else "0"
    return child_environment


def _start_process(
    target: SandboxTarget,
    runner: Path,
    environment: Mapping[str, str],
) -> subprocess.Popen[str]:
    command = [
        "node",
        "--permission",
        f"--allow-fs-read={target.plugin_dir}",
        str(runner),
    ]
    return subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=dict(environment),
        cwd=str(target.plugin_dir),
    )


def _start_watchdog(
    process: subprocess.Popen[str],
    plugin_id: str,
    timeout_s: float,
    logger: WarningLogger,
) -> None:
    def kill_on_timeout() -> None:
        try:
            process.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            logger.warning(
                "Plugin %s: timed out; terminating subprocess",
                plugin_id,
            )
            try:
                process.kill()
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=kill_on_timeout, daemon=True).start()


def _write_message(process: subprocess.Popen[str], message: Mapping[str, object]) -> None:
    try:
        if process.stdin is None:
            return
        process.stdin.write(json.dumps(dict(message)) + "\n")
        process.stdin.flush()
    except Exception:  # noqa: BLE001
        pass


def _handle_rpc(
    process: subprocess.Popen[str],
    message: Mapping[str, object],
    conversation: SandboxConversation,
    *,
    plugin_id: str,
    granted: set[str],
    method_permissions: Mapping[str, str],
    host_handlers: Mapping[str, HostHandler],
) -> None:
    conversation.rpc_count += 1
    request_id = message.get("id")
    method = message.get("method")
    permission = method_permissions.get(cast(str, method))
    if permission is None or permission not in granted:
        _write_message(
            process,
            {
                "type": "rpc-result",
                "id": request_id,
                "ok": False,
                "error": f"permís denegat per {method}",
            },
        )
        return
    handler = host_handlers.get(cast(str, method))
    if handler is None:
        _write_message(
            process,
            {
                "type": "rpc-result",
                "id": request_id,
                "ok": False,
                "error": f"host no implementa {method}",
            },
        )
        return
    arguments = cast(dict[str, Any], message.get("args") or {})
    try:
        result = handler(arguments, plugin_id)
        _write_message(
            process,
            {
                "type": "rpc-result",
                "id": request_id,
                "ok": True,
                "result": result,
            },
        )
    except Exception as exc:  # noqa: BLE001
        _write_message(
            process,
            {
                "type": "rpc-result",
                "id": request_id,
                "ok": False,
                "error": str(exc),
            },
        )


def _handle_message(
    process: subprocess.Popen[str],
    message: Mapping[str, object],
    conversation: SandboxConversation,
    *,
    plugin_id: str,
    granted: set[str],
    method_permissions: Mapping[str, str],
    host_handlers: Mapping[str, HostHandler],
) -> None:
    message_type = message.get("type")
    if message_type == "rpc":
        _handle_rpc(
            process,
            message,
            conversation,
            plugin_id=plugin_id,
            granted=granted,
            method_permissions=method_permissions,
            host_handlers=host_handlers,
        )
    elif message_type == "log":
        conversation.logs.append(
            {
                "level": str(message.get("level") or "info"),
                "message": str(message.get("message") or ""),
            }
        )
    elif message_type == "done":
        conversation.result = {"ok": True, "result": message.get("result")}
        conversation.done = True
    elif message_type == "error":
        conversation.result = {
            "ok": False,
            "error": str(message.get("message") or "error del plugin"),
        }
        conversation.done = True


def _read_conversation(
    process: subprocess.Popen[str],
    *,
    plugin_id: str,
    granted: set[str],
    method_permissions: Mapping[str, str],
    host_handlers: Mapping[str, HostHandler],
) -> SandboxConversation:
    conversation = SandboxConversation()
    try:
        for raw_line in cast(Iterable[str], process.stdout):
            line = raw_line.strip()
            if not line:
                continue
            try:
                decoded: object = json.loads(line)
            except json.JSONDecodeError:
                continue
            _handle_message(
                process,
                cast(Mapping[str, object], decoded),
                conversation,
                plugin_id=plugin_id,
                granted=granted,
                method_permissions=method_permissions,
                host_handlers=host_handlers,
            )
            if conversation.done:
                break
    except Exception as exc:  # noqa: BLE001
        conversation.result = {
            "ok": False,
            "error": f"error llegint del sandbox: {exc}",
        }
    return conversation


def _finish_process(process: subprocess.Popen[str]) -> None:
    try:
        if process.stdin is not None:
            process.stdin.close()
    except Exception:  # noqa: BLE001
        pass
    try:
        process.wait(timeout=2)
    except Exception:  # noqa: BLE001
        try:
            process.kill()
        except Exception:  # noqa: BLE001
            pass


def run_event(
    config_dir: Path,
    manifest: SandboxManifest,
    granted: Sequence[str],
    event_name: str,
    payload: Mapping[str, Any],
    *,
    timeout_s: float,
    runner: Path,
    method_permissions: Mapping[str, str],
    host_handlers: Mapping[str, HostHandler],
    node_available: Callable[[], bool],
    resolve_plugin_dir: PluginDirResolver,
    environment: Mapping[str, str],
    logger: WarningLogger,
) -> SandboxResult:
    """Execute one plugin event in the bounded Node sandbox."""

    target, error = _resolve_target(
        config_dir,
        manifest,
        node_available=node_available,
        resolve_plugin_dir=resolve_plugin_dir,
    )
    if error is not None:
        return error
    if target is None:
        raise RuntimeError("sandbox target resolution returned no result")

    granted_set = set(granted)
    child_environment = _runtime_environment(
        environment,
        target.main_path,
        "network" in granted_set,
    )
    try:
        process = _start_process(target, runner, child_environment)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"could not start Node.js: {exc}"}

    _start_watchdog(process, target.plugin_id, timeout_s, logger)
    _write_message(
        process,
        {"type": "event", "event": {"name": event_name, "payload": payload}},
    )
    try:
        conversation = _read_conversation(
            process,
            plugin_id=target.plugin_id,
            granted=granted_set,
            method_permissions=method_permissions,
            host_handlers=host_handlers,
        )
    finally:
        _finish_process(process)

    conversation.result["logs"] = conversation.logs
    conversation.result["rpc_count"] = conversation.rpc_count
    return conversation.result
