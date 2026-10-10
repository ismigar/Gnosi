"""Capability descriptions and intact conversation context for team routing."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from backend.services.agent_behavior import resource
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_team_models import TeamPlan, TeamTask


def validate_assignments(plan: TeamPlan, members: list[dict[str, Any]], owner_id: str) -> None:
    """Reject invented assignments and let the planner repair them before execution."""
    by_id = {member["id"]: member for member in members}
    skills = {}
    for member in members:
        assigned = {identifier: identifier for identifier in member.get("skills", [])}
        for capability in member.get("capabilities", []):
            canonical = capability["canonical_id"]
            for identifier in (capability["id"], canonical):
                if capability["available"]:
                    assigned[identifier] = canonical
                else:
                    assigned.pop(identifier, None)
        skills[member["id"]] = assigned
    for task in plan.tasks:
        selected = by_id.get(task.agent_id)
        if not selected or not selected["available"]:
            if task.temporary is not None:
                continue
            raise ValueError(f"agent_team_assignment_unavailable:{task.agent_id}; choose an available catalog member")
        requested = set(task.skill_ids)
        if not requested.issubset(skills[task.agent_id]):
            raise ValueError(f"agent_team_skill_not_assigned:{task.agent_id}; use that member's assigned skill IDs")
        if task.agent_id == owner_id:
            specialists = [identifier for identifier, candidate in by_id.items()
                           if identifier != owner_id and candidate["available"]
                           and requested.issubset(skills[identifier])]
            if specialists:
                raise ValueError("agent_team_specialist_required: assign this task to an available specialist: "
                                 + ", ".join(specialists))


def planning_catalog(owner: dict[str, Any], scope: ExecutionScope, original: str,
                     *, include_owner: bool = False) -> list[dict[str, Any]]:
    from backend.services.agent_team_policy import team_for
    from backend.services.agent_team_runtime import _candidate, _config, _runtime

    roles = {member.agent_id: member.roles for member in team_for(owner).members}
    if include_owner:
        roles[owner["id"]] = ["director"]
    catalog = []
    for profile in _config().get("agents", []):
        identifier = profile.get("id")
        if identifier not in roles or (identifier == owner["id"] and not include_owner):
            continue
        if not profile.get("enabled", True) or profile.get("plugin_suspended"):
            continue
        runtime = _runtime(profile, scope, list(profile.get("skill_ids") or []))
        eligible, reason, _ = _candidate(owner, scope, [identifier], [], original, allow_owner=include_owner)
        skills = [{
            "id": entry.descriptor.metadata.get("effective_skill_id", entry.descriptor.id),
            "canonical_id": entry.descriptor.id,
            "name": entry.descriptor.name,
            "description": entry.descriptor.description[:400],
            "application_operation": entry.descriptor.metadata.get("application_operation", ""),
            "available": entry.available,
            "tool_ids": entry.descriptor.tool_ids,
        } for entry in runtime.skills]
        catalog.append({
            "id": identifier, "name": profile.get("name"), "roles": roles[identifier],
            "skills": list(profile.get("skill_ids") or []), "capabilities": skills,
            "tools": [{"id": descriptor.id, "name": descriptor.name,
                       "effects": [str(getattr(effect, "value", effect)) for effect in descriptor.effects]}
                      for descriptor in runtime.tool_descriptors],
            "available": eligible is not None, "availability_reason": reason,
            "missing_skill_ids": list(runtime.missing_skill_ids),
            "unavailable_tool_ids": list(runtime.unavailable_tool_ids),
            "provider": profile.get("provider"), "model": profile.get("model"),
        })
    return catalog


def assignment_messages(state: dict[str, Any], task: TeamTask, original: str,
                        results: dict[str, Any]) -> list[BaseMessage]:
    """Keep the actual latest user message, attachments and roles intact.

    A coordinator's generated assignment must not become a new user instruction
    or replace the text used to determine current-turn authorization.
    """
    assignment = {"objective": task.objective, "expected_result": task.expected_result,
                  "acceptance": task.acceptance,
                  "completed_evidence": state.get("team_completed_evidence", []),
                  "previous_results": {key: results[key]["result"] for key in task.depends_on}}
    if state.get("team_task_output_schema") is not None:
        assignment["output_schema"] = state["team_task_output_schema"]
    messages = list(state.get("messages") or [HumanMessage(content=original)])
    return [SystemMessage(content=resource("system/team-assignment.md"), name="team_assignment"),
            AIMessage(content=json.dumps(assignment, ensure_ascii=False), name="team_assignment"), *messages]
