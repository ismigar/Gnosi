"""Provider-independent planning for governed agent turns."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

LOCAL_PROVIDERS = frozenset({"ollama", "llama-cpp", "lmstudio", "local", "generic"})


GUARDED_EFFECTS = frozenset(
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


PRIVATE_CONTEXT_TYPES = frozenset(
    {
        "file",
        "page",
        "table",
        "database",
        "vault",
        "internal",
    }
)


DOMAIN_ALIASES = {
    "mail": ("mail", "email", "correu", "correo", "courriel", "inbox", "bustia", "buzon"),
    "calendar": (
        "calendar",
        "calendari",
        "calendario",
        "calendrier",
        "event",
        "esdeveniment",
        "evento",
    ),
    "contacts": ("contact", "contacte", "contacto"),
    "tasks": ("task", "tasca", "tarea", "todo", "pendent"),
    "reader": ("reader", "news", "noticia", "noticies", "article", "rss", "feed", "unread"),
    "vault": (
        "vault",
        "wiki",
        "page",
        "pagina",
        "nota",
        "note",
        "document",
        "pdf",
        "table",
        "taula",
        "tabla",
        "database",
        "registre",
        "registro",
        "recurs",
        "resource",
        "font",
        "fuente",
        "source",
        "projecte",
        "proyecto",
    ),
    "files": (
        "file",
        "fitxer",
        "archivo",
        "fichier",
        "folder",
        "carpeta",
        "directori",
        "directory",
    ),
    "web": ("web", "internet", "browser", "navega", "url"),
    "weather": ("weather", "forecast", "temps", "tiempo", "meteo"),
    "notion": ("notion",),
    "zotero": ("zotero", "reference", "referencia", "bibliografia"),
}


DOMAIN_TOOL_MARKERS = {
    "mail": ("mail", "email", "inbox", "draft"),
    "calendar": ("calendar", "event"),
    "contacts": ("contact",),
    "tasks": ("task", "todo", "planning"),
    "reader": ("reader", "article", "news", "rss", "feed"),
    "vault": (
        "vault",
        "wiki",
        "page",
        "note",
        "document",
        "pdf",
        "table",
        "database",
        "context",
        "memory",
        "resource",
    ),
    "files": ("file", "folder", "directory"),
    "web": ("web", "browser", "url", "http", "search"),
    "weather": ("weather", "forecast", "meteo"),
    "notion": ("notion",),
    "zotero": ("zotero", "reference", "bibliograph"),
}


COMPLETION_RE = re.compile(
    r"\b(?:completed|finished|done|sent|deleted|created|updated|published|scheduled|"
    r"completat|completada|fet|feta|enviat|enviada|eliminat|eliminada|creat|creada|"
    r"actualitzat|actualizada|publicat|publicada|programat|programada|"
    r"termine|terminee|envoye|supprime|cree|publie|planifie)\b",
    re.IGNORECASE,
)


TURN_BUDGETS = {
    "conversation": {
        "timeout_seconds": 60,
        "max_model_calls": 2,
        "max_tool_calls": 0,
        "max_read_tool_results": 0,
    },
    "lookup": {
        "timeout_seconds": 120,
        "max_model_calls": 4,
        "max_tool_calls": 8,
        "max_read_tool_results": 3,
    },
    "inventory": {
        "timeout_seconds": 120,
        "max_model_calls": 4,
        "max_tool_calls": 6,
        "max_read_tool_results": 3,
    },
    "analysis": {
        "timeout_seconds": 120,
        "max_model_calls": 6,
        "max_tool_calls": 12,
        "max_read_tool_results": 4,
    },
    "action": {
        "timeout_seconds": 120,
        "max_model_calls": 8,
        "max_tool_calls": 12,
        "max_read_tool_results": 4,
    },
}


def turn_budgets_for_mode(mode: str) -> dict[str, int]:
    """Return a bounded copy of the operational budget for a request mode."""
    selected = TURN_BUDGETS.get(str(mode or "").strip().lower())
    if selected is None:
        selected = TURN_BUDGETS["conversation"]
    return {key: max(0, int(value)) for key, value in selected.items()}


def normalize_request_text(value: Any) -> str:
    """Return accent-insensitive text used only for deterministic routing."""
    decomposed = unicodedata.normalize("NFKD", str(value or "").casefold())
    plain = "".join(character for character in decomposed if not unicodedata.combining(character))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", plain).split())


def detect_request_domains(message: str) -> list[str]:
    """Return explicit request domains without inferring them from attachments."""
    text = f" {normalize_request_text(message)} "
    domains = []
    for domain, aliases in DOMAIN_ALIASES.items():
        if any(re.search(rf"\b{re.escape(alias)}\w*\b", text) for alias in aliases):
            domains.append(domain)
    if "vault" in domains and any(domain != "vault" for domain in domains):
        explicit_vault_container = re.search(
            r"\b(?:vault|wiki|taula|taules|tabla|tablas|table|tables|database)\b",
            text,
        )
        if not explicit_vault_container:
            domains.remove("vault")
    return domains


def _tool_effects(metadata: Mapping[str, Any]) -> set[str]:
    return {
        str(effect).strip().lower()
        for effect in (metadata.get("effects") or [])
        if str(effect or "").strip()
    }


def _tool_matches_domains(name: str, domains: Sequence[str]) -> bool:
    normalized = str(name or "").strip().lower()
    return any(
        any(marker in normalized for marker in DOMAIN_TOOL_MARKERS.get(domain, ()))
        for domain in domains
    )


def _response_language(message: str) -> str:
    text = normalize_request_text(message)
    if re.search(
        r"\b(?:soc|troba|cerca|llista|mostra|quins|quines|tinc|amb|dels|aquest|aquesta|diu|tasca|projecte)\b",
        text,
    ):
        return "ca"
    if re.search(r"\b(?:soy|busca|lista|muestra|cuales|tengo|tarea|proyecto)\b", text):
        return "es"
    if re.search(r"\b(?:je|cherche|trouve|liste|quels|quelles|projet)\b", text):
        return "fr"
    return "en"


def build_turn_plan(
    message: str,
    *,
    mode: str,
    context_refs: Iterable[Mapping[str, Any]] = (),
    tool_metadata: Iterable[Mapping[str, Any]] = (),
    authorized_tool_names: Iterable[str] = (),
    provider: str = "",
    required_tool_name: str = "",
    route: str = "",
) -> dict[str, Any]:
    """Build the effective request-scoped capability and privacy plan."""
    from backend.agent.semantic_interpreter import broker_capabilities, interpret_request

    refs = [dict(ref) for ref in context_refs if isinstance(ref, Mapping)]
    tools = [dict(item) for item in tool_metadata if isinstance(item, Mapping)]
    authorized = {str(name) for name in authorized_tool_names if name}
    domains = detect_request_domains(message)
    interpretation = interpret_request(message, mode=mode, domains=domains)
    broker_candidates = broker_capabilities(interpretation, tools)
    guarded_tool_names = [
        str(item.get("name") or "")
        for item in tools
        if str(item.get("name") or "") and bool(_tool_effects(item).intersection(GUARDED_EFFECTS))
    ][:24]
    capability_broker: dict[str, Any] = {
        "broker_version": "capability-v1",
        "operation": str(interpretation.get("operation") or "conversation"),
        "candidate_tools": broker_candidates[:24],
        "guarded_tools": guarded_tool_names,
        "selection_policy": "semantic-domain-match; guarded effects require explicit authorization",
    }
    has_private_sources = any(
        str(ref.get("type") or "").lower() in PRIVATE_CONTEXT_TYPES for ref in refs
    )
    remote_model = bool(provider) and provider.strip().lower() not in LOCAL_PROVIDERS
    context_requested = mode in {"lookup", "inventory", "analysis"} and bool(refs)
    deterministic_output = bool(mode == "inventory" and required_tool_name == "inventory_context")
    budgets = turn_budgets_for_mode(mode)
    if deterministic_output:
        # Exact inventories are rendered from the governed result. Avoid
        # reserving or accidentally spending a model call after that result.
        budgets["max_model_calls"] = 0
        budgets["max_tool_calls"] = min(budgets["max_tool_calls"], 2)
        budgets["max_read_tool_results"] = min(
            budgets["max_read_tool_results"],
            budgets["max_tool_calls"],
        )

    allowed_tool_names: list[str] = []
    for item in tools:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        effects = _tool_effects(item)
        guarded = bool(effects.intersection(GUARDED_EFFECTS)) or str(
            item.get("confirmation") or "none"
        ) not in {"", "never", "none"}
        skill_ids = {str(value) for value in (item.get("skill_ids") or [])}
        explicitly_scoped_read = bool(
            skill_ids and "core.legacy-default-v1" not in skill_ids and not guarded
        )
        if guarded and name not in authorized:
            continue
        relevant = (
            name == required_tool_name
            or name in authorized
            or (
                context_requested
                and bool(item.get("dynamic_context"))
                and (not domains or _tool_matches_domains(name, domains))
            )
            or bool(
                domains
                and _tool_matches_domains(name, domains)
                and (context_requested or not item.get("dynamic_context"))
            )
            or explicitly_scoped_read
        )
        if mode == "conversation" and name not in authorized:
            relevant = False
        if relevant and name not in allowed_tool_names:
            allowed_tool_names.append(name)

    if required_tool_name and required_tool_name not in allowed_tool_names:
        allowed_tool_names.insert(0, required_tool_name)
    if deterministic_output:
        allowed_tool_names = [
            name for name in allowed_tool_names if name == required_tool_name or name in authorized
        ]
    allowed_tool_names = allowed_tool_names[:24]
    broker_candidates = [name for name in broker_candidates if name in allowed_tool_names]
    capability_broker["candidate_tools"] = broker_candidates[:24]
    domain_discovery: list[dict[str, Any]] = []
    for domain in domains[:8]:
        matching = [
            str(item.get("name") or "")
            for item in tools
            if item.get("name") and _tool_matches_domains(str(item.get("name")), [domain])
        ][:8]
        usable = [name for name in matching if name in allowed_tool_names]
        domain_discovery.append(
            {
                "domain": domain,
                "status": "ready"
                if usable
                else "assigned_but_guarded"
                if matching
                else "missing_capability",
                "candidate_tools": usable,
                "recommended_action": (
                    None
                    if usable
                    else "authorize_current_action"
                    if matching
                    else "connect_or_assign_skill"
                ),
            }
        )
    capability_broker["discovery"] = {
        "status": (
            "ready"
            if not domain_discovery or all(item["status"] == "ready" for item in domain_discovery)
            else "attention_required"
        ),
        "domains": domain_discovery,
        "automatic_install": False,
        "automatic_permission_grant": False,
    }

    durable_tool = (
        required_tool_name
        if required_tool_name.startswith("start_") and "analysis" in required_tool_name
        else ""
    )
    execution = "background" if durable_tool else "foreground"
    allowed_dynamic_context = any(
        item.get("dynamic_context") and item.get("name") in allowed_tool_names for item in tools
    )
    private_context_in_use = bool(
        has_private_sources and (allowed_dynamic_context or mode == "action" or required_tool_name)
    )
    private_evidence_to_remote_model = bool(
        remote_model and private_context_in_use and not deterministic_output
    )
    privacy_classification = (
        "private_remote_processing"
        if private_evidence_to_remote_model
        else "private_local_processing"
        if private_context_in_use
        else "external_read"
        if any(
            "external_read" in _tool_effects(item)
            for item in tools
            if item.get("name") in allowed_tool_names
        )
        else "standard"
    )
    plan_digest = hashlib.sha256(
        json.dumps(
            {
                "mode": mode,
                "domains": domains,
                "required_tool": required_tool_name,
                "allowed_tools": allowed_tool_names,
                "provider": provider,
                "context_types": sorted(str(ref.get("type") or "") for ref in refs),
                "budgets": budgets,
                "interpretation": interpretation.get("query_digest"),
                "capability_candidates": broker_candidates,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    effective_route = route or (
        "General" if mode == "conversation" and not allowed_tool_names else "Brain"
    )
    return {
        "schema_version": 1,
        "planner_version": "universal-v1",
        "interpreter_version": interpretation.get("interpreter_version"),
        "plan_id": plan_digest,
        "language": _response_language(message),
        "mode": mode,
        "domains": domains,
        "interpretation": interpretation,
        "capability_broker": capability_broker,
        "memory": {
            "checkpointed": True,
            "scope": "agent_session",
            "historical_tool_payloads_excluded": True,
        },
        "route": effective_route,
        "execution": execution,
        "output_strategy": ("deterministic" if deterministic_output else "model_synthesis"),
        "required_tool": required_tool_name or None,
        "allowed_tool_names": allowed_tool_names,
        "allowed_tool_count": len(allowed_tool_names),
        "budgets": budgets,
        "deadline": {
            "hard_seconds": int(budgets.get("timeout_seconds", 0)),
            "synthesis_reserve_seconds": min(
                20,
                max(5, int(budgets.get("timeout_seconds", 0)) // 6),
            ),
            "soft_seconds": max(
                1,
                int(budgets.get("timeout_seconds", 0))
                - min(20, max(5, int(budgets.get("timeout_seconds", 0)) // 6)),
            ),
            "policy": "synthesize_or_handoff_before_hard_deadline",
        },
        "optimization": {
            "deterministic_no_model": deterministic_output,
            "bounded_tool_calls": int(budgets.get("max_tool_calls", 0)),
            "prompt_cache": "disabled_for_private_content",
        },
        "privacy": {
            "classification": privacy_classification,
            "private_source_count": sum(
                str(ref.get("type") or "").lower() in PRIVATE_CONTEXT_TYPES for ref in refs
            ),
            "remote_model": remote_model,
            "private_evidence_to_remote_model": private_evidence_to_remote_model,
            "data_minimized": True,
            "cross_domain_reads_blocked": True,
        },
        "verification": {
            "source_evidence_required": bool(required_tool_name),
            "action_result_required": mode == "action",
            "exact_inventory_required": mode == "inventory",
        },
        "job": {
            "eligible": bool(durable_tool),
            "start_tool": durable_tool or None,
            "provider": "reader" if durable_tool.startswith("start_reader_") else None,
        },
    }
