import logging
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from backend.services.graph_service import GraphService
from pydantic import BaseModel
from typing import Dict, Any, Optional

log = logging.getLogger(__name__)

router = APIRouter()

class SuggestionRequest(BaseModel):
    source_id: str
    target_id: str
    reason: Optional[str] = None

@router.get("/vault-graph")
async def get_vault_graph() -> Dict[str, Any]:
    """
    Retorna el graf unificat del Vault (4 capes + pàgines + suggeriments)
    generat pel GraphService.
    """
    try:
        service = GraphService()
        graph_data = service.build_unified_graph()
        return graph_data
    except Exception as e:
        log.exception(f"Error generant el graf del vault: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/accept-suggestion")
async def accept_suggestion(req: SuggestionRequest) -> Dict[str, Any]:
    """
    Accepta una connexió suggerida per la IA i la guarda al frontmatter del fitxer .md.
    """
    try:
        service = GraphService()
        result = service.accept_suggestion(req.source_id, req.target_id, reason=req.reason)
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["message"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        log.exception(f"Error acceptant suggeriment: {e}")
        raise HTTPException(status_code=500, detail=str(e))
