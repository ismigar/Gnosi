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
        registry, _ = _configuration(payload)
        return evaluations.plan(payload, current_scope(), registry)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, PermissionError) else 409,
                            detail=f'task_evaluation.{exc}') from exc


@router.post('/task-evaluations', response_model=TaskEvaluationReport)
async def run(payload: TaskEvaluationRequest) -> TaskEvaluationReport:
    from backend.agent.factory import build_diagnostic_client
    from backend.services.agent_diagnostics import invoke_diagnostic
    from langchain_core.messages import HumanMessage
    try:
        registry, _ = _configuration(payload)
        scope = current_scope()

        def invoke(parent: str, prompt: str) -> Any:
            # Revalidate before each paid call, without assigning the candidate
            # to the bot or loading private instructions, memories or documents.
            live_registry, config = _configuration(payload)
            evaluations.plan(payload, scope, live_registry)
            from backend.services.agent_work_samples import output_limit
            client = build_diagnostic_client(payload.provider, payload.model, config, max_output=output_limit(payload.suite))
            return invoke_diagnostic(client, [HumanMessage(content=prompt)], provider=payload.provider,
                model=payload.model, parent_run_id=parent, agent_id=payload.agent_id, metadata_only=True)

        return await asyncio.to_thread(evaluations.run, payload, scope, registry, invoke)
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
