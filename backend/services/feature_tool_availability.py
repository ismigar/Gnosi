"""Recheck optional feature availability for each scoped catalogue snapshot."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

from backend.models.agent_skills import CatalogStatus, OriginType

if TYPE_CHECKING:
    from backend.services.agent_skill_catalog import ToolRegistration


def suspend_disabled_features(registrations: dict[str, ToolRegistration]) -> None:
    """Keep disabled feature tools discoverable without admitting them to agents."""
    from backend.agent.feature_tool_support import feature_enabled

    availability: dict[str, bool] = {}
    for tool_id, registration in list(registrations.items()):
        required = registration.descriptor.metadata.get("required_plugins") or []
        if registration.descriptor.origin.type != OriginType.CORE or not required:
            continue
        for plugin_id in required:
            if plugin_id not in availability:
                try:
                    availability[plugin_id] = feature_enabled(plugin_id)
                except Exception:
                    availability[plugin_id] = False
        if not all(availability[plugin_id] for plugin_id in required):
            descriptor = registration.descriptor.model_copy(
                update={"status": CatalogStatus.SUSPENDED}
            )
            registrations[tool_id] = replace(registration, descriptor=descriptor)
