"""Immutable catalog registration and resolved runtime capability values."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Tuple

from backend.models.agent_skills import SkillCatalogEntry, ToolDescriptor


@dataclass(frozen=True)
class ToolRegistration:
    """A serializable descriptor paired with an in-process runtime adapter."""

    descriptor: ToolDescriptor
    handler: Any = None


@dataclass(frozen=True)
class AgentRuntimeCapabilities:
    """Exact skills and tools made eligible for a compiled runtime."""

    assigned_skill_ids: Tuple[str, ...]
    active_skill_ids: Tuple[str, ...]
    instructions: Tuple[str, ...]
    tools: Tuple[Any, ...]
    tool_descriptors: Tuple[ToolDescriptor, ...]
    skills: Tuple[SkillCatalogEntry, ...]
    missing_skill_ids: Tuple[str, ...]
    unavailable_tool_ids: Tuple[str, ...]
    catalog_revision: str
