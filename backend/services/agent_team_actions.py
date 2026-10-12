"""Resolve action executors from callable tools and the activated skill grant."""
from __future__ import annotations

from typing import Any
import json

from backend.services.agent_team_models import TeamPlan


def skill_tool_names(member: dict[str, Any], identifiers: list[str]) -> set[str]:
    tool_ids = {tool_id for capability in member.get("capabilities", [])
                if capability.get("available") and {capability["id"], capability["canonical_id"]}.intersection(identifiers)
                for tool_id in capability.get("tool_ids", [])}
    return {str(tool.get("call_name") or tool.get("name") or "")
            for tool in member.get("tools", []) if tool.get("id") in tool_ids}


def action_candidates(members: list[dict[str, Any]], names: set[str], owner_id: str) -> list[tuple[str, list[str]]]:
    candidates = []
    for member in members:
        if not member["available"]:
            continue
        for capability in member.get("capabilities", []):
            identifiers = [capability["id"]]
            if capability.get("available") and names.issubset(skill_tool_names(member, identifiers)):
                candidates.append((member["id"], identifiers))
                break
    return sorted(candidates, key=lambda candidate: candidate[0] == owner_id)


def validate_action_plan(plan: TeamPlan, members: list[dict[str, Any]], names: set[str]) -> None:
    """A writing skill and a profile's inactive tools cannot execute a mutation."""
    if not names:
        return
    available = {member["id"]: member for member in members if member["available"]}
    if plan.response:
        if plan.response_kind == "clarification":
            return
        if plan.response_kind == "unavailable" and not any(
                names.intersection(skill_tool_names(member, member.get("skills", [])))
                for member in available.values()):
            return
        raise ValueError("agent_team_action_requires_task: delegate the action using an assigned tool-bearing skill")
    if not any(not task.read_only and task.agent_id in available
               and names.intersection(skill_tool_names(available[task.agent_id], task.skill_ids))
               for task in plan.tasks):
        raise ValueError("agent_team_action_tool_required: use a writable task and activate a skill with a requested callable tool")


def successful_action_result(message: Any, names: set[str]) -> bool:
    """Count only an actual authorized tool response, never generated prose."""
    if getattr(message, "type", "") != "tool" or getattr(message, "name", "") not in names or getattr(message, "status", "") == "error":
        return False
    try:
        value = json.loads(str(message.content))
    except (ValueError, TypeError):
        return bool(str(message.content).strip())
    return not (isinstance(value, dict) and (value.get("error") or value.get("status") in {"error", "failed", "unavailable", "cancelled"}))


def action_context_refs(original: str, refs: list[dict[str, Any]], names: list[str], *, read_only: bool, structured_edit: bool = False) -> list[dict[str, Any]]:
    from backend.domains.agent.title_replacements import title_replacements, active_title_scope
    if read_only or (title_replacements(original) is None and not structured_edit) or "bulk_update_rows" not in names:
        return refs
    selected = active_title_scope(refs)
    if not selected:
        raise ValueError("title_replacement_scope_required")
    return selected


def validate_task_action(outcome: dict[str, Any], original: str, *, structured_edit: bool = False) -> None:
    if not outcome.get("required_action_names") or outcome["confirmations"] or outcome.get("action_evidence"):
        return
    from backend.domains.agent.title_replacements import title_replacements, title_response
    reason = outcome.get("metadata", {}).get("gnosi_title_action_outcome")
    deterministic = (title_replacements(original) is not None or structured_edit) and reason in {"scope", "inventory", "unchanged", "failed"}
    if not deterministic or outcome["result"] != title_response(original, reason):
        raise RuntimeError("agent_team_action_not_executed")
