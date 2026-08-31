"""Governed AI contributions from installed third-party plugins.

Plugin manifests point at bounded JSON or YAML descriptor files. Skills remain
declarative. Agent tools execute through the existing Node sandbox and receive
only the per-tool permission subset declared in their descriptor. No plugin
Python is imported into the FastAPI process.
"""

from __future__ import annotations

import inspect
import json
import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional, cast

import yaml

from backend.config.app_config import load_params
from backend.config.logger_config import get_logger
from backend.domains.configuration import plugin_state
from backend.models.agent_skills import (
    CatalogOrigin,
    CatalogStatus,
    ConfirmationPolicy,
    OriginType,
    ToolDescriptor,
    ToolEffect,
)
from backend.services import builtin_plugins, plugin_sandbox, plugin_system
from backend.services.agent_skill_catalog import (
    ToolRegistration,
    register_plugin_skill_provider,
    register_plugin_tool_provider,
)
from backend.services.context_vars import get_active_vault_path
from backend.utils.safe_io import PathLike, safe_write_json, safe_write_text

logger = get_logger(__name__)

_MAX_CONTRIBUTION_BYTES = 1024 * 1024
_MANAGED_BY_PREFIX = "plugin:"
_reconcile_lock = threading.RLock()
_registered_plugin_ids: set[str] = set()


def _write_plugin_state_json(path: PathLike, obj: Any, **dumps_kwargs: Any) -> None:
    safe_write_json(path, obj, **dumps_kwargs)


def _runtime_context() -> tuple[Path, dict[str, Any]]:
    """Load the active vault's plugin directory and lifecycle state."""

    active_vault = get_active_vault_path()
    if active_vault is None:
        raise plugin_system.PluginError("No active vault is available")
    config_dir = active_vault / ".gnosi"
    state = plugin_state.load_with_dependencies(
        plugin_state.PluginStateDependencies(
            path=lambda: config_dir / "plugins.json",
            normalize_state=builtin_plugins.normalize_state,
            write_json=_write_plugin_state_json,
            logger=logger,
        )
    )
    return config_dir, state


def _safe_contribution_path(
    config_dir: Path,
    plugin_id: str,
    relative_path: str,
) -> Path:
    base = plugin_system.plugin_dir(config_dir, plugin_id).resolve()
    target = (base / relative_path).resolve()
    if base not in target.parents:
        raise plugin_system.PluginError(
            f"AI contribution escapes plugin directory: {relative_path!r}"
        )
    if not target.is_file():
        raise plugin_system.PluginError(f"AI contribution not found: {relative_path!r}")
    if target.stat().st_size > _MAX_CONTRIBUTION_BYTES:
        raise plugin_system.PluginError(
            f"AI contribution is larger than {_MAX_CONTRIBUTION_BYTES} bytes"
        )
    return target


def _read_records(
    config_dir: Path,
    plugin_id: str,
    relative_paths: Iterable[str],
) -> list[dict[str, Any]]:
    """Read one or many descriptor records without executing plugin code."""

    records: list[dict[str, Any]] = []
    for relative_path in relative_paths:
        path = _safe_contribution_path(config_dir, plugin_id, relative_path)
        try:
            if path.suffix.lower() == ".json":
                raw = json.loads(path.read_text(encoding="utf-8"))
            elif path.suffix.lower() in {".yaml", ".yml"}:
                raw = yaml.safe_load(path.read_text(encoding="utf-8"))
            else:
                raise plugin_system.PluginError("AI contribution descriptors must be JSON or YAML")
        except (OSError, json.JSONDecodeError, yaml.YAMLError) as exc:
            raise plugin_system.PluginError(
                f"Could not read AI contribution {relative_path!r}: {exc}"
            ) from exc
        values = raw if isinstance(raw, list) else [raw]
        if not all(isinstance(value, dict) for value in values):
            raise plugin_system.PluginError(
                f"AI contribution {relative_path!r} must contain an object or list"
            )
        for value in values:
            record = dict(value)
            instructions_file = record.pop("instructions_file", None)
            if instructions_file:
                instructions_path = _safe_contribution_path(
                    config_dir, plugin_id, str(instructions_file)
                )
                if instructions_path.suffix.lower() != ".md":
                    raise plugin_system.PluginError("Skill instructions_file must be Markdown")
                record["instructions"] = instructions_path.read_text(encoding="utf-8")
            records.append(record)
    return records


