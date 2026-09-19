"""Catalogue coverage for newer first-party application features."""

from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from backend.agent.activity_tools import ACTIVITY_READ_TOOLS
from backend.agent.literature_tools import LITERATURE_READ_TOOLS, LITERATURE_WRITE_TOOLS
from backend.agent.media_tools import MEDIA_READ_TOOLS, MEDIA_WRITE_TOOLS
from backend.agent.notebook_tools import NOTEBOOK_READ_TOOLS, NOTEBOOK_WRITE_TOOLS
from backend.agent.planning_resource_tools import (
    PLANNING_RESOURCE_READ_TOOLS,
    PLANNING_RESOURCE_WRITE_TOOLS,
    PLANNING_RESOURCE_DELETE_TOOLS,
)
from backend.models.agent_skills import (
    CatalogOrigin,
    ConfirmationPolicy,
    OriginType,
    ToolDescriptor,
    ToolEffect,
)

FEATURE_DOMAINS = {
    "notebooks": (
        "Gnosi Notebooks",
        "List accessible notebooks, read their status, and select exact source IDs. Search the recorded revision before citing evidence. Create private notebooks or alter owned notebooks only after an explicit request. Indexing is asynchronous; report queued, running and completed states accurately. Attached-notebook context tools remain available for narrower source selections.",
    ),
    "literature": (
        "Gnosi Literature",
        "List configured academic sources first. Search only explicitly selected enabled sources and poll the returned search ID. Read exact result IDs before importing a Resource and preserve duplicate checks. Imports and systematic-review inspection currently require the personal primary Vault; do not cross this scope. Report evidence and uncertainty without inventing publication metadata.",
    ),
    "media": (
        "Gnosi Media",
        "Select a configured gallery root and search bounded pages by name, kind or tags. Use returned relative paths. Change tags or descriptions only after an explicit request; never infer image content from a filename, upload files, or change file bytes.",
    ),
    "activity": (
        "Gnosi Activity",
        "Inspect only the current user's automations and recorded execution results. A successful service run does not prove that work was available or changes occurred. System-wide schedules are restricted to the personal workspace. These tools cannot approve actions, grant skills, change credentials or create recurring work.",
    ),
}


def feature_registrations() -> tuple[tuple[ToolDescriptor, Any], ...]:
    groups = [
        ("notebooks", "grounded-notebooks", NOTEBOOK_READ_TOOLS, "read"),
        ("notebooks", "grounded-notebooks", NOTEBOOK_WRITE_TOOLS, "write"),
        ("literature", "resources", LITERATURE_READ_TOOLS, "read"),
        ("literature", "resources", LITERATURE_WRITE_TOOLS, "write"),
        ("media", "social-publishing", MEDIA_READ_TOOLS, "read"),
        ("media", "social-publishing", MEDIA_WRITE_TOOLS, "write"),
        ("activity", "automations", ACTIVITY_READ_TOOLS, "read"),
        ("planning", "project-planning", PLANNING_RESOURCE_READ_TOOLS, "read"),
        ("planning", "project-planning", PLANNING_RESOURCE_WRITE_TOOLS, "write"),
        ("planning", "project-planning", PLANNING_RESOURCE_DELETE_TOOLS, "delete"),
    ]
    result = []
    for domain, plugin_id, handlers, operation in groups:
        for handler in handlers:
            if not isinstance(handler, StructuredTool):
                raise TypeError("Feature adapters must expose structured tool schemas.")
            function = handler.func or handler.coroutine
            if function is None:
                raise TypeError("Feature adapters must have an executable handler.")
            effects = [ToolEffect.READ] if operation == "read" else [ToolEffect.LOCAL_WRITE]
            confirmation = (
                ConfirmationPolicy.NONE
                if operation == "read"
                else ConfirmationPolicy.EXPLICIT_REQUEST
            )
            if domain in {"notebooks", "media", "activity"}:
                effects.append(ToolEffect.PERSONAL_DATA)
            if handler.name in {
                "literature_start_search",
                "notebook_create",
                "notebook_add_sources",
                "notebook_refresh",
            }:
                effects.append(ToolEffect.EXTERNAL_READ)
            if handler.name == "literature_start_search":
                effects.append(ToolEffect.DATA_EGRESS)
            if handler.name in {"notebook_create", "notebook_add_sources", "notebook_refresh"}:
                effects.append(ToolEffect.BULK_WRITE)
            if operation == "delete":
                effects.append(ToolEffect.DESTRUCTIVE)
                confirmation = ConfirmationPolicy.ALWAYS
            schema_type = handler.get_input_schema()
            schema = (
                schema_type.model_json_schema()
                if issubclass(schema_type, BaseModel)
                else schema_type.schema()
            )
            schema.pop("title", None)
            result.append(
                (
                    ToolDescriptor(
                        id=f"core.gnosi.{handler.name.replace('_', '-')}",
                        name=handler.name.replace("_", " ").title(),
                        description=handler.description,
                        origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"),
                        input_schema=schema,
                        output_schema={"type": "string"},
                        effects=effects,
                        minimum_role="viewer" if operation == "read" else "editor",
                        confirmation=confirmation,
                        handler_ref=f"{function.__module__}.{handler.name}",
                        metadata={"domain": domain, "required_plugins": [plugin_id]},
                    ),
                    handler,
                )
            )
    return tuple(result)
