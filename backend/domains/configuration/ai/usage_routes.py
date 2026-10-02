"""Authenticated, provider-independent consumption dashboard."""
from __future__ import annotations
import asyncio
from typing import Annotated, Any
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from backend.domains.configuration.ai.contracts import AiUsageDashboardResponse, AiUsageRequestsResponse, AiUsageHistoryResponse, AiUsageResponse
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


# Preserve the existing endpoints without adding dashboard scope dependencies.
legacy_router = APIRouter()
JsonObject = dict[str, Any]


@legacy_router.get(
    "/usage",
    response_model=AiUsageResponse,
    response_model_exclude_unset=True,
)
async def get_ai_usage() -> JsonObject:
    """Current-period AI spend: USD + the Settings currency, cap, ratio and a
    per-model breakdown. to_thread: reads the ledger from disk and may do one
    short FX fetch."""
    from backend.agent.model_router import budget_status

    return await asyncio.to_thread(budget_status)


@legacy_router.get(
    "/usage/history",
    response_model=AiUsageHistoryResponse,
    response_model_exclude_unset=True,
)
async def get_ai_usage_history() -> JsonObject:
    """Returns all historical usage records grouped by period, provider, and model."""
    from backend.agent.model_router import UsageStore, _normalize_usage_entry
    from backend.config.app_config import load_params
    from backend.services.fx_rates import parse_currency_code, rate_info, usd_to_currency

    def _history() -> JsonObject:
        store = UsageStore()
        cfg = load_params(strict_env=False)
        currency = rate_info(parse_currency_code((cfg.get("settings", {}) or {}).get("currency")))
        periods: JsonObject = {}
        for period_key, model_data in (store._data or {}).items():
            if not isinstance(model_data, dict):
                continue
            period_rows: list[JsonObject] = []
            period_total_usd = 0.0
            for key, val in model_data.items():
                if ":" in key:
                    provider, model_id = key.split(":", 1)
                else:
                    provider, model_id = "", key
                norm = _normalize_usage_entry(val)
                cost_ccy = usd_to_currency(norm["cost_usd"], currency["code"])
                period_rows.append(
                    {
                        "provider": provider,
                        "model_id": model_id,
                        "in": norm["in"],
                        "out": norm["out"],
                        "cost_usd": norm["cost_usd"],
                        "cost_ccy": cost_ccy,
                    }
                )
                period_total_usd += norm["cost_usd"]
            periods[period_key] = {
                "period": period_key,
                "total_usd": period_total_usd,
                "total_ccy": usd_to_currency(period_total_usd, currency["code"]),
                "models": period_rows,
            }
        return {
            "currency": currency,
            "periods": periods,
        }

    return await asyncio.to_thread(_history)
