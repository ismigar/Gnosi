from fastapi import APIRouter, HTTPException, Body
import logging
from backend.services.integration_manager import integration_manager

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
log = logging.getLogger(__name__)

@router.get("")
async def get_integrations():
    """Returns safe masked integration configuration for the UI."""
    try:
        return integration_manager.get_all_safe()
    except Exception as e:
        log.error(f"Error getting integrations: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{integration_id}")
async def update_integration(integration_id: str, payload: dict = Body(...)):
    """Updates a specific integration (e.g. 'email', 'ai', 'notion')"""
    try:
        integration_manager.update(integration_id, payload)
        return {"status": "success", "message": f"Integration {integration_id} updated"}
    except Exception as e:
        log.error(f"Error updating integration {integration_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
