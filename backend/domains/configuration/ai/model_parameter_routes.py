"""Review configured model parameters within the AI settings domain."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.services.model_parameter_review import (
    ParameterReviewRequest as ParameterReviewRequest,
    ParameterReviewResponse as ParameterReviewResponse,
)
from backend.services.workspace_service import require_role

router = APIRouter()


@router.post("/model-parameters/review", response_model=ParameterReviewResponse)
async def review_model_parameters(
    payload: ParameterReviewRequest, _context: Any = Depends(require_role("admin")),
) -> dict[str, Any]:
    from backend.services.model_parameter_review import review

    try:
        return await asyncio.to_thread(review, payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
