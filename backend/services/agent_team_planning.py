"""Choose an existing route, a verified continuation, or a compact director plan."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from backend.services import agent_team_store as artifacts
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_trace import record
from backend.services.agent_team_context import planning_input
from backend.services.agent_team_continuation import continuation_plan
from backend.services.agent_team_models import DirectRoute, TeamPlan, TeamTask
from backend.services.agent_team_policy import chat_operation, team_for
from backend.services.agent_team_routing import planning_catalog


def _director_input(
    owner: dict[str, Any], state: dict[str, Any], original: str,
    catalog: list[dict[str, Any]], refs: list[dict[str, Any]],
    *, operation_mode: bool, operation: str, route: DirectRoute | None, tried_greeting: bool,
) -> tuple[str, dict[str, int]]:
    from backend.services.agent_execution import _snapshot
    from backend.services.agent_team_contracts import explicit_output_keys, operation_for_output_keys, required_operation

    data, sizes = planning_input(owner, state, original, catalog, refs, operation_mode=operation_mode)
    if tried_greeting:
        data["specialist_planning_requested"] = True
    if route is not None:
        data["execution_route"] = route.model_dump()
    snapshot = _snapshot.get()
    if operation_mode:
        operation_hint = required_operation(operation, snapshot.skill_ids if snapshot else [])
    else:
        operation_hint = operation or operation_for_output_keys(explicit_output_keys(original), catalog)
    if operation_hint:
        data["required_operation"] = operation_hint
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if operation_hint or tried_greeting:
        sizes["sent_context_chars"] = len(payload)
    return payload, sizes


async def prepare_plan(owner: dict[str, Any], scope: ExecutionScope, root_id: str, state: dict[str, Any],
                       original: str, refs: list[dict[str, Any]], *, operation_mode: bool
                       ) -> tuple[TeamPlan, dict[str, Any], list[dict[str, Any]], DirectRoute | None, bool]:
    from backend.services.agent_operation_catalog import skill_id
    from backend.domains.agent.supplied_tasks import current_supplied_operation
    from backend.services.agent_team_runtime import _candidate, _config, _phase
    team = team_for(owner)
    from backend.services.agent_gauntlet_policy import needs_planning
    supplied = "" if operation_mode else current_supplied_operation(state, original)
    operation = str(json.loads(original).get("operation") or "").split(".")[0] if operation_mode else supplied or chat_operation(original)
    route = next((r for r in team.direct_routes if r.operation == operation), None)
    saved = artifacts.list_artifacts(scope, "plan", root_id)
    from backend.services.agent_team_greeting import director_greeting, greeting_exchange
    from backend.domains.agent.title_replacements import active_title_scope
    try_greeting = not (operation_mode or route or saved) and greeting_exchange(original, state) and not active_title_scope(refs)
    if try_greeting:
        greeting = await director_greeting(owner, scope, root_id, state, original, refs)
        if greeting is not None:
            greeting_metrics = {"version": 1, "mode": "director", "reason": "standalone_greeting",
                           "full_planning_calls_avoided": 1}
            artifacts.put(scope, root_id, "routing", "routing", greeting_metrics)
            record("team.route", greeting_metrics)
            return greeting, {**state, "greeting_reply": True}, [], None, False
    semantic_plan = needs_planning(original, refs, state, operation_mode=operation_mode)
    required = [skill_id(operation)] if route else []
    direct, reason, cost = (
        await asyncio.to_thread(
            _candidate, owner, scope, route.agent_ids, required, original, tools=not operation_mode,
        )
        if route and not semantic_plan and not supplied else (None, "director_required", None)
    )
    include_owner = not operation_mode and owner["id"] == (await asyncio.to_thread(_config)).get("active_agent_id")
    catalog = await asyncio.to_thread(planning_catalog, owner, scope, original, include_owner=include_owner)
    if saved:
        return (TeamPlan.model_validate(saved[0]["plan"]),
                {**state, **saved[0].get('state', {}), "team_completed_evidence": saved[0].get("evidence", [])}, catalog, route, bool(direct))
    from backend.services.agent_team_supplied import supplied_task_plan
    routine = (await asyncio.to_thread(supplied_task_plan, owner, scope, team, catalog, supplied, original, route, state)
               if supplied else None)
    if routine is not None:
        executor = routine.tasks[0].agent_id
        supplied_measurement = {"version": 1, "mode": "direct", "reason": "unique_eligible_specialist",
                       "operation": supplied, "executor": executor, "planning_calls_avoided": 1}
        record("team.route", supplied_measurement)
        artifacts.put(scope, root_id, "routing", "routing", supplied_measurement)
        return routine, state, catalog, DirectRoute(operation=supplied, agent_ids=[executor]), True
    continuation = None if semantic_plan or direct else continuation_plan(owner, scope, state, original, catalog, refs)
    if not operation_mode and not direct and not continuation:
        from backend.services.agent_view_edit import prepare_view_edit
        state, clarification = await prepare_view_edit(owner, scope, root_id, state, original, refs, catalog)
        if clarification:
            return TeamPlan(response=clarification, response_kind='clarification'), state, catalog, None, False
    # A complete literal substitution needs capability selection, not a model
    # deciding whether it is prose. It still uses the normal team executor,
    # revocation checks, scoped reads, confirmations, traces and shared budget.
    if not operation_mode:
        from backend.domains.agent.title_replacements import title_replacements, active_title_scope, title_response
        from backend.services.agent_team_actions import action_candidates
        if (title_replacements(original) is not None or state.get('title_edit')) and "bulk_update_rows" in state.get("turn_authorized_tool_names", []):
            if not active_title_scope(refs):
                plan = TeamPlan(response=title_response(original, "scope"), response_kind="clarification")
            else:
                plan = None
                for identifier, skills in action_candidates(catalog, {"bulk_update_rows"}, owner["id"]):
                    selected, _, _ = await asyncio.to_thread(
                        _candidate, owner, scope, [identifier], skills, original, tools=True, allow_owner=True,
                    )
                    if selected:
                        plan = TeamPlan(tasks=[TeamTask(id="titles", agent_id=identifier, objective="Prepare the original title substitutions in the active view using exact tool evidence.",
                            skill_ids=skills, read_only=False)], result_task="titles")
                        break
            if plan is not None:
                action_measurement = {"version": 1, "mode": "capability", "reason": "structured_title_edit" if state.get('title_edit') else "exact_title_substitution",
                               "full_planning_calls_avoided": 1,
                               **({"planning_calls_avoided": 1} if not state.get('title_edit') else {})}
                record("team.route", action_measurement)
                artifacts.put(scope, root_id, "routing", "routing", action_measurement)
                return plan, state, catalog, None, False
    measurement: dict[str, Any] = {"version": 1, "planning_calls_avoided": 0}
    if direct:
        measurement.update(mode="direct", operation=operation, executor=direct["id"], reason=reason, estimated_cost_usd=cost)
        plan = TeamPlan(tasks=[TeamTask(id="direct", agent_id=direct["id"], objective=original,
            skill_ids=required, read_only=operation_mode or bool(chat_operation(original)))], result_task="direct")
    elif continuation:
        plan, prior_run_id = continuation
        measurement.update(mode="continuation", executor=plan.tasks[0].agent_id,
                           prior_run_id=prior_run_id, planning_calls_avoided=1)
    else:
        payload, sizes = _director_input(
            owner, state, original, catalog, refs, operation_mode=operation_mode,
            operation=operation, route=route, tried_greeting=try_greeting,
        )
        measurement.update(mode="director", reason=reason, **sizes)
        artifacts.put(scope, root_id, "routing", "routing", measurement)
        raw = await _phase(owner, root_id, scope, payload,
                           TeamPlan.model_json_schema(), "team.plan", allow_response=not operation_mode, members=catalog)
        plan = TeamPlan.model_validate_json(raw)
    record("team.route", measurement)
    artifacts.put(scope, root_id, "routing", "routing", measurement)
    return plan, state, catalog, route, bool(direct)
