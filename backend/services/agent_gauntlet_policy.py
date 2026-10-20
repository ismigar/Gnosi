"""Automatic review selection using the coordinator's task contract."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from backend.services.agent_gauntlet_models import GauntletPlan

if TYPE_CHECKING:
    from backend.services.agent_team_models import TeamPlan


def needs_planning(original: str, refs: list[dict[str, Any]], state: dict[str, Any], *, operation_mode: bool = False) -> bool:
    """Only short, single-source text transformations may bypass semantic planning.

    These are routing bounds, not a claim that length measures difficulty.
    The planner decides whether the complete task needs independent review.
    """
    from backend.services.agent_team_contracts import output_contract_requested
    return (operation_mode or output_contract_requested(original) or len(original) > 2000 or len(refs) > 1
            or bool(state.get("turn_authorized_tool_names")))


def review_plan(plan: TeamPlan) -> GauntletPlan:
    if plan.quality.mode == "elaborate":
        return plan.quality
    if plan.response:
        return GauntletPlan()
    if not plan.synthesize and len(plan.tasks) == 1:
        return GauntletPlan()
    criteria = list(dict.fromkeys(item for task in plan.tasks for item in task.acceptance))
    if not criteria:
        criteria = ["Satisfy the original requested deliverable and its explicit constraints using the supplied evidence."]
    # Keep a single original contract even if individual tasks have many checks.
    if len(criteria) > 8:
        group_size = (len(criteria) + 7) // 8
        criteria = ["\n".join(criteria[start:start + group_size])
                    for start in range(0, len(criteria), group_size)]
    return GauntletPlan(mode="elaborate", reason="The deliverable combines multiple assignments or requires synthesis.", criteria=criteria)
