"""Read-only source preflight; includes repeated context, output and repair allowance."""
from __future__ import annotations

import math
from copy import deepcopy
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.domains.llm_wiki.chunking import encoded, reading_chunk_budget, reading_chunks, records
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.reading_action_contracts import action_schemas
from backend.services import llm_wiki, llm_wiki_config, llm_wiki_extractors, llm_wiki_storage
from backend.services.llm_wiki_reading_runtime import prepare_reading_runtime
from backend.services.agent_context_budget import reading_price_counter
from backend.services import reading_budget
from backend.services.ai_usage_dashboard import currency_context
from backend.domains.llm_wiki.reading_batch_recovery import batch_limit, reduce_batch
from backend.domains.llm_wiki.semantic_context import state_progress
from backend.domains.llm_wiki.reading_identity import job_identity, reading_identity, identity_parts, resume_semantic_state


def estimate(resource_id: str, metadata: dict[str, object], body: str, vault_root: Path,
             source_table: dict[str, object], source_config: dict[str, object],
             brain_table_id: str, *, force: bool = False, batch_size: int = 4, source_title: str = "", language: str = "") -> dict[str, Any]:
    runtime = prepare_reading_runtime(vault_root)
    origins, warnings = llm_wiki_extractors.extract_resource_sources(metadata, body, vault_root, source_table, source_config)
    if not origins:
        raise ValueError("No readable configured attachment or URL was found")
    semantic = getattr(runtime, "reading_engine", "legacy") == "semantic"
    from backend.services.llm_wiki_reading_runtime import prepare_review_runtime
    reviewer = prepare_review_runtime(vault_root, runtime.snapshot) if semantic else None
    capacity = min(runtime.input_budget, reviewer.input_budget) if reviewer else runtime.input_budget
    chunks = reading_chunks(origins, budget=reading_chunk_budget(capacity), count=runtime.count_tokens)
    _, dimensions = llm_wiki._dimension_context(llm_wiki_config.load_config(), source_table, source_config, metadata)
    index = llm_wiki._load_brain_index(brain_table_id, resource_id)
    identity = (reading_identity(runtime.identity, chunks, dimensions, index) if semantic else
                fingerprint([runtime.identity, chunks, dimensions, index]))
    previous = llm_wiki_storage.get_job_status(resource_id, str(source_table.get("id") or ""))
    parts = identity_parts(runtime.identity, chunks, dimensions, index) if semantic else {}
    saved, previous_plans = _saved_state(previous, identity, semantic, force, source_title, language, parts,
                                         getattr(runtime, "compatible_legacy_revision", None))
    count, token_method = reading_price_counter(runtime.provider, runtime.model)
    batch_size = batch_limit(batch_size, saved)
    remaining = [chunk for chunk in chunks if str(chunk["id"]) not in saved.get("plans", {})]
    source_tokens = sum(count(str(segment.get("text", ""))) for origin in origins for segment in records(origin.get("segments")))
    semantic_cost = {}
    if semantic:
        from backend.services.reading_semantic_estimate import phase_estimate
        semantic_cost = phase_estimate(runtime, chunks, remaining, dimensions, saved, batch_size, price_count=count)
        calls = semantic_cost["planned_calls"]
        restore_calls = 0
        input_bound = semantic_cost["input_token_bound"]
        output_assumed = semantic_cost["output_tokens_assumed"]
        output_bound = semantic_cost["output_token_bound"]
    else:
        # Keep the legacy engine's context bounds without preparing and then
        # discarding this work for every semantic quote.
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
        repeated = calls * (2*count(runtime.instructions) + 3*count(encoded(schema)) + min(8000, runtime.input_budget//8) + 8192)
        passages = sum(count(encoded(group)) for group in groups)
        restore_input = count(encoded(saved.get("plans", {}))) if restore_calls else 0
        input_bound = 2*passages + repeated + 2*restore_input
        output_assumed = sum(count(encoded(chunk)) for chunk in remaining)//2 + 512*calls
        output_bound = 16384*calls
    rates = _rates(runtime)
    low, high, flex = _quote(runtime, rates, semantic, input_bound, output_assumed, output_bound, semantic_cost)
    priced = rates is not None
    review_fields = {}
    if reviewer is not None:
        from backend.domains.llm_wiki.independent_review import validate_review_capacity
        from backend.services.reading_semantic_estimate import independent_estimate, independent_work
        validate_review_capacity(reviewer, chunks, dimensions, source_title, language)
        from backend.domains.llm_wiki.review_draft_batches import additional_review_calls, check_draft_capacity
        check_draft_capacity(reviewer, chunks, saved.get("plans", {}), dimensions, source_title, language)
        review_rates = _rates(reviewer)
        sampled, sample_count, targeted = independent_work(chunks, saved, reviewer.identity)
        # Forecast one extra flagged passage per remaining extraction batch. Allow
        # every remaining passage and additional map reductions in the upper projection.
        remaining_segments = sum(len(records(c.get("segments"))) for c in remaining)
        possible_flags = min(semantic_cost["phase_calls"]["interpretation"], remaining_segments)
        passages = sum(len(records(c.get("segments"))) for c in chunks)
        completed = saved.get("independent_revision") == reviewer.identity and saved.get("independent_synthesis")
        extra_batches = additional_review_calls(reviewer, chunks, saved.get("plans", {}), sampled, dimensions, source_title, language)
        expected_passages = min(passages, sample_count + possible_flags)
        review_count, _ = reading_price_counter(reviewer.provider, reviewer.model)
        typical_passage = max(1, sum(review_count(encoded(segment)) for chunk in chunks for segment in records(chunk.get("segments")))
                              // max(1, sum(len(records(c.get("segments"))) for c in chunks)))
        input_per_call = review_count(reviewer.instructions) + 6 * typical_passage + 4096
        review_calls, review_input, review_output, review_bound = independent_estimate(
            reviewer, review_count, expected_passages, targeted, extra_batches, int(not completed), typical_passage)
        possible_reviews = min(passages, sample_count + remaining_segments)
        extra_calls = max(0, possible_reviews + extra_batches + int(not completed) - review_calls)
        if possible_reviews > 1:
            extra_calls += possible_reviews  # Includes intermediate evidence syntheses.
        # Each remaining passage can also need a source-grounded correction
        # during extraction, before its independent final audit.
        review_low, review_high, _ = _quote(reviewer, review_rates, True, review_input, review_output, review_bound,
            {"evidence_input_token_bound": extra_calls * input_per_call + remaining_segments * reviewer.input_budget,
             "evidence_output_token_bound": (extra_calls + remaining_segments) * 16384})
        low = low + review_low if low is not None and review_low is not None else None
        high = high + review_high if high is not None and review_high is not None else None
        priced = priced and review_rates is not None
        calls += review_calls
        input_bound += review_input
        output_assumed += review_output
        output_bound += review_bound
        semantic_cost["phase_calls"]["independent_review"] = review_calls
        review_fields = {"review_provider": reviewer.provider, "review_model": reviewer.model,
            "review_cost_in_per_million_usd": review_rates["cost_in"] if review_rates else None,
            "review_cost_out_per_million_usd": review_rates["cost_out"] if review_rates else None}
        identity = job_identity(identity, reviewer.identity)
    budget = None
    if previous.get("job_id") or previous.get("budget_id"):
        budget = reading_budget.book_status(str(previous.get("budget_id") or ""), vault_root, str(source_table.get("id") or ""), resource_id)
    return {**semantic_cost, **review_fields, "_reading_identity": identity, "estimate_id": fingerprint([identity, source_title, language, rates, batch_size, len(saved.get("plans", {})), previous_plans, token_method, input_bound, output_assumed, high, flex]),
            "provider": runtime.provider, "model": runtime.model, "currency": "USD", "priced": priced,
            "processing_tier": "flex" if flex else "default",
            "display_currency": currency_context(),
            "cost_in_per_million_usd": rates["cost_in"] if rates else None,
            "cost_out_per_million_usd": rates["cost_out"] if rates else None,
            "incompatible_saved_chunks": max(0, previous_plans-len(saved.get("plans", {}))),
            "chunks_total": len(chunks), "saved_chunks": len(saved.get("plans", {})), "remaining_chunks": len(remaining),
            "batch_size": batch_size, "planned_calls": calls, "memory_restore_calls": restore_calls,
            "source_token_bound": source_tokens, "token_count_method": token_method, "input_token_bound": input_bound,
            "output_tokens_assumed": output_assumed, "output_token_bound": output_bound,
            "cost_usd": low, "cost_with_repairs_usd": high, "budget": budget, "warnings": warnings}



def _rates(runtime: Any) -> dict[str, Any] | None:
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
    return rates if priced else None


def _quote(runtime: Any, rates: Any, semantic: bool, input_bound: int, output_assumed: int,
           output_bound: int, evidence: dict[str, Any]) -> tuple[float | None, float | None, bool]:
    low = high = None
    from backend.services.reading_performance import eligible
    flex = eligible(runtime.provider, runtime.model) and getattr(runtime, "cost_optimization", True)
    if rates:
        from backend.services.openai_usage_pricing import LONG_INPUT, reading_model
        direct = reading_model(runtime.provider, runtime.model)
        multiplier = 0.5 if flex else 1.0
        # Hits depend on actual provider cache reuse. Forecast no hits and
        # include the 30-minute write premium instead of promising a discount.
        input_rate = float(rates["cost_in"]) * multiplier * (1.25 if direct else 1)
        output_rate = float(rates["cost_out"]) * multiplier
        low = (input_bound*input_rate+output_assumed*output_rate)/1_000_000
        # Include bounded evidence rounds as well as each call's format repair.
        repair_input = input_bound + evidence.get("evidence_input_token_bound", 0)
        repair_output = output_bound + evidence.get("evidence_output_token_bound", 0)
        high_in = float(rates["cost_in"]) * (1.25 if direct else 1)
        high_out = float(rates["cost_out"])
        if direct and runtime.input_budget > LONG_INPUT:
            high_in *= 2
            high_out *= 1.5
        high = (2 if semantic else 3)*(repair_input*high_in+repair_output*high_out)/1_000_000*1.10
    return low, high, flex


def _saved_state(previous: dict[str, Any], identity: str, semantic: bool, force: bool,
                 source_title: str, language: str, parts: dict[str, str] | None = None,
                 legacy_revision: Callable[[str], str] | None = None) -> tuple[dict[str, Any], int]:
    saved: dict[str, Any] = {}
    previous_plans = 0
    if not force and previous.get("phase") in {llm_wiki.PHASE_PARTIAL, llm_wiki.PHASE_ERROR}:
        for job_id in llm_wiki_storage.resume_checkpoint_jobs(str(previous.get("job_id") or "")):
            legacy = llm_wiki_storage.load_checkpoint(job_id, "agent-state")
            if semantic and isinstance(legacy, dict) and isinstance(legacy.get("plans"), dict):
                previous_plans = max(previous_plans, len(legacy["plans"]))
            checkpoint = llm_wiki_storage.load_checkpoint(job_id, "semantic-state") if semantic else legacy
            if isinstance(checkpoint, dict) and isinstance(checkpoint.get("plans"), dict):
                previous_plans = max(previous_plans, len(checkpoint["plans"]))
            if semantic:
                checkpoint = resume_semantic_state(checkpoint, identity, parts or {}, fingerprint([source_title, language]),
                                                  (lambda: legacy_revision(job_id)) if legacy_revision else None)
            if (isinstance(checkpoint, dict) and checkpoint.get("identity") == identity
                    and (not semantic or (checkpoint.get("engine") == 2
                         and checkpoint.get("reading_context") == fingerprint([source_title, language])))):
                plans = checkpoint.get("plans", {})
                if isinstance(plans, dict) and (not saved or state_progress(checkpoint) > state_progress(saved)):
                    saved = deepcopy(checkpoint)
                    reduce_batch(saved, str(llm_wiki_storage.get_job_status(job_id).get("error") or ""))
    return saved, previous_plans
