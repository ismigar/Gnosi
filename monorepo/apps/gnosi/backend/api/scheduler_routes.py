from fastapi import APIRouter, HTTPException, BackgroundTasks, Query, Depends
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from backend.data.management_db import get_mgmt_db
from backend.models.scheduler import TaskExecutionHistory, TaskHistoryResponse
from backend.scheduler.manager import scheduler_manager

router = APIRouter(prefix="/api/schedulers", tags=["schedulers"])


class TaskUpdate(BaseModel):
    interval_minutes: float
    enabled: bool


@router.get("")
async def list_tasks() -> List[Dict[str, Any]]:
    """Get all scheduled tasks."""
    return scheduler_manager.get_tasks()



@router.delete("/history")
async def clear_history() -> Dict[str, Any]:
    """Clear execution history for all tasks."""
    try:
        return scheduler_manager.clear_all_history()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history", response_model=Dict[str, Any])
async def get_history(
    limit: int = Query(20, gt=0),
    offset: int = Query(0, ge=0),
    task_name: Optional[str] = Query(None),
    db: Session = Depends(get_mgmt_db)
):
    """Get task execution history with pagination."""
    query = db.query(TaskExecutionHistory)
    if task_name:
        query = query.filter(TaskExecutionHistory.task_name == task_name)
    
    total = query.count()
    items = query.order_by(TaskExecutionHistory.started_at.desc()).offset(offset).limit(limit).all()
    
    return {
        "items": [TaskHistoryResponse.from_orm(item) for item in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": total > offset + limit
    }


@router.get("/{name}")
async def get_task(name: str) -> Dict[str, Any]:
    """Get a specific task."""
    task = scheduler_manager.get_task(name)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{name}' not found")
    return task


@router.put("/{name}")
async def update_task(name: str, update: TaskUpdate) -> Dict[str, Any]:
    """Update a task's configuration."""
    try:
        return scheduler_manager.update_task(
            name=name,
            interval_minutes=update.interval_minutes,
            enabled=update.enabled
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{name}/run")
async def run_task(name: str, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Run a task immediately in the background."""
    try:
        # Check if task exists
        if not scheduler_manager.get_task(name):
            raise HTTPException(status_code=404, detail=f"Task '{name}' not found")
            
        # Iniciem el procés asíncronament utilitzant BackgroundTasks de FastAPI
        background_tasks.add_task(scheduler_manager.run_task_now, name)
        
        return {
            "success": True, 
            "message": f"Tasca '{name}' enviada a execució en segon pla",
            "status": "running"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
