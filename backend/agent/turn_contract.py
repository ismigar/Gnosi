"""Provider-independent planning and deterministic response verification.

The module deliberately handles operational metadata only. It never stores a
prompt, source body, or chain-of-thought. The plan is used to constrain the
runtime tool surface, and the verification report is derived from authoritative
current-turn tool results rather than from a second model call.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote, urlparse

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage


LOCAL_PROVIDERS = frozenset({"ollama", "llama-cpp", "lmstudio", "local", "generic"})
GUARDED_EFFECTS = frozenset({
    "local_write",
    "external_write",
    "destructive",
    "code_execution",
    "ai_cost",
    "bulk_write",
    "financial_cost",
    "data_egress",
})
PRIVATE_CONTEXT_TYPES = frozenset({
    "file",
    "page",
    "table",
    "database",
    "vault",
    "internal",
})
DOMAIN_ALIASES = {
    "mail": ("mail", "email", "correu", "correo", "courriel", "inbox", "bustia", "buzon"),
    "calendar": ("calendar", "calendari", "calendario", "calendrier", "event", "esdeveniment", "evento"),
    "contacts": ("contact", "contacte", "contacto"),
    "tasks": ("task", "tasca", "tarea", "todo", "pendent"),
    "reader": ("reader", "news", "noticia", "noticies", "article", "rss", "feed", "unread"),
    "vault": (
        "vault", "wiki", "page", "pagina", "nota", "note", "document", "pdf",
        "table", "taula", "tabla", "database", "registre", "registro", "recurs",
        "resource", "font", "fuente", "source", "projecte", "proyecto",
    ),
    "files": ("file", "fitxer", "archivo", "fichier", "folder", "carpeta", "directori", "directory"),
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
    "vault": ("vault", "wiki", "page", "note", "document", "pdf", "table", "database", "context", "memory", "resource"),
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
CITATION_MARKER_RE = re.compile(
    r"\[\[cite:([A-Za-z0-9][A-Za-z0-9._:-]{0,191})\]\]"
)
MAX_CITATION_SOURCES = 96
MAX_CITATION_CLAIMS = 128

# These are request-scoped safety budgets. They are deliberately kept in the
# provider-independent contract so every model, connector, and UI surface sees
# the same limits. The HTTP layer still owns the hard cancellation boundary.
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
    return {
        key: max(0, int(value))
        for key, value in selected.items()
    }


def normalize_request_text(value: Any) -> str:
    """Return accent-insensitive text used only for deterministic routing."""
    decomposed = unicodedata.normalize("NFKD", str(value or "").casefold())
    plain = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
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
    if re.search(r"\b(?:soc|troba|cerca|llista|mostra|quins|quines|tinc|amb|dels|aquest|aquesta|diu|tasca|projecte)\b", text):
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
        if str(item.get("name") or "")
        and bool(_tool_effects(item).intersection(GUARDED_EFFECTS))
    ][:24]
    capability_broker = {
        "broker_version": "capability-v1",
        "operation": str(interpretation.get("operation") or "conversation"),
        "candidate_tools": broker_candidates[:24],
        "guarded_tools": guarded_tool_names,
        "selection_policy": "semantic-domain-match; guarded effects require explicit authorization",
    }
    has_private_sources = any(
        str(ref.get("type") or "").lower() in PRIVATE_CONTEXT_TYPES
        for ref in refs
    )
    remote_model = bool(provider) and provider.strip().lower() not in LOCAL_PROVIDERS
    context_requested = mode in {"lookup", "inventory", "analysis"} and bool(refs)
    deterministic_output = bool(
        mode == "inventory" and required_tool_name == "inventory_context"
    )
    budgets = turn_budgets_for_mode(mode)

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
            name
            for name in allowed_tool_names
            if name == required_tool_name or name in authorized
        ]
    allowed_tool_names = allowed_tool_names[:24]
    broker_candidates = [
        name for name in broker_candidates
        if name in allowed_tool_names
    ]
    capability_broker["candidate_tools"] = broker_candidates[:24]

    durable_tool = (
        required_tool_name
        if required_tool_name.startswith("start_") and "analysis" in required_tool_name
        else ""
    )
    execution = "background" if durable_tool else "foreground"
    allowed_dynamic_context = any(
        item.get("dynamic_context") and item.get("name") in allowed_tool_names
        for item in tools
    )
    private_context_in_use = bool(
        has_private_sources
        and (allowed_dynamic_context or mode == "action" or required_tool_name)
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
        if any("external_read" in _tool_effects(item) for item in tools if item.get("name") in allowed_tool_names)
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
        "output_strategy": (
            "deterministic"
            if deterministic_output
            else "model_synthesis"
        ),
        "required_tool": required_tool_name or None,
        "allowed_tool_names": allowed_tool_names,
        "allowed_tool_count": len(allowed_tool_names),
        "budgets": budgets,
        "privacy": {
            "classification": privacy_classification,
            "private_source_count": sum(
                str(ref.get("type") or "").lower() in PRIVATE_CONTEXT_TYPES
                for ref in refs
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


def _current_turn_tool_messages(messages: Iterable[BaseMessage]) -> list[ToolMessage]:
    current: list[ToolMessage] = []
    for message in reversed(list(messages)):
        if str(getattr(message, "type", "") or "") == "human":
            break
        if isinstance(message, ToolMessage):
            current.append(message)
    return list(reversed(current))


def _tool_payload(message: ToolMessage) -> dict[str, Any]:
    content = getattr(message, "content", "")
    if not isinstance(content, str):
        return {}
    try:
        payload = json.loads(content)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _safe_job(tool_name: str, payload: Mapping[str, Any], plan: Mapping[str, Any]) -> dict[str, Any] | None:
    local_id = str(payload.get("job_id") or payload.get("id") or "").strip()
    if not local_id or not (tool_name.startswith("start_") or "analysis_status" in tool_name):
        return None
    provider = str((plan.get("job") or {}).get("provider") or "reader")
    job_id = local_id if ":" in local_id else f"{provider}:{local_id}"
    retry = payload.get("retry") if isinstance(payload.get("retry"), Mapping) else {}

    def nonnegative_int(value: Any) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    return {
        "job_id": job_id[:256],
        "provider": provider[:64],
        "status": str(payload.get("status") or payload.get("state") or "queued")[:64],
        "progress": payload.get("progress") if isinstance(payload.get("progress"), (int, float)) else None,
        "result_available": bool(payload.get("result_available")),
        "retry": {
            "automatic_enabled": bool(retry.get("automatic_enabled")),
            "attempt": nonnegative_int(retry.get("attempt")),
            "max_attempts": nonnegative_int(retry.get("max_attempts")),
            "next_retry_at": str(retry.get("next_retry_at") or "")[:64] or None,
            "model_call_budget": nonnegative_int(retry.get("model_call_budget")),
            "model_calls_used": nonnegative_int(retry.get("model_calls_used")),
            "last_retry_reason": str(retry.get("last_retry_reason") or "")[:128] or None,
            "budget_exhausted": bool(retry.get("budget_exhausted")),
        },
        "capabilities": {
            "status": True,
            "result": True,
            "resume": True,
            "cancel": bool(payload.get("cancellable", True)),
            "automatic_retry": bool(retry.get("automatic_enabled")),
        },
    }


def _bounded_label(value: Any, fallback: str, limit: int = 240) -> str:
    """Return one single-line presentation label without source content."""
    label = " ".join(str(value or "").split()).strip()
    return (label or fallback)[:limit]


def _safe_source_href(*, source_id: str, source_kind: str, url: Any = "") -> str:
    """Return an internal or HTTP(S) source link, never a filesystem path."""
    candidate = str(url or "").strip()
    if candidate:
        parsed = urlparse(candidate)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return candidate[:2_000]
    if not source_id:
        return ""
    encoded = quote(source_id, safe="")
    if source_kind == "reader_article":
        return f"/reader?article={encoded}"
    if source_kind == "vault_record":
        return f"/vault/page/{encoded}"
    return ""


def _citation_id(source_kind: str, source_id: str) -> str:
    digest = hashlib.sha256(
        f"{source_kind}:{source_id}".encode("utf-8")
    ).hexdigest()[:12]
    return f"src-{digest}"


def _citation_evidence(
    tools: Sequence[ToolMessage],
    tool_names: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, str], list[str], list[str]]:
    """Build safe source descriptors from successful current-turn evidence."""
    sources: list[dict[str, Any]] = []
    source_key_to_citation: dict[str, str] = {}
    ordered_record_citations: list[str] = []
    manifest_citations: list[str] = []
    seen_citations: set[str] = set()

    def add_source(
        *,
        source_id: Any,
        title: Any,
        source_kind: str,
        url: Any = "",
        marker_keys: Iterable[Any] = (),
    ) -> str:
        normalized_id = _bounded_label(source_id, "", 192)
        if not normalized_id or len(sources) >= MAX_CITATION_SOURCES:
            return ""
        citation_id = _citation_id(source_kind, normalized_id)
        if citation_id not in seen_citations:
            seen_citations.add(citation_id)
            sources.append({
                "citation_id": citation_id,
                "source_id": normalized_id,
                "title": _bounded_label(title, normalized_id),
                "source_type": source_kind,
                "href": _safe_source_href(
                    source_id=normalized_id,
                    source_kind=source_kind,
                    url=url,
                ),
            })
        for marker_key in (normalized_id, *marker_keys):
            key = _bounded_label(marker_key, "", 192)
            if key:
                source_key_to_citation.setdefault(key, citation_id)
        return citation_id

    for index, (tool, tool_name, payload) in enumerate(
        zip(tools, tool_names, payloads)
    ):
        if str(getattr(tool, "status", "") or "") == "error" or payload.get("error"):
            continue
        manifest_id = f"{tool_name or 'tool'}:{index + 1}"
        manifest_citation = add_source(
            source_id=manifest_id,
            title=f"{tool_name or 'Tool'} result",
            source_kind="tool_result",
            marker_keys=(tool_name,),
        )
        if manifest_citation:
            manifest_citations.append(manifest_citation)

        collections = (
            ("records", "vault_record"),
            ("articles", "reader_article"),
            ("sources", "source"),
            ("results", "source"),
            ("items", "source"),
            ("citations", "source"),
        )
        for collection_key, default_kind in collections:
            rows = payload.get(collection_key)
            if not isinstance(rows, list):
                continue
            for raw_row in rows:
                if not isinstance(raw_row, Mapping):
                    continue
                source_id = raw_row.get("id") or raw_row.get("source_id")
                if source_id in (None, ""):
                    continue
                source_kind = default_kind
                if collection_key == "records" and (
                    tool_name.startswith("inspect_reader")
                    or "article" in tool_name
                    or raw_row.get("published_at")
                ):
                    source_kind = "reader_article"
                citation_id = add_source(
                    source_id=source_id,
                    title=(
                        raw_row.get("title")
                        or raw_row.get("name")
                        or raw_row.get("label")
                    ),
                    source_kind=source_kind,
                    url=raw_row.get("url") or raw_row.get("href"),
                    marker_keys=(raw_row.get("citation_key"),),
                )
                if citation_id and collection_key == "records":
                    ordered_record_citations.append(citation_id)
    return (
        sources,
        source_key_to_citation,
        ordered_record_citations,
        manifest_citations,
    )


def _claim_citations(
    text: str,
    *,
    tools: Sequence[ToolMessage],
    tool_names: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
    plan: Mapping[str, Any],
) -> tuple[str, dict[str, Any]]:
    """Validate citation markers and map visible claims to current evidence."""
    (
        sources,
        source_key_to_citation,
        ordered_records,
        manifests,
    ) = _citation_evidence(tools, tool_names, payloads)
    required = bool((plan.get("verification") or {}).get("source_evidence_required"))
    deterministic = str(plan.get("output_strategy") or "") == "deterministic"
    required_tool = str(plan.get("required_tool") or "")
    if required_tool.startswith("start_") or "_status" in required_tool:
        deterministic = True

    claims: list[dict[str, Any]] = []
    limitations: list[str] = []
    unknown_markers = 0
    record_index = 0
    cleaned_lines: list[str] = []
    for line_index, raw_line in enumerate(str(text or "").splitlines()):
        marker_keys = CITATION_MARKER_RE.findall(raw_line)
        citation_ids = list(dict.fromkeys(
            source_key_to_citation[key]
            for key in marker_keys
            if key in source_key_to_citation
        ))
        unknown_markers += sum(
            key not in source_key_to_citation for key in marker_keys
        )
        cleaned = CITATION_MARKER_RE.sub("", raw_line).rstrip()
        cleaned = re.sub(r"\s+([.,;:!?])", r"\1", cleaned)
        cleaned_lines.append(cleaned)
        if deterministic and cleaned.strip():
            if re.match(r"^\s*\d+\.\s+", cleaned) and record_index < len(ordered_records):
                citation_ids = [ordered_records[record_index]]
                record_index += 1
            elif not citation_ids and manifests:
                citation_ids = [manifests[0]]
        if citation_ids and cleaned.strip() and len(claims) < MAX_CITATION_CLAIMS:
            claims.append({
                "claim_id": f"claim-{len(claims) + 1}",
                "line_index": line_index,
                "text": _bounded_label(cleaned, "Claim", 320),
                "citation_ids": citation_ids[:12],
            })

    cleaned_text = "\n".join(cleaned_lines)
    if unknown_markers:
        limitations.append("unknown_citation_id_rejected")
    if required and tools and not claims:
        limitations.append("claim_citations_missing")
    if any(not source.get("href") for source in sources):
        limitations.append("one_or_more_source_links_unavailable")
    if not required and not sources:
        status = "not_applicable"
    elif claims and not unknown_markers:
        status = "complete"
    elif sources:
        status = "partial"
    else:
        status = "missing"
    cited = {
        citation_id
        for claim in claims
        for citation_id in claim["citation_ids"]
    }
    return cleaned_text, {
        "schema_version": 1,
        "status": status,
        "claim_count": len(claims),
        "source_count": len(cited),
        "sources": [
            source for source in sources if source["citation_id"] in cited
        ],
        "claims": claims,
        "limitations": list(dict.fromkeys(limitations))[:8],
    }


def _blocked_text(language: str, reason: str) -> str:
    messages = {
        "missing_evidence": {
            "ca": "No puc verificar aquesta resposta perquè no s'ha consultat la font necessària.",
            "es": "No puedo verificar esta respuesta porque no se ha consultado la fuente necesaria.",
            "fr": "Je ne peux pas vérifier cette réponse car la source requise n'a pas été consultée.",
            "en": "I cannot verify this answer because the required source was not consulted.",
        },
        "unsupported_action": {
            "ca": "No puc confirmar que l'acció s'hagi completat perquè no hi ha cap resultat d'eina que ho acrediti.",
            "es": "No puedo confirmar que la acción se haya completado porque no hay ningún resultado de herramienta que lo acredite.",
            "fr": "Je ne peux pas confirmer que l'action a été effectuée, car aucun résultat d'outil ne le prouve.",
            "en": "I cannot confirm that the action completed because no tool result proves it.",
        },
        "tool_error": {
            "ca": "No puc confirmar el resultat perquè una de les eines necessàries ha fallat.",
            "es": "No puedo confirmar el resultado porque una de las herramientas necesarias ha fallado.",
            "fr": "Je ne peux pas confirmer le résultat, car l'un des outils requis a échoué.",
            "en": "I cannot confirm the result because one of the required tools failed.",
        },
    }
    return messages[reason].get(language, messages[reason]["en"])


def verify_response(
    response: AIMessage,
    *,
    messages: Iterable[BaseMessage],
    plan: Mapping[str, Any],
) -> AIMessage:
    """Verify one final response against current-turn authoritative evidence."""
    tools = _current_turn_tool_messages(messages)
    tool_names = [str(getattr(item, "name", "") or "") for item in tools]
    payloads = [_tool_payload(item) for item in tools]
    failed_indexes = [
        index
        for index, (item, payload) in enumerate(zip(tools, payloads))
        if str(getattr(item, "status", "") or "") == "error" or bool(payload.get("error"))
    ]
    evidence_count = 0
    freshness = None
    job = None
    for index, (tool_name, payload) in enumerate(zip(tool_names, payloads)):
        count = payload.get("matching_count")
        if isinstance(count, int) and count >= 0:
            evidence_count += count
        elif payload or getattr(tools[index], "content", ""):
            evidence_count += 1
        if isinstance(payload.get("freshness"), dict):
            freshness = dict(payload["freshness"])
        candidate_job = _safe_job(tool_name, payload, plan)
        if candidate_job:
            job = candidate_job

    verification_policy = dict(plan.get("verification") or {})
    language = str(plan.get("language") or "en")
    text = str(getattr(response, "content", "") or "")
    status = "passed"
    limitations: list[str] = []
    blocked_reason = ""
    if verification_policy.get("source_evidence_required") and not tools:
        status = "blocked"
        blocked_reason = "missing_evidence"
        limitations.append("required_source_not_inspected")
    elif failed_indexes and COMPLETION_RE.search(text):
        status = "blocked"
        blocked_reason = "tool_error"
        limitations.append("tool_error_conflicts_with_completion_claim")
    elif verification_policy.get("action_result_required") and COMPLETION_RE.search(
        text
    ) and not any(index not in failed_indexes for index in range(len(tools))):
        status = "blocked"
        blocked_reason = "unsupported_action"
        limitations.append("action_completion_without_tool_evidence")
    elif failed_indexes:
        status = "limited"
        limitations.append("one_or_more_tools_failed")
    elif not tools and not any(verification_policy.values()):
        status = "not_applicable"

    if blocked_reason:
        text = _blocked_text(language, blocked_reason)
    text, citations = _claim_citations(
        text,
        tools=tools,
        tool_names=tool_names,
        payloads=payloads,
        plan=plan,
    )
    citation_status = str(citations.get("status") or "missing")
    if (
        verification_policy.get("source_evidence_required")
        and tools
        and citation_status not in {"complete", "not_applicable"}
    ):
        if status == "passed":
            status = "limited"
        limitations.append("claim_citations_incomplete")
    explanation = {
        "mode": str(plan.get("mode") or "conversation"),
        "route": str(plan.get("route") or "General"),
        "execution": str(plan.get("execution") or "foreground"),
        "output_strategy": str(plan.get("output_strategy") or "model_synthesis"),
        "budgets": dict(plan.get("budgets") or {}),
        "tools_used": [name for name in tool_names if name][:16],
        "evidence_count": evidence_count,
        "citation_count": int(citations.get("source_count") or 0),
    }
    verification = {
        "status": status,
        "evidence_count": evidence_count,
        "tool_count": len(tools),
        "tool_names": [name for name in tool_names if name][:16],
        "limitations": limitations[:8],
        "checks": {
            "required_source_inspected": not verification_policy.get("source_evidence_required") or bool(tools),
            "tool_results_successful": not failed_indexes,
            "action_claim_supported": not bool(blocked_reason in {"unsupported_action", "tool_error"}),
            "claim_citations_complete": citation_status in {"complete", "not_applicable"},
        },
    }
    additional = dict(getattr(response, "additional_kwargs", {}) or {})
    additional.update({
        "gnosi_plan": {
            key: plan.get(key)
            for key in (
                "schema_version", "planner_version", "plan_id", "mode", "domains",
                "route", "execution", "output_strategy", "required_tool",
                "allowed_tool_count", "budgets",
                "interpretation", "capability_broker", "memory",
            )
        },
        "gnosi_privacy": dict(plan.get("privacy") or {}),
        "gnosi_verification": verification,
        "gnosi_citations": citations,
        "gnosi_explanation": explanation,
    })
    if freshness:
        additional["gnosi_freshness"] = freshness
    if job:
        additional["gnosi_job"] = job
    return response.model_copy(update={"content": text, "additional_kwargs": additional})
