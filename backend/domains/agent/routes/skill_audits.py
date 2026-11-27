"""Scoped API routes for periodic skill regression audits."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.services.agent_execution_scope import current_scope
from backend.services.agent_skill_audits import (
    SkillAuditRun as SkillAuditRun,
    SkillAuditSuite as SkillAuditSuite,
    SkillAuditSuiteCreate as SkillAuditSuiteCreate,
    create_audit_suite,
    delete_audit_suite,
    list_audit_runs,
    list_audit_suites,
    run_audit_suite,
)

router = APIRouter()


class DeleteAuditSuiteResponse(BaseModel):
    deleted: bool = True


@router.get("/skill-audits", response_model=list[SkillAuditSuite])
def get_skill_audit_suites() -> list[SkillAuditSuite]:
    return list_audit_suites(current_scope())


@router.post("/skill-audits", response_model=SkillAuditSuite)
def post_skill_audit_suite(payload: SkillAuditSuiteCreate) -> SkillAuditSuite:
    scope = current_scope()
    if scope.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="skill_audit_admin_required")
    try:
        return create_audit_suite(scope, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/skill-audits/{suite_id}", response_model=DeleteAuditSuiteResponse)
def remove_skill_audit_suite(suite_id: str) -> DeleteAuditSuiteResponse:
    scope = current_scope()
    if scope.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="skill_audit_admin_required")
    try:
        delete_audit_suite(scope, suite_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DeleteAuditSuiteResponse(deleted=True)


@router.get("/skill-audits/{suite_id}/runs", response_model=list[SkillAuditRun])
def get_skill_audit_runs(suite_id: str, limit: int = Query(default=20, ge=1, le=100)) -> list[SkillAuditRun]:
    try:
        return list_audit_runs(current_scope(), suite_id, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/skill-audits/{suite_id}/run", response_model=SkillAuditRun)
async def trigger_skill_audit_suite(suite_id: str) -> SkillAuditRun:
    scope = current_scope()
    if scope.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="skill_audit_admin_required")
    try:
        return await run_audit_suite(scope, suite_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
