"""Deterministic evidence verification for governed agent turns."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

from backend.domains.agent.turn_citations import (
    CITATION_MARKER_RE,
    MAX_CITATION_CLAIMS,
    MAX_CITATION_SOURCES,
    NOTEBOOK_EVIDENCE_TOOL_NAMES,
    _bounded_label,
    _citation_evidence,
    _citation_id,
    _claim_citations,
    _current_turn_tool_messages,
    _safe_job,
    _safe_source_href,
    _tool_payload,
    configure_browser_path_resolver,
)
from backend.domains.agent.turn_planning import COMPLETION_RE


def _blocked_text(language: str, reason: str) -> str:
    messages = {
        "missing_evidence": {
            "ca": (
                "No puc verificar aquesta resposta perquè no s'ha consultat la font necessària."
            ),
            "es": (
                "No puedo verificar esta respuesta porque no se ha consultado la fuente necesaria."
            ),
            "fr": (
                "Je ne peux pas vérifier cette réponse car la source requise n'a pas été consultée."
            ),
            "en": "I cannot verify this answer because the required source was not consulted.",
        },
        "unsupported_action": {
            "ca": (
                "No puc confirmar que l'acció s'hagi completat perquè no hi ha "
                "cap resultat d'eina que ho acrediti."
            ),
            "es": (
                "No puedo confirmar que la acción se haya completado porque no "
                "hay ningún resultado de herramienta que lo acredite."
            ),
            "fr": (
                "Je ne peux pas confirmer que l'action a été effectuée, car "
                "aucun résultat d'outil ne le prouve."
            ),
            "en": "I cannot confirm that the action completed because no tool result proves it.",
        },
        "tool_error": {
            "ca": ("No puc confirmar el resultat perquè una de les eines necessàries ha fallat."),
            "es": (
                "No puedo confirmar el resultado porque una de las "
                "herramientas necesarias ha fallado."
            ),
            "fr": "Je ne peux pas confirmer le résultat, car l'un des outils requis a échoué.",
            "en": "I cannot confirm the result because one of the required tools failed.",
        },
    }
    return messages[reason].get(language, messages[reason]["en"])


@dataclass
class _EvidenceSummary:
    count: int = 0
    freshness: dict[str, Any] | None = None
    job: dict[str, Any] | None = None


def _string_key_dict(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in value.items()}


def _failed_tool_indexes(
    tools: Sequence[ToolMessage],
    payloads: Sequence[Mapping[str, Any]],
) -> list[int]:
    return [
        index
        for index, (item, payload) in enumerate(zip(tools, payloads))
        if str(getattr(item, "status", "") or "") == "error" or bool(payload.get("error"))
    ]


def _summarize_evidence(
    tools: Sequence[ToolMessage],
    tool_names: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
    plan: Mapping[str, Any],
) -> _EvidenceSummary:
    summary = _EvidenceSummary()
    for index, (tool_name, payload) in enumerate(zip(tool_names, payloads)):
        count = payload.get("matching_count")
        if isinstance(count, int) and count >= 0:
            summary.count += count
        elif payload or tools[index].content:
            summary.count += 1
        freshness = payload.get("freshness")
        if isinstance(freshness, Mapping):
            summary.freshness = _string_key_dict(freshness)
        candidate_job = _safe_job(tool_name, payload, plan)
        if candidate_job:
            summary.job = candidate_job
    return summary


def _verification_decision(
    *,
    policy: Mapping[str, Any],
    text: str,
    tool_count: int,
    failed_indexes: Sequence[int],
) -> tuple[str, list[str], str]:
    if policy.get("source_evidence_required") and not tool_count:
        return "blocked", ["required_source_not_inspected"], "missing_evidence"
    if failed_indexes and COMPLETION_RE.search(text):
        return (
            "blocked",
            ["tool_error_conflicts_with_completion_claim"],
            "tool_error",
        )
    has_success = any(index not in failed_indexes for index in range(tool_count))
    unsupported_action = (
        policy.get("action_result_required") and COMPLETION_RE.search(text) and not has_success
    )
    if unsupported_action:
        return (
            "blocked",
            ["action_completion_without_tool_evidence"],
            "unsupported_action",
        )
    if failed_indexes:
        return "limited", ["one_or_more_tools_failed"], ""
    if not tool_count and not any(policy.values()):
        return "not_applicable", [], ""
    return "passed", [], ""


def _apply_citation_policy(
    *,
    status: str,
    limitations: list[str],
    policy: Mapping[str, Any],
    tool_count: int,
    citations: Mapping[str, Any],
) -> tuple[str, str]:
    citation_status = str(citations.get("status") or "missing")
    incomplete = (
        policy.get("source_evidence_required")
        and tool_count
        and citation_status not in {"complete", "not_applicable"}
    )
    if incomplete:
        limitations.append("claim_citations_incomplete")
        if status == "passed":
            status = "limited"
    return status, citation_status


def _verification_payload(
    *,
    status: str,
    evidence_count: int,
    tools: Sequence[ToolMessage],
    tool_names: Sequence[str],
    limitations: Sequence[str],
    policy: Mapping[str, Any],
    failed_indexes: Sequence[int],
    blocked_reason: str,
    citation_status: str,
) -> dict[str, Any]:
    return {
        "status": status,
        "evidence_count": evidence_count,
        "tool_count": len(tools),
        "tool_names": [name for name in tool_names if name][:16],
        "limitations": list(limitations)[:8],
        "checks": {
            "required_source_inspected": (
                not policy.get("source_evidence_required") or bool(tools)
            ),
            "tool_results_successful": not failed_indexes,
            "action_claim_supported": blocked_reason not in {"unsupported_action", "tool_error"},
            "claim_citations_complete": citation_status in {"complete", "not_applicable"},
        },
    }


def _plan_snapshot(plan: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: plan.get(key)
        for key in (
            "schema_version",
            "planner_version",
            "plan_id",
            "mode",
            "domains",
            "route",
            "execution",
            "output_strategy",
            "required_tool",
            "allowed_tool_count",
            "budgets",
            "deadline",
            "interpretation",
            "capability_broker",
            "memory",
        )
    }


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
    failed_indexes = _failed_tool_indexes(tools, payloads)
    summary = _summarize_evidence(tools, tool_names, payloads, plan)
    policy = _string_key_dict(plan.get("verification"))
    language = str(plan.get("language") or "en")
    text = str(getattr(response, "content", "") or "")
    status, limitations, blocked_reason = _verification_decision(
        policy=policy,
        text=text,
        tool_count=len(tools),
        failed_indexes=failed_indexes,
    )
    if blocked_reason:
        text = _blocked_text(language, blocked_reason)
    text, citations = _claim_citations(
        text,
        tools=tools,
        tool_names=tool_names,
        payloads=payloads,
        plan=plan,
    )
    status, citation_status = _apply_citation_policy(
        status=status,
        limitations=limitations,
        policy=policy,
        tool_count=len(tools),
        citations=citations,
    )
    from backend.services.agent_response_quality import (
        conflict_notice,
        detect_evidence_conflicts,
        evaluate_response_quality,
    )

    conflicts = _string_key_dict(detect_evidence_conflicts(payloads, tool_names))
    from backend.services.agent_evidence_security import analyze_evidence

    evidence_security = _string_key_dict(analyze_evidence(payloads))
    conflict_count = conflicts.get("count")
    if isinstance(conflict_count, int) and conflict_count:
        if status == "passed":
            status = "limited"
        limitations.append("conflicting_source_facts")
        text = f"{text.rstrip()}\n\n{conflict_notice(language, conflict_count)}"
    explanation: dict[str, Any] = {
        "mode": str(plan.get("mode") or "conversation"),
        "route": str(plan.get("route") or "General"),
        "execution": str(plan.get("execution") or "foreground"),
        "output_strategy": str(plan.get("output_strategy") or "model_synthesis"),
        "budgets": _string_key_dict(plan.get("budgets")),
        "tools_used": [name for name in tool_names if name][:16],
        "evidence_count": summary.count,
        "citation_count": int(citations.get("source_count") or 0),
    }
    verification = _verification_payload(
        status=status,
        evidence_count=summary.count,
        tools=tools,
        tool_names=tool_names,
        limitations=limitations,
        policy=policy,
        failed_indexes=failed_indexes,
        blocked_reason=blocked_reason,
        citation_status=citation_status,
    )
    quality = _string_key_dict(
        evaluate_response_quality(
            text=text,
            plan=plan,
            verification=verification,
            citations=citations,
            payloads=payloads,
            conflicts=conflicts,
        )
    )
    explanation["quality_score"] = quality["score"]
    additional = _string_key_dict(getattr(response, "additional_kwargs", {}))
    additional.update(
        {
            "gnosi_plan": _plan_snapshot(plan),
            "gnosi_privacy": _string_key_dict(plan.get("privacy")),
            "gnosi_verification": verification,
            "gnosi_citations": citations,
            "gnosi_explanation": explanation,
            "gnosi_quality": quality,
            "gnosi_conflicts": conflicts,
            "gnosi_evidence_security": evidence_security,
        }
    )
    if summary.freshness:
        additional["gnosi_freshness"] = summary.freshness
    if summary.job:
        additional["gnosi_job"] = summary.job
    return response.model_copy(update={"content": text, "additional_kwargs": additional})


__all__ = [
    "CITATION_MARKER_RE",
    "MAX_CITATION_CLAIMS",
    "MAX_CITATION_SOURCES",
    "NOTEBOOK_EVIDENCE_TOOL_NAMES",
    "_blocked_text",
    "_bounded_label",
    "_citation_evidence",
    "_citation_id",
    "_claim_citations",
    "_current_turn_tool_messages",
    "_safe_job",
    "_safe_source_href",
    "_tool_payload",
    "configure_browser_path_resolver",
    "verify_response",
]
