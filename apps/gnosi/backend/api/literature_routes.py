"""HTTP contracts for academic search and systematic literature review."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.services import (
    literature_ai_service,
    literature_import_service,
    literature_review_service,
    literature_service,
)
from backend.services.workspace_service import WorkspaceContext, require_role


router = APIRouter(prefix="/api/vault/literature", tags=["Literature"])


class ConfigurationPatch(BaseModel):
    contact_email: Optional[str] = Field(default=None, max_length=320)
    ai_agent_id: Optional[str] = Field(default=None, max_length=160)
    source_defaults: Optional[dict[str, bool]] = None
    hidden_sources: Optional[list[str]] = None


class RepositoryPayload(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["oai", "rest"]
    base_url: str = Field(min_length=8, max_length=4_000)
    default_enabled: bool = True
    metadata_prefix: str = Field(default="oai_dc", max_length=100)
    set: str = Field(default="", max_length=500)
    sync_mode: Literal["full", "incremental"] = "incremental"
    tombstones: bool = True
    query_parameter: str = Field(default="q", max_length=100)
    limit_parameter: str = Field(default="limit", max_length=100)
    results_path: str = Field(default="results", max_length=300)
    pagination: Literal["none", "page", "offset", "cursor", "link"] = "none"
    page_parameter: str = Field(default="page", max_length=100)
    offset_parameter: str = Field(default="offset", max_length=100)
    cursor_parameter: str = Field(default="cursor", max_length=100)
    next_cursor_path: str = Field(default="next_cursor", max_length=300)
    static_filters: dict[str, str] = Field(default_factory=dict)
    mapping: dict[str, str] = Field(default_factory=dict)


class RepositoryTestPayload(RepositoryPayload):
    query: str = Field(default="test", max_length=500)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)
    filters: dict[str, Any] = Field(default_factory=dict)
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    source_queries: dict[str, str] = Field(default_factory=dict)
    ai_audits: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    limit_per_source: int = Field(default=25, ge=1, le=100)


class ImportRequest(BaseModel):
    works: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    notebook_id: str = Field(default="", max_length=64)
    notebook_title: str = Field(default="", max_length=160)


class ReviewCreateRequest(BaseModel):
    title: str = Field(default="", max_length=300)
    question: str = Field(min_length=1, max_length=2_000)
    protocol: str = Field(default="", max_length=50_000)
    criteria: dict[str, Any] = Field(default_factory=dict)
    reviewer_mode: Literal["single", "dual_blind"] = "single"
    reviewers: list[str] = Field(default_factory=list, max_length=20)
    configuration: dict[str, Any] = Field(default_factory=dict)


class ActivityRequest(BaseModel):
    activity_type: str = Field(min_length=1, max_length=100)
    strategy: dict[str, Any] = Field(default_factory=dict)
    exact_queries: dict[str, Any] = Field(default_factory=dict)
    source_snapshot: list[dict[str, Any]] = Field(default_factory=list)
    errors: list[dict[str, Any]] = Field(default_factory=list)
    counts: dict[str, Any] = Field(default_factory=dict)
    ai_audit: dict[str, Any] = Field(default_factory=dict)
    export_format: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=50_000)


class ReviewScheduleRequest(BaseModel):
    enabled: bool = False
    interval_days: int = Field(default=7, ge=1, le=365)
    strategy: dict[str, Any] = Field(default_factory=dict)


class CandidateRequest(BaseModel):
    works: list[dict[str, Any]] = Field(min_length=1, max_length=1_000)
    activity_id: str = Field(default="", max_length=64)


class DecisionRequest(BaseModel):
    phase: Optional[str] = Field(default=None, max_length=80)
    decision: Literal["include", "exclude", "uncertain"]
    reason: str = Field(default="", max_length=4_000)
    notes: str = Field(default="", max_length=20_000)


class ConflictRequest(BaseModel):
    decision: Literal["include", "exclude"]
    reason: str = Field(default="Conflict resolution", max_length=4_000)
    notes: str = Field(default="", max_length=20_000)


class FullTextRequest(BaseModel):
    status: Literal["not_requested", "requested", "available_oa", "attached", "unavailable", "assessed"]
    location_url: str = Field(default="", max_length=4_000)
    license: str = Field(default="", max_length=500)
    resource_id: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=20_000)


class SnowballRequest(BaseModel):
    seeds: list[dict[str, Any]] = Field(min_length=1, max_length=20)
    direction: Literal["backward", "forward", "both"] = "both"
    limit_per_seed: int = Field(default=25, ge=1, le=100)


class ManualCaptureRequest(BaseModel):
    value: str = Field(min_length=1, max_length=4_000)
    kind: Literal["auto", "doi", "pmid", "arxiv", "isbn", "url"] = "auto"


class AiOperationRequest(BaseModel):
    operation: Literal["query_strategy", "translate_query", "rerank", "screen", "synthesize", "snowball"]
    payload: dict[str, Any] = Field(default_factory=dict)
    review_id: str = Field(default="", max_length=64)
    search_id: str = Field(default="", max_length=64)
    agent_id: str = Field(default="", max_length=160)


@router.get("/configuration")
def get_configuration(context: WorkspaceContext = Depends(require_role("viewer"))):
    return literature_service.public_configuration(context.vault_path)


@router.put("/configuration")
def update_configuration(payload: ConfigurationPatch, context: WorkspaceContext = Depends(require_role("admin"))):
    literature_service.save_config(context.vault_path, payload.model_dump(exclude_none=True))
    return literature_service.public_configuration(context.vault_path)


@router.get("/catalog")
def get_catalog(context: WorkspaceContext = Depends(require_role("viewer"))):
    return {"sources": literature_service.catalog(context.vault_path)}


@router.post("/repositories/test")
async def test_repository(payload: RepositoryTestPayload, context: WorkspaceContext = Depends(require_role("admin"))):
    del context
    return await literature_service.test_repository(payload.model_dump(exclude={"query"}), payload.query)


@router.post("/repositories", status_code=201)
def create_repository(payload: RepositoryPayload, context: WorkspaceContext = Depends(require_role("admin"))):
    return literature_service.save_repository(context.vault_path, payload.model_dump())


@router.put("/repositories/{repository_id}")
def update_repository(repository_id: str, payload: RepositoryPayload, context: WorkspaceContext = Depends(require_role("admin"))):
    return literature_service.save_repository(context.vault_path, payload.model_dump(), repository_id)


@router.delete("/repositories/{repository_id}")
def delete_repository(repository_id: str, delete_index: bool = Query(default=False), confirm: bool = Query(default=False), context: WorkspaceContext = Depends(require_role("admin"))):
    if not confirm:
        raise HTTPException(status_code=409, detail="Repository deletion requires explicit confirmation.")
    return literature_service.delete_repository(context.vault_path, repository_id, delete_index=delete_index)


@router.post("/synchronizations/{source_id}", status_code=202)
def start_synchronization(source_id: str, full: bool = Body(default=False, embed=True), context: WorkspaceContext = Depends(require_role("admin"))):
    return literature_service.enqueue_sync(context.vault_path, source_id, full=full)


@router.get("/synchronizations/{source_id}")
def get_synchronization(source_id: str, context: WorkspaceContext = Depends(require_role("viewer"))):
    return literature_service.sync_status(context.vault_path, source_id)


@router.delete("/synchronizations/{source_id}")
def cancel_synchronization(source_id: str, context: WorkspaceContext = Depends(require_role("admin"))):
    return literature_service.cancel_sync(context.vault_path, source_id)


@router.post("/synchronizations/{source_id}/resume", status_code=202)
def resume_synchronization(source_id: str, context: WorkspaceContext = Depends(require_role("admin"))):
    return literature_service.enqueue_sync(context.vault_path, source_id, full=False)


@router.get("/searches")
def list_searches(limit: int = Query(default=50, ge=1, le=200), context: WorkspaceContext = Depends(require_role("viewer"))):
    return {"searches": literature_service.list_searches(context.vault_path, limit)}


@router.post("/searches", status_code=202)
async def create_search(payload: SearchRequest, context: WorkspaceContext = Depends(require_role("viewer"))):
    return literature_service.start_search(context.vault_path, query=payload.query, filters=payload.filters, source_ids=payload.source_ids, source_queries=payload.source_queries, ai_audits=payload.ai_audits, limit_per_source=payload.limit_per_source, owner_user_id=context.user_id)


@router.get("/searches/{search_id}")
def get_search(search_id: str, offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200), context: WorkspaceContext = Depends(require_role("viewer"))):
    payload = literature_service.get_search(context.vault_path, search_id, offset=offset, limit=limit)
    payload["results"] = literature_import_service.mark_resource_membership(payload.get("results") or [], context)
    return payload


@router.delete("/searches/{search_id}")
def cancel_search(search_id: str, context: WorkspaceContext = Depends(require_role("viewer"))):
    return literature_service.cancel_search(context.vault_path, search_id)


@router.get("/searches/{search_id}/results/{result_id}")
def get_result(search_id: str, result_id: str, context: WorkspaceContext = Depends(require_role("viewer"))):
    result = literature_service.get_search_result(context.vault_path, search_id, result_id)
    return literature_import_service.mark_resource_membership([result], context)[0]


@router.get("/searches/{search_id}/events")
async def stream_search_events(search_id: str, after: int = Query(default=0, ge=0), context: WorkspaceContext = Depends(require_role("viewer"))):
    vault_path = context.vault_path

    async def event_stream():
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

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/imports")
async def import_results(payload: ImportRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_import_service.import_works(payload.works, background_tasks, context, notebook_id=payload.notebook_id, notebook_title=payload.notebook_title)


@router.post("/reviews/tables", status_code=201)
async def ensure_review_tables(context: WorkspaceContext = Depends(require_role("editor"))):
    del context
    return await literature_review_service.ensure_tables()


@router.get("/reviews")
def list_reviews(context: WorkspaceContext = Depends(require_role("viewer"))):
    del context
    return {"reviews": literature_review_service.list_reviews()}


@router.post("/reviews", status_code=201)
async def create_review(payload: ReviewCreateRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_review_service.create_review(payload.model_dump(), background_tasks, context)


@router.get("/reviews/{review_id}")
def get_review(review_id: str, context: WorkspaceContext = Depends(require_role("viewer"))):
    audit = literature_review_service.review_audit(review_id, context)
    return {"review": audit["review"], "activities": audit["activities"], "candidates": audit["candidates"], "prisma": audit["prisma"]}


@router.post("/reviews/{review_id}/activities", status_code=201)
async def create_activity(review_id: str, payload: ActivityRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_review_service.append_activity(review_id, payload.activity_type, payload.model_dump(exclude={"activity_type"}), background_tasks, context)


@router.put("/reviews/{review_id}/schedule")
async def update_review_schedule(review_id: str, payload: ReviewScheduleRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    schedule = payload.model_dump()
    schedule["updated_at"] = datetime.now(timezone.utc).isoformat()
    return await literature_review_service.update_configuration(review_id, {"schedule": schedule}, background_tasks, context)


@router.post("/reviews/{review_id}/candidates", status_code=201)
async def add_candidates(review_id: str, payload: CandidateRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_review_service.add_candidates(review_id, payload.works, background_tasks, context, payload.activity_id)


@router.get("/reviews/{review_id}/candidates")
def list_candidates(review_id: str, phase: str = Query(default="", max_length=80), context: WorkspaceContext = Depends(require_role("viewer"))):
    return {"candidates": literature_review_service.list_candidates(review_id, context, phase)}


@router.post("/reviews/{review_id}/candidates/{candidate_id}/decisions", status_code=201)
async def submit_decision(review_id: str, candidate_id: str, payload: DecisionRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_review_service.submit_decision(review_id, candidate_id, payload.model_dump(), background_tasks, context)


@router.post("/reviews/{review_id}/candidates/{candidate_id}/consensus", status_code=201)
async def resolve_conflict(review_id: str, candidate_id: str, payload: ConflictRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_review_service.resolve_conflict(review_id, candidate_id, payload.model_dump(), background_tasks, context)


@router.put("/reviews/{review_id}/candidates/{candidate_id}/full-text")
async def update_candidate_full_text(review_id: str, candidate_id: str, payload: FullTextRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    return await literature_review_service.update_full_text(review_id, candidate_id, payload.model_dump(), background_tasks, context)


@router.post("/reviews/{review_id}/snowball")
async def discover_review_citations(review_id: str, payload: SnowballRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
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
            "strategy": {"direction": payload.direction, "seed_ids": [seed.get("id") for seed in payload.seeds]},
            "exact_queries": result["exact_queries"],
            "source_snapshot": [{"id": result["provider"], "kind": "citation_graph"}],
            "counts": result["counts"],
        },
        background_tasks,
        context,
    )
    return {**result, "activity_id": activity.get("id")}


@router.post("/manual-capture")
async def manual_capture(payload: ManualCaptureRequest, context: WorkspaceContext = Depends(require_role("viewer"))):
    from backend.api.vault_routes import lookup_metadata

    value = payload.value.strip()
    lookup_payload = {payload.kind: value} if payload.kind != "auto" else {
        "doi": value, "pmid": value, "arxiv": value, "isbn": value, "url": value,
    }
    result = await lookup_metadata(lookup_payload)
    if not result.get("suggested"):
        raise HTTPException(status_code=404, detail=result.get("error") or "No academic metadata was found.")
    work = literature_import_service.suggested_resource_to_work(
        result["suggested"],
        provider=str(result.get("source") or "manual"),
        provider_id=str(result.get("identifier") or value),
    )
    return {"lookup": {key: result.get(key) for key in ("source", "identifier", "error")}, "work": literature_import_service.mark_resource_membership([work], context)[0]}


@router.post("/ai")
async def run_ai_operation(payload: AiOperationRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role("editor"))):
    result = await asyncio.to_thread(literature_ai_service.run_operation, payload.operation, payload.payload, payload.agent_id)
    if payload.review_id:
        await literature_review_service.append_activity(payload.review_id, f"ai:{payload.operation}", {"ai_audit": result["audit"], "notes": json.dumps(result["result"], ensure_ascii=False)}, background_tasks, context)
    if payload.search_id:
        literature_service.append_search_ai_audit(context.vault_path, payload.search_id, payload.operation, result["audit"])
    return result


@router.get("/reviews/{review_id}/exports/{export_format}")
def export_review(review_id: str, export_format: str, context: WorkspaceContext = Depends(require_role("editor"))):
    body, media_type, filename = literature_review_service.export_review(review_id, export_format, context)
    return Response(content=body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
