"""HTTP contracts for academic search and systematic literature review."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from collections.abc import AsyncIterator
from typing import TypeVar

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.domains.literature.schemas import (
    ActivityRequest,
    AiOperationRequest,
    CandidateRequest,
    ConfigurationPatch,
    ConflictRequest,
    DecisionRequest,
    FullTextRequest,
    ImportRequest,
    LiteratureActivityResponse,
    LiteratureAiResponse,
    LiteratureCandidateMutationResponse,
    LiteratureCandidateResponse,
    LiteratureCandidatesResponse,
    LiteratureCatalogResponse,
    LiteratureConfigurationResponse,
    LiteratureDecisionMutationResponse,
    LiteratureImportResponse,
    LiteratureManualCaptureResponse,
    LiteratureRepositoryDeletionResponse,
    LiteratureRepositoryResponse,
    LiteratureRepositoryTestResponse,
    LiteratureReviewDetailResponse,
    LiteratureReviewResponse,
    LiteratureReviewsResponse,
    LiteratureReviewTablesResponse,
    LiteratureSearchResponse,
    LiteratureSearchesResponse,
    LiteratureSnowballResponse,
    LiteratureSyncResponse,
    LiteratureWorkResponse,
    ManualCaptureRequest,
    RepositoryPayload,
    RepositoryTestPayload,
    ReviewCreateRequest,
    ReviewScheduleRequest,
    SearchRequest,
    SnowballRequest,
)
from backend.services import (
    literature_ai_service,
    literature_import_service,
    literature_review_service,
    literature_service,
)
from backend.services.workspace_service import WorkspaceContext, require_role


router = APIRouter(prefix="/api/vault/literature", tags=["Literature"])
ResponseModelT = TypeVar("ResponseModelT", bound=BaseModel)


def _validated_response(model: type[ResponseModelT], payload: object) -> ResponseModelT:
    return model.model_validate(payload)


@router.get(
    "/configuration",
    response_model=LiteratureConfigurationResponse,
    response_model_exclude_unset=True,
)
def get_configuration(
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureConfigurationResponse:
    return _validated_response(
        LiteratureConfigurationResponse,
        literature_service.public_configuration(context.vault_path),
    )


@router.put(
    "/configuration",
    response_model=LiteratureConfigurationResponse,
    response_model_exclude_unset=True,
)
def update_configuration(
    payload: ConfigurationPatch,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureConfigurationResponse:
    literature_service.save_config(context.vault_path, payload.model_dump(exclude_none=True))
    return _validated_response(
        LiteratureConfigurationResponse,
        literature_service.public_configuration(context.vault_path),
    )


@router.get(
    "/catalog",
    response_model=LiteratureCatalogResponse,
    response_model_exclude_unset=True,
)
def get_catalog(
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureCatalogResponse:
    return _validated_response(
        LiteratureCatalogResponse,
        {"sources": literature_service.catalog(context.vault_path)},
    )


@router.post(
    "/repositories/test",
    response_model=LiteratureRepositoryTestResponse,
    response_model_exclude_unset=True,
)
async def test_repository(
    payload: RepositoryTestPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureRepositoryTestResponse:
    del context
    return _validated_response(
        LiteratureRepositoryTestResponse,
        await literature_service.test_repository(
            payload.model_dump(exclude={"query"}), payload.query
        ),
    )


@router.post(
    "/repositories",
    status_code=201,
    response_model=LiteratureRepositoryResponse,
    response_model_exclude_unset=True,
)
def create_repository(
    payload: RepositoryPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureRepositoryResponse:
    return _validated_response(
        LiteratureRepositoryResponse,
        literature_service.save_repository(context.vault_path, payload.model_dump()),
    )


@router.put(
    "/repositories/{repository_id}",
    response_model=LiteratureRepositoryResponse,
    response_model_exclude_unset=True,
)
def update_repository(
    repository_id: str,
    payload: RepositoryPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureRepositoryResponse:
    return _validated_response(
        LiteratureRepositoryResponse,
        literature_service.save_repository(context.vault_path, payload.model_dump(), repository_id),
    )


@router.delete(
    "/repositories/{repository_id}",
    response_model=LiteratureRepositoryDeletionResponse,
    response_model_exclude_unset=True,
)
def delete_repository(
    repository_id: str,
    delete_index: bool = Query(default=False),
    confirm: bool = Query(default=False),
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureRepositoryDeletionResponse:
    if not confirm:
        raise HTTPException(
            status_code=409, detail="Repository deletion requires explicit confirmation."
        )
    return _validated_response(
        LiteratureRepositoryDeletionResponse,
        literature_service.delete_repository(
            context.vault_path, repository_id, delete_index=delete_index
        ),
    )


@router.post(
    "/synchronizations/{source_id}",
    status_code=202,
    response_model=LiteratureSyncResponse,
    response_model_exclude_unset=True,
)
def start_synchronization(
    source_id: str,
    full: bool = Body(default=False, embed=True),
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureSyncResponse:
    return _validated_response(
        LiteratureSyncResponse,
        literature_service.enqueue_sync(context.vault_path, source_id, full=full),
    )


@router.get(
    "/synchronizations/{source_id}",
    response_model=LiteratureSyncResponse,
    response_model_exclude_unset=True,
)
def get_synchronization(
    source_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureSyncResponse:
    return _validated_response(
        LiteratureSyncResponse,
        literature_service.sync_status(context.vault_path, source_id),
    )


@router.delete(
    "/synchronizations/{source_id}",
    response_model=LiteratureSyncResponse,
    response_model_exclude_unset=True,
)
def cancel_synchronization(
    source_id: str,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureSyncResponse:
    return _validated_response(
        LiteratureSyncResponse,
        literature_service.cancel_sync(context.vault_path, source_id),
    )


@router.post(
    "/synchronizations/{source_id}/resume",
    status_code=202,
    response_model=LiteratureSyncResponse,
    response_model_exclude_unset=True,
)
def resume_synchronization(
    source_id: str,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> LiteratureSyncResponse:
    return _validated_response(
        LiteratureSyncResponse,
        literature_service.enqueue_sync(context.vault_path, source_id, full=False),
    )


@router.get(
    "/searches",
    response_model=LiteratureSearchesResponse,
    response_model_exclude_unset=True,
)
def list_searches(
    limit: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureSearchesResponse:
    return _validated_response(
        LiteratureSearchesResponse,
        {"searches": literature_service.list_searches(context.vault_path, limit)},
    )


@router.post(
    "/searches",
    status_code=202,
    response_model=LiteratureSearchResponse,
    response_model_exclude_unset=True,
)
async def create_search(
    payload: SearchRequest,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureSearchResponse:
    return _validated_response(
        LiteratureSearchResponse,
        literature_service.start_search(
            context.vault_path,
            query=payload.query,
            filters=payload.filters,
            source_ids=payload.source_ids,
            source_queries=payload.source_queries,
            ai_audits=payload.ai_audits,
            limit_per_source=payload.limit_per_source,
            owner_user_id=context.user_id,
        ),
    )


@router.get(
    "/searches/{search_id}",
    response_model=LiteratureSearchResponse,
    response_model_exclude_unset=True,
)
def get_search(
    search_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureSearchResponse:
    payload = literature_service.get_search(
        context.vault_path, search_id, offset=offset, limit=limit
    )
    payload["results"] = literature_import_service.mark_resource_membership(
        payload.get("results") or [], context
    )
    return _validated_response(LiteratureSearchResponse, payload)


@router.delete(
    "/searches/{search_id}",
    response_model=LiteratureSearchResponse,
    response_model_exclude_unset=True,
)
def cancel_search(
    search_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureSearchResponse:
    return _validated_response(
        LiteratureSearchResponse,
        literature_service.cancel_search(context.vault_path, search_id),
    )


@router.get(
    "/searches/{search_id}/results/{result_id}",
    response_model=LiteratureWorkResponse,
    response_model_exclude_unset=True,
)
def get_result(
    search_id: str,
    result_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureWorkResponse:
    result = literature_service.get_search_result(context.vault_path, search_id, result_id)
    return _validated_response(
        LiteratureWorkResponse,
        literature_import_service.mark_resource_membership([result], context)[0],
    )


@router.get("/searches/{search_id}/events", response_model=None)
async def stream_search_events(
    search_id: str,
    after: int = Query(default=0, ge=0),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> StreamingResponse:
    vault_path = context.vault_path

    async def event_stream() -> AsyncIterator[str]:
        cursor = after
        idle = 0
        while True:
            payload = literature_service.search_events(vault_path, search_id, cursor)
            for event in payload["events"]:
                cursor = max(cursor, int(event.get("seq") or 0))
                yield f"id: {cursor}\nevent: {event.get('type', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                idle = 0
            if payload["state"] in {"completed", "cancelled", "failed"} and not payload["events"]:
                break
            idle += 1
            if idle % 30 == 0:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/imports",
    response_model=LiteratureImportResponse,
    response_model_exclude_unset=True,
)
async def import_results(
    payload: ImportRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureImportResponse:
    return _validated_response(
        LiteratureImportResponse,
        await literature_import_service.import_works(
            payload.works,
            background_tasks,
            context,
            notebook_id=payload.notebook_id,
            notebook_title=payload.notebook_title,
        ),
    )


@router.post(
    "/reviews/tables",
    status_code=201,
    response_model=LiteratureReviewTablesResponse,
    response_model_exclude_unset=True,
)
async def ensure_review_tables(
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureReviewTablesResponse:
    del context
    return _validated_response(
        LiteratureReviewTablesResponse,
        await literature_review_service.ensure_tables(),
    )


@router.get(
    "/reviews",
    response_model=LiteratureReviewsResponse,
    response_model_exclude_unset=True,
)
def list_reviews(
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureReviewsResponse:
    del context
    return _validated_response(
        LiteratureReviewsResponse,
        {"reviews": literature_review_service.list_reviews()},
    )


@router.post(
    "/reviews",
    status_code=201,
    response_model=LiteratureReviewResponse,
    response_model_exclude_unset=True,
)
async def create_review(
    payload: ReviewCreateRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureReviewResponse:
    return _validated_response(
        LiteratureReviewResponse,
        await literature_review_service.create_review(
            payload.model_dump(), background_tasks, context
        ),
    )


@router.get(
    "/reviews/{review_id}",
    response_model=LiteratureReviewDetailResponse,
    response_model_exclude_unset=True,
)
def get_review(
    review_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureReviewDetailResponse:
    audit = literature_review_service.review_audit(review_id, context)
    return _validated_response(
        LiteratureReviewDetailResponse,
        {
            "review": audit["review"],
            "activities": audit["activities"],
            "candidates": audit["candidates"],
            "prisma": audit["prisma"],
        },
    )


@router.post(
    "/reviews/{review_id}/activities",
    status_code=201,
    response_model=LiteratureActivityResponse,
    response_model_exclude_unset=True,
)
async def create_activity(
    review_id: str,
    payload: ActivityRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureActivityResponse:
    return _validated_response(
        LiteratureActivityResponse,
        await literature_review_service.append_activity(
            review_id,
            payload.activity_type,
            payload.model_dump(exclude={"activity_type"}),
            background_tasks,
            context,
        ),
    )


@router.put(
    "/reviews/{review_id}/schedule",
    response_model=LiteratureReviewResponse,
    response_model_exclude_unset=True,
)
async def update_review_schedule(
    review_id: str,
    payload: ReviewScheduleRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureReviewResponse:
    schedule = payload.model_dump()
    schedule["updated_at"] = datetime.now(timezone.utc).isoformat()
    return _validated_response(
        LiteratureReviewResponse,
        await literature_review_service.update_configuration(
            review_id, {"schedule": schedule}, background_tasks, context
        ),
    )


@router.post(
    "/reviews/{review_id}/candidates",
    status_code=201,
    response_model=LiteratureCandidateMutationResponse,
    response_model_exclude_unset=True,
)
async def add_candidates(
    review_id: str,
    payload: CandidateRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureCandidateMutationResponse:
    return _validated_response(
        LiteratureCandidateMutationResponse,
        await literature_review_service.add_candidates(
            review_id, payload.works, background_tasks, context, payload.activity_id
        ),
    )


@router.get(
    "/reviews/{review_id}/candidates",
    response_model=LiteratureCandidatesResponse,
    response_model_exclude_unset=True,
)
def list_candidates(
    review_id: str,
    phase: str = Query(default="", max_length=80),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureCandidatesResponse:
    return _validated_response(
        LiteratureCandidatesResponse,
        {"candidates": literature_review_service.list_candidates(review_id, context, phase)},
    )


@router.post(
    "/reviews/{review_id}/candidates/{candidate_id}/decisions",
    status_code=201,
    response_model=LiteratureDecisionMutationResponse,
    response_model_exclude_unset=True,
)
async def submit_decision(
    review_id: str,
    candidate_id: str,
    payload: DecisionRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureDecisionMutationResponse:
    return _validated_response(
        LiteratureDecisionMutationResponse,
        await literature_review_service.submit_decision(
            review_id, candidate_id, payload.model_dump(), background_tasks, context
        ),
    )


@router.post(
    "/reviews/{review_id}/candidates/{candidate_id}/consensus",
    status_code=201,
    response_model=LiteratureDecisionMutationResponse,
    response_model_exclude_unset=True,
)
async def resolve_conflict(
    review_id: str,
    candidate_id: str,
    payload: ConflictRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureDecisionMutationResponse:
    return _validated_response(
        LiteratureDecisionMutationResponse,
        await literature_review_service.resolve_conflict(
            review_id, candidate_id, payload.model_dump(), background_tasks, context
        ),
    )


@router.put(
    "/reviews/{review_id}/candidates/{candidate_id}/full-text",
    response_model=LiteratureCandidateResponse,
    response_model_exclude_unset=True,
)
async def update_candidate_full_text(
    review_id: str,
    candidate_id: str,
    payload: FullTextRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureCandidateResponse:
    return _validated_response(
        LiteratureCandidateResponse,
        await literature_review_service.update_full_text(
            review_id, candidate_id, payload.model_dump(), background_tasks, context
        ),
    )


@router.post(
    "/reviews/{review_id}/snowball",
    response_model=LiteratureSnowballResponse,
    response_model_exclude_unset=True,
)
async def discover_review_citations(
    review_id: str,
    payload: SnowballRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureSnowballResponse:
    literature_review_service.get_review(review_id)
    result = await literature_service.discover_citation_neighbors(
        context.vault_path,
        payload.seeds,
        direction=payload.direction,
        limit_per_seed=payload.limit_per_seed,
    )
    result["works"] = literature_import_service.mark_resource_membership(result["works"], context)
    activity = await literature_review_service.append_activity(
        review_id,
        "snowball",
        {
            "strategy": {
                "direction": payload.direction,
                "seed_ids": [seed.get("id") for seed in payload.seeds],
            },
            "exact_queries": result["exact_queries"],
            "source_snapshot": [{"id": result["provider"], "kind": "citation_graph"}],
            "counts": result["counts"],
        },
        background_tasks,
        context,
    )
    return _validated_response(
        LiteratureSnowballResponse,
        {**result, "activity_id": activity.get("id")},
    )


@router.post(
    "/manual-capture",
    response_model=LiteratureManualCaptureResponse,
    response_model_exclude_unset=True,
)
async def manual_capture(
    payload: ManualCaptureRequest,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> LiteratureManualCaptureResponse:
    from backend.api.vault_routes import lookup_metadata

    value = payload.value.strip()
    lookup_payload = (
        {payload.kind: value}
        if payload.kind != "auto"
        else {
            "doi": value,
            "pmid": value,
            "arxiv": value,
            "isbn": value,
            "url": value,
        }
    )
    result = await lookup_metadata(lookup_payload)
    if not result.get("suggested"):
        raise HTTPException(
            status_code=404, detail=result.get("error") or "No academic metadata was found."
        )
    work = literature_import_service.suggested_resource_to_work(
        result["suggested"],
        provider=str(result.get("source") or "manual"),
        provider_id=str(result.get("identifier") or value),
    )
    return _validated_response(
        LiteratureManualCaptureResponse,
        {
            "lookup": {key: result.get(key) for key in ("source", "identifier", "error")},
            "work": literature_import_service.mark_resource_membership([work], context)[0],
        },
    )


@router.post(
    "/ai",
    response_model=LiteratureAiResponse,
    response_model_exclude_unset=True,
)
async def run_ai_operation(
    payload: AiOperationRequest,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> LiteratureAiResponse:
    result = await asyncio.to_thread(
        literature_ai_service.run_operation, payload.operation, payload.payload, payload.agent_id
    )
    if payload.review_id:
        await literature_review_service.append_activity(
            payload.review_id,
            f"ai:{payload.operation}",
            {
                "ai_audit": result["audit"],
                "notes": json.dumps(result["result"], ensure_ascii=False),
            },
            background_tasks,
            context,
        )
    if payload.search_id:
        literature_service.append_search_ai_audit(
            context.vault_path, payload.search_id, payload.operation, result["audit"]
        )
    return _validated_response(LiteratureAiResponse, result)


@router.get(
    "/reviews/{review_id}/exports/{export_format}",
    response_class=Response,
    response_model=None,
)
def export_review(
    review_id: str,
    export_format: str,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> Response:
    body, media_type, filename = literature_review_service.export_review(
        review_id, export_format, context
    )
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
