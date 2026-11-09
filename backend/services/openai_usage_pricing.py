"""Price returned Sol usage, retaining a conservative hold until billing arrives."""
from __future__ import annotations

from decimal import Decimal
import re
from typing import Any

SOL = re.compile(r"gpt-6\.1-sol(?:-\d{4}-?\d{2}-?\d{2})?\Z")


def measured(provider: str, model: str, tokens: dict[str, Any], usage: dict[str, Any],
             rates: dict[str, Any] | None, tier: str | None,
             options: dict[str, Any] | None) -> dict[str, Any] | None:
    if provider != "openai" or not SOL.fullmatch(model) or tier not in {"default", "flex"} or not rates:
        return None
    # These ratios are the published Sol tariff, not a generic provider rule.
    # A changed/unknown tariff retains the original reservation for reconciliation.
    if rates.get("cost_in") != 2 or rates.get("cost_out") != 10:
        return None
    details = usage.get("input_tokens_details", usage.get("prompt_tokens_details", {}))
    if not isinstance(details, dict):
        return None
    values: list[int] = []
    for value in (tokens.get("input_tokens"), tokens.get("output_tokens"),
                  details.get("cached_tokens"), details.get("cache_write_tokens")):
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            return None
        values.append(value)
    inputs, outputs, reads, writes = values
    if reads + writes > inputs:
        return None
    ttl = (options or {}).get("ttl", "30m")
    if ttl != "30m":
        return None
    input_rate = Decimal(2) * (2 if inputs > 272_000 else 1)
    output_rate = Decimal(10) * (Decimal("1.5") if inputs > 272_000 else 1)
    ordinary = inputs - reads - writes
    factor = Decimal("0.5") if tier == "flex" else Decimal(1)
    cost = ((Decimal(ordinary) + Decimal(reads) * Decimal("0.05")
             + Decimal(writes) * Decimal("1.25")) * input_rate
            + Decimal(outputs) * output_rate) * factor / Decimal(1_000_000)
    # Do not call a token-priced estimate a reported invoice. The held bound
    # ignores cache-hit discounts and retains a 10% margin; only a terminal
    # provider usage record can replace the pre-call maximum-output reservation.
    held = (Decimal(inputs) * input_rate * Decimal("1.25")
            + Decimal(outputs) * output_rate) * factor * Decimal("1.10") / Decimal(1_000_000)
    return {"service_tier": tier, "cache_read_tokens": reads, "cache_write_tokens": writes,
            "cache_ttl": ttl, "tariff_date": "2026-11-08", "cost_usd": str(cost),
            "reservation_bound_usd": str(held), "billing_confirmed": False}
