from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
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
from backend.scheduler.manager import scheduler_manager
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail

router = APIRouter(prefix="/api/schedulers", tags=["schedulers"])


class TaskUpdate(BaseModel):
    interval_minutes: float
    enabled: bool


@router.get("", response_model=list[ScheduledTaskResponse])
async def list_tasks() -> list[ScheduledTaskResponse]:
    """Get all scheduled tasks."""
    return [
        ScheduledTaskResponse.model_validate(task)
        for task in scheduler_manager.get_tasks()
    ]

@router.delete(
    "/history",
    response_model=ClearTaskHistoryResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def clear_history() -> ClearTaskHistoryResponse:
    """Clear execution history for all tasks."""
    try:
        return ClearTaskHistoryResponse.model_validate(
            scheduler_manager.clear_all_history()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="DELETE /api/schedulers/history"),
        )


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
    items = (
        query.order_by(TaskExecutionHistory.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return TaskHistoryPageResponse(
        items=[TaskHistoryResponse.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
        has_more=total > offset + limit,
    )


@router.get("/{name}", response_model=ScheduledTaskResponse)
async def get_task(name: str) -> ScheduledTaskResponse:
    """Get a specific task."""
    task = scheduler_manager.get_task(name)
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
async def run_task(name: str, background_tasks: BackgroundTasks) -> TaskRunResponse:
    """Run a task immediately in the background."""
    try:
        # Check if task exists
        if not scheduler_manager.get_task(name):
            raise HTTPException(status_code=404, detail=f"Task '{name}' not found")

        # We start the process asynchronously using FastAPI's BackgroundTasks
        background_tasks.add_task(scheduler_manager.run_task_now, name)

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
