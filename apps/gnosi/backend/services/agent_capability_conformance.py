"""Versioned conformance reporting for governed skills and tools."""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from backend.services.agent_capability_contract import (
    REQUIRED_V2_FIELDS,
    capability_contract,
)



def tool_conformance(value: Any) -> dict[str, Any]:
    raw = value.model_dump(mode="json") if hasattr(value, "model_dump") else dict(value or {})
    contract = capability_contract(raw)
    declared = int(contract.get("schema_version") or 1)
    checks = {
        "stable_identity": bool(raw.get("id") and raw.get("version")),
        "input_schema": isinstance(raw.get("input_schema"), Mapping),
        "output_schema": isinstance(raw.get("output_schema"), Mapping) and bool(raw.get("output_schema")),
        "effects": bool(raw.get("effects")),
        "role": bool(raw.get("minimum_role")),
        "confirmation": raw.get("confirmation") is not None,
    }
    missing_v2 = sorted(REQUIRED_V2_FIELDS - set(contract)) if declared >= 2 else []
    if declared >= 2:
        checks["contract_v2"] = not missing_v2
    status = "pass" if all(checks.values()) and declared >= 2 else (
        "partial" if all(value for key, value in checks.items() if key != "output_schema") else "legacy"
    )
    return {
        "id": str(raw.get("id") or "")[:160],
        "kind": "tool",
        "declared_schema_version": declared,
        "status": status,
        "checks": checks,
        "missing_fields": missing_v2[:12],
    }


def skill_conformance(value: Any) -> dict[str, Any]:
    descriptor = getattr(value, "descriptor", value)
    raw = descriptor.model_dump(mode="json") if hasattr(descriptor, "model_dump") else dict(descriptor or {})
    contract = capability_contract(raw)
    declared = int(contract.get("schema_version") or 1)
    checks = {
        "stable_identity": bool(raw.get("id") and raw.get("version")),
        "activation": bool(raw.get("activation")),
        "kind": bool(raw.get("kind")),
        "tool_references": isinstance(raw.get("tool_ids"), list),
        "origin": bool(raw.get("origin")),
    }
    missing_v2 = sorted(REQUIRED_V2_FIELDS - set(contract)) if declared >= 2 else []
    if declared >= 2:
        checks["contract_v2"] = not missing_v2
    return {
        "id": str(raw.get("id") or "")[:160],
        "kind": "skill",
        "declared_schema_version": declared,
        "status": "pass" if declared >= 2 and all(checks.values()) else (
            "partial" if all(value for key, value in checks.items() if key != "contract_v2") else "legacy"
        ),
        "checks": checks,
        "missing_fields": missing_v2[:12],
    }


def conformance_report(tools: Iterable[Any], skills: Iterable[Any]) -> dict[str, Any]:
    rows = [tool_conformance(item) for item in tools]
    rows.extend(skill_conformance(item) for item in skills)
    counts = {"pass": 0, "partial": 0, "legacy": 0}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {
        "schema_version": 1,
        "counts": counts,
        "total": len(rows),
        "capabilities": rows[:500],
        "enforcement": "v2_fail_closed_legacy_visible",
    }
