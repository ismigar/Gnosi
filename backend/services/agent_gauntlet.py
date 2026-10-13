"""Automatic evidence-based review without repeating an action graph."""
from __future__ import annotations

import asyncio
import copy
import json
import time
from typing import TYPE_CHECKING, Any, cast

from jsonschema import ValidationError as SchemaError

from backend.services import agent_team_store as artifacts
from backend.services.agent_behavior import resource, revision
from backend.services.agent_cancellation import AgentTurnCancelled, await_with_cancellation, is_cancelled
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, ExecutionScope
from backend.services.agent_execution_trace import record, sanitize
from backend.services.agent_gauntlet_models import GauntletPlan, GauntletReview, improved

if TYPE_CHECKING:
    from backend.services.agent_team_models import TeamPlan

_BUDGET_ERRORS = {"agent_operation_call_budget_exceeded", "agent_job_call_budget_exceeded", "agent_budget_exceeded"}


def public_summary(work: dict[str, Any]) -> dict[str, Any]:
    return {key: work[key] for key in ("status", "rounds", "finding_count", "stop_reason")}


def _fresh_snapshot(source: AgentExecutionSnapshot, phase: str, root_id: str) -> AgentExecutionSnapshot:
    """Keep frozen authority and methodology, discard personal/context history."""
    profile = copy.deepcopy(source.profile)
    profile.update(persona="", context="", _execution_detailed_persona="", _execution_reviewed_memory=[], team={"enabled": False})
    metadata = profile.setdefault("_team_execution", {"root_id": root_id, "owner_id": source.agent_id})
    metadata["read_only"] = True
    instructions = [*source.instructions, resource(f"system/gauntlet-{phase}.md")]
    return source.model_copy(update={"profile": profile, "instructions": instructions,
        "parent_run_id": root_id, "revision": revision({"source": source.revision, "phase": phase, "instructions": instructions})})


def _packet(original: str, state: dict[str, Any], results: dict[str, Any], criteria: list[dict[str, str]],
            schema: dict[str, Any] | None) -> dict[str, Any]:
    # These are the messages present BEFORE building, never the builder's trace.
    messages = [message for message in state.get("messages", [])
                if message.type in {"human", "ai", "tool"} and not getattr(message, "tool_calls", None)]
    original_context = []
    for message in messages[-8:]:
        content = message.content if isinstance(message.content, str) else json.dumps(message.content, ensure_ascii=False)
        truncated = len(content) > 4000
        original_context.append({"role": message.type, "content": content[:4000], "truncated": truncated})
    evidence = [{"task_id": key, "run_id": value.get("run_id"), "sources": value.get("review_evidence", []),
                 "omitted_source_evidence": value.get("review_evidence_omitted", 0),
                 "action_evidence": value.get("action_evidence", [])} for key, value in results.items()]
    clean, _ = sanitize({"original_request": original, "original_context": original_context,
        "omitted_context_messages": max(0, len(messages) - 8),
        "criteria": criteria, "source_evidence": evidence, "output_schema": schema})
    return cast(dict[str, Any], clean)


async def _call(snapshot: AgentExecutionSnapshot, phase: str, root_id: str, packet: dict[str, Any],
                candidate: str, round_number: int, token: str, timeout: int,
                schema: dict[str, Any] | None, findings: dict[str, Any] | None = None) -> tuple[str, str]:
    from backend.services.agent_execution import execute_operation
    from backend.services.agent_team_runtime import delegating
    from backend.services.agent_execution_trace import metadata_only_trace
    if not snapshot.skill_ids:
        raise RuntimeError("agent_gauntlet_skill_unavailable")
    active = delegating.set(True)
    trace_token = metadata_only_trace.set(True)
    try:
        request = AgentOperation(skill_id=snapshot.skill_ids[0], operation=f"gauntlet.{phase}",
            input=json.dumps({**packet, "candidate": candidate, "round": round_number,
                              **({"findings": findings} if findings is not None else {})}, ensure_ascii=False),
            output_schema=schema, tool_mode="none", max_model_calls=1, timeout_seconds=timeout,
            parent_run_id=root_id, resume_requires_parent=True, origin=snapshot.origin)
        result = await await_with_cancellation(execute_operation(
            request, snapshot=_fresh_snapshot(snapshot, phase, root_id), private_result=True), token)
        return result.result, result.run_id
    finally:
        metadata_only_trace.reset(trace_token)
        delegating.reset(active)


