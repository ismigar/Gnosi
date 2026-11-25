"""Plan an already classified routine chat turn using the live team catalog."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from backend.services.agent_team_routing import executor_input
from backend.domains.agent.supplied_tasks import supplied_table_output_directive
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_operation_catalog import skill_id
from backend.services.agent_team_contracts import explicit_output_schema, output_contract_requested, output_schema
from backend.services.agent_team_models import AgentTeam, DirectRoute, TeamOutputContract, TeamOutputField, TeamPlan, TeamTask

if TYPE_CHECKING:
    from backend.services.agent_team_runtime import CandidateInputs


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
                       operation: str, original: str, route: DirectRoute | None, state: dict[str, Any],
                       *, inputs: CandidateInputs) -> TeamPlan | None:
    from backend.services.agent_team_runtime import _candidate

    # A request with a richer output contract still needs the director to describe it.
    directive = supplied_table_output_directive(original) if operation == "tables" else ""
    schema = explicit_output_schema(directive or original)
    contract = _flat_contract(schema) if schema is not None else None
    if contract is None and (directive or output_contract_requested(original)):
        return None
    # The worker receives the complete original HumanMessage. Repeating the payload
    # in its assignment would also count it twice against the model's context.
    objective = ("Translate the supplied passage as requested." if operation == "translation"
                 else "Calculate the requested field using the supplied values and rule.")
    task = TeamTask(id="direct", skill_ids=[skill_id(operation)], objective=objective, read_only=True)
    text = executor_input(task, original, state, {}, operation_mode=False, output_schema=schema)
    allowed = set(route.agent_ids if route else (m.agent_id for m in team.members))
    allowed.difference_update((owner["id"], team.director_id))
    matches = []
    for member in catalog:
        if member["id"] not in allowed or not member["available"]:
            continue
        for identifier in _operation_assignments(member, operation):
            skills = [identifier]
            selected, _, _ = _candidate(owner, scope, [member["id"]], skills, text, tools=True, inputs=inputs)
            if selected:
                matches.append((member["id"], skills))
                break
    if len(matches) != 1:
        return None
    identifier, skills = matches[0]
    task = task.model_copy(update={"agent_id": identifier, "skill_ids": skills})
    plan = TeamPlan(operation=operation, tasks=[task], result_task=task.id, output_contract=contract)
    # The normal worker validator must receive the exact schema, including its key set and types.
    return plan if schema == output_schema(plan) else None
