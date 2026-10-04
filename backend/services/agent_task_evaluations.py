"""Reuse scoped checks before spending; save each result before the next call."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone
import threading
import time
from typing import Any, Callable, Iterator
import uuid

from backend.services import agent_execution_store as runs, agent_team_store as artifacts
from backend.services import reading_budget
from backend.services.agent_execution_models import AgentRun, ExecutionScope
from backend.services.agent_task_cases import cases_for, validate_case, VERSION, MODE, MAX_OUTPUT, MAX_AGE_DAYS, TaskCase
from backend.services.agent_task_evaluation_models import (
    TaskEvaluationRequest, TaskEvaluationPlan, TaskEvaluationReport, TaskCaseResult,
)
from backend.services.agent_team_policy import estimate_cost

_lock = threading.Lock()
_running: set[tuple[str, ...]] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(request: TaskEvaluationRequest, registry: list[dict[str, Any]]) -> dict[str, Any]:
    row = next((row for row in registry if row.get('enabled') is True
                and (row.get('provider'), row.get('model_id')) == (request.provider, request.model)), None)
    if row is None:
        raise ValueError('model_unavailable')
    return row


def _cache(scope: ExecutionScope, request: TaskEvaluationRequest) -> dict[str, TaskCaseResult]:
    results: dict[str, TaskCaseResult] = {}
    if request.retest:
        return results
    for raw in artifacts.list_artifacts(scope, 'task_evaluation'):
        report = TaskEvaluationReport.model_validate(raw)
        if (report.provider, report.model, report.version, report.mode) != (request.provider, request.model, VERSION, MODE):
            continue
        for case in report.cases:
            if case.failure not in {'', 'contract_mismatch'}:
                continue
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(case.checked_at)).total_seconds()
            previous = results.get(case.id)
            if 0 <= age <= MAX_AGE_DAYS * 86400 and (previous is None or previous.checked_at < case.checked_at):
                results[case.id] = case.model_copy(update={'reused_from': case.reused_from or report.id})
    return results


def _bound(case: TaskCase, row: dict[str, Any]) -> float | None:
    # Includes framing/parameters and 10% margin, with no cache discount.
    value = estimate_cost(row, len(case.prompt.encode('utf-8')) + 8192, MAX_OUTPUT)
    return None if value is None else value * 1.1


def plan(request: TaskEvaluationRequest, scope: ExecutionScope, registry: list[dict[str, Any]]) -> TaskEvaluationPlan:
    row = _row(request, registry)
    selected = cases_for(request.tasks)
    cached = _cache(scope, request)
    reused = [cached[case.id] for case in selected if case.id in cached]
    pending = [case for case in selected if case.id not in cached]
    bounds = [_bound(case, row) for case in pending]
    maximum = sum(value for value in bounds if value is not None) if all(value is not None for value in bounds) else None
    reason = ''
    if pending:
        if maximum is None or (maximum == 0 and not row.get('is_free') and not row.get('is_local')):
            reason = 'unknown_price'
        elif any(int(row.get('context_window') or 0) < len(case.prompt.encode('utf-8')) + MAX_OUTPUT for case in pending):
            reason = 'insufficient_context'
        elif maximum > request.budget_usd:
            reason = 'budget_too_low'
    return TaskEvaluationPlan(case_ids=[case.id for case in selected], reused_cases=reused,
        pending_ids=[case.id for case in pending], maximum_cost_usd=maximum, can_run=not reason, reason=reason)


@contextmanager
def _claim(scope: ExecutionScope, request: TaskEvaluationRequest) -> Iterator[None]:
    key = (scope.user_id, scope.workspace_id, scope.vault_path, request.provider, request.model)
    with _lock:
        if key in _running:
            raise ValueError('already_running')
        _running.add(key)
    try:
        yield
    finally:
        with _lock:
            _running.discard(key)


def _result(case: TaskCase, response: Any, row: dict[str, Any], latency: int, failure: str = '') -> TaskCaseResult:
    usage = getattr(response, 'usage_metadata', None) or {}
    metadata = getattr(response, 'response_metadata', None) or {}
    if not failure and metadata.get('finish_reason') in {'length', 'max_tokens'}:
        failure = 'output_limit'
    raw = metadata.get('token_usage') or metadata.get('usage') or {}
    from backend.services.ai_usage_ledger import decimal_cost
    reported = decimal_cost(raw.get('cost'))
    known = all(isinstance(usage.get(key), int) and not isinstance(usage[key], bool) and usage[key] >= 0
                for key in ('input_tokens', 'output_tokens'))
    estimated = estimate_cost(row, usage['input_tokens'], usage['output_tokens']) if known else None
    cost = float(reported) if reported is not None else estimated
    valid = not failure and validate_case(case, getattr(response, 'content', response))
    return TaskCaseResult(id=case.id, metric=case.metric, tasks=list(case.tasks), passed=valid,
        failure=failure or ('' if valid else 'contract_mismatch'), checked_at=_now(), latency_ms=latency,
        cost_usd=cost, cost_source='reported' if reported is not None else 'estimated' if estimated is not None else 'unknown')


def run(request: TaskEvaluationRequest, scope: ExecutionScope, registry: list[dict[str, Any]],
        invoke: Callable[[str, str], Any]) -> TaskEvaluationReport:
    if scope.role not in {'admin', 'owner'} or not request.authorize_model_calls:
        raise PermissionError('authorization_required')
    with _claim(scope, request):
        return _run(request, scope, registry, invoke)


def _run(request: TaskEvaluationRequest, scope: ExecutionScope, registry: list[dict[str, Any]],
         invoke: Callable[[str, str], Any]) -> TaskEvaluationReport:
    preview = plan(request, scope, registry)
    if not preview.can_run:
        raise ValueError(preview.reason)
    identifier = uuid.uuid4().hex
    row = _row(request, registry)
    now = time.time()
    runs.create(AgentRun(run_id=identifier, agent_id=request.agent_id, skill_id='', operation='bot_task_evaluation',
        origin='diagnostic', status='running', created_at=now, updated_at=now, provider=request.provider,
        model=request.model), scope, {'mode': 'diagnostic', 'max_calls': len(preview.pending_ids)}, {'scope': scope.model_dump()})
    report = TaskEvaluationReport(id=identifier, agent_id=request.agent_id, provider=request.provider, model=request.model,
        created_at=_now(), tasks=list(dict.fromkeys(request.tasks)), cases=preview.reused_cases,
        reused_cases=len(preview.reused_cases), budget_usd=request.budget_usd)
    reading_budget.configure(request.budget_usd, identifier)
    try:
        with reading_budget.session(identifier):
            for case in cases_for(request.tasks):
                if case.id not in preview.pending_ids:
                    continue
                if runs.cancelled(scope, identifier):
                    raise InterruptedError('cancelled')
                started = time.monotonic()
                response, failure = None, ''
                report.model_calls += 1
                try:
                    response = invoke(identifier, case.prompt)
                except (PermissionError, reading_budget.ReadingBudgetError, InterruptedError):
                    raise
                except Exception as exc:
                    failure = type(exc).__name__
                result = _result(case, response, row, int((time.monotonic() - started) * 1000), failure)
                report.cases.append(result)
                # A transport failure/unknown bill stops the suite, and remains
                # retryable: only contract results are reused for recommendations.
                if result.failure not in {'', 'contract_mismatch'} or result.cost_usd is None:
                    report.status = 'stopped'
                    report.stop_reason = 'output_limit' if result.failure == 'output_limit' else 'provider_error' if failure else 'unknown_cost'
                artifacts.put(scope, identifier, identifier, 'task_evaluation', report.model_dump())
                if report.status == 'stopped':
                    break
    except Exception as exc:
        report.status, report.stop_reason = 'stopped', str(exc)
    totals = reading_budget.status(identifier)
    report.reserved_usd = totals['reserved_usd']
    fresh = [case for case in report.cases if not case.reused_from]
    report.cost_usd = sum(case.cost_usd or 0 for case in fresh) if all(case.cost_usd is not None for case in fresh) else None
    artifacts.put(scope, identifier, identifier, 'task_evaluation', report.model_dump())
    runs.update(scope, identifier, status='completed' if report.status == 'completed' else 'failed', error=report.stop_reason)
    return report
