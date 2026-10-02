"""Authenticated, provider-independent consumption dashboard."""
from __future__ import annotations
import asyncio
from typing import Annotated
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from backend.domains.configuration.ai.contracts import AiUsageDashboardResponse, AiUsageRequestsResponse
from backend.services import ai_usage_dashboard as service
from backend.services.agent_execution_scope import bind_request_scope, current_scope

router = APIRouter(dependencies=[Depends(bind_request_scope)])
UsageQuery = Annotated[service.UsageQuery, Depends(service.usage_query)]

@router.get('/usage/dashboard', response_model=AiUsageDashboardResponse)
async def usage_dashboard(query: UsageQuery) -> AiUsageDashboardResponse:
    return AiUsageDashboardResponse.model_validate(await asyncio.to_thread(service.dashboard, query, current_scope()))

@router.get('/usage/requests', response_model=AiUsageRequestsResponse)
async def usage_requests(query: UsageQuery, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)) -> AiUsageRequestsResponse:
    return AiUsageRequestsResponse.model_validate(await asyncio.to_thread(service.requests, query, current_scope(), page, page_size))

@router.get('/usage/export', response_class=Response, responses={200: {'content': {'text/csv': {'schema': {'type': 'string'}}}}})
async def usage_export(query: UsageQuery) -> Response:
    content = await asyncio.to_thread(service.export_csv, query, current_scope())
    return Response(content, media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="gnosi-ai-usage.csv"'})
