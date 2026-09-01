import asyncio
from typing import Any, AsyncIterator

from fastapi import Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from backend.agent.model_reliability import reliability_report
from backend.domains.agent.routes.contracts import (
    ChatFeedbackRequest,
    ExternalContextSourceResponse,
    InternalContextSourceResponse,
)
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.shared import _validated_identifier, _vault_scope
from backend.services.agent_cancellation import cancel_stream as cancel_agent_stream
from backend.services.agent_quality_telemetry import record_quality_signal
from backend.services.agent_stream_journal import replay as replay_stream_events
from backend.services.agent_stream_journal import scope_digest
from backend.services.workspace_service import WorkspaceContext, require_role


class ModelReliabilityEntryResponse(BaseModel):
    """Recorded failure evidence for one provider model."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    model_id: str
    window_days: int
    reasons: dict[str, int]
    model_fault_total: int
    total: int
    top_model_reason: str | None


class ModelReliabilityResponse(BaseModel):
    """Failure evidence returned for the requested reporting window."""

    model_config = ConfigDict(extra="forbid")

    window_days: int
    models: list[ModelReliabilityEntryResponse]


@router.get("/ai/model-reliability", response_model=ModelReliabilityResponse)
async def model_reliability(
    window_days: int = 30,
    workspace_context: WorkspaceContext = Depends(require_role("viewer")),
) -> ModelReliabilityResponse:
    """Recorded failures per model, by reason.

    Evidence for the UI, not a policy: nothing here disables or reroutes a
    model — the user reads it and decides.
    """
    _vault, vault_scope = _vault_scope()
    reliability_scope = ":".join(
        (
            vault_scope,
            workspace_context.workspace_id,
            workspace_context.user_id,
        )
    )
    models = [
        ModelReliabilityEntryResponse.model_validate(row)
        for row in reliability_report(window_days, scope_key=reliability_scope)
    ]
    return ModelReliabilityResponse(window_days=window_days, models=models)


@router.get(
    "/agent/context-sources",
    response_model=list[ExternalContextSourceResponse],
)
async def list_context_sources() -> Any:
    """Catalogue of large external sources an agent can attach to its context.

    These are queried through their own API, never crawled — see directive
    `agent_context_sources.md`.
    """
    from backend.agent.context_sources import list_sources

    return list_sources()


@router.get(
    "/agent/internal-sources",
    response_model=list[InternalContextSourceResponse],
)
async def list_internal_context_sources(
    workspace_context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    """List scoped first-party Gnosi sources available in this workspace."""
    from backend.agent.internal_sources import internal_source_catalog

    return internal_source_catalog(workspace_context.workspace_id)


@router.post("/chat/feedback", response_model=None)
async def record_chat_feedback(
    payload: ChatFeedbackRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Persist assistant feedback without retaining prompts or responses."""
    agent_id = _validated_identifier(payload.agent_id, "agent_id")
    session_id = _validated_identifier(payload.session_id, "session_id")
    _vault, vault_scope = _vault_scope()
    event_id = await asyncio.to_thread(
        record_quality_signal,
        {
            "vault_scope": vault_scope,
            "workspace_id": workspace_context.workspace_id,
            "user_id": workspace_context.user_id,
        },
        agent_id=agent_id,
        session_id=session_id,
        turn_id=payload.turn_id,
        signal="feedback",
        rating=payload.rating,
        error_code=payload.error_code,
        language=payload.language,
        mode=payload.mode,
        domains=payload.domains,
        route=payload.route,
        execution=payload.execution,
        output_strategy=payload.output_strategy,
        required_tool=payload.required_tool,
        verification_status=payload.verification_status,
        limitations=payload.limitations,
        tool_names=payload.tool_names,
        duration_ms=payload.duration_ms,
    )
    return {"status": "recorded", "event_id": event_id}


@router.get("/chat/streams/{stream_id}", response_model=None)
async def resume_agent_stream(
    stream_id: str,
    agent_id: str = Query(min_length=1, max_length=128),
    session_id: str = Query(min_length=1, max_length=128),
    after_sequence: int = Query(default=0, ge=0),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> StreamingResponse:
    """Replay encrypted short-lived events for the exact authenticated scope."""
    safe_stream = _validated_identifier(stream_id, "stream_id")
    safe_agent = _validated_identifier(agent_id, "agent_id")
    safe_session = _validated_identifier(session_id, "session_id")
    digest = scope_digest(
        {
            "workspace_id": workspace_context.workspace_id,
            "user_id": workspace_context.user_id,
            "agent_id": safe_agent,
            "session_id": safe_session,
        }
    )
    events = await asyncio.to_thread(
        replay_stream_events,
        safe_stream,
        digest,
        after_sequence,
    )

    async def replay_generator() -> AsyncIterator[str]:
        for event in events:
            yield event

    return StreamingResponse(replay_generator(), media_type="application/x-ndjson")


@router.post("/chat/streams/{stream_id}/cancel", response_model=None)
async def cancel_running_agent_stream(
    stream_id: str,
    agent_id: str = Query(min_length=1, max_length=128),
    session_id: str = Query(min_length=1, max_length=128),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    """Explicitly cancel one running stream in the exact authenticated scope."""
    scope = {
        "workspace_id": workspace_context.workspace_id,
        "user_id": workspace_context.user_id,
        "agent_id": _validated_identifier(agent_id, "agent_id"),
        "session_id": _validated_identifier(session_id, "session_id"),
    }
    if not cancel_agent_stream(
        _validated_identifier(stream_id, "stream_id"),
        scope,
    ):
        raise HTTPException(status_code=404, detail="Running agent stream not found.")
    return {"status": "cancellation_requested"}
