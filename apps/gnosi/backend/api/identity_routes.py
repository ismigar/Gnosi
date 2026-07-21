import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any
import json
import os

from backend.services.workspace_service import get_workspace_context, WorkspaceContext, require_role
from backend.services.context_vars import get_active_vault_path
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_json

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
    # Configs sincronitzats vault-first viuen a `.gnosi/`.
    base = get_active_vault_path()
    path = base / ".gnosi" / "identity.json"
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

@router.post("/api/identity", dependencies=[Depends(require_role("editor"))])
async def save_identity(profile: IdentityProfile):
    path = get_identity_path()
    try:
        # Atomic write — a crash halfway through json.dump would leave identity.json
        # truncated and would lose the original data.
        safe_write_json(path, profile.dict(), indent=2, ensure_ascii=False)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error saving identity: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /api/identity"))
