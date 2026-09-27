"""Read-only model metadata used by assistant settings."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from backend.domains.configuration.ai.contracts import ModelReasoningResponse
from backend.services.model_reasoning import reasoning_options

router = APIRouter()


@router.get("/model-reasoning", response_model=ModelReasoningResponse)
async def get_model_reasoning(provider: str, model: str) -> dict[str, Any]:
    """Public provider metadata, without accessing credentials or calling an LLM."""
    return await asyncio.to_thread(reasoning_options, provider, model)
