"""Local operation and output checks for the coordinator's untrusted plan."""
from __future__ import annotations

import json
import math
from typing import Any

from jsonschema import Draft202012Validator, SchemaError

from backend.services.agent_operation_catalog import OPERATIONS, skill_id
from backend.services.agent_team_models import TeamPlan

def required_operation(operation: str, active_skills: list[str]) -> str:
    """A plugin's operation prefix is not an application-skill assignment."""
    family = operation.split(".")[0]
    return family if family in OPERATIONS and skill_id(family) in active_skills else ""


def output_schema(plan: TeamPlan) -> dict[str, Any] | None:
    if not plan.output_schema_json:
        return None
    try:
        schema = json.loads(plan.output_schema_json)
        if not isinstance(schema, dict) or not schema:
            raise ValueError("output schema must be a nonempty object")
        pending = [(schema, 0, True)]
        nodes = 0
        while pending:
            item, depth, is_schema = pending.pop()
            nodes += 1
            if nodes > 256 or depth > 12:
                raise ValueError("output schema exceeds local validation limits")
            if isinstance(item, dict):
                if is_schema and any(key in item for key in ("$ref", "$dynamicRef", "$recursiveRef", "$schema", "$id", "pattern", "patternProperties")):
                    raise ValueError("output schema must inline its types without references or patterns")
                for key, child in item.items():
                    if is_schema and key in {"properties", "$defs", "definitions", "dependentSchemas"} and isinstance(child, dict):
                        pending.extend((value, depth + 1, True) for value in child.values())
                    elif is_schema and key in {"allOf", "anyOf", "oneOf", "prefixItems"} and isinstance(child, list):
                        pending.extend((value, depth + 1, True) for value in child)
                    else:
                        subschema = is_schema and key in {"items", "additionalProperties", "unevaluatedItems", "unevaluatedProperties", "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"}
                        pending.append((child, depth + 1, subschema))
            elif isinstance(item, list):
                pending.extend((child, depth + 1, False) for child in item)
            elif isinstance(item, float) and not math.isfinite(item):
                raise ValueError("output schema must contain finite numbers")
        Draft202012Validator.check_schema(schema)
        return schema
    except (ValueError, SchemaError, RecursionError) as error:
        raise ValueError("agent_team_output_schema_invalid: " + str(error)[:300]) from error


def operation_skills(members: list[dict[str, Any]]) -> dict[str, str]:
    known = {skill_id(operation): operation for operation in OPERATIONS}
    for member in members:
        for capability in member.get("capabilities", []):
            if capability["available"]:
                operation = capability.get("application_operation") or known.get(capability["canonical_id"])
                if operation:
                    known[capability["id"]] = operation
                    known[capability["canonical_id"]] = operation
    return known


def validate_plan_contract(plan: TeamPlan, members: list[dict[str, Any]], owner_id: str,
                           *, legacy_response: bool = False, required_operation: str = "") -> None:
    schema = output_schema(plan)
    operations = operation_skills(members)
    operation = required_operation or plan.operation
    if required_operation and plan.operation and plan.operation != required_operation:
        raise ValueError("agent_team_operation_mismatch: preserve the requested operation " + required_operation)
    if operation and operation not in set(operations.values()):
        raise ValueError("agent_team_unknown_operation: choose a catalog application_operation")
    if plan.response:
        if not plan.response_kind and not legacy_response:
            raise ValueError("agent_team_response_kind_required: classify dialogue or delegate the deliverable")
        available = [member for member in members if member["available"] and member["id"] != owner_id
                     and (not operation or any(operations.get(identifier) == operation
                                                   for identifier in member.get("skills", [])))]
        structured = schema is not None or plan.response.lstrip().startswith(("{", "```json", '["', "[{"))
        if available and (structured or (operation and plan.response_kind != "clarification")):
            raise ValueError("agent_team_specialist_required: delegate this operation or structured deliverable to an available specialist")
        if operation and plan.response_kind not in {"clarification", "unavailable"}:
            raise ValueError("agent_team_work_requires_task: use a bounded task for a deliverable")
        return
    if operation:
        final = next(task for task in plan.tasks if task.id == plan.result_task)
        if not any(operations.get(identifier) == operation for identifier in final.skill_ids):
            raise ValueError("agent_team_operation_skill_required: " + operation
                             + "; the result task must use this operation's assigned skill")

