"""Explicit, audited AI assistance for literature workflows."""
from __future__ import annotations

from backend.services.agent_behavior import task_input

import json
import re
import threading
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.services.literature_models import normalize_title


OPERATIONS = {"query_strategy", "translate_query", "rerank", "screen", "synthesize", "snowball"}
_EMBEDDING_MODEL: Any = None
_EMBEDDING_UNAVAILABLE = False
_EMBEDDING_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _evidence_level(work: dict[str, Any]) -> str:
    if work.get("verified_full_text") or work.get("full_text"):
        return "verified_full_text"
    if work.get("abstract"):
        return "title_and_abstract"
    return "title_only"


def _clean_json(raw: str) -> Any:
    cleaned = re.sub(r"^```(?:json)?|```$", "", str(raw or "").strip(), flags=re.MULTILINE).strip()
    start_candidates = [index for index in (cleaned.find("{"), cleaned.find("[")) if index >= 0]
    if not start_candidates:
        raise ValueError("The model did not return JSON.")
    start = min(start_candidates)
    end = max(cleaned.rfind("}"), cleaned.rfind("]"))
    if end < start:
        raise ValueError("The model returned incomplete JSON.")
    return json.loads(cleaned[start:end + 1])


def _bounded_works(values: Any, limit: int = 100) -> list[dict[str, Any]]:
    works = [item for item in values if isinstance(item, dict)] if isinstance(values, list) else []
    return [{
        "id": item.get("id"), "title": str(item.get("title") or ""),
        "abstract": str(item.get("abstract") or ""), "year": item.get("year"),
        "full_text": str(item.get("full_text") or ""),
        "authors": item.get("authors") or [], "type": item.get("type") or "other",
        "evidence_level": _evidence_level(item),
    } for item in works]


def _token_overlap_rerank(query: str, works: list[dict[str, Any]]) -> dict[str, Any]:
    query_tokens = set(normalize_title(query).split())
    ranked: list[dict[str, Any]] = []
    for ordinal, work in enumerate(works):
        title_tokens = set(normalize_title(f"{work.get('title', '')} {work.get('abstract', '')}").split())
        denominator = len(query_tokens | title_tokens) or 1
        score = len(query_tokens & title_tokens) / denominator
        ranked.append({"id": work.get("id"), "score": round(score, 6), "original_rank": ordinal + 1})
    ranked.sort(key=lambda item: (-item["score"], item["original_rank"]))
    for rank, item in enumerate(ranked, start=1):
        item["semantic_rank"] = rank
    return {"ranking": ranked, "explanation": "Local token-overlap fallback; the original rank is preserved."}


def _local_embedding_rerank(query: str, works: list[dict[str, Any]]) -> tuple[dict[str, Any], str, str | None]:
    """Use cached local embeddings when available, with a deterministic fallback."""
    global _EMBEDDING_MODEL, _EMBEDDING_UNAVAILABLE
    if not query.strip() or not works:
        return _token_overlap_rerank(query, works), "local-token-overlap", "Empty query or result set."
    if _EMBEDDING_MODEL is None and not _EMBEDDING_UNAVAILABLE:
        with _EMBEDDING_LOCK:
            if _EMBEDDING_MODEL is None and not _EMBEDDING_UNAVAILABLE:
                try:
                    from sentence_transformers import SentenceTransformer

                    _EMBEDDING_MODEL = SentenceTransformer(
                        "sentence-transformers/all-MiniLM-L6-v2",
                        device="cpu",
                        local_files_only=True,
                    )
                except (ImportError, OSError, RuntimeError, TypeError):
                    _EMBEDDING_UNAVAILABLE = True
    if _EMBEDDING_MODEL is None:
        return _token_overlap_rerank(query, works), "local-token-overlap", "The local embedding model is not installed in the runtime cache."
    texts = [query, *(f"{work.get('title', '')}. {work.get('abstract', '')}"[:10_000] for work in works)]
    try:
        vectors = _EMBEDDING_MODEL.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        ranked: list[dict[str, Any]] = [
            {"id": work.get("id"), "score": round(float(vectors[0] @ vectors[index + 1]), 6), "original_rank": index + 1}
            for index, work in enumerate(works)
        ]
    except (RuntimeError, ValueError, TypeError) as exc:
        return _token_overlap_rerank(query, works), "local-token-overlap", f"Embedding inference failed: {type(exc).__name__}."
    ranked.sort(key=lambda item: (-item["score"], item["original_rank"]))
    for rank, item in enumerate(ranked, start=1):
        item["semantic_rank"] = rank
    return {"ranking": ranked, "explanation": "Local semantic embedding ranking; the original rank is preserved."}, "sentence-transformers/all-MiniLM-L6-v2", None


def _prompt(operation: str, payload: dict[str, Any]) -> tuple[str, str, list[dict[str, Any]]]:
    works = _bounded_works(payload.get("works"), 100)
    if operation not in {"query_strategy", "translate_query", "screen", "synthesize", "snowball"}:
        raise HTTPException(status_code=400, detail="Unsupported literature AI operation.")
    data = {**payload, "works": works}
    return "", task_input(f"literature.{operation}", **data), works


def run_operation(operation: str, payload: dict[str, Any], agent_id: str = "") -> dict[str, Any]:
    """Run an explicit AI aid or a zero-cost local reranking operation."""
    if operation not in OPERATIONS:
        raise HTTPException(status_code=400, detail="Unsupported literature AI operation.")
    works = _bounded_works(payload.get("works"), 100)
    if operation == "rerank" and str(payload.get("mode") or "local") == "local":
        from backend.services.agent_specialized_tools import run_engine
        result, model, fallback_reason = run_engine("semantic-ranking", "literature selection", lambda: _local_embedding_rerank(str(payload.get("query") or ""), works))
        return {"operation": operation, "result": result, "audit": {"model": model, "provider": "local", "usage": {"input_tokens": 0, "output_tokens": 0}, "cost": 0, "fallback_reason": fallback_reason, "performed_at": _now(), "evidence_levels": sorted({_evidence_level(work) for work in works}), "resource_ids": [work.get("id") for work in works if work.get("id")], "operation_version": 1, "human_decision_required": True}}
    system_prompt, user_message, works = _prompt(operation, payload)
    try:
        from backend.services.agent_execution import generate_result_for
        run = generate_result_for("literature", user_message, timeout=120, output_schema={"type": "object"})
        raw, model = run.result, run.model
        agent_id = run.agent_id
        result = _clean_json(raw)
    except RuntimeError as exc:
        if str(exc).startswith("agent_"):
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise HTTPException(status_code=503, detail="No AI provider is configured. Deterministic literature search remains available.") from exc
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="The configured AI model returned an invalid structured response.") from exc
    usage = {
        "input_tokens_estimate": max(1, len(f"{system_prompt}\n{user_message}") // 4),
        "output_tokens_estimate": max(1, len(str(raw or "")) // 4),
        "reported_by_provider": False,
    }
    return {"operation": operation, "result": result, "audit": {"run_id": run.run_id, "agent_id": agent_id, "model": model, "provider": run.provider, "usage": usage, "cost": None, "cost_status": "Provider cost was not reported; usage is estimated.", "performed_at": _now(), "evidence_levels": sorted({_evidence_level(work) for work in works}), "resource_ids": [work.get("id") for work in works if work.get("id")], "operation_version": 1, "human_decision_required": True}}
