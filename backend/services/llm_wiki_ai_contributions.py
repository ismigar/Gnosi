"""Declarative agent skills and governed tools contributed by LLM Wiki."""

from __future__ import annotations

from typing import Callable, Iterable, cast

from backend.agent.llm_wiki_tools import LLM_WIKI_TOOL_HANDLERS
from backend.models.agent_skills import (
    CatalogOrigin,
    CatalogStatus,
    ConfirmationPolicy,
    OriginType,
    SkillActivation,
    SkillDescriptor,
    SkillKind,
    ToolDescriptor,
    ToolEffect,
)
from backend.services.agent_skill_catalog import (
    ToolRegistration,
    register_plugin_skill_provider,
    register_plugin_tool_provider,
)


PLUGIN_ID = "llm-wiki"
ORIGIN = CatalogOrigin(type=OriginType.PLUGIN, id=PLUGIN_ID)


def _status() -> CatalogStatus:
    """Reflect the per-vault built-in plugin lifecycle in catalog entries."""

    try:
        from backend.api.vault_routes import _llm_wiki_enabled, _load_plugins_state

        load_state = _load_plugins_state
        is_enabled = _llm_wiki_enabled
        return (
            CatalogStatus.AVAILABLE
            if is_enabled(load_state())
            else CatalogStatus.SUSPENDED
        )
    except Exception:
        # Catalog inspection outside a request must fail closed rather than
        # granting a plugin capability whose state cannot be checked.
        return CatalogStatus.SUSPENDED


def _tool_descriptors() -> Iterable[ToolRegistration]:
    status = _status()
    definitions = (
        ToolDescriptor(
            id="plugin.llm-wiki.query-wiki",
            name="Query Brain",
            description=(
                "Search the compiled Brain indexes and cache while preserving "
                "note provenance."
            ),
            origin=ORIGIN,
            effects=[ToolEffect.READ],
            minimum_role="viewer",
            confirmation=ConfirmationPolicy.NONE,
            handler_ref="backend.agent.vault_tools.query_wiki",
            status=status,
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "k": {"type": "integer", "minimum": 1, "maximum": 20},
                },
                "required": ["query"],
            },
        ),
        ToolDescriptor(
            id="plugin.llm-wiki.process-source",
            name="Process Brain source",
            description=(
                "Start the existing durable ingest or explicit reprocess job "
                "for a configured source."
            ),
            origin=ORIGIN,
            effects=[ToolEffect.LOCAL_WRITE, ToolEffect.AI_COST],
            minimum_role="editor",
            confirmation=ConfirmationPolicy.EXPLICIT_REQUEST,
            handler_ref=(
                "backend.agent.llm_wiki_tools.process_brain_source"
            ),
            status=status,
            input_schema={
                "type": "object",
                "properties": {
                    "resource_id": {"type": "string"},
                    "source_table_id": {"type": "string"},
                    "force": {"type": "boolean"},
                    "language": {"type": "string"},
                },
                "required": ["resource_id"],
            },
        ),
        ToolDescriptor(
            id="plugin.llm-wiki.process-status",
            name="Brain process status",
            description="Read the durable current or latest ingest state.",
            origin=ORIGIN,
            effects=[ToolEffect.READ],
            minimum_role="viewer",
            confirmation=ConfirmationPolicy.NONE,
            handler_ref=(
                "backend.agent.llm_wiki_tools.brain_process_status"
            ),
            status=status,
            input_schema={
                "type": "object",
                "properties": {
                    "item_id": {"type": "string"},
                    "source_table_id": {"type": "string"},
                },
                "required": ["item_id"],
            },
        ),
        ToolDescriptor(
            id="plugin.llm-wiki.maintain",
            name="Maintain Brain",
            description=(
                "Rebuild managed indexes and run deterministic lint."
            ),
            origin=ORIGIN,
            effects=[ToolEffect.LOCAL_WRITE],
            minimum_role="editor",
            confirmation=ConfirmationPolicy.EXPLICIT_REQUEST,
            handler_ref="backend.agent.llm_wiki_tools.maintain_brain",
            status=status,
            input_schema={
                "type": "object",
                "properties": {},
            },
        ),
        ToolDescriptor(
            id="plugin.llm-wiki.propose-connections",
            name="Propose Brain connections",
            description=(
                "Run the model-costing connection and contradiction proposal pass."
            ),
            origin=ORIGIN,
            effects=[ToolEffect.LOCAL_WRITE, ToolEffect.AI_COST],
            minimum_role="editor",
            confirmation=ConfirmationPolicy.EXPLICIT_REQUEST,
            handler_ref=(
                "backend.agent.llm_wiki_tools.propose_brain_connections"
            ),
            status=status,
            input_schema={
                "type": "object",
                "properties": {},
            },
        ),
    )
    return tuple(
        ToolRegistration(
            descriptor=descriptor,
            handler=LLM_WIKI_TOOL_HANDLERS[descriptor.id],
        )
        for descriptor in definitions
    )


