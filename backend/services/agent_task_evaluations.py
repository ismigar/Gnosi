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
from backend.services.agent_task_cases import validate_case, TaskCase
from backend.services.agent_work_samples import selected_cases, suite_version, suite_mode, output_limit, validate_work
from backend.services.agent_task_evaluation_models import (
    TaskEvaluationRequest, TaskEvaluationPlan, TaskEvaluationReport, TaskCaseResult, TaskReviewRequest,
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


def _cache(scope: ExecutionScope, request: TaskEvaluationRequest, public_parameters: dict[str, Any] | None = None) -> dict[str, TaskCaseResult]:
    results: dict[str, TaskCaseResult] = {}
    if request.retest:
        return results
    for raw in artifacts.list_artifacts(scope, 'task_evaluation'):
        report = TaskEvaluationReport.model_validate(raw)
        if (report.provider, report.model, report.version, report.mode) != (
                request.provider, request.model, suite_version(request.suite), suite_mode(request.suite)):
            continue
        if report.public_parameters is not None and report.public_parameters != public_parameters:
            continue
        for case in report.cases:
            # Reconsult the bank for shared evidence; withdrawal/disagreement must take effect.
            if case.evidence_origin == 'shared':
                continue
            if case.failure not in {'', 'contract_mismatch'}:
                continue
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(case.checked_at)).total_seconds()
            previous = results.get(case.id)
            if age >= 0 and (previous is None or (previous.checked_at, previous.reviewed_at) < (case.checked_at, case.reviewed_at)):
                results[case.id] = case.model_copy(update={'reused_from': case.reused_from or report.id})
    if request.use_shared and request.suite == 'work':
        from backend.services.shared_task_evaluations import cached_cases
        for identifier, case in cached_cases(request.provider, request.model, public_parameters).items():
            results.setdefault(identifier, case)
    return results


def _bound(case: TaskCase, row: dict[str, Any], limit: int) -> float | None:
    # Includes framing/parameters and 10% margin, with no cache discount.
    value = estimate_cost(row, len(case.prompt.encode('utf-8')) + 8192, limit)
    return None if value is None else value * 1.1


def plan(request: TaskEvaluationRequest, scope: ExecutionScope, registry: list[dict[str, Any]], public_parameters: dict[str, Any] | None = None) -> TaskEvaluationPlan:
    row = _row(request, registry)
    selected = selected_cases(request.tasks, request.suite)
    cached = _cache(scope, request, public_parameters)
    reused = [cached[case.id] for case in selected if case.id in cached]
    pending = [case for case in selected if case.id not in cached]
    limit = output_limit(request.suite)
    bounds = [_bound(case, row, limit) for case in pending]
    maximum = sum(value for value in bounds if value is not None) if all(value is not None for value in bounds) else None
    reason = ''
    if pending:
        if maximum is None or (maximum == 0 and not row.get('is_free') and not row.get('is_local')):
            reason = 'unknown_price'
        elif any(int(row.get('context_window') or 0) < len(case.prompt.encode('utf-8')) + limit for case in pending):
            reason = 'insufficient_context'
        elif maximum > request.budget_usd:
            reason = 'budget_too_low'
    return TaskEvaluationPlan(version=suite_version(request.suite), mode=suite_mode(request.suite),
        case_ids=[case.id for case in selected], reused_cases=reused,
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


def _result(case: TaskCase, response: Any, row: dict[str, Any], latency: int, failure: str = '', work: bool = False) -> TaskCaseResult:
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
    content = getattr(response, 'content', response)
    if work and len(str(content)) > 16000:
        failure = 'output_limit'
    valid = not failure and (validate_work(case, content) if work else validate_case(case, content))
    return TaskCaseResult(id=case.id, metric=case.metric, tasks=list(case.tasks), passed=valid,
        failure=failure or ('' if valid else 'contract_mismatch'), checked_at=_now(), latency_ms=latency,
        cost_usd=cost, cost_source='reported' if reported is not None else 'estimated' if estimated is not None else 'unknown',
        output=str(content)[:16000] if work and content is not None else '', requires_review=case.requires_review,
        task_prompt=case.prompt if work else '', expected=case.expected if work else None,
        review='pending' if case.requires_review else 'not_required')


def run(request: TaskEvaluationRequest, scope: ExecutionScope, registry: list[dict[str, Any]],
        invoke: Callable[[str, str], Any], public_parameters: dict[str, Any] | None = None) -> TaskEvaluationReport:
    if scope.role not in {'admin', 'owner'} or not request.authorize_model_calls:
        raise PermissionError('authorization_required')
    with _claim(scope, request):
        return _run(request, scope, registry, invoke, public_parameters)


def _run(request: TaskEvaluationRequest, scope: ExecutionScope, registry: list[dict[str, Any]],
         invoke: Callable[[str, str], Any], public_parameters: dict[str, Any] | None = None) -> TaskEvaluationReport:
    preview = plan(request, scope, registry, public_parameters)
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
        reused_cases=len(preview.reused_cases), budget_usd=request.budget_usd,
        version=suite_version(request.suite), mode=suite_mode(request.suite), public_parameters=public_parameters)
    reading_budget.configure(request.budget_usd, identifier)
    try:
        with reading_budget.session(identifier):
            for case in selected_cases(request.tasks, request.suite):
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
                result = _result(case, response, row, int((time.monotonic() - started) * 1000), failure, request.suite == 'work')
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


def review(scope: ExecutionScope, report_id: str, payload: TaskReviewRequest) -> TaskEvaluationReport:
    """Human assessment changes saved evidence, never triggers model calls."""
    if scope.role not in {'admin', 'owner'}:
        raise PermissionError('authorization_required')
    with _lock:
        return _review(scope, report_id, payload)


def _review(scope: ExecutionScope, report_id: str, payload: TaskReviewRequest) -> TaskEvaluationReport:
    raw = next((item for item in artifacts.list_artifacts(scope, 'task_evaluation') if item.get('id') == report_id), None)
    if raw is None:
        raise ValueError('report_unavailable')
    if runs.read(scope, report_id).status == 'running':
        raise ValueError('already_running')
    report = TaskEvaluationReport.model_validate(raw)
    case = next((item for item in report.cases if item.id == payload.case_id), None)
    if case is None or not case.requires_review or case.reused_from or not case.passed:
        raise ValueError('case_not_reviewable')
    case.review, case.review_note, case.reviewed_at = payload.verdict, payload.note, _now()
    artifacts.put(scope, report.id, report.id, 'task_evaluation', report.model_dump())
    return report
