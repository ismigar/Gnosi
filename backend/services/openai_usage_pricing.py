"""Price returned direct reading-model usage, retaining a conservative hold until billing arrives."""
from __future__ import annotations

from decimal import Decimal
import re
from typing import Any, TypeGuard

_DIRECT_READING_MODEL = re.compile(r"(gpt-6\.[12]-sol|gpt-5\.6-luna)(?:-\d{4}-?\d{2}-?\d{2})?\Z")
LONG_INPUT = 272_000


def reading_model(provider: str, model: str) -> str:
    match = _DIRECT_READING_MODEL.fullmatch(model) if provider == "openai" else None
    return match[1] if match else ""


def measured(provider: str, model: str, tokens: dict[str, Any], usage: dict[str, Any],
             rates: dict[str, Any] | None, tier: str | None,
             options: dict[str, Any] | None) -> dict[str, Any] | None:
    from backend.agent.reading_model_catalog import DEFAULT_OFFERS
    identifier = reading_model(provider, model)
    if not identifier or tier not in {"default", "flex"} or not rates:
        return None
    if tier == "flex" and identifier != "gpt-6.1-sol":
        return None
    _, base_in, base_out = DEFAULT_OFFERS.get(identifier, ("GPT-6.1 Sol", 2., 10.))
    if rates.get("cost_in") != base_in or rates.get("cost_out") != base_out:
        return None
    details = usage.get("input_tokens_details", usage.get("prompt_tokens_details", {}))
    if not isinstance(details, dict):
        return None
    def valid_count(value: object) -> TypeGuard[int]:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0
    inputs, outputs = tokens.get("input_tokens"), tokens.get("output_tokens")
    if not valid_count(inputs) or not valid_count(outputs):
        return None
    reads, writes = details.get("cached_tokens"), details.get("cache_write_tokens")
    missing = reads is None or writes is None
    if missing and identifier == "gpt-6.1-sol":
        return None
    # Native Standard sometimes omits the write breakdown. Retain the full
    # cache-write premium on measured tokens without inventing observed counts.
    if any(v is not None and not valid_count(v) for v in (reads, writes)) or (reads or 0) + (writes or 0) > inputs:
        return None
    ttl = (options or {}).get("ttl", "30m")
    if ttl != "30m" and not (ttl == "12h" and identifier != "gpt-6.1-sol"):
        return None
    write_ratio = Decimal("2.5") if ttl == "12h" else Decimal("1.25")
    read_ratio = Decimal(".10") if identifier == "gpt-5.6-luna" else Decimal(".05")
    input_rate = Decimal(str(base_in)) * (2 if inputs > LONG_INPUT else 1)
    output_rate = Decimal(str(base_out)) * (Decimal("1.5") if inputs > LONG_INPUT else 1)
    factor = Decimal("0.5") if tier == "flex" else Decimal(1)
    billable_input = Decimal(inputs) * write_ratio
    if valid_count(reads) and valid_count(writes):
        billable_input = Decimal(inputs - reads - writes) + Decimal(reads) * read_ratio + Decimal(writes) * write_ratio
    cost = (billable_input * input_rate + Decimal(outputs) * output_rate) * factor / Decimal(1_000_000)
    # Do not call a token-priced estimate a reported invoice. The held bound
    # ignores cache-hit discounts and retains a 10% margin; only a terminal
    # provider usage record can replace the pre-call maximum-output reservation.
    held = (Decimal(inputs) * input_rate * write_ratio
            + Decimal(outputs) * output_rate) * factor * Decimal("1.10") / Decimal(1_000_000)
    return {"service_tier": tier, "cache_breakdown_complete": not missing, "cache_read_tokens": reads, "cache_write_tokens": writes,
            "cache_ttl": ttl, "tariff_date": "2026-11-08" if identifier == "gpt-6.1-sol" else "2026-11-20", "cost_usd": str(cost),
            "reservation_bound_usd": str(held), "billing_confirmed": False}
