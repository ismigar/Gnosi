import asyncio
import logging
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from backend.services.graph_service import GraphService
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)

router = APIRouter()

@router.get("/graph")
async def get_vault_graph() -> Dict[str, Any]:
    """
    Return the current Vault topology and the canonical Brain proposal overlay.
    """
    try:
        # Graph construction scans the vault on a cold cache, so keep it off the
        # event loop.
        service = GraphService()
        graph_data = await asyncio.to_thread(service.build_unified_graph)
        return graph_data
    except Exception as e:
        log.exception(f"Error generating the vault graph: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="GET /api/graph"))