def _restore(scope: ExecutionScope, root_id: str, identity: str,
             schema: dict[str, Any] | None) -> tuple[str, dict[str, Any]] | None:
    from backend.services.agent_execution import _validate_output
    saved = artifacts.list_artifacts(scope, "gauntlet", root_id)
    if not saved:
        return None
    work = saved[0]
    if work["identity"] != identity:
        raise RuntimeError("agent_gauntlet_inputs_changed")
    if work["status"] == "running":
        work.update(status="incomplete", stop_reason="interrupted")
        artifacts.put(scope, root_id, "gauntlet", "gauntlet", work)
    return _validate_output(str(work["candidate"]), schema), public_summary(work)


def _deadline(state: dict[str, Any]) -> float:
    from backend.services.agent_execution import _operation_timeout
    # This is the remaining parent time, not a fresh deadline for every revision.
    started = float(state.get("turn_started_at") or time.monotonic())
    timeout = _operation_timeout.get()
    budgets = (state.get("turn_plan") or {}).get("budgets") or {}
    limit = budgets.get("timeout_seconds")
    if isinstance(limit, (int, float)) and limit > 0:
        timeout = min(timeout, int(limit))
    return started + timeout


def _verdict(review: GauntletReview, previous: GauntletReview | None,
             work: dict[str, Any], allow_revision: bool) -> tuple[str, str] | None:
    if review.unverifiable:
        return "incomplete", "unverified_evidence"
    if review.accepted:
        return "accepted", "accepted"
    if not allow_revision:
        return "incomplete", "action_review"
    if previous is not None:
        work["stagnant_rounds"] = 0 if improved(previous, review) else int(work["stagnant_rounds"]) + 1
        if int(work["stagnant_rounds"]) >= 2:
            return "stagnated", "stagnated"
    return None


async def review_team_result(*, root_id: str, scope: ExecutionScope, plan: TeamPlan,
                             original: str, state: dict[str, Any], results: dict[str, Any],
                             candidate: str, output_schema: dict[str, Any] | None,
                             metadata: dict[str, Any], operation_mode: bool) -> tuple[str, dict[str, Any]]:
    # Only the coordinator's current review can certify its final deliverable.
    metadata.pop("gnosi_gauntlet", None)
    if plan.quality.mode != "elaborate":
        return candidate, metadata
    result, summary = await review_deliverable(root_id=root_id, scope=scope, quality=plan.quality,
        source=AgentExecutionSnapshot.model_validate(results[plan.result_task]["snapshot"]),
        original=original, state=state, results=results, candidate=candidate, output_schema=output_schema,
        allow_revision=operation_mode or all(task.read_only for task in plan.tasks))
    metadata["gnosi_gauntlet"] = summary
    if "gnosi_visible_content" in metadata:
        metadata["gnosi_visible_content"] = result
    return result, metadata


async def review_direct_response(*, owner: dict[str, Any], root_id: str, scope: ExecutionScope,
                                 quality: GauntletPlan, original: str, state: dict[str, Any], candidate: str,
                                 output_schema: dict[str, Any] | None, available: bool) -> tuple[str, dict[str, Any]]:
    if quality.mode != "elaborate":
        return candidate, {}
    if not available:
        return candidate, {"gnosi_gauntlet": {"status": "incomplete", "rounds": 0, "finding_count": 0, "stop_reason": "unavailable"}}
    from backend.services.agent_team_models import TEAM_SKILL
    from backend.services.agent_team_policy import team_for
    from backend.services.agent_team_runtime import _snapshot, _profile
    snapshot, _ = _snapshot(_profile(team_for(owner).director_id), owner, root_id, scope, [TEAM_SKILL], [])
    answer, summary = await review_deliverable(root_id=root_id, scope=scope, quality=quality,
        source=snapshot, original=original, state=state, results={}, candidate=candidate,
        output_schema=output_schema, allow_revision=True)
    return answer, {"gnosi_gauntlet": summary}


