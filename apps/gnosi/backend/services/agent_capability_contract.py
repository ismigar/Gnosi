"""Versioned extension contract for governed agent capabilities."""

from __future__ import annotations

from typing import Any, Mapping


REQUIRED_V2_FIELDS = {
    "timeout_seconds", "idempotency", "privacy", "egress", "durable_result",
}


def capability_contract(value: Any) -> dict[str, Any]:
    """Return the bounded extension contract declared by a descriptor."""
    raw = value.model_dump(mode="json") if hasattr(value, "model_dump") else dict(value or {})
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), Mapping) else {}
    contract = metadata.get("contract") if isinstance(metadata.get("contract"), Mapping) else {}
    return dict(contract)


def validate_versioned_capability(value: Any) -> None:
    """Fail closed for opt-in v2 contracts while leaving legacy v1 visible."""
    contract = capability_contract(value)
    declared = int(contract.get("schema_version") or 1)
    if declared < 2:
        return
    missing = sorted(REQUIRED_V2_FIELDS - set(contract))
    if missing:
        raise ValueError(
            "Capability contract v2 is missing required fields: " + ", ".join(missing)
        )
    timeout = contract.get("timeout_seconds")
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 3_600:
        raise ValueError("Capability contract v2 timeout_seconds must be between 0 and 3600.")
    if str(contract.get("idempotency") or "") not in {
        "not_applicable", "idempotent", "idempotency_key_required", "unknown_outcome_guarded",
    }:
        raise ValueError("Capability contract v2 declares an invalid idempotency policy.")
    if str(contract.get("privacy") or "") not in {
        "standard", "private_local", "private_remote", "personal_data",
    }:
        raise ValueError("Capability contract v2 declares an invalid privacy policy.")
    if str(contract.get("egress") or "") not in {"none", "configured_provider", "declared_hosts"}:
        raise ValueError("Capability contract v2 declares an invalid egress policy.")
    if not isinstance(contract.get("durable_result"), bool):
        raise ValueError("Capability contract v2 durable_result must be a boolean.")
