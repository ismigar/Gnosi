"""Tools closed over grounded notebook context references."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool


def build_notebook_context_tools(
    notebook_refs: list[dict[str, Any]],
) -> list[Any]:
    """Build notebook tools for one immutable attached-reference scope."""
    from backend.agent.web_context import wrap_untrusted

    def _notebook_ref(source_id: str = "") -> dict[str, Any]:
        normalized = str(source_id or "").strip()
        if normalized:
            selected = next(
                (
                    item
                    for item in notebook_refs
                    if item["id"] == normalized or item["ref"] == normalized
                ),
                None,
            )
        else:
            selected = notebook_refs[0] if len(notebook_refs) == 1 else None
        if selected is None:
            available = ", ".join(item["id"] for item in notebook_refs) or "(none)"
            raise ValueError(f"Select one attached notebook source. Available: {available}")
        return selected

    def inspect_notebook_context(source_id: str = "") -> str:
        """Inspect Resources and sources in an attached grounded notebook.

        Use the source id from list_context_sources. When exactly one notebook
        is attached, source_id may be omitted. The result is pinned to the
        turn's authorized immutable revision.
        """
        from backend.services.notebook_service import inspect_notebook

        ref = _notebook_ref(source_id)
        payload = inspect_notebook(
            ref["ref"],
            revision=int(ref["scope"]["revision"]),
            source_ids=(
                ref["scope"].get("source_ids")
                if ref["scope"].get("selection") == "sources"
                else None
            ),
        )
        return json.dumps(payload, ensure_ascii=False, default=str)

    def search_notebook_context(query: str, source_id: str = "", limit: int = 12) -> str:
        """Search evidence in an attached grounded notebook.

        This is mandatory before answering a source-dependent notebook
        question. It performs hybrid FTS5 and deterministic local-vector search
        inside the pinned revision and returns stable citations.
        """
        from backend.services.notebook_service import search_notebook

        ref = _notebook_ref(source_id)
        payload = search_notebook(
            ref["ref"],
            query,
            revision=int(ref["scope"]["revision"]),
            source_ids=(
                ref["scope"].get("source_ids")
                if ref["scope"].get("selection") == "sources"
                else None
            ),
            limit=max(1, min(int(limit), 50)),
        )
        return wrap_untrusted(
            f"Grounded notebook {ref['label']} search results",
            json.dumps(payload, ensure_ascii=False, default=str),
        )

    def read_notebook_context_evidence(chunk_id: str, source_id: str = "") -> str:
        """Read one exact notebook evidence chunk returned by notebook search."""
        from backend.services.notebook_service import read_notebook_evidence

        ref = _notebook_ref(source_id)
        payload = read_notebook_evidence(
            ref["ref"],
            chunk_id,
            revision=int(ref["scope"]["revision"]),
            source_ids=(
                ref["scope"].get("source_ids")
                if ref["scope"].get("selection") == "sources"
                else None
            ),
        )
        return wrap_untrusted(
            f"Grounded notebook {ref['label']} exact evidence",
            json.dumps(payload, ensure_ascii=False, default=str),
        )

    def start_notebook_context_analysis(request: str, source_id: str = "") -> str:
        """Start a durable hierarchical analysis over the entire notebook.

        Use this only for explicit whole-notebook synthesis, comparison, or
        classification requests that exceed bounded retrieval. The analysis is
        pinned to this turn's authorized revision and processes bounded batches.
        """
        from backend.services.notebook_service import start_notebook_analysis

        ref = _notebook_ref(source_id)
        payload = start_notebook_analysis(
            ref["ref"],
            request,
            revision=int(ref["scope"]["revision"]),
            source_ids=(
                ref["scope"].get("source_ids")
                if ref["scope"].get("selection") == "sources"
                else None
            ),
        )
        return json.dumps(payload, ensure_ascii=False, default=str)

    def notebook_context_analysis_status(analysis_id: str, source_id: str = "") -> str:
        """Return durable whole-notebook analysis progress."""
        from backend.services.notebook_service import get_notebook_analysis

        ref = _notebook_ref(source_id)
        payload = get_notebook_analysis(
            ref["ref"], analysis_id, revision=int(ref["scope"]["revision"])
        )
        return json.dumps(payload, ensure_ascii=False, default=str)

    def read_notebook_context_analysis(analysis_id: str, source_id: str = "") -> str:
        """Read a completed whole-notebook analysis and its evidence chunk ids."""
        from backend.services.notebook_service import get_notebook_analysis

        ref = _notebook_ref(source_id)
        payload = get_notebook_analysis(
            ref["ref"],
            analysis_id,
            revision=int(ref["scope"]["revision"]),
            include_result=True,
        )
        return wrap_untrusted(
            f"Grounded notebook {ref['label']} whole-notebook analysis",
            json.dumps(payload, ensure_ascii=False, default=str)[:120_000],
        )

    return [
        StructuredTool.from_function(inspect_notebook_context),
        StructuredTool.from_function(search_notebook_context),
        StructuredTool.from_function(read_notebook_context_evidence),
        StructuredTool.from_function(start_notebook_context_analysis),
        StructuredTool.from_function(notebook_context_analysis_status),
        StructuredTool.from_function(read_notebook_context_analysis),
    ]
