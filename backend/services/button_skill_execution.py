"""Execute a selected skill against a row with a typed, bounded write contract."""

import json
from pathlib import Path

from fastapi import HTTPException

from backend.services.agent_execution import run_sync
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import current_scope, revalidate_scope
from backend.services.agent_skill_catalog import get_skill_catalog
from typing import Any
from backend.services.button_action_contracts import ButtonAssignment, field_assignments_schema, parse_button_assignments
from backend.services.button_field_execution import resolve_button_fields
from backend.services.button_relation_context import ButtonRelationContext, build_button_relation_context
from backend.domains.vault.registry.state import RegistryData
from backend.models.agent_skills import SkillCatalogEntry
from backend.services.json_contracts import validate_json_value


def skill_entry(identifier: str) -> SkillCatalogEntry:
    entry = get_skill_catalog().get_entry(identifier, Path(current_scope().vault_path))
    if entry is None or not entry.available:
        raise HTTPException(422, "The selected skill is unavailable")
    return entry


def generate_skill_assignments(identifier: str, title: object, metadata: RegistryData, body: str) -> tuple[list[dict[str, Any]], list[ButtonAssignment], str, str, ButtonRelationContext]:
    entry = skill_entry(identifier)
    revision = entry.revision
    fields = resolve_button_fields(metadata)
    relation_context = build_button_relation_context(fields)
    schema = field_assignments_schema(fields)
    result = run_sync(AgentOperation(
        skill_id=entry.descriptor.id, operation="tables.skill-fields", origin="button",
        data={"task": "tables.skill-fields", "title": title, "metadata": metadata, "content": body, "editable_fields": fields,
              "relation_candidates": list(relation_context.candidates)},
        output_schema=schema,
        tool_mode="read", max_model_calls=3,
    ))
    assignments = json.loads(result.result)
    validate_json_value(assignments, schema)
    return fields, parse_button_assignments(assignments["assignments"]), entry.descriptor.id, revision, relation_context


def revalidate_button_skill(identifier: str, revision: str) -> None:
    revalidate_scope(current_scope())
    entry = skill_entry(identifier)
    if entry.revision != revision:
        raise HTTPException(409, "The selected skill changed while generating field values")
