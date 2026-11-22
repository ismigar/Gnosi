"""Plan an already classified routine chat turn using the live team catalog."""
from __future__ import annotations

from typing import Any

from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_operation_catalog import skill_id
from backend.services.agent_team_contracts import explicit_output_schema, output_contract_requested, output_schema
from backend.services.agent_team_models import AgentTeam, DirectRoute, TeamOutputContract, TeamOutputField, TeamPlan, TeamTask


def _flat_contract(schema: dict[str, Any]) -> TeamOutputContract | None:
    if schema.get("type") != "object" or not 0 < len(schema.get("properties", {})) <= 64:
        return None
    fields = []
    for name in schema["required"]:
        definition = schema["properties"][name]
        if definition.get("type") not in {"boolean", "number", "integer", "string", "null"}:
            return None
        fields.append(TeamOutputField(path=[name], type=definition["type"]))
    return TeamOutputContract(fields=fields)


def _operation_assignments(member: dict[str, Any], operation: str) -> list[str]:
    canonical = skill_id(operation)
    descriptors = [skill for skill in member["capabilities"] if skill.get("application_operation") == operation
                   or skill["canonical_id"] == canonical]
    if descriptors:
        return [skill["id"] for skill in descriptors if skill["available"]]
    # Some integrations publish assigned canonical IDs without a descriptor.
    return [canonical] if canonical in member["skills"] else []


def supplied_task_plan(owner: dict[str, Any], scope: ExecutionScope, team: AgentTeam, catalog: list[dict[str, Any]],
                       operation: str, original: str, route: DirectRoute | None) -> TeamPlan | None:
    from backend.services.agent_team_runtime import _candidate, _config, candidate_inputs

    # A request with a richer output contract still needs the director to describe it.
    schema = explicit_output_schema(original)
    contract = _flat_contract(schema) if schema is not None else None
    if contract is None and output_contract_requested(original):
        return None
    allowed = set(route.agent_ids if route else (m.agent_id for m in team.members))
    allowed.difference_update((owner["id"], team.director_id))
    inputs = candidate_inputs(_config())
    matches = []
    for member in catalog:
        if member["id"] not in allowed or not member["available"]:
            continue
        for identifier in _operation_assignments(member, operation):
            skills = [identifier]
            selected, _, _ = _candidate(owner, scope, [member["id"]], skills, original, tools=True, inputs=inputs)
            if selected:
                matches.append((member["id"], skills))
    if len(matches) != 1:
        return None
    identifier, skills = matches[0]
    task = TeamTask(id="direct", agent_id=identifier, skill_ids=skills, objective=original, read_only=True)
    plan = TeamPlan(operation=operation, tasks=[task], result_task=task.id, output_contract=contract)
    # The normal worker validator must receive the exact schema, including its key set and types.
    return plan if schema == output_schema(plan) else None
