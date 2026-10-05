"""Administrator-only previews and explicit checks of active candidate routes."""
from __future__ import annotations
import asyncio
from typing import Any
from fastapi import APIRouter, HTTPException
from backend.services.agent_execution_scope import current_scope, revalidate_scope
from backend.services.agent_task_evaluation_models import (
    TaskEvaluationRequest, TaskEvaluationPlan, TaskEvaluationReport, TaskEvaluationSuite, TaskCriterion,
    TaskReviewRequest,
)
from backend.services import agent_task_evaluations as evaluations
from backend.services.shared_task_evaluations import SharedEvaluationBank

router = APIRouter()


@router.get('/task-evaluation-suite', response_model=TaskEvaluationSuite)
def suite(kind: str = 'work') -> TaskEvaluationSuite:
    from backend.services.agent_work_samples import SuiteKind, suite_cases, suite_version, suite_mode, output_limit
    if kind not in {'basic', 'work'}:
        raise HTTPException(status_code=422, detail='task_evaluation.invalid_suite')
    selected: SuiteKind = 'work' if kind == 'work' else 'basic'
    return TaskEvaluationSuite(kind=selected, version=suite_version(selected), mode=suite_mode(selected),
        max_output_tokens=output_limit(selected), criteria=[TaskCriterion(id=case.id, metric=case.metric, tasks=list(case.tasks),
        title=case.title, source=case.source, prompt=case.prompt if selected == 'work' else '', expected=case.expected,
        requires_review=case.requires_review) for case in suite_cases(selected)])


def _configuration(payload: TaskEvaluationRequest) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from backend.services.agent_team_runtime import _config
    from backend.agent.model_router import load_registry
    scope = current_scope()
    revalidate_scope(scope)
    if scope.role not in {'owner', 'admin'}:
        raise PermissionError('authorization_required')
    config = _config()
    if not any(profile.get('id') == payload.agent_id and profile.get('enabled', True)
               and not profile.get('plugin_suspended') for profile in config.get('agents', [])):
        raise ValueError('bot_unavailable')
    provider_config = config.get('providers', {}).get(payload.provider, {})
    if not provider_config.get('enabled', True):
        raise ValueError('model_unavailable')
    return load_registry(), provider_config


@router.get('/task-evaluations', response_model=list[TaskEvaluationReport])
def reports() -> list[dict[str, Any]]:
    from backend.services.agent_team_store import list_artifacts
    return list_artifacts(current_scope(), 'task_evaluation')


@router.post('/task-evaluations/preview', response_model=TaskEvaluationPlan)
def preview(payload: TaskEvaluationRequest) -> TaskEvaluationPlan:
    try:
        registry, config = _configuration(payload)
        from backend.services.shared_task_evaluations import public_parameters
        parameters = public_parameters(payload.provider, payload.model, config.get('base_url')) if payload.suite == 'work' else None
        return evaluations.plan(payload, current_scope(), registry, parameters)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, PermissionError) else 409,
                            detail=f'task_evaluation.{exc}') from exc


@router.post('/task-evaluations', response_model=TaskEvaluationReport)
async def run(payload: TaskEvaluationRequest) -> TaskEvaluationReport:
    from backend.agent.factory import build_diagnostic_client
    from backend.services.agent_diagnostics import invoke_diagnostic
    from langchain_core.messages import HumanMessage
    try:
        registry, config = _configuration(payload)
        from backend.services.shared_task_evaluations import public_parameters
        parameters = public_parameters(payload.provider, payload.model, config.get('base_url')) if payload.suite == 'work' else None
        scope = current_scope()

        def invoke(parent: str, prompt: str) -> Any:
            # Revalidate before each paid call, without assigning the candidate
            # to the bot or loading private instructions, memories or documents.
            live_registry, config = _configuration(payload)
            live_parameters = public_parameters(payload.provider, payload.model, config.get('base_url')) if payload.suite == 'work' else None
            if live_parameters != parameters:
                raise ValueError('evaluation_configuration_changed')
            evaluations.plan(payload, scope, live_registry, live_parameters)
            from backend.services.agent_work_samples import output_limit
            client = build_diagnostic_client(payload.provider, payload.model, config, max_output=output_limit(payload.suite))
            return invoke_diagnostic(client, [HumanMessage(content=prompt)], provider=payload.provider,
                model=payload.model, parent_run_id=parent, agent_id=payload.agent_id, metadata_only=True)

        return await asyncio.to_thread(evaluations.run, payload, scope, registry, invoke, parameters)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, PermissionError) else 409,
                            detail=f'task_evaluation.{exc}') from exc


@router.post('/task-evaluations/{report_id}/review', response_model=TaskEvaluationReport)
def review(report_id: str, payload: TaskReviewRequest) -> TaskEvaluationReport:
    scope = current_scope()
    revalidate_scope(scope)
    try:
        return evaluations.review(scope, report_id, payload)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, PermissionError) else 409,
                            detail=f'task_evaluation.{exc}') from exc


@router.get('/shared-task-evaluations', response_model=SharedEvaluationBank)
def shared_bank(refresh: bool = False) -> SharedEvaluationBank:
    from backend.services.shared_task_evaluations import load_bank
    revalidate_scope(current_scope())
    bank = load_bank(refresh=True, force=refresh)
    from backend.services.agent_team_runtime import _config
    from backend.services.shared_task_evaluations import public_parameters
    config = _config()
    bank.reports = [report for report in bank.reports if report.public_parameters == public_parameters(
        report.provider, report.model, config.get('providers', {}).get(report.provider, {}).get('base_url'))]
    return bank


@router.get('/task-evaluations/{report_id}/public-export')
def public_export(report_id: str) -> dict[str, Any]:
    from backend.services.agent_team_store import list_artifacts
    from backend.services.shared_task_evaluations import export_report
    scope = current_scope()
    revalidate_scope(scope)
    if scope.role not in {'owner', 'admin'}:
        raise HTTPException(status_code=403, detail='task_evaluation.authorization_required')
    raw = next((item for item in list_artifacts(scope, 'task_evaluation') if item.get('id') == report_id), None)
    if raw is None:
        raise HTTPException(status_code=404, detail='task_evaluation.report_unavailable')
    try:
        return export_report(TaskEvaluationReport.model_validate(raw))
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=409, detail='task_evaluation.not_exportable') from exc
