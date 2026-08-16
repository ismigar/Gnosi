"""Cheap, deterministic health checks for governed runtime capabilities."""

from __future__ import annotations

from typing import Any


def assess_tool_capability(descriptor: Any, handler: Any) -> dict[str, Any]:
    """Return a public health record without executing third-party code."""
    raw = descriptor if isinstance(descriptor, dict) else {}
    tool_id = str(getattr(descriptor, "id", "") or raw.get("id", ""))
    name = str(
        getattr(descriptor, "name", "")
        or raw.get("name", "")
        or getattr(handler, "name", "")
        or getattr(handler, "__name__", "")
    )
    errors: list[str] = []
    if not tool_id:
        errors.append("missing_id")
    if not name:
        errors.append("missing_name")
    if not (callable(handler) or callable(getattr(handler, "invoke", None))):
        errors.append("missing_handler")
    status = "healthy" if not errors else "unavailable"
    return {"status": status, "reason": errors[0] if errors else "ready"}