def _skill_descriptors() -> Iterable[SkillDescriptor]:
    status = _status()
    return (
        SkillDescriptor(
            id="plugin.llm-wiki.query",
            name="Query Brain",
            description=(
                "Answer from the compiled Brain before consulting raw sources."
            ),
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=SkillActivation.AUTOMATIC,
            tool_ids=[
                "plugin.llm-wiki.query-wiki",
            ],
            instructions=(
                "Consult the compiled Brain first for knowledge that has already "
                "been processed. Preserve citations and provenance, distinguish "
                "reading notes from permanent notes, and open raw source material "
                "only when evidence must be verified."
            ),
            status=status,
            metadata={"required_for_agent": True},
        ),
        SkillDescriptor(
            id="plugin.llm-wiki.process-source",
            name="Process Brain source",
            description=(
                "Start or explicitly repeat the durable resource-processing job."
            ),
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=SkillActivation.EXPLICIT,
            tool_ids=[
                "plugin.llm-wiki.process-source",
                "plugin.llm-wiki.process-status",
            ],
            instructions=(
                "Process a source only when the user explicitly requests it. "
                "Preserve provenance and source order. Start the durable job, "
                "report its job id, and use the status tool rather than waiting "
                "synchronously. Use force only for an explicit reprocess request."
            ),
            status=status,
        ),
        SkillDescriptor(
            id="plugin.llm-wiki.process-status",
            name="Brain process status",
            description="Inspect a durable Brain processing job.",
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=SkillActivation.AUTOMATIC,
            tool_ids=["plugin.llm-wiki.process-status"],
            instructions=(
                "When asked about an ingest already started, report the durable "
                "job state exactly and never infer completion from elapsed time."
            ),
            status=status,
        ),
        SkillDescriptor(
            id="plugin.llm-wiki.maintain",
            name="Maintain Brain",
            description="Run deterministic Brain maintenance and optional analysis.",
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=SkillActivation.EXPLICIT,
            tool_ids=["plugin.llm-wiki.maintain"],
            instructions=(
                "Run deterministic lint and index maintenance only after an "
                "explicit request. This skill never starts semantic model work. "
                "Report the actual maintenance result."
            ),
            status=status,
        ),
        SkillDescriptor(
            id="plugin.llm-wiki.propose-connections",
            name="Propose Brain connections",
            description=(
                "Run the explicit model-costing Brain connection proposal pass."
            ),
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=SkillActivation.EXPLICIT,
            tool_ids=["plugin.llm-wiki.propose-connections"],
            instructions=(
                "Generate semantic Brain connection, support, contradiction, and "
                "gap proposals only when the user explicitly requests this "
                "model-costing analysis. Report the actual queued results."
            ),
            status=status,
        ),
    )


def register_llm_wiki_contributions() -> None:
    """Register idempotent lazy providers for the built-in plugin."""

    register_plugin_tool_provider(PLUGIN_ID, _tool_descriptors)
    register_plugin_skill_provider(PLUGIN_ID, _skill_descriptors)
