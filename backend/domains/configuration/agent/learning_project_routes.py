"""User-scoped project context for learning and reusing procedures."""

from fastapi import APIRouter, Depends, HTTPException

from backend.domains.configuration.agent.governance_routes import _require_configured_agent
from backend.services import agent_learning_projects as projects
from backend.services.agent_learning_models import (
    LearningProject, LearningWorkspace, ProjectBinding, ProjectDraft,
)
from backend.services.workspace_service import WorkspaceContext, require_role

router = APIRouter()


@router.get("/agents/{agent_id}/learning", response_model=LearningWorkspace)
def get_learning_workspace(
    agent_id: str, session_id: str = "",
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LearningWorkspace:
    _require_configured_agent(agent_id)
    return projects.workspace(context, agent_id, session_id[:128])


@router.post("/agents/{agent_id}/projects", response_model=LearningProject, status_code=201)
def create_learning_project(
    agent_id: str, payload: ProjectDraft,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LearningProject:
    _require_configured_agent(agent_id)
    try:
        return projects.save_project(context, agent_id, payload)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc


@router.put("/agents/{agent_id}/projects/{project_id}", response_model=LearningProject)
def update_learning_project(
    agent_id: str, project_id: str, payload: ProjectDraft,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LearningProject:
    _require_configured_agent(agent_id)
    try:
        return projects.save_project(context, agent_id, payload, project_id)
    except ValueError as exc:
        raise HTTPException(409, detail=str(exc)) from exc


@router.delete("/agents/{agent_id}/projects/{project_id}", response_model=LearningWorkspace)
def remove_learning_project(
    agent_id: str, project_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LearningWorkspace:
    _require_configured_agent(agent_id)
    try:
        projects.delete_project(context, agent_id, project_id)
    except LookupError as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    return projects.workspace(context, agent_id)


@router.put("/agents/{agent_id}/learning/{session_id}", response_model=LearningWorkspace)
def bind_learning_project(
    agent_id: str, session_id: str, payload: ProjectBinding,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LearningWorkspace:
    _require_configured_agent(agent_id)
    if not session_id or len(session_id) > 128:
        raise HTTPException(400, detail="Invalid session.")
    try:
        projects.bind_project(context, agent_id, session_id, payload.project_id)
    except LookupError as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    return projects.workspace(context, agent_id, session_id)
