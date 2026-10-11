"""Choose an existing route, a verified continuation, or a compact director plan."""
from __future__ import annotations

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


async def prepare_plan(owner: dict[str, Any], scope: ExecutionScope, root_id: str, state: dict[str, Any],
                       original: str, refs: list[dict[str, Any]], *, operation_mode: bool
                       ) -> tuple[TeamPlan, dict[str, Any], list[dict[str, Any]], DirectRoute | None, bool]:
    from backend.services.agent_operation_catalog import skill_id
    from backend.services.agent_execution import _snapshot
    from backend.services.agent_team_contracts import required_operation, explicit_output_keys, operation_for_output_keys
    from backend.services.agent_team_runtime import _candidate, _config, _phase
    team = team_for(owner)
    operation = str(json.loads(original).get("operation") or "").split(".")[0] if operation_mode else chat_operation(original)
    route = next((r for r in team.direct_routes if r.operation == operation), None)
    required = [skill_id(operation)] if route else []
    direct, reason, cost = _candidate(owner, scope, route.agent_ids, required, original, tools=not operation_mode) if route else (None, "director_required", None)
    catalog = planning_catalog(owner, scope, original,
                               include_owner=not operation_mode and owner["id"] == _config().get("active_agent_id"))
    saved = artifacts.list_artifacts(scope, "plan", root_id)
    if saved:
        return (TeamPlan.model_validate(saved[0]["plan"]),
                {**state, "team_completed_evidence": saved[0].get("evidence", [])}, catalog, route, bool(direct))
    # A complete literal substitution needs capability selection, not a model
    # deciding whether it is prose. It still uses the normal team executor,
    # revocation checks, scoped reads, confirmations, traces and shared budget.
    if not operation_mode:
        from backend.domains.agent.title_replacements import title_replacements, active_title_scope, title_response
        from backend.services.agent_team_actions import action_candidates
        if title_replacements(original) is not None and "bulk_update_rows" in state.get("turn_authorized_tool_names", []):
            if not active_title_scope(refs):
                plan = TeamPlan(response=title_response(original, "scope"), response_kind="clarification")
            else:
                plan = None
                for identifier, skills in action_candidates(catalog, {"bulk_update_rows"}, owner["id"]):
                    selected, _, _ = _candidate(owner, scope, [identifier], skills, original, tools=True, allow_owner=True)
                    if selected:
                        plan = TeamPlan(tasks=[TeamTask(id="titles", agent_id=identifier, objective="Prepare the original title substitutions in the active view using exact tool evidence.",
                            skill_ids=skills, read_only=False)], result_task="titles")
                        break
            if plan is not None:
                action_measurement = {"version": 1, "mode": "capability", "reason": "exact_title_substitution",
                               "planning_calls_avoided": 1}
                record("team.route", action_measurement)
                artifacts.put(scope, root_id, "routing", "routing", action_measurement)
                return plan, state, catalog, None, False
    continuation = None if operation_mode or direct else continuation_plan(owner, scope, state, original, catalog, refs)
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
        data, sizes = planning_input(owner, state, original, catalog, refs, operation_mode=operation_mode)
        snapshot = _snapshot.get()
        operation_hint = required_operation(operation, snapshot.skill_ids if snapshot else []) if operation_mode else operation
        if not operation_mode:
            operation_hint = operation_hint or operation_for_output_keys(explicit_output_keys(original), catalog)
        if operation_hint:
            data["required_operation"] = operation_hint
            sizes["sent_context_chars"] = len(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        measurement.update(mode="director", reason=reason, **sizes)
        artifacts.put(scope, root_id, "routing", "routing", measurement)
        raw = await _phase(owner, root_id, scope, json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                           TeamPlan.model_json_schema(), "team.plan", allow_response=not operation_mode, members=catalog)
        plan = TeamPlan.model_validate_json(raw)
    record("team.route", measurement)
    artifacts.put(scope, root_id, "routing", "routing", measurement)
    return plan, state, catalog, route, bool(direct)
