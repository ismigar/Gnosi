"""Tools closed over one attached Reader scope."""

from __future__ import annotations

import json
from typing import Any, Optional, cast

from langchain_core.tools import StructuredTool


def build_reader_context_tools(reader_ref: dict[str, Any]) -> list[Any]:
    """Build Reader tools constrained to the attached source scope."""
    from backend.agent.web_context import wrap_untrusted

    def _reader_scope(
        *,
        read_status: str = "all",
        source_ids: Optional[list[int]] = None,
        source_names: Optional[list[str]] = None,
        categories: Optional[list[str]] = None,
        date_from: str = "",
        date_to: str = "",
        limit: int = 12,
        offset: int = 0,
    ) -> dict[str, Any]:
        from backend.agent.internal_sources import intersect_reader_scope

        return intersect_reader_scope(
            reader_ref.get("scope") or {},
            {
                "read_status": read_status,
                "source_ids": source_ids or [],
                "source_names": source_names or [],
                "categories": categories or [],
                "date_from": date_from,
                "date_to": date_to,
                "limit": limit,
                "offset": offset,
            },
        )

    def inspect_reader_context() -> str:
        """Return exact totals, read states, feeds, categories, dates, and fields."""
        from backend.agent.internal_sources import describe_internal_source

        payload = describe_internal_source("reader", reader_ref.get("scope") or {})
        return cast(str, wrap_untrusted("Gnosi Reader inventory", payload))

    def search_reader_context(
        query: str = "",
        read_status: str = "all",
        source_ids: Optional[list[int]] = None,
        source_names: Optional[list[str]] = None,
        categories: Optional[list[str]] = None,
        date_from: str = "",
        date_to: str = "",
        limit: int = 12,
        offset: int = 0,
    ) -> str:
        """Search attached Reader articles with metadata filters and pagination.

        An empty query lists the newest matching records. read_status accepts
        all, read, or unread. Source names and categories are case-insensitive.
        Results include exact ids, read state, source, category, date, URL,
        excerpts, total matches, and whether more pages exist.
        """
        from backend.agent.internal_sources import _reader_search

        scope = _reader_scope(
            read_status=read_status,
            source_ids=source_ids,
            source_names=source_names,
            categories=categories,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            offset=offset,
        )
        payload = _reader_search(scope, query)
        return cast(
            str,
            wrap_untrusted(
                "Gnosi Reader filtered search",
                json.dumps(payload, ensure_ascii=False, default=str),
            ),
        )

    def read_reader_context_article(
        article_id: str,
        content_offset: int = 0,
        content_limit: int = 16_000,
    ) -> str:
        """Read exact Reader metadata and one full-text chunk.

        Start at offset zero. If content_has_more is true, call this tool again
        with next_content_offset until the complete available article is read.
        """
        from backend.agent.internal_sources import _reader_read

        payload = _reader_read(
            _reader_scope(),
            article_id,
            content_offset=content_offset,
            content_limit=content_limit,
        )
        return cast(
            str,
            wrap_untrusted(
                f"Gnosi Reader article {article_id}",
                json.dumps(payload, ensure_ascii=False, default=str),
            ),
        )

    def start_reader_context_analysis(
        request: str,
        language: str = "Catalan",
        read_status: str = "all",
        source_ids: Optional[list[int]] = None,
        source_names: Optional[list[str]] = None,
        categories: Optional[list[str]] = None,
        date_from: str = "",
        date_to: str = "",
    ) -> str:
        """Start an explicit durable analysis over the attached Reader collection.

        Use this for collection-wide summaries, comparisons, classifications,
        trends, or other requests that require processing more records than a
        bounded search can return. The result keeps exact article ids as evidence.
        """
        from backend.services.context_vars import get_active_vault_path
        from backend.services.reader_analysis import start_analysis

        scope = _reader_scope(
            read_status=read_status,
            source_ids=source_ids,
            source_names=source_names,
            categories=categories,
            date_from=date_from,
            date_to=date_to,
        )
        payload = start_analysis(
            get_active_vault_path(), scope, language=language, guidance=request
        )
        return json.dumps(payload, ensure_ascii=False, default=str)

    def _reader_job(job_id: str, *, include_result: bool = False) -> dict[str, Any]:
        from backend.agent.internal_sources import reader_scope_contains
        from backend.services.context_vars import get_active_vault_path
        from backend.services.reader_analysis import get_status, read_result

        status = get_status(get_active_vault_path(), job_id)
        if not reader_scope_contains(reader_ref.get("scope") or {}, status.get("scope") or {}):
            raise PermissionError(
                "The Reader analysis is outside the collection attached to this turn."
            )
        result = read_result(get_active_vault_path(), job_id) if include_result else status
        return cast(dict[str, Any], result)

    def reader_context_analysis_status(job_id: str) -> str:
        """Return progress for a durable analysis of the attached Reader collection."""
        return json.dumps(_reader_job(job_id), ensure_ascii=False, default=str)

    def read_reader_context_analysis(job_id: str) -> str:
        """Read a completed attached-Reader analysis with article-id evidence."""
        payload = _reader_job(job_id, include_result=True)
        return cast(
            str,
            wrap_untrusted(
                f"Gnosi Reader analysis {job_id}",
                json.dumps(payload, ensure_ascii=False, default=str)[:120_000],
            ),
        )

    return [
        StructuredTool.from_function(inspect_reader_context),
        StructuredTool.from_function(search_reader_context),
        StructuredTool.from_function(read_reader_context_article),
        StructuredTool.from_function(start_reader_context_analysis),
        StructuredTool.from_function(reader_context_analysis_status),
        StructuredTool.from_function(read_reader_context_analysis),
    ]
