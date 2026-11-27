"""Configuration endpoints for opt-in AI model tiers and automatic fallback."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.services.agent_model_tiers import (
    ModelTiersConfig as ModelTiersConfig,
    load_model_tiers,
    save_model_tiers,
)
from backend.services.workspace_service import require_role

router = APIRouter()


@router.get("/model-tiers", response_model=ModelTiersConfig)
async def get_model_tiers() -> dict[str, Any]:
    return await asyncio.to_thread(load_model_tiers)


@router.put("/model-tiers", response_model=ModelTiersConfig)
async def update_model_tiers(
    payload: ModelTiersConfig,
    request: Request,
    _context: Any = Depends(require_role("admin")),
) -> dict[str, Any]:
    try:
        saved = await asyncio.to_thread(save_model_tiers, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    cache = getattr(request.app.state, "agent_cache", None)
    if isinstance(cache, dict):
        cache.clear()
    return saved
