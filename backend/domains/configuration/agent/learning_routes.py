"""Conversation-derived skill drafts, explicit adoption and bounded trials."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import cast

from fastapi import APIRouter, Depends, HTTPException

from backend.domains.agent.routes.sessions import get_chat_session
from backend.domains.configuration.agent.governance_routes import (
    _ai_configuration, _assignment_store, _require_configured_agent,
)
from backend.models.agent_skills import CatalogStatus
from backend.services.agent_learning_generation import configured_invoker, draft_skill, trial_skill
from backend.services.agent_learning_models import (
    LearnedSkill, LearnRequest, SavedLearning, SaveLearningRequest, SkillPackage,
    SkillTrialRequest, SkillTrialResult,
)
from backend.services.agent_skill_catalog import (
    get_skill_catalog, get_tool_catalog, resolve_agent_capabilities,
)
from backend.services.user_skill_store import UserSkillStore
from backend.services.workspace_service import WorkspaceContext, require_role

router = APIRouter()


@router.post("/learning/draft", response_model=LearnedSkill)
async def create_learning_draft(
    payload: LearnRequest,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LearnedSkill:
    """Extract an editable draft from the caller's canonical private conversation."""
    agent = _require_configured_agent(payload.agent_id)
    history = await get_chat_session(
        payload.agent_id, payload.session_id, workspace_context=context, notebook_id=None,
    )
    raw = history.get("messages")
    messages = cast(list[Mapping[str, object]], raw) if isinstance(raw, list) else []
    tools = resolve_agent_capabilities(agent, context.vault_path).tool_ids
    try:
        invoke = await asyncio.to_thread(configured_invoker, agent, _ai_configuration())
        return await asyncio.to_thread(draft_skill, payload, messages, tools, invoke)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(422, detail="Could not prepare the learning draft.") from exc


def _save_skill(payload: SaveLearningRequest, context: WorkspaceContext) -> SavedLearning:
    _require_configured_agent(payload.agent_id)
    snapshot = get_tool_catalog().snapshot()
    missing = [
        name for name in payload.skill.tool_ids
        if name not in snapshot or snapshot[name].descriptor.status != CatalogStatus.AVAILABLE
    ]
    if payload.assign and missing:
        raise HTTPException(409, detail="Required tools are unavailable; save without assigning first.")
    store = UserSkillStore(context.vault_path)
    assignments = _assignment_store() if payload.assign else None
    if assignments is not None:
        assignments.ensure_migrated()
    descriptor = store.create({
        "name": payload.skill.name, "description": payload.skill.description,
        "activation": "automatic", "kind": "agent", "version": "1.0.0",
        "tool_ids": payload.skill.tool_ids, "status": "available",
        "metadata": {"learning": payload.skill.model_dump(mode="json"), "category": "workflow"},
    }, payload.skill.instructions)
    try:
        if assignments is not None:
            revision = assignments.agent_revision(payload.agent_id)
            agent = assignments.get_agent(payload.agent_id)
            ids = list(agent.get("skill_ids") or [])
            assignments.assign(
                payload.agent_id, [*ids, descriptor.id], catalog=get_skill_catalog(),
                vault_path=context.vault_path, expected_revision=revision,
            )
    except Exception:
        store.delete(descriptor.id)
        raise
    return SavedLearning(skill_id=descriptor.id, assigned=payload.assign, missing_tools=missing)


@router.post("/learning/skills", response_model=SavedLearning, status_code=201)
def save_learned_skill(
    payload: SaveLearningRequest,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> SavedLearning:
    """Publish the reviewed draft to the existing catalog, optionally assigning it."""
    try:
        return _save_skill(payload, context)
    except ValueError as exc:
        raise HTTPException(409, detail=str(exc)) from exc


@router.post("/learning/trial", response_model=SkillTrialResult)
async def run_learning_trial(
    payload: SkillTrialRequest,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> SkillTrialResult:
    """Run a new text case and a separate rubric review, without side effects."""
    agent = _require_configured_agent(payload.agent_id)
    try:
        invoke = await asyncio.to_thread(configured_invoker, agent, _ai_configuration())
        return await asyncio.to_thread(trial_skill, payload, invoke)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(422, detail="The trial could not be completed.") from exc


@router.get("/skills/{skill_id}/package", response_model=SkillPackage)
def export_learning_package(
    skill_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> SkillPackage:
    """Export procedure, explicit examples and text resources, never private memory."""
    entry = get_skill_catalog().get_entry(skill_id, context.vault_path)
    if entry is None:
        raise HTTPException(404, detail="Skill not found.")
    from backend.services.agent_learning_packages import learned_skill

    try:
        return SkillPackage(skill=learned_skill(entry.descriptor))
    except ValueError as exc:
        raise HTTPException(422, detail="This skill exceeds the portable package limits.") from exc


@router.post("/learning/package/validate", response_model=SkillPackage)
def validate_learning_package(
    payload: SkillPackage,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> SkillPackage:
    """Validate an imported text-only package without saving or assigning it."""
    return payload
