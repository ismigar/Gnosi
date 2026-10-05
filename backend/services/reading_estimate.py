"""Read-only source preflight; includes repeated context, output and repair allowance."""
from __future__ import annotations

import math
from copy import deepcopy
from pathlib import Path
from typing import Any

from backend.domains.llm_wiki.chunking import encoded, reading_chunk_budget, reading_chunks, records
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.reading_action_contracts import action_schemas
from backend.services import llm_wiki, llm_wiki_config, llm_wiki_extractors, llm_wiki_storage
from backend.services.llm_wiki_reading_runtime import prepare_reading_runtime
from backend.services import reading_budget
from backend.services.ai_usage_dashboard import currency_context
from backend.domains.llm_wiki.reading_batch_recovery import batch_limit, reduce_batch


def estimate(resource_id: str, metadata: dict[str, object], body: str, vault_root: Path,
             source_table: dict[str, object], source_config: dict[str, object],
             brain_table_id: str, *, force: bool = False, batch_size: int = 4) -> dict[str, Any]:
    runtime = prepare_reading_runtime(vault_root)
    origins, warnings = llm_wiki_extractors.extract_resource_sources(metadata, body, vault_root, source_table, source_config)
    if not origins:
        raise ValueError("No readable configured attachment or URL was found")
    chunks = reading_chunks(origins, budget=reading_chunk_budget(runtime.input_budget), count=runtime.count_tokens)
    _, dimensions = llm_wiki._dimension_context(llm_wiki_config.load_config(), source_table, source_config, metadata)
    index = llm_wiki._load_brain_index(brain_table_id, resource_id)
    identity = fingerprint([runtime.identity, chunks, dimensions, index])
    previous = llm_wiki_storage.get_job_status(resource_id, str(source_table.get("id") or ""))
    saved: dict[str, Any] = {}
    previous_plans = 0
    if not force and previous.get("phase") in {llm_wiki.PHASE_PARTIAL, llm_wiki.PHASE_ERROR}:
        for job_id in llm_wiki_storage.resume_checkpoint_jobs(str(previous.get("job_id") or "")):
            checkpoint = llm_wiki_storage.load_checkpoint(job_id, "agent-state")
            if isinstance(checkpoint, dict) and isinstance(checkpoint.get("plans"), dict):
                previous_plans = max(previous_plans, len(checkpoint["plans"]))
            if isinstance(checkpoint, dict) and checkpoint.get("identity") == identity:
                plans = checkpoint.get("plans", {})
                if isinstance(plans, dict) and (not saved or len(plans) > len(saved.get("plans", {}))):
                    saved = deepcopy(checkpoint)
                    reduce_batch(saved, str(llm_wiki_storage.get_job_status(job_id).get("error") or ""))
    batch_size = batch_limit(batch_size, saved)
    remaining = [chunk for chunk in chunks if str(chunk["id"]) not in saved.get("plans", {})]
    # Same context bound as automatic delivery; conservative fixed full memory
    # avoids an optimistic four-fragment count when the context is small.
    schema, _ = action_schemas(dimensions)
    groups: list[list[dict[str, object]]] = []
    for chunk in remaining:
        if (not groups or len(groups[-1]) >= batch_size or
                runtime.count_tokens(encoded([groups[-1]+[chunk], "x"*(runtime.input_budget//8), schema, dimensions])) > runtime.input_budget//2):
            groups.append([])
        groups[-1].append(chunk)
    restore_calls = 0
    if saved.get("plans") and not saved.get("memory"):
        restore_calls = math.ceil(len(encoded(saved["plans"]).encode()) / max(1, runtime.input_budget//3)) + 1
    calls = len(groups) + 1 + restore_calls
    source_bytes = sum(len(str(segment.get("text", "")).encode()) for origin in origins for segment in records(origin.get("segments")))
    repeated = calls * (2*len(runtime.instructions.encode()) + 3*len(encoded(schema).encode()) + min(8000, runtime.input_budget//8) + 8192)
    passages = sum(len(encoded(group).encode()) for group in groups)
    restore_input = len(encoded(saved.get("plans", {})).encode()) if restore_calls else 0
    input_bound = 2*passages + repeated + 2*restore_input
    # Explicit planning assumptions; extra searches or larger notes remain
    # possible and are subject to the durable spending limit.
    output_assumed = sum(len(encoded(chunk).encode()) for chunk in remaining)//2 + 512*calls
    output_bound = 16384*calls
    from backend.agent.model_catalog import catalog_model_cost
    from backend.agent.model_router import load_registry
    rates = catalog_model_cost(runtime.provider, runtime.model)
    if rates is None:
        row = next((r for r in load_registry(with_catalog_prices=False) if r.get("provider") == runtime.provider and r.get("model_id") == runtime.model), {})
        if "cost_in" in row and "cost_out" in row and (row["cost_in"] or row["cost_out"] or row.get("is_free")):
            rates = {"cost_in": row["cost_in"], "cost_out": row["cost_out"]}
    if runtime.provider in {"ollama", "local", "lmstudio", "llama-cpp", "llama.cpp"}:
        rates = {"cost_in": 0, "cost_out": 0}
    from backend.services.ai_usage_ledger import decimal_cost
    priced = bool(rates and decimal_cost(rates.get("cost_in")) is not None and decimal_cost(rates.get("cost_out")) is not None)
    low = high = None
    if priced and rates:
        low = (input_bound*float(rates["cost_in"])+output_assumed*float(rates["cost_out"]))/1_000_000
        # A reference repair can require two further bounded calls.
        high = 3*(input_bound*float(rates["cost_in"])+output_bound*float(rates["cost_out"]))/1_000_000*1.10
    budget = None
    if not force and previous.get("budget_id"):
        budget = reading_budget.status(str(previous["budget_id"]))
    return {"_reading_identity": identity, "estimate_id": fingerprint([identity, rates, batch_size, len(saved.get("plans", {})), previous_plans]),
            "provider": runtime.provider, "model": runtime.model, "currency": "USD", "priced": priced,
            "display_currency": currency_context(),
            "cost_in_per_million_usd": rates["cost_in"] if priced and rates else None,
            "cost_out_per_million_usd": rates["cost_out"] if priced and rates else None,
            "incompatible_saved_chunks": max(0, previous_plans-len(saved.get("plans", {}))),
            "chunks_total": len(chunks), "saved_chunks": len(saved.get("plans", {})), "remaining_chunks": len(remaining),
            "batch_size": batch_size, "planned_calls": calls, "memory_restore_calls": restore_calls,
            "source_token_bound": source_bytes, "input_token_bound": input_bound,
            "output_tokens_assumed": output_assumed, "output_token_bound": output_bound,
            "cost_usd": low, "cost_with_repairs_usd": high, "budget": budget, "warnings": warnings}
