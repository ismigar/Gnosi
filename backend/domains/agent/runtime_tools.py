"""Typed agent capability resolution, metadata and tool selection."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable, List, Optional, Sequence

from backend.agent.action_confirmations import confirmation_event
from backend.agent.gnosi_tools import (
    CONFIRMED_WRITE_TOOLS,
    EXPLICIT_WRITE_TOOLS,
)
from backend.agent.system_tools import save_memory
from backend.agent.vault_tools import create_page, summarize_to_cornell
from backend.config.app_config import load_params
from backend.services.agent_capability_health import assess_tool_capability

MAX_BOUND_TOOLS = 64


MAX_RELEVANT_READ_TOOLS = 16


DEFAULT_CONTEXT_WINDOW_TOKENS = 8_192


GUARDED_TOOL_EFFECTS = frozenset(
    {
        "local_write",
        "external_write",
        "destructive",
        "code_execution",
        "ai_cost",
        "bulk_write",
        "financial_cost",
        "data_egress",
    }
)


TURN_TOOL_DOMAINS = {
    "mail": {
        "aliases": (
            "mail",
            "email",
            "correu",
            "correo",
            "courriel",
            "inbox",
            "bustia",
            "buzon",
        ),
        "markers": ("mail", "email", "inbox", "draft"),
    },
    "calendar": {
        "aliases": (
            "calendar",
            "calendari",
            "calendario",
            "calendrier",
            "event",
            "esdeveniment",
            "evento",
        ),
        "markers": ("calendar", "event"),
    },
    "contacts": {
        "aliases": ("contact", "contacte", "contacto"),
        "markers": ("contact",),
    },
    "tasks": {
        "aliases": ("task", "tasca", "tarea", "todo", "pendent"),
        "markers": ("task", "todo"),
    },
    "reader": {
        "aliases": (
            "reader",
            "news",
            "noticia",
            "article",
            "rss",
            "llegida",
            "unread",
        ),
        "markers": ("reader", "article", "news", "rss"),
    },
    "tables": {
        "aliases": (
            "table",
            "taula",
            "tabla",
            "database",
            "recurs",
            "resource",
            "row",
            "fila",
            "registre",
            "registro",
        ),
        "markers": ("table", "database", "row", "resource"),
    },
    "vault": {
        "aliases": (
            "vault",
            "wiki",
            "page",
            "pagina",
            "nota",
            "note",
            "document",
            "pdf",
            "memory",
            "memoria",
        ),
        "markers": (
            "vault",
            "wiki",
            "page",
            "note",
            "document",
            "pdf",
            "memory",
            "search",
        ),
    },
    "files": {
        "aliases": (
            "file",
            "fitxer",
            "archivo",
            "fichier",
            "folder",
            "carpeta",
            "directori",
            "directory",
        ),
        "markers": ("file", "folder", "directory"),
    },
    "web": {
        "aliases": ("web", "internet", "browser", "url", "navega"),
        "markers": ("web", "browser", "url", "http"),
    },
    "weather": {
        "aliases": ("weather", "forecast", "temps", "tiempo", "meteo"),
        "markers": ("weather", "forecast", "meteo"),
    },
}


def _safe_mcp_definitions(
    definitions: list[dict[str, Any]],
    explicit_allowlist: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """Keep MCP tools explicitly declared read-only or exactly allowlisted."""
    allowed_names = {str(name) for name in (explicit_allowlist or [])}
    safe = []
    for definition in definitions or []:
        if not isinstance(definition, dict) or not definition.get("name"):
            continue
        annotations = definition.get("annotations") or {}
        declared_read_only = (
            annotations.get("readOnlyHint") is True
            and annotations.get("destructiveHint") is not True
        )
        if declared_read_only or definition["name"] in allowed_names:
            safe.append(definition)
    return safe


def _rejected_mcp_names(
    definitions: list[dict[str, Any]],
    safe_definitions: list[dict[str, Any]],
) -> list[str]:
    """Return tool names withheld because read-only safety was not established."""
    safe_names = {item.get("name") for item in safe_definitions}
    return sorted(
        {
            str(item.get("name"))
            for item in definitions or []
            if isinstance(item, dict) and item.get("name") and item.get("name") not in safe_names
        }
    )


def _coder_read_only_tools(tools: Sequence[Any]) -> List[Any]:
    """Limit the coding specialist to code and directive inspection."""
    allowed_names = {
        "inspect_codebase",
        "search_code_symbols",
        "list_directives",
        "read_directive",
    }
    return [tool for tool in tools if tool.name in allowed_names]


def _authorized_brain_write_tools(names: set[str]) -> List[Any]:
    """Resolve only the explicitly authorized write-tool names."""
    tools_by_name = {
        "create_page": create_page,
        "summarize_to_cornell": summarize_to_cornell,
        "save_memory": save_memory,
        **{tool.name: tool for tool in EXPLICIT_WRITE_TOOLS},
        **{tool.name: tool for tool in CONFIRMED_WRITE_TOOLS},
    }
    return [tool for name, tool in tools_by_name.items() if name in names]


def _model_supports_tools(
    provider_name: str,
    model_name: Optional[str],
    agent_data: dict[str, Any],
) -> bool:
    """Resolve tool support from profile override, registry, then catalog."""
    capabilities = agent_data.get("capabilities")
    if isinstance(capabilities, list):
        return "tools" in capabilities
    if isinstance(capabilities, dict) and "tools" in capabilities:
        return bool(capabilities["tools"])
    try:
        from backend.agent.model_router import load_registry

        match = next(
            (
                row
                for row in load_registry(with_catalog_prices=False)
                if row.get("provider") == provider_name and row.get("model_id") == model_name
            ),
            None,
        )
        if match is not None:
            return "tools" in set(match.get("tags") or [])
    except Exception:
        pass
    try:
        from backend.agent.model_catalog import catalog_provider

        provider = catalog_provider(provider_name)
        match = next(
            (row for row in (provider or {}).get("models", []) if row.get("id") == model_name),
            None,
        )
        if match is not None:
            return "tools" in set(match.get("tags") or [])
    except Exception:
        pass
    # Unknown/custom models fail closed. Agent profiles can explicitly opt in
    # through `capabilities.tools: true` after compatibility is verified.
    return False


def _model_context_window(provider_name: str, model_name: Optional[str]) -> int:
    """Resolve the selected model context window with a fail-small fallback."""
    try:
        from backend.agent.model_router import load_registry

        match = next(
            (
                row
                for row in load_registry(with_catalog_prices=False)
                if row.get("provider") == provider_name and row.get("model_id") == model_name
            ),
            None,
        )
        if match:
            return max(2_048, int(match.get("context_window") or 0))
    except Exception:
        pass
    return DEFAULT_CONTEXT_WINDOW_TOKENS


def _tool_schema_chars(tools: Sequence[Any]) -> int:
    """Estimate serialized tool-schema input charged by providers."""
    total = 0
    for item in tools:
        schema = getattr(item, "args_schema", None)
        try:
            payload = schema.model_json_schema() if schema else {}
        except Exception:
            payload = {}
        total += len(str(getattr(item, "name", "")))
        total += len(str(getattr(item, "description", "")))
        total += len(json.dumps(payload, ensure_ascii=False, default=str))
    return total


def _select_agent_profile(
    ai_cfg: dict[str, Any],
    agent_id: str,
) -> dict[str, Any] | None:
    """Select one enabled-compatible profile using the historical fallback."""
    agents = ai_cfg.get("agents", []) or []
    target_id = agent_id or ai_cfg.get("active_agent_id")
    agent_data = next(
        (agent for agent in agents if agent.get("id") == target_id),
        None,
    )
    if not agent_data and agents:
        agent_data = next(
            (agent for agent in agents if agent.get("enabled", True)),
            agents[0],
        )
    return agent_data


def _resolve_runtime_capabilities(
    agent_data: dict[str, Any],
    *,
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[Iterable[str]] = None,
) -> Any:
    """Resolve assigned skills through the governed catalog.

    The import remains local while the catalog is introduced so older installs
    can still start during the compatibility release. Once the catalog exists,
    validation or resolution errors are deliberately propagated: silently
    falling back to a broader legacy tool belt would be a privilege escalation.
    """
    try:
        from backend.services.agent_skill_catalog import resolve_agent_runtime
    except ImportError:
        return None
    return resolve_agent_runtime(
        agent_data,
        vault_path=vault_path,
        active_skill_ids=active_skill_ids,
    )


def prepare_agent_runtime(
    agent_id: str,
    *,
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[Iterable[str]] = None,
) -> tuple[dict[str, Any], dict[str, Any] | None, Any]:
    """Load current AI config, selected profile, and resolved capabilities."""
    raw_ai_cfg = load_params(strict_env=False).ai
    ai_cfg = dict(raw_ai_cfg) if isinstance(raw_ai_cfg, dict) else {}
    agent_data = _select_agent_profile(ai_cfg, agent_id)
    runtime = (
        _resolve_runtime_capabilities(
            agent_data,
            vault_path=vault_path,
            active_skill_ids=active_skill_ids,
        )
        if agent_data
        else None
    )
    return ai_cfg, agent_data, runtime


def _tool_name(item: Any) -> str:
    """Return the model-visible name of a BaseTool or plain callable."""
    return str(getattr(item, "name", "") or getattr(item, "__name__", "") or "")


def _deduplicate_tools(tools: Iterable[Any]) -> List[Any]:
    """Deduplicate LangChain tools and callables by model-visible name."""
    result = []
    names: set[str] = set()
    for item in tools:
        name = _tool_name(item)
        if not name or name in names:
            continue
        names.add(name)
        result.append(item)
    return result


def _omitted_runtime_tool_ids(
    runtime_tool_metadata: Iterable[dict[str, Any]],
    bound_tool_names: set[str],
    *,
    notebook_context_only: bool,
) -> list[str]:
    """Return genuinely unavailable runtime tools for status reporting.

    Grounded notebooks deliberately replace the agent's ordinary tool belt
    with dynamic, read-only notebook tools. Ordinary profile tools omitted by
    that policy are not runtime failures and must not trigger a configuration
    warning in the embedded chat.
    """
    return [
        str(item.get("id") or "")
        for item in runtime_tool_metadata
        if item.get("name") not in bound_tool_names
        and item.get("id")
        and (not notebook_context_only or item.get("dynamic_context"))
    ]


def _latest_tool_batch_requires_confirmation(messages: Iterable[Any]) -> bool:
    """Stops the model loop once a consequential action preview is ready."""
    for message in reversed(list(messages)):
        message_type = str(getattr(message, "type", "") or "")
        if message_type == "ai":
            break
        if message_type == "tool" and confirmation_event(
            getattr(message, "content", ""),
        ):
            return True
    return False


def _descriptor_value(descriptor: Any, field: str, default: Any = None) -> Any:
    if isinstance(descriptor, dict):
        return descriptor.get(field, default)
    return getattr(descriptor, field, default)


def _descriptor_effects(descriptor: Any) -> tuple[str, ...]:
    """Normalize descriptor effects without depending on its concrete model."""
    values = _descriptor_value(descriptor, "effects", ()) or ()
    result = []
    for value in values:
        raw = getattr(value, "value", value)
        if raw:
            result.append(str(raw))
    return tuple(result)


def _runtime_tool_metadata(
    runtime: Any,
) -> tuple[list[dict[str, Any]], set[str]]:
    """Build public metadata and guarded names for resolved runtime tools."""
    tools = list(getattr(runtime, "tools", ()) or ())
    descriptors = list(getattr(runtime, "tool_descriptors", ()) or ())
    skills = list(getattr(runtime, "skills", ()) or ())
    active_skill_ids = {
        str(skill_id) for skill_id in (getattr(runtime, "active_skill_ids", ()) or ())
    }
    tool_skill_ids: dict[str, list[str]] = {}
    for skill in skills:
        skill_descriptor = _descriptor_value(skill, "descriptor", skill)
        skill_id = str(_descriptor_value(skill_descriptor, "id", "") or "")
        if skill_id not in active_skill_ids:
            continue
        for tool_id in _descriptor_value(skill_descriptor, "tool_ids", ()) or ():
            tool_skill_ids.setdefault(str(tool_id), []).append(skill_id)

    metadata = []
    guarded_names: set[str] = set()
    for index, tool in enumerate(tools):
        descriptor = descriptors[index] if index < len(descriptors) else None
        tool_id = str(_descriptor_value(descriptor, "id", "") or "")
        tool_name = _tool_name(tool) or tool_id
        effects = _descriptor_effects(descriptor)
        confirmation = str(
            getattr(
                _descriptor_value(descriptor, "confirmation", ""),
                "value",
                _descriptor_value(descriptor, "confirmation", ""),
            )
            or ""
        )
        minimum_role = str(_descriptor_value(descriptor, "minimum_role", "viewer") or "viewer")
        health = assess_tool_capability(descriptor, tool)
        if GUARDED_TOOL_EFFECTS.intersection(effects) or confirmation not in {
            "",
            "never",
            "none",
        }:
            guarded_names.add(tool_name)
        metadata.append(
            {
                "id": tool_id or tool_name,
                "name": tool_name,
                "effects": list(effects),
                "skill_ids": tool_skill_ids.get(tool_id, []),
                "minimum_role": minimum_role,
                "confirmation": confirmation or "none",
                "prepares_confirmation": bool(
                    (_descriptor_value(descriptor, "metadata", {}) or {}).get(
                        "prepares_confirmation"
                    )
                ),
                "health": health,
                "_descriptor": descriptor,
            }
        )
    return metadata, guarded_names


def _turn_model_tools(
    tools: Iterable[Any],
    metadata: Iterable[dict[str, Any]],
    authorized_tool_names: Iterable[str],
    *,
    user_message: str = "",
    narrow_passive_reads: bool = False,
    required_read_tool_names: Iterable[str] = (),
) -> List[Any]:
    """Bind relevant passive reads and exact current-turn guarded grants."""
    policies = {str(item.get("name") or ""): item for item in metadata if item.get("name")}
    authorized = {str(name) for name in authorized_tool_names if str(name)}
    required_reads = {str(name) for name in required_read_tool_names if str(name)}
    normalized_message = unicodedata.normalize(
        "NFKD",
        str(user_message or "").casefold(),
    )
    normalized_message = " ".join(
        re.sub(
            r"[^a-z0-9]+",
            " ",
            "".join(
                character
                for character in normalized_message
                if not unicodedata.combining(character)
            ),
        ).split()
    )
    message_tokens = {token for token in normalized_message.split() if len(token) >= 3}
    domain_markers: set[str] = set()
    for domain in TURN_TOOL_DOMAINS.values():
        if any(
            token == alias or token.startswith(alias)
            for alias in domain["aliases"]
            for token in message_tokens
        ):
            domain_markers.update(domain["markers"])
    if not domain_markers and any(
        token.startswith(alias)
        for alias in ("cerca", "busca", "search", "find", "troba")
        for token in message_tokens
    ):
        domain_markers.update(("search", "query"))

    def passive_tool_is_relevant(tool: Any, policy: dict[str, Any]) -> bool:
        if not narrow_passive_reads:
            return True
        searchable = " ".join(
            (
                _tool_name(tool),
                str(getattr(tool, "description", "") or ""),
                str(policy.get("id") or ""),
                " ".join(str(value) for value in (policy.get("skill_ids") or [])),
            )
        )
        decomposed = unicodedata.normalize("NFKD", searchable.casefold())
        searchable_tokens = {
            token
            for token in re.sub(
                r"[^a-z0-9]+",
                " ",
                "".join(
                    character for character in decomposed if not unicodedata.combining(character)
                ),
            ).split()
            if len(token) >= 3
        }
        return bool(
            message_tokens.intersection(searchable_tokens)
            or domain_markers.intersection(searchable_tokens)
        )

    selected = []
    selected_passive_reads = 0
    for tool in tools:
        name = _tool_name(tool)
        policy = policies.get(name)
        if not policy:
            continue
        confirmation = str(policy.get("confirmation") or "none")
        effects = {str(value) for value in (policy.get("effects") or [])}
        passive_read = confirmation in {
            "",
            "never",
            "none",
        } and not GUARDED_TOOL_EFFECTS.intersection(effects)
        if name in authorized:
            selected.append(tool)
            continue
        if (
            passive_read
            and selected_passive_reads < MAX_RELEVANT_READ_TOOLS
            and (name in required_reads or passive_tool_is_relevant(tool, policy))
        ):
            selected.append(tool)
            selected_passive_reads += 1
    return selected