def _plugin_snapshot(
    plugin_id: str,
) -> tuple[Path, dict[str, Any], dict[str, Any], set[str], bool]:
    config_dir, state = _runtime_context()
    manifest = plugin_system.read_manifest(config_dir, plugin_id)
    granted = set(plugin_system.granted_permissions(state, plugin_id))
    enabled = builtin_plugins.is_enabled(state, plugin_id)
    return config_dir, state, manifest, granted, enabled


def _contribution_status(
    enabled: bool,
    granted: set[str],
    permission: str,
) -> CatalogStatus:
    return CatalogStatus.AVAILABLE if enabled and permission in granted else CatalogStatus.SUSPENDED


def _skill_provider(
    plugin_id: str,
) -> Callable[[], Iterable[Mapping[str, Any]]]:
    def provide() -> Iterable[Mapping[str, Any]]:
        try:
            config_dir, _state, manifest, granted, enabled = _plugin_snapshot(plugin_id)
            status = _contribution_status(enabled, granted, "ai:skills")
            records = _read_records(
                config_dir,
                plugin_id,
                (manifest.get("contributes") or {}).get("skills") or [],
            )
            for record in records:
                record["status"] = status
            return records
        except plugin_system.PluginError as exc:
            logger.warning(
                "Plugin %s AI skill contributions are unavailable: %s",
                plugin_id,
                exc,
            )
            return ()

    return provide


def _permission_policy(required_permissions: set[str]) -> dict[str, Any]:
    """Derive effects and minimum policy from sandbox permissions."""

    effects = {ToolEffect.READ}
    minimum_role = "viewer"
    confirmation = ConfirmationPolicy.NONE
    if {"vault:write", "settings"}.intersection(required_permissions):
        effects.add(ToolEffect.LOCAL_WRITE)
        minimum_role = "editor"
        confirmation = ConfirmationPolicy.EXPLICIT_REQUEST
    if "vault:delete" in required_permissions:
        effects.add(ToolEffect.DESTRUCTIVE)
        minimum_role = "admin"
        confirmation = ConfirmationPolicy.ALWAYS
    return {
        "effects": sorted(effects, key=lambda value: value.value),
        "minimum_role": minimum_role,
        "confirmation": confirmation,
    }


def _schema_python_type(schema: Mapping[str, Any]) -> type[Any]:
    kind = str(schema.get("type") or "")
    return {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": list,
        "object": dict,
    }.get(kind, Any)


def _callable_signature(input_schema: Mapping[str, Any]) -> inspect.Signature:
    properties = input_schema.get("properties") or {}
    required = set(input_schema.get("required") or [])
    parameters = []
    for name, schema in properties.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(name)):
            raise plugin_system.PluginError(
                f"Sandboxed tool argument is not a safe identifier: {name!r}"
            )
        schema_mapping = schema if isinstance(schema, Mapping) else {}
        default = inspect.Parameter.empty if name in required else schema_mapping.get("default")
        parameters.append(
            inspect.Parameter(
                str(name),
                inspect.Parameter.KEYWORD_ONLY,
                default=default,
                annotation=_schema_python_type(schema_mapping),
            )
        )
    return inspect.Signature(parameters=parameters)


def _sandbox_handler(
    plugin_id: str,
    tool_id: str,
    description: str,
    input_schema: Mapping[str, Any],
    required_permissions: set[str],
) -> Callable[..., Any]:
    """Create a schema-bearing callable backed by the restricted Node runner."""

    action = tool_id.removeprefix(f"plugin.{plugin_id}.")

    def invoke(**arguments: Any) -> Any:
        config_dir, state, manifest, granted, enabled = _plugin_snapshot(plugin_id)
        if not enabled or "ai:tools" not in granted:
            raise RuntimeError(f"Plugin tool {tool_id!r} is suspended")
        missing = required_permissions.difference(granted)
        if missing:
            raise RuntimeError(
                "Plugin tool permissions are unavailable: " + ", ".join(sorted(missing))
            )
        result = plugin_sandbox.run_event(
            config_dir,
            manifest,
            sorted(required_permissions),
            f"agent.tool.{action}",
            {"arguments": arguments, "tool_id": tool_id},
        )
        if not result.get("ok"):
            raise RuntimeError(str(result.get("error") or f"Plugin tool {tool_id!r} failed"))
        return result.get("result")

    invoke.__name__ = re.sub(r"[^A-Za-z0-9_]", "_", tool_id)
    invoke.__doc__ = description or f"Run the sandboxed plugin tool {tool_id}."
    setattr(invoke, "__signature__", _callable_signature(input_schema))
    return invoke


