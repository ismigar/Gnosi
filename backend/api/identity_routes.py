import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.domains.identity.schemas import (
    IdentityProfile,
    IdentityReadResponse,
    IdentitySaveResponse,
)
from backend.services.workspace_service import get_workspace_context, WorkspaceContext, require_role
from backend.services.context_vars import get_active_vault_path
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_json

log = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_workspace_context)])


def get_identity_path() -> Path:
    # Configs sincronitzats vault-first viuen a `.gnosi/`.
    base = get_active_vault_path()
    if base is None:
        raise RuntimeError("No active vault is available for identity storage")
    path = base / ".gnosi" / "identity.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@router.get(
    "/api/identity",
    response_model=IdentityReadResponse,
    response_model_exclude_unset=True,
)
async def get_identity() -> dict[str, Any]:
    return await asyncio.to_thread(_read_identity)


def _read_identity() -> dict[str, Any]:
    """Read the synchronized identity document outside the event loop."""
    path = get_identity_path()
    if not path.exists():
        return IdentityProfile().model_dump()

    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return IdentityReadResponse.model_validate(payload).model_dump(exclude_unset=True)
    except Exception as e:
        log.error(f"Error reading identity: {e}")
        return IdentityProfile().model_dump()


@router.post(
    "/api/identity",
    dependencies=[Depends(require_role("editor"))],
    response_model=IdentitySaveResponse,
)
async def save_identity(
    profile: IdentityProfile,
) -> dict[str, str]:
    path = get_identity_path()
    try:
        # Atomic write — a crash halfway through json.dump would leave identity.json
        # truncated and would lose the original data.
        safe_write_json(path, profile.model_dump(), indent=2, ensure_ascii=False)
        return IdentitySaveResponse(status="success").model_dump()
    except Exception as e:
        log.error(f"Error saving identity: {e}")
        raise HTTPException(
            status_code=500, detail=safe_error_detail(e, context="POST /api/identity")
        )
