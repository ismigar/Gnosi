import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.scheduler import (
    ClearTaskHistoryResponse,
    ScheduledTaskResponse,
    TaskExecutionHistory,
    TaskHistoryPageResponse,
    TaskHistoryResponse,
    TaskRunResponse,
    TaskUpdateResponse,
)
from backend.scheduler.execution import podcast_history_message
from backend.scheduler.manager import scheduler_manager
from backend.services.agent_execution_models import ExecutionScope
from backend.services.auth_service import COOKIE_NAME, get_current_user_id
from backend.services.workspace_service import get_workspace_context, require_role
from backend.utils.errors import safe_error_detail
from backend.utils.metadata_io import MetadataUnavailable

router = APIRouter(prefix="/api/schedulers", tags=["schedulers"])


class TaskUpdate(BaseModel):
    interval_minutes: float
    enabled: bool


def _status_scope(request: Request, db: Session = Depends(get_mgmt_db)) -> ExecutionScope | None:
    """Global schedule configuration remains readable when a private vault cannot be authorized."""
    try:
        uid = get_current_user_id(request.cookies.get(COOKIE_NAME), request.headers.get("authorization"), db)
        context = get_workspace_context(x_workspace_id=request.headers.get("x-workspace-id"), x_user_id=None,
                                        x_vault_id=request.headers.get("x-vault-id"), db=db, auth_uid=uid)
    except (HTTPException, MetadataUnavailable):
        return None
    return ExecutionScope.model_validate({"user_id": context.user_id, "workspace_id": context.workspace_id,
        "vault_path": str(context.vault_path.resolve()), "role": context.role})


StatusScope = Annotated[ExecutionScope | None, Depends(_status_scope)]


@router.get("", response_model=list[ScheduledTaskResponse])
async def list_tasks(scope: StatusScope = None) -> list[ScheduledTaskResponse]:
    """Get all scheduled tasks."""
    tasks = await asyncio.to_thread(scheduler_manager.get_tasks, scope)
    return [ScheduledTaskResponse.model_validate(task) for task in tasks]


@router.delete(
    "/history",
    response_model=ClearTaskHistoryResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def clear_history() -> ClearTaskHistoryResponse:
    """Clear execution history for all tasks."""
    try:
        return ClearTaskHistoryResponse.model_validate(scheduler_manager.clear_all_history())
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="DELETE /api/schedulers/history"),
        )


def _history_entry(item: TaskExecutionHistory) -> TaskHistoryResponse:
    entry = TaskHistoryResponse.model_validate(item)
    if entry.task_name == "generate_podcast" and entry.message:
        entry.message = podcast_history_message(entry.status, saved_message=entry.message) or None
    return entry


@router.get("/history", response_model=TaskHistoryPageResponse)
async def get_history(
    limit: int = Query(20, gt=0),
    offset: int = Query(0, ge=0),
    task_name: str | None = Query(None),
    db: Session = Depends(get_mgmt_db),
) -> TaskHistoryPageResponse:
    """Get task execution history with pagination."""
    query = db.query(TaskExecutionHistory)
    if task_name:
        query = query.filter(TaskExecutionHistory.task_name == task_name)

    total = query.count()
    items = query.order_by(TaskExecutionHistory.started_at.desc()).offset(offset).limit(limit).all()

    return TaskHistoryPageResponse(
        items=[_history_entry(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
        has_more=total > offset + limit,
    )


@router.get("/{name}", response_model=ScheduledTaskResponse)
async def get_task(name: str, scope: StatusScope = None) -> ScheduledTaskResponse:
    """Get a specific task."""
    task = await asyncio.to_thread(scheduler_manager.get_task, name, scope)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{name}' not found")
    return ScheduledTaskResponse.model_validate(task)


@router.put(
    "/{name}",
    response_model=TaskUpdateResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def update_task(name: str, update: TaskUpdate) -> TaskUpdateResponse:
    """Update a task's configuration."""
    try:
        return TaskUpdateResponse.model_validate(
            scheduler_manager.update_task(
                name=name,
                interval_minutes=update.interval_minutes,
                enabled=update.enabled,
            )
        )
    except ValueError as e:
        raise HTTPException(
            status_code=404,
            detail=safe_error_detail(e, context="PUT /api/schedulers/{name}"),
        )


@router.post(
    "/{name}/run",
    response_model=TaskRunResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def run_task(name: str) -> TaskRunResponse:
    """Run a task immediately in the background."""
    try:
        # Check if task exists
        if not await asyncio.to_thread(scheduler_manager.get_task, name):
            raise HTTPException(status_code=404, detail=f"Task '{name}' not found")

        accepted = scheduler_manager.submit_task(name)
        if not accepted:
            return TaskRunResponse(
                success=True,
                message=f"Tasca '{name}' ja pendent o en execució",
                status="running",
            )

        return TaskRunResponse(
            success=True,
            message=f"Tasca '{name}' enviada a execució en segon pla",
            status="running",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="POST /api/schedulers/{name}/run"),
        )
