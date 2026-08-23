"""Explicit, audited AI assistance for literature workflows."""
from __future__ import annotations

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
        "id": item.get("id"), "title": str(item.get("title") or "")[:1_000],
        "abstract": str(item.get("abstract") or "")[:8_000], "year": item.get("year"),
        "authors": item.get("authors") or [], "type": item.get("type") or "other",
        "evidence_level": _evidence_level(item),
    } for item in works[:limit]]


def _token_overlap_rerank(query: str, works: list[dict[str, Any]]) -> dict[str, Any]:
    query_tokens = set(normalize_title(query).split())
    ranked = []
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
        ranked = [
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
    if operation == "query_strategy":
        question = str(payload.get("question") or "")[:4_000]
        framework = str(payload.get("framework") or "PICO").upper()
        framework_instruction = (
            "Choose transparent concept blocks; use PICO or SPIDER only when they fit the research question"
            if framework == "AUTO"
            else f"Use {framework} when appropriate"
        )
        return (
            "You assist a human literature reviewer. Convert the question into editable concepts. "
            f"{framework_instruction}. Include multilingual synonyms in the requested languages, but keep the "
            "Boolean query concise, high-recall, and provider-neutral, using the question language and English "
            "rather than combining every translated synonym. The Boolean query must require only the central "
            "subject concept; treat requested dates, characteristics, comparisons, or criteria as screening and "
            "analysis dimensions unless they are indispensable to identify the subject. Include spelling "
            "variants, controlled terms, and one transparent Boolean query. Do not invent evidence. "
            "Return only JSON with keys framework, concepts, synonyms, boolean_query, cautions.",
            question,
            works,
        )
    if operation == "translate_query":
        return (
            "Translate an existing Boolean literature query into the target academic source syntax. Preserve "
            "meaning, quote phrases, explain unsupported operators, and return only JSON with keys source_id, "
            "original_query, translated_query, warnings.",
            json.dumps({"query": str(payload.get("query") or "")[:4_000], "source_id": str(payload.get("source_id") or "")[:100]}, ensure_ascii=False),
            works,
        )
    if operation == "screen":
        return (
            "Suggest screening outcomes for the supplied works against the criteria. Return only JSON with "
            "suggestions, each containing id, suggestion (include, exclude, or uncertain), rationale, confidence, "
            "and evidence_level. Never present the suggestion as a final decision and never claim full-text review "
            "unless evidence_level is verified_full_text.",
            json.dumps({"criteria": payload.get("criteria") or {}, "works": works}, ensure_ascii=False),
            works,
        )
    if operation == "synthesize":
        return (
            "Synthesize only the supplied selected works. Identify themes, contradictions, evidence gaps, and "
            "specific next searches. Cite works by their supplied id and label evidence level. Do not claim to "
            "have read full text when only title or abstract is supplied. Return only JSON with keys summary, "
            "themes, contradictions, gaps, next_searches, citations.",
            json.dumps({"question": str(payload.get("question") or "")[:4_000], "works": works}, ensure_ascii=False),
            works,
        )
    if operation == "snowball":
        return (
            "Propose transparent backward and forward citation-search steps for the seed works. Distinguish "
            "retrieved identifiers from suggested discovery queries. Return only JSON with backward_queries, "
            "forward_queries, identifiers, cautions.",
            json.dumps({"works": works}, ensure_ascii=False),
            works,
        )
    raise HTTPException(status_code=400, detail="Unsupported literature AI operation.")


def run_operation(operation: str, payload: dict[str, Any], agent_id: str = "") -> dict[str, Any]:
    """Run an explicit AI aid or a zero-cost local reranking operation."""
    if operation not in OPERATIONS:
        raise HTTPException(status_code=400, detail="Unsupported literature AI operation.")
    works = _bounded_works(payload.get("works"), 100)
    if operation == "rerank" and str(payload.get("mode") or "local") == "local":
        result, model, fallback_reason = _local_embedding_rerank(str(payload.get("query") or ""), works)
        return {"operation": operation, "result": result, "audit": {"model": model, "provider": "local", "usage": {"input_tokens": 0, "output_tokens": 0}, "cost": 0, "fallback_reason": fallback_reason, "performed_at": _now(), "evidence_levels": sorted({_evidence_level(work) for work in works}), "resource_ids": [work.get("id") for work in works if work.get("id")], "operation_version": 1, "human_decision_required": True}}
    system_prompt, user_message, works = _prompt(operation, payload)
    try:
        from backend.agent.factory import generate_text

        raw, model = generate_text(f"{system_prompt}\n\nINPUT:\n{user_message}", user_message=user_message[:500], timeout=120, agent_id=agent_id)
        result = _clean_json(raw)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="No AI provider is configured. Deterministic literature search remains available.") from exc
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="The configured AI model returned an invalid structured response.") from exc
    usage = {
        "input_tokens_estimate": max(1, len(f"{system_prompt}\n{user_message}") // 4),
        "output_tokens_estimate": max(1, len(str(raw or "")) // 4),
        "reported_by_provider": False,
    }
    return {"operation": operation, "result": result, "audit": {"agent_id": agent_id or None, "model": model, "provider": "configured", "usage": usage, "cost": None, "cost_status": "Provider cost was not reported; usage is estimated.", "performed_at": _now(), "evidence_levels": sorted({_evidence_level(work) for work in works}), "resource_ids": [work.get("id") for work in works if work.get("id")], "operation_version": 1, "human_decision_required": True}}
