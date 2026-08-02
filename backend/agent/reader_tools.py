"""Governed tools for inspecting and analysing Gnosi Reader content."""
from __future__ import annotations

import json
from typing import List

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover - keeps helpers importable in lean tests
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


def _vault_path():
    from backend.services.context_vars import get_active_vault_path

    return get_active_vault_path()


def _scope(
    unread_only: bool,
    source_ids: List[int],
    categories: List[str],
    date_from: str,
    date_to: str,
):
    return {
        "unread_only": unread_only,
        "source_ids": source_ids,
        "categories": categories,
        "date_from": date_from,
        "date_to": date_to,
    }


@tool
def reader_inventory(
    unread_only: bool = True,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
) -> str:
    """Return an exact count and feed breakdown for a scoped Reader corpus."""
    from backend.agent.internal_sources import _reader_inventory, normalize_internal_scope

    scope = normalize_internal_scope(
        "reader",
        _scope(unread_only, source_ids or [], categories or [], date_from, date_to),
    )
    return json.dumps(_reader_inventory(scope), ensure_ascii=False, default=str)


@tool
def search_reader_articles(
    query: str,
    unread_only: bool = True,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
    limit: int = 12,
) -> str:
    """Search Reader articles with bounded excerpts and exact article IDs."""
    from backend.agent.internal_sources import _reader_search, normalize_internal_scope

    raw_scope = _scope(
        unread_only,
        source_ids or [],
        categories or [],
        date_from,
        date_to,
    )
    raw_scope["limit"] = limit
    scope = normalize_internal_scope("reader", raw_scope)
    return json.dumps(_reader_search(scope, query), ensure_ascii=False, default=str)


@tool
def read_reader_article(
    article_id: str,
    unread_only: bool = False,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
) -> str:
    """Read one exact Reader article while re-applying the requested scope."""
    from backend.agent.internal_sources import _reader_read, normalize_internal_scope

    scope = normalize_internal_scope(
        "reader",
        _scope(unread_only, source_ids or [], categories or [], date_from, date_to),
    )
    return json.dumps(_reader_read(scope, article_id), ensure_ascii=False, default=str)


@tool
def start_reader_topic_analysis(
    unread_only: bool = True,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
    language: str = "Catalan",
    guidance: str = "",
) -> str:
    """Start a durable, model-costing topic-evolution analysis after an explicit request."""
    from backend.services.reader_analysis import start_analysis

    result = start_analysis(
        _vault_path(),
        _scope(unread_only, source_ids or [], categories or [], date_from, date_to),
        language=language,
        guidance=guidance,
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
def reader_analysis_status(job_id: str) -> str:
    """Read progress for a durable Reader topic-analysis job."""
    from backend.services.reader_analysis import get_status

    return json.dumps(get_status(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def read_reader_analysis(job_id: str) -> str:
    """Read the cited result of a completed Reader topic-analysis job."""
    from backend.services.reader_analysis import read_result

    return json.dumps(read_result(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def resume_reader_topic_analysis(job_id: str) -> str:
    """Resume a failed or interrupted model-costing Reader analysis."""
    from backend.services.reader_analysis import resume_analysis

    return json.dumps(resume_analysis(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def cancel_reader_topic_analysis(job_id: str) -> str:
    """Request cooperative cancellation of a running Reader analysis."""
    from backend.services.reader_analysis import cancel_analysis

    return json.dumps(cancel_analysis(_vault_path(), job_id), ensure_ascii=False, default=str)


READER_READ_TOOLS = [
    reader_inventory,
    search_reader_articles,
    read_reader_article,
    reader_analysis_status,
    read_reader_analysis,
]
READER_AI_TOOLS = [start_reader_topic_analysis, resume_reader_topic_analysis]
READER_WRITE_TOOLS = [cancel_reader_topic_analysis]
