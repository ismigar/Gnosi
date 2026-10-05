"""Official provider plan evidence for comparison, never inference accounting.

The model catalog's zero tariff does not prove free access. Plan allowances are
only comparable when the exact model has a published token deduction formula.
No account credentials, subscriptions or paid inference are accessed here.
"""
from __future__ import annotations

import json
import math
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class ComparisonBillingPlan(BaseModel):
    """Public monthly fee and quota, with exact-model deduction units."""

    name: str
    monthly_fee: float | None = None
    currency: str = "USD"
    monthly_fee_usd: float | None = None
    quota: float | None = None
    quota_unit: Literal["tokens", "credits", "usd", "requests", "usage"] = "usage"
    quota_period: Literal["month", "week", "5h", "unknown"] = "unknown"
    input_units_per_million: float | None = None
    output_units_per_million: float | None = None


class ComparisonBilling(BaseModel):
    """Provenance and comparability of one provider/model offer."""

    kind: Literal["metered", "subscription", "free", "unknown", "local"]
    source_url: str = ""
    rate_source_url: str | None = None
    checked_at: str | None = None
    stale: bool = False
    notes: list[str] = Field(default_factory=list)
    plans: list[ComparisonBillingPlan] = Field(default_factory=list)
    model_covered: bool | None = None
    input_price_usd: float | None = None
    output_price_usd: float | None = None


@lru_cache(maxsize=1)
def load_billing_evidence() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "data" / "provider_billing.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return dict(payload.get("providers") or {})
    except (OSError, ValueError, TypeError):
        return {}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) and value >= 0 else None


def _plan(raw: dict[str, Any], rates: dict[str, Any], index: int) -> ComparisonBillingPlan:
    plan = ComparisonBillingPlan.model_validate(raw)
    plan.monthly_fee = _number(plan.monthly_fee)
    # Foreign fees retain their original currency unless an actual FX quote is
    # supported. In particular, never use rate_info's unknown-currency 1:1 fallback.
    if plan.monthly_fee is not None:
        if plan.currency == "USD":
            plan.monthly_fee_usd = plan.monthly_fee
        else:
            from backend.services.fx_rates import CURRENCY_SYMBOLS, rate_info
            if plan.currency in CURRENCY_SYMBOLS:
                rate = rate_info(plan.currency)
                if (math.isfinite(rate["usd_rate"]) and rate["usd_rate"] > 0
                        and (rate["source"] != "static" or plan.currency != "CNY")):
                    plan.monthly_fee_usd = plan.monthly_fee / rate["usd_rate"]
    quotas = rates.get("quotas", [])
    plan.quota = _number(quotas[index] if len(quotas) > index else plan.quota)
    for field in ("input_units_per_million", "output_units_per_million"):
        value = rates.get(field, getattr(plan, field))
        if isinstance(value, list):
            value = value[index] if index < len(value) else None
        if value is None and plan.quota_unit == "tokens":
            value = 1_000_000
        setattr(plan, field, _number(value))
    return plan


def route_billing(
    provider: dict[str, Any], model: dict[str, Any], *, today: date | None = None,
) -> dict[str, Any]:
    """Attach evidence for the exact route, including cached comparator rows.

    Reviewed facts expire after 30 days. Expired plan prices remain visible as
    dated evidence, but must not yield equivalent token prices or cheap rankings.
    Providers absent from the evidence file still have an explicit unknown state.
    """
    provider_id, model_id = str(provider.get("id", "")), str(model.get("id", ""))
    if provider.get("is_local"):
        return ComparisonBilling(kind="local").model_dump()
    evidence = load_billing_evidence().get(provider_id, {})
    source = str(evidence.get("source_url") or provider.get("doc") or "")
    checked_at = evidence.get("checked_at")
    try:
        age = ((today or date.today()) - date.fromisoformat(checked_at)).days
        stale = not 0 <= age <= 30
    except (TypeError, ValueError):
        stale = True
    subscription = any(part in provider_id for part in ("coding-plan", "code-plan", "token-plan"))
    zero = model.get("cost_in") == 0 and model.get("cost_out") == 0
    known = (model.get("pricing_known") is not False
             and all(_number(model.get(key)) is not None
                     and (model.get(key) != 0 or model.get("pricing_known") is True)
                     for key in ("cost_in", "cost_out")))
    kind = evidence.get("kind") or ("subscription" if subscription else "metered" if known and not zero else "unknown")
    result = ComparisonBilling.model_validate({
        "kind": kind, "source_url": source, "checked_at": checked_at,
        "stale": bool(evidence) and stale, "notes": evidence.get("notes", []),
        "rate_source_url": evidence.get("rate_source_url"),
    })
    rates = evidence.get("model_rates", {}).get(model_id, {})
    covered = evidence.get("models")
    result.model_covered = model_id in covered if isinstance(covered, list) else None
    result.plans = [_plan(raw, rates, index) for index, raw in enumerate(evidence.get("plans", []))]
    # These are explicitly declared free endpoints, not all zero entries of a host.
    if (model_id in evidence.get("free_models", [])
            or any(model_id.endswith(suffix) for suffix in evidence.get("free_suffixes", []))) and not stale:
        result.kind = "free"
    if result.kind == "metered":
        result.input_price_usd = _number(rates.get("input_units_per_million")) if not stale else None
        result.output_price_usd = _number(rates.get("output_units_per_million")) if not stale else None
        if result.input_price_usd is None or result.output_price_usd is None:
            if known and not zero:
                result.input_price_usd = _number(model.get("cost_in"))
                result.output_price_usd = _number(model.get("cost_out"))
            else:
                result.kind = "unknown"
    return result.model_dump()