def _tool_provider(plugin_id: str) -> Callable[[], Iterable[ToolRegistration]]:
    def provide() -> Iterable[ToolRegistration]:
        try:
            config_dir, _state, manifest, granted, enabled = _plugin_snapshot(plugin_id)
            records = _read_records(
                config_dir,
                plugin_id,
                (manifest.get("contributes") or {}).get("agentTools") or [],
            )
            registrations: list[ToolRegistration] = []
            declared = set(manifest.get("permissions") or [])
            for value in records:
                record = dict(value)
                required_permissions = {
                    str(permission) for permission in record.pop("required_permissions", [])
                }
                allowed_runtime_permissions = set(plugin_sandbox.runtime_permissions())
                if not required_permissions.issubset(allowed_runtime_permissions):
                    raise plugin_system.PluginError(
                        "Agent tool requests unsupported sandbox permissions: "
                        + ", ".join(
                            sorted(required_permissions.difference(allowed_runtime_permissions))
                        )
                    )
                if not required_permissions.issubset(declared):
                    raise plugin_system.PluginError(
                        "Agent tool requests permissions absent from manifest: "
                        + ", ".join(sorted(required_permissions.difference(declared)))
                    )
                tool_id = str(record.get("id") or "")
                description = str(record.get("description") or "")
                raw_input_schema = record.get("input_schema")
                input_schema = (
                    cast(dict[str, Any], raw_input_schema)
                    if isinstance(raw_input_schema, dict)
                    else {"type": "object", "properties": {}}
                )
                policy = _permission_policy(required_permissions)
                record.update(policy)
                record["status"] = (
                    CatalogStatus.AVAILABLE
                    if (
                        enabled
                        and "ai:tools" in granted
                        and required_permissions.issubset(granted)
                        and manifest.get("backend")
                    )
                    else CatalogStatus.SUSPENDED
                )
                record["handler_ref"] = f"sandbox:{plugin_id}:{tool_id}"
                metadata = dict(record.get("metadata") or {})
                metadata["required_permissions"] = sorted(required_permissions)
                metadata["sandboxed"] = True
                record["metadata"] = metadata
                record["origin"] = CatalogOrigin(
                    type=OriginType.PLUGIN,
                    id=plugin_id,
                )
                handler = _sandbox_handler(
                    plugin_id,
                    tool_id,
                    description,
                    input_schema,
                    required_permissions,
                )
                registrations.append(
                    ToolRegistration(
                        descriptor=ToolDescriptor.model_validate(record),
                        handler=handler,
                    )
                )
            return registrations
        except plugin_system.PluginError as exc:
            logger.warning(
                "Plugin %s AI tool contributions are unavailable: %s",
                plugin_id,
                exc,
            )
            return ()

    return provide


def _normalize_agent_id(plugin_id: str, value: Any) -> str:
    local_id = str(value or "").strip().lower()
    prefix = f"plugin.{plugin_id}."
    if local_id.startswith(prefix):
        candidate = local_id
    else:
        candidate = prefix + local_id
    if not re.fullmatch(
        rf"plugin\.{re.escape(plugin_id)}\.[a-z0-9][a-z0-9._-]*",
        candidate,
    ):
        raise plugin_system.PluginError(f"Invalid contributed agent ID: {value!r}")
    return candidate


