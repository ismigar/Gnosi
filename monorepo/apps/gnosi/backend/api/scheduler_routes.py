from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Dict, Any, List

from backend.scheduler.manager import scheduler_manager

router = APIRouter(prefix="/api/schedulers", tags=["schedulers"])


class TaskUpdate(BaseModel):
    interval_minutes: int
    enabled: bool


@router.get("")
async def list_tasks() -> List[Dict[str, Any]]:
    """Get all scheduled tasks."""
    return scheduler_manager.get_tasks()


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
        # La resposta serà immediata, evitant el timeout del navegador.
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
