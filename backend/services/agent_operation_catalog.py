"""Reusable methodology for application operations, published in the skill catalog."""
from __future__ import annotations

from backend.services.agent_behavior import resource as behavior_resource

from collections.abc import Iterable

from backend.models.agent_skills import CatalogOrigin, OriginType, SkillActivation, SkillDescriptor, SkillCatalogEntry

# Feature gates also define the one-time migration's exact assignment boundary.
OPERATIONS: dict[str, tuple[str, str, str]] = {
    "writing": ("ai-platform", "Writing and correction", behavior_resource('operations/writing/SKILL.md')),
    "reader": ("feeds-reader", "Reader analysis", behavior_resource('operations/reader/SKILL.md')),
    "podcast": ("feeds-reader", "Daily podcast", behavior_resource('operations/podcast/SKILL.md')),
    "notebook": ("grounded-notebooks", "Notebook synthesis", behavior_resource('operations/notebook/SKILL.md')),
    "literature": ("resources", "Literature assistance", behavior_resource('operations/literature/SKILL.md')),
    "mail": ("mail", "Mail assistance", behavior_resource('operations/mail/SKILL.md')),
    "social": ("social-publishing", "Social composition", behavior_resource('operations/social/SKILL.md')),
    "meeting": ("calendar", "Meeting preparation and minutes", behavior_resource('operations/meeting/SKILL.md')),
    "translation": ("translation", "Faithful translation", behavior_resource('operations/translation/SKILL.md')),
    "tables": ("ai-platform", "Table actions", behavior_resource('operations/tables/SKILL.md')),
    "knowledge": ("llm-wiki", "Knowledge connections and refinement", behavior_resource('operations/knowledge/SKILL.md')),
    "capture": ("ai-platform", "Structured knowledge capture", behavior_resource('operations/capture/SKILL.md')),
    "learning": ("ai-platform", "Learn and evaluate skills", behavior_resource('operations/learning/SKILL.md')),
}


EXISTING_SKILLS = {
    "reader": "core.gnosi-reader-topic-evolution",
    "podcast": "core.gnosi-daily-briefing",
    "mail": "core.gnosi-inbox-triage",
    "meeting": "core.gnosi-meeting-preparation",
    "capture": "core.gnosi-knowledge-capture",
    "social": "core.gnosi-social-publishing",
    "translation": "core.gnosi-translation-workflow",
    "literature": "core.gnosi-literature",
    "notebook": "core.gnosi-notebooks",
}


def skill_id(operation: str) -> str:
    if operation not in OPERATIONS:
        raise ValueError("unknown_agent_operation")
    return EXISTING_SKILLS.get(operation, f"core.gnosi-operation-{operation}")


def descriptors() -> list[SkillDescriptor]:
    return [SkillDescriptor(
        id=skill_id(key), version="2.0.0", name=name,
        description=name, origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"),
        activation=SkillActivation.EXPLICIT, instructions=instructions,
        metadata={"required_plugins": [plugin], "application_operation": key},
    ) for key, (plugin, name, instructions) in OPERATIONS.items()]


def extend_descriptors(existing: Iterable[SkillDescriptor]) -> list[SkillDescriptor]:
    """Attach functional procedures to their existing chat skill identities."""
    extensions = {entry.id: entry for entry in descriptors()}
    engines = {"core.gnosi-knowledge-capture": ["core.transcribe-asset", "core.recognize-asset"],
               "core.gnosi-daily-briefing": ["core.synthesize-speech"],
               "core.gnosi-literature": ["core.rank-literature"]}
    result = []
    for descriptor in existing:
        extension = extensions.pop(descriptor.id, None)
        if extension:
            descriptor = descriptor.model_copy(update={
                "instructions": descriptor.instructions + "\n\nApplication phases:\n" + extension.instructions,
                "metadata": {**descriptor.metadata, **extension.metadata},
                "version": "2.0.0",
                "tool_ids": list(dict.fromkeys([*descriptor.tool_ids, *engines.get(descriptor.id, [])])),
            })
        result.append(descriptor)
    return [*result, *extensions.values()]


def activate_companions(entries: Iterable[SkillCatalogEntry], active: set[str] | None) -> None:
    if active is None:
        return
    for entry in entries:
        companions = entry.descriptor.metadata.get("companion_for", [])
        if isinstance(companions, list) and active.intersection(companions):
            active.add(entry.descriptor.id)
