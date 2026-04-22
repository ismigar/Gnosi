import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any
import json
import os

from backend.services.workspace_service import get_workspace_context, WorkspaceContext
from backend.services.context_vars import get_active_vault_path

log = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_workspace_context)])

class IdentityProfile(BaseModel):
    full_name: Optional[str] = ""
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    zip_code: Optional[str] = ""
    dni_nie: Optional[str] = ""
    notes: Optional[str] = ""

def get_identity_path() -> Path:
    base = get_active_vault_path()
    path = base / "data" / "identity.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path

@router.get("/api/identity")
async def get_identity():
    path = get_identity_path()
    if not path.exists():
        return IdentityProfile().dict()
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.error(f"Error reading identity: {e}")
        return IdentityProfile().dict()

@router.post("/api/identity")
async def save_identity(profile: IdentityProfile):
    path = get_identity_path()
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(profile.dict(), f, indent=2, ensure_ascii=False)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error saving identity: {e}")
        raise HTTPException(status_code=500, detail=str(e))