async def review_deliverable(*, root_id: str, scope: ExecutionScope, quality: GauntletPlan,
                             source: AgentExecutionSnapshot, original: str, state: dict[str, Any],
                             results: dict[str, Any], candidate: str,
                             output_schema: dict[str, Any] | None, allow_revision: bool = True) -> tuple[str, dict[str, Any]]:
    from backend.services.agent_execution import _validate_output
    from backend.services.agent_team_runtime import execution_profile
    token = str(state.get("cancel_token") or "")
    authority = _fresh_snapshot(source, "review", root_id)

    def check_authority() -> None:
        if is_cancelled(token):
            raise AgentTurnCancelled("agent_turn_cancelled")
        execution_profile(authority)

    check_authority()
    criteria = [{"id": f"C{index + 1}", "requirement": text} for index, text in enumerate(quality.criteria)]
    packet = _packet(original, state, results, criteria, output_schema)
    identity = revision({"candidate": candidate, "packet": packet, "snapshot": source.revision, "allow_revision": allow_revision})
    saved = _restore(scope, root_id, identity, output_schema)
    if saved is not None:
        check_authority()
        return saved
    work: dict[str, Any] = {"identity": identity, "criteria": criteria, "candidate": candidate,
            "candidate_hash": revision(candidate), "status": "running", "rounds": 0,
            "finding_count": 0, "stop_reason": "", "stagnant_rounds": 0, "phases": []}
    artifacts.put(scope, root_id, "gauntlet", "gauntlet", work, create_only=True)
    record("gauntlet.start", {"status": "started", "criteria_count": len(criteria)})
    previous: GauntletReview | None = None
    deadline = _deadline(state)

    def finish(status: str, reason: str) -> tuple[str, dict[str, Any]]:
        check_authority()
        work.update(status=status, stop_reason=reason)
        artifacts.put(scope, root_id, "gauntlet", "gauntlet", work)
        record("gauntlet.complete", public_summary(work))
        return str(work["candidate"]), public_summary(work)

    try:
        while True:
            check_authority()
            remaining = int(deadline - time.monotonic())
            if remaining < 1:
                return finish("incomplete", "budget")
            round_number = int(work["rounds"]) + 1
            text, run_id = await _call(source, "review", root_id, packet, str(work["candidate"]),
                round_number, token, remaining, GauntletReview.model_json_schema())
            review = GauntletReview.model_validate_json(text).validate_coverage(criteria)
            work.update(rounds=round_number, finding_count=len(review.findings))
            work["phases"].append({"phase": "review", "round": round_number, "run_id": run_id,
                                   "candidate_hash": work["candidate_hash"], "finding_count": len(review.findings)})
            artifacts.put(scope, root_id, "gauntlet", "gauntlet", work)
            record("gauntlet.review", {
                "round": round_number,
                "finding_count": len(review.findings),
                "status": "accepted" if review.accepted else "unverifiable" if review.unverifiable else "needs_revision",
            })
            verdict = _verdict(review, previous, work, allow_revision)
            if verdict:
                return finish(*verdict)
            previous = review
            remaining = int(deadline - time.monotonic())
            if remaining < 1:
                return finish("incomplete", "budget")
            revised, run_id = await _call(source, "revise", root_id, packet, str(work["candidate"]),
                round_number, token, remaining, output_schema, review.model_dump())
            revised = _validate_output(revised, output_schema)
            work.update(candidate=revised, candidate_hash=revision(revised))
            work["phases"].append({"phase": "revise", "round": round_number, "run_id": run_id,
                                   "candidate_hash": work["candidate_hash"]})
            artifacts.put(scope, root_id, "gauntlet", "gauntlet", work)
    except (AgentTurnCancelled, asyncio.CancelledError, PermissionError):
        raise
    except TimeoutError:
        return finish("incomplete", "budget")
    except (ValueError, SchemaError):
        return finish("incomplete", "invalid_review")
    except (RuntimeError, LookupError, OSError) as error:
        return finish("incomplete", "budget" if str(error) in _BUDGET_ERRORS else "unavailable")
