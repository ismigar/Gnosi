"""
Sync Routes: API endpoints for syncing directives to Notion.
"""
from fastapi import APIRouter, HTTPException
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
import json

from backend.sync.notion_exporter import notion_exporter

router = APIRouter(prefix="/api/sync", tags=["sync"])

# Store last sync info in memory (could be persisted)
_last_sync: Optional[Dict[str, Any]] = None


@router.post("/directives-to-notion")
async def sync_directives_to_notion() -> Dict[str, Any]:
    """Export all directives to a Notion page."""
    global _last_sync
    
    try:
        result = await notion_exporter.export_all_directives()
        
        _last_sync = {
            "timestamp": datetime.utcnow().isoformat(),
            "success": result["success"],
            "synced_count": result.get("synced", 0),
            "errors": result.get("errors", [])
        }
        
        return result
    except Exception as e:
        _last_sync = {
            "timestamp": datetime.utcnow().isoformat(),
            "success": False,
            "error": str(e)
        }
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_sync_status() -> Dict[str, Any]:
    """Get the status of the last sync operation."""
    if _last_sync is None:
        return {
            "last_sync": None,
            "message": "Never synced"
        }
    
    return {
        "last_sync": _last_sync
    }


@router.post("/directive/{name}")
async def sync_single_directive(name: str) -> Dict[str, Any]:
    """Sync a single directive to Notion."""
    try:
        result = await notion_exporter.export_directive(name)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Directive '{name}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("")
async def trigger_sync() -> Dict[str, Any]:
    """
    Trigger a sync process. 
    Frontend calls this blindly. We can map it to export_all_directives 
    or just return OK if we want to defer the actual work.
    """
    # For now, let's actually do the work to be consistent
    return await sync_directives_to_notion()