def _agent_templates(
    config_dir: Path,
    manifest: Mapping[str, Any],
) -> list[dict[str, Any]]:
    plugin_id = str(manifest["id"])
    records = _read_records(
        config_dir,
        plugin_id,
        (manifest.get("contributes") or {}).get("agents") or [],
    )
    templates = []
    for value in records:
        template = dict(value)
        template["id"] = _normalize_agent_id(plugin_id, template.get("id"))
        template["managed_by"] = _MANAGED_BY_PREFIX + plugin_id
        for field in ("skill_ids", "required_skill_ids", "context_refs"):
            if field in template and not isinstance(template[field], list):
                raise plugin_system.PluginError(f"Contributed agent field {field!r} must be a list")
        templates.append(template)
    return templates


def _reconcile_agents(
    config_dir: Path,
    state: Mapping[str, Any],
    manifests: Mapping[str, Mapping[str, Any]],
) -> bool:
    """Reconcile managed profiles while preserving every user override."""

    cfg = load_params(strict_env=False)
    params = cfg.params
    ai = params.setdefault("ai", {})
    agents = ai.setdefault("agents", [])
    if not isinstance(agents, list):
        raise plugin_system.PluginError("ai.agents must be a list")
    by_id = {str(agent.get("id") or ""): agent for agent in agents if isinstance(agent, dict)}
    changed = False
    active_template_ids: set[str] = set()

    for plugin_id, manifest in manifests.items():
        granted = set(plugin_system.granted_permissions(dict(state), plugin_id))
        active = builtin_plugins.is_enabled(state, plugin_id) and "ai:agents" in granted
        templates = _agent_templates(config_dir, manifest) if active else []
        for template in templates:
            agent_id = str(template["id"])
            active_template_ids.add(agent_id)
            current = by_id.get(agent_id)
            if current is None:
                current = dict(template)
                current.setdefault(
                    "enabled",
                    bool(current.get("provider") and current.get("model")),
                )
                agents.append(current)
                by_id[agent_id] = current
                changed = True
            elif current.get("managed_by") != _MANAGED_BY_PREFIX + plugin_id:
                raise plugin_system.PluginError(
                    f"Contributed agent ID conflicts with user profile: {agent_id}"
                )
            else:
                for key, default_value in template.items():
                    if key not in current:
                        current[key] = default_value
                        changed = True
            if current.pop("plugin_suspended", False):
                current["enabled"] = bool(
                    current.pop(
                        "plugin_enabled_before_suspend",
                        bool(current.get("provider") and current.get("model")),
                    )
                )
                changed = True

    for agent in agents:
        if not isinstance(agent, dict):
            continue
        managed_by = str(agent.get("managed_by") or "")
        if not managed_by.startswith(_MANAGED_BY_PREFIX):
            continue
        if str(agent.get("id") or "") in active_template_ids:
            continue
        if not agent.get("plugin_suspended"):
            agent["plugin_enabled_before_suspend"] = bool(agent.get("enabled", True))
            agent["plugin_suspended"] = True
            agent["enabled"] = False
            changed = True

    if changed:
        safe_write_text(
            cfg.params_source,
            yaml.safe_dump(
                params,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            ),
        )
    return changed


def reconcile_plugin_ai_contributions() -> dict[str, Any]:
    """Register catalogs and reconcile agent templates idempotently."""

    with _reconcile_lock:
        try:
            config_dir, state = _runtime_context()
        except plugin_system.PluginError:
            return {
                "plugins": [],
                "registered_plugins": sorted(_registered_plugin_ids),
                "agents_changed": False,
            }
        manifests: dict[str, dict[str, Any]] = {}
        for entry in plugin_system.discover_plugins(config_dir):
            manifest = entry.get("manifest")
            if not manifest:
                continue
            plugin_id = str(manifest["id"])
            manifests[plugin_id] = manifest
            contributions = manifest.get("contributes") or {}
            if contributions.get("skills"):
                register_plugin_skill_provider(plugin_id, _skill_provider(plugin_id))
            if contributions.get("agentTools"):
                register_plugin_tool_provider(plugin_id, _tool_provider(plugin_id))
            _registered_plugin_ids.add(plugin_id)

        changed = _reconcile_agents(config_dir, state, manifests)
        return {
            "plugins": sorted(manifests),
            "registered_plugins": sorted(_registered_plugin_ids),
            "agents_changed": changed,
        }
