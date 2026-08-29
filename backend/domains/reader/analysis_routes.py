"""Reader inventory and durable-analysis HTTP routes."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.domains.reader.internal_sources import normalize_scope, reader_inventory
from backend.domains.reader.routing import RouteReturn, require_active_vault
from backend.domains.reader.schemas import (
    ReaderAnalysisJobResponse,
    ReaderAnalysisResultResponse,
    ReaderInventoryResponse,
)
from backend.services.plugin_access import require_plugins
from backend.services.workspace_service import require_role


class ReaderAnalysisRequest(BaseModel):
    """Validated scope and output preferences for a durable Reader analysis."""

    unread_only: bool = True
    source_ids: List[int] = Field(default_factory=list, max_length=50)
    categories: List[str] = Field(default_factory=list, max_length=50)
    date_from: str = Field(default="", max_length=64)
    date_to: str = Field(default="", max_length=64)
    language: str = Field(default="Catalan", max_length=64)
    guidance: str = Field(default="", max_length=2_000)

    def source_scope(self) -> Dict[str, Any]:
        return {
            "unread_only": self.unread_only,
            "source_ids": self.source_ids,
            "categories": self.categories,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "include_full_content": True,
        }


def get_reader_inventory(
    unread_only: bool = True,
    source_id: Optional[List[int]] = Query(default=None),
    category: Optional[List[str]] = Query(default=None),
    date_from: str = "",
    date_to: str = "",
) -> RouteReturn:
    """Return exact Reader counts and source breakdown without fetching rows."""
    scope = normalize_scope(
        "reader",
        {
            "unread_only": unread_only,
            "source_ids": source_id or [],
            "categories": category or [],
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    return reader_inventory(scope)


def start_reader_analysis(payload: ReaderAnalysisRequest) -> RouteReturn:
    """Snapshot the selected Reader corpus and start durable topic analysis."""
    from backend.services.reader_analysis import start_analysis

    return start_analysis(
        require_active_vault(),
        payload.source_scope(),
        language=payload.language,
        guidance=payload.guidance,
    )


def list_reader_analyses(limit: int = Query(default=20, ge=1, le=100)) -> RouteReturn:
    """List recent durable Reader analyses in the active vault."""
    from backend.services.reader_analysis import list_analyses

    return list_analyses(require_active_vault(), limit=limit)


def get_reader_analysis_status(job_id: str) -> RouteReturn:
    """Return progress for one analysis job in the active vault."""
    from backend.services.reader_analysis import get_status

    try:
        return get_status(require_active_vault(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error


def get_reader_analysis_result(job_id: str) -> RouteReturn:
    """Return the structured cited result for one completed analysis."""
    from backend.services.reader_analysis import read_result

    try:
        return read_result(require_active_vault(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


def resume_reader_analysis(job_id: str) -> RouteReturn:
    """Resume a durable job from completed checkpoints."""
    from backend.services.reader_analysis import resume_analysis

    try:
        return resume_analysis(require_active_vault(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error


def cancel_reader_analysis(job_id: str) -> RouteReturn:
    """Request cooperative cancellation of a running analysis."""
    from backend.services.reader_analysis import cancel_analysis

    try:
        return cancel_analysis(require_active_vault(), job_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Reader analysis job not found.") from error


def register_routes(router: APIRouter) -> None:
    """Register analysis handlers directly on the canonical Reader router."""
    router.get("/inventory", response_model=ReaderInventoryResponse)(get_reader_inventory)
    router.post(
        "/analysis",
        response_model=ReaderAnalysisJobResponse,
        response_model_exclude_unset=True,
        dependencies=[Depends(require_role("editor")), Depends(require_plugins("ai-platform"))],
    )(start_reader_analysis)
    router.get(
        "/analysis",
        response_model=List[ReaderAnalysisJobResponse],
        response_model_exclude_unset=True,
    )(list_reader_analyses)
    router.get(
        "/analysis/{job_id}",
        response_model=ReaderAnalysisJobResponse,
        response_model_exclude_unset=True,
    )(get_reader_analysis_status)
    router.get(
        "/analysis/{job_id}/result",
        response_model=ReaderAnalysisResultResponse,
        response_model_exclude_unset=True,
    )(get_reader_analysis_result)
    router.post(
        "/analysis/{job_id}/resume",
        response_model=ReaderAnalysisJobResponse,
        response_model_exclude_unset=True,
        dependencies=[Depends(require_role("editor")), Depends(require_plugins("ai-platform"))],
    )(resume_reader_analysis)
    router.post(
        "/analysis/{job_id}/cancel",
        response_model=ReaderAnalysisJobResponse,
        response_model_exclude_unset=True,
        dependencies=[Depends(require_role("editor"))],
    )(cancel_reader_analysis)


__all__ = [
    "ReaderAnalysisRequest",
    "cancel_reader_analysis",
    "get_reader_analysis_result",
    "get_reader_analysis_status",
    "get_reader_inventory",
    "list_reader_analyses",
    "register_routes",
    "resume_reader_analysis",
    "start_reader_analysis",
]
