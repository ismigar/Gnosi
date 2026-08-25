"""Deterministic response-quality and evidence-conflict evaluation."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable, Mapping, Sequence


MAX_CONFLICTS = 12
_CONFLICT_WORDS = {
    "conflict", "conflicting", "contradiction", "contradictory", "disagree",
    "conflicte", "contradiccio", "discrepen", "contradiccion", "contradictoire",
}


def _safe_scalar(value: Any) -> str | None:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)[:128]
    if isinstance(value, str):
        normalized = " ".join(value.split())
        return normalized[:256] if normalized else None
    return None


def _record_facts(payload: Mapping[str, Any], source_name: str) -> Iterable[dict[str, str]]:
    records = payload.get("records")
    if not isinstance(records, list):
        return []
    facts: list[dict[str, str]] = []
    for record in records[:200]:
        if not isinstance(record, Mapping):
            continue
        entity = str(record.get("id") or record.get("record_id") or record.get("title") or "")[:192]
        if not entity:
            continue
        fields: dict[str, Any] = {}
        for key in ("metadata", "fields"):
            if isinstance(record.get(key), Mapping):
                fields.update(record[key])
        for key in ("title", "status", "state", "year", "author", "item_type"):
            if key in record:
                fields.setdefault(key, record.get(key))
        for field, raw_value in list(fields.items())[:32]:
            value = _safe_scalar(raw_value)
            if value is None:
                continue
            facts.append({
                "entity": entity,
                "field": str(field)[:96],
                "value": value,
                "source": source_name[:128],
            })
    return facts


def detect_evidence_conflicts(
    payloads: Sequence[Mapping[str, Any]],
    tool_names: Sequence[str],
) -> dict[str, Any]:
    """Find bounded incompatible structured facts without exposing their values."""
    grouped: dict[tuple[str, str], dict[str, set[str]]] = {}
    for index, payload in enumerate(payloads):
        source_name = tool_names[index] if index < len(tool_names) else f"tool-{index + 1}"
        for fact in _record_facts(payload, source_name):
            key = (fact["entity"], fact["field"])
            values = grouped.setdefault(key, {})
            values.setdefault(fact["value"], set()).add(fact["source"])
    conflicts = []
    for (entity, field), values in grouped.items():
        if len(values) <= 1:
            continue
        sources = sorted({source for names in values.values() for source in names})[:8]
        conflicts.append({
            "conflict_id": "conflict-" + hashlib.sha256(
                json.dumps([entity, field, sorted(values)], ensure_ascii=True).encode("utf-8")
            ).hexdigest()[:16],
            "entity_id": entity,
            "field": field,
            "source_names": sources,
            "value_count": len(values),
        })
        if len(conflicts) >= MAX_CONFLICTS:
            break
    return {
        "schema_version": 1,
        "status": "conflicting" if conflicts else "consistent",
        "count": len(conflicts),
        "conflicts": conflicts,
        "values_redacted": True,
    }


def conflict_notice(language: str, count: int) -> str:
    """Return a localized visible warning for unresolved evidence conflicts."""
    messages = {
        "ca": "He detectat {count} contradicció entre les fonts consultades. Revisa les procedències indicades abans de donar el resultat per definitiu.",
        "es": "He detectado {count} contradicción entre las fuentes consultadas. Revisa las procedencias indicadas antes de considerar definitivo el resultado.",
        "fr": "J’ai détecté {count} contradiction entre les sources consultées. Vérifiez les provenances indiquées avant de considérer le résultat comme définitif.",
        "en": "I detected {count} conflict between the consulted sources. Review the listed provenance before treating the result as final.",
    }
    template = messages.get(str(language or "en").lower(), messages["en"])
    return template.format(count=max(1, int(count)))


def evaluate_response_quality(
    *,
    text: str,
    plan: Mapping[str, Any],
    verification: Mapping[str, Any],
    citations: Mapping[str, Any],
    payloads: Sequence[Mapping[str, Any]],
    conflicts: Mapping[str, Any],
) -> dict[str, Any]:
    """Score final-response contracts without asking a second model."""
    exact_inventory = str(plan.get("mode") or "") == "inventory"
    inventory_complete = True
    if exact_inventory:
        inventory_payloads = [payload for payload in payloads if "matching_count" in payload]
        inventory_complete = bool(inventory_payloads) and all(
            not bool(payload.get("has_more")) for payload in inventory_payloads
        )
    checks = {
        "visible_response": bool(str(text or "").strip()),
        "required_evidence": bool(
            (verification.get("checks") or {}).get("required_source_inspected", True)
        ),
        "tool_success": bool(
            (verification.get("checks") or {}).get("tool_results_successful", True)
        ),
        "completion_supported": bool(
            (verification.get("checks") or {}).get("action_claim_supported", True)
        ),
        "citations_complete": str(citations.get("status") or "") in {
            "complete", "not_applicable"
        },
        "inventory_complete": inventory_complete,
        "conflicts_handled": (
            not conflicts.get("count")
            or any(word in str(text or "").casefold() for word in _CONFLICT_WORDS)
        ),
    }
    weights = {
        "visible_response": 10,
        "required_evidence": 20,
        "tool_success": 15,
        "completion_supported": 15,
        "citations_complete": 15,
        "inventory_complete": 15,
        "conflicts_handled": 10,
    }
    score = sum(weight for key, weight in weights.items() if checks[key])
    failed = [key for key, passed in checks.items() if not passed]
    return {
        "schema_version": 1,
        "score": score,
        "status": "passed" if score == 100 else "limited" if score >= 70 else "failed",
        "checks": checks,
        "failed_checks": failed,
    }
