"""Core read and search tools for attached context references."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional, cast

from langchain_core.tools import StructuredTool

from backend.domains.agent.context_matching import (
    MAX_CONTEXT_TABLE_FIELDS,
    MAX_CONTEXT_TABLE_ROWS,
    MAX_SEARCH_HITS,
    _bounded_context_value,
    _tokenize,
    excerpt_around,
    score_text,
)
from backend.domains.agent.context_refs import describe_context_refs
from backend.domains.agent.context_storage import (
    _page_body,
    _page_title,
    _read_file_source,
    _read_source,
    _searchable_pages,
    _table_entry,
    _table_rows,
)

log = logging.getLogger(__name__)


class ContextCoreTools:
    """Bound tool handlers for one immutable attached-reference set."""

    def __init__(self, refs: list[dict[str, Any]]) -> None:
        self.refs = refs
        self.by_id = {ref["id"]: ref for ref in refs}
        self.external_ids = [ref["ref"] for ref in refs if ref["type"] == "source"]
        self.internal_refs = [ref for ref in refs if ref["type"] == "internal"]
        self.table_refs = [ref for ref in refs if ref["type"] == "table"]

    def list_context_sources(self) -> str:
        """Lists the context sources attached to this agent, with their ids and types."""
        return describe_context_refs(self.refs)

    def read_context_source(self, source_id: str) -> str:
        """Reads an attached source by its id.

        Returns the content for a file or page, the schema and rows for a
        database, and the index for a vault.
        """
        ref = self.by_id.get(str(source_id).strip())
        if not ref:
            available = ", ".join(self.by_id) or "(none)"
            return f"«{source_id}» is not an attached source. Available: {available}"
        try:
            return _read_source(ref)
        except Exception as exc:  # noqa: BLE001
            log.exception("Failed to read context source %s", source_id)
            return f"Error reading source «{ref['label']}»: {exc}"

    def query_context_table(
        self,
        source_id: str,
        offset: int = 0,
        limit: int = MAX_CONTEXT_TABLE_ROWS,
        fields: Optional[list[str]] = None,
    ) -> str:
        """List exact rows from one attached table or its active view.

        Use the source id from list_context_sources. Results are deterministic,
        include the exact matching count and support offset pagination. With no
        fields, each row contains only id and title; request at most 12 metadata
        field names when their values are needed.
        """
        ref = self.by_id.get(str(source_id).strip())
        if not ref or ref["type"] != "table":
            available = ", ".join(item["id"] for item in self.table_refs) or "(none)"
            return f"«{source_id}» is not an attached table source. Available: {available}"
        table = _table_entry(ref["ref"])
        if not table:
            return json.dumps({"error": "The attached table no longer exists."})
        rows, view = _table_rows(ref["ref"], ref.get("scope"))
        bounded_offset = max(0, min(int(offset), len(rows)))
        bounded_limit = max(1, min(int(limit), MAX_CONTEXT_TABLE_ROWS))
        selected_fields: list[str] = []
        seen_fields: set[str] = set()
        for raw_field in fields or []:
            field = str(raw_field or "").strip()[:128]
            key = field.casefold()
            if not field or key in seen_fields:
                continue
            seen_fields.add(key)
            selected_fields.append(field)
            if len(selected_fields) >= MAX_CONTEXT_TABLE_FIELDS:
                break
        records = []
        for row in rows[bounded_offset : bounded_offset + bounded_limit]:
            record = {"id": row["id"], "title": row["title"]}
            if selected_fields:
                metadata = row.get("metadata") or {}
                record["fields"] = {
                    field: _bounded_context_value(metadata.get(field)) for field in selected_fields
                }
            records.append(record)
        payload = {
            "source_id": ref["id"],
            "table": {"id": table.get("id"), "name": table.get("name")},
            "active_view": ({"id": view.get("id"), "name": view.get("name")} if view else None),
            "matching_count": len(rows),
            "offset": bounded_offset,
            "limit": bounded_limit,
            "has_more": bounded_offset + len(records) < len(rows),
            "next_offset": (
                bounded_offset + len(records) if bounded_offset + len(records) < len(rows) else None
            ),
            "records": records,
        }
        return json.dumps(payload, ensure_ascii=False, default=str)

    def _local_scores(
        self, query: str, selected_refs: list[dict[str, Any]]
    ) -> list[tuple[int, str, str]]:
        scored: list[tuple[int, str, str]] = []
        for page in _searchable_pages(selected_refs):
            title = _page_title(page)
            body = _page_body(page)
            score = score_text(query, f"{title} {body}")
            if score:
                scored.append((score, f"page «{title}»", excerpt_around(body, query)))
        for ref in selected_refs:
            content = self._direct_ref_content(ref)
            if content is None:
                continue
            score = score_text(query, content)
            if score:
                source_kind = {"page": "page", "file": "file", "url": "web"}[ref["type"]]
                scored.append(
                    (score, f"{source_kind} «{ref['label']}»", excerpt_around(content, query))
                )
        return scored

    @staticmethod
    def _direct_ref_content(ref: dict[str, Any]) -> str | None:
        if ref["type"] == "page":
            return _read_source(ref)
        if ref["type"] == "file":
            return _read_file_source(ref["ref"])
        if ref["type"] == "url":
            from backend.agent.web_context import fetch_url_text

            return cast(str, fetch_url_text(ref["ref"]))
        return None

    @staticmethod
    def _internal_search(query: str, selected_refs: list[dict[str, Any]]) -> list[str]:
        from backend.agent.internal_sources import search_internal_source
        from backend.agent.web_context import wrap_untrusted

        output: list[str] = []
        for ref in selected_refs:
            if ref["type"] != "internal":
                continue
            try:
                content = search_internal_source(ref["ref"], ref.get("scope") or {}, query)
                source_label = f"Gnosi {ref['label']} search results"
                output.append(f"\n— Gnosi {ref['label']}:\n{wrap_untrusted(source_label, content)}")
            except Exception as exc:  # noqa: BLE001
                log.warning("Internal source %s search failed: %s", ref["ref"], exc)
                output.append(f"\n— Gnosi {ref['label']}:\nThe source could not be searched: {exc}")
        return output

    @staticmethod
    def _external_search(query: str, selected_refs: list[dict[str, Any]]) -> list[str]:
        from backend.agent.context_sources import get_source

        output: list[str] = []
        for ref in selected_refs:
            if ref["type"] != "source":
                continue
            source = get_source(ref["ref"])
            if source:
                output.append(f"\n— {source.LABEL}:\n{source.search(query)}")
        return output

    def _search(self, query: str, selected_refs: list[dict[str, Any]]) -> str:
        scored = self._local_scores(query, selected_refs)
        scored.sort(key=lambda item: item[0], reverse=True)
        output = [f"\n— {source}:\n{excerpt}" for _, source, excerpt in scored[:MAX_SEARCH_HITS]]
        output.extend(self._internal_search(query, selected_refs))
        output.extend(self._external_search(query, selected_refs))
        if not output:
            return f"Nothing about «{query}» was found in the attached sources."
        return "\n".join([f"Relevant excerpts for «{query}»:"] + output)

    def search_context(self, query: str) -> str:
        """Searches ALL attached sources and returns relevant excerpts.

        Use this before reading entire sources: large vaults and databases do
        not fit in the conversation.
        """
        if not _tokenize(query):
            return "The query is too short to search the attached sources."
        try:
            return self._search(query, self.refs)
        except Exception as exc:  # noqa: BLE001
            log.exception("Search over the attached context failed")
            return f"Error searching the attached sources: {exc}"

    def search_context_source(self, source_id: str, query: str) -> str:
        """Searches one attached source and returns bounded relevant excerpts.

        Use the exact source id returned by list_context_sources. This avoids
        querying unrelated attached sources and preserves their independent
        least-privilege scopes.
        """
        if not _tokenize(query):
            return "The query is too short to search the attached source."
        ref = self.by_id.get(str(source_id).strip())
        if not ref:
            available = ", ".join(self.by_id) or "(none)"
            return f"«{source_id}» is not an attached source. Available: {available}"
        try:
            return self._search(query, [ref])
        except Exception as exc:  # noqa: BLE001
            log.exception("Search over context source %s failed", source_id)
            return f"Error searching source «{ref['label']}»: {exc}"

    def read_external_source(self, source_id: str, reference: str) -> str:
        """Reads an EXACT reference from an attached external source.

        IMPORTANT: `reference` must ALWAYS come from a previous search result.
        Never invent an identifier: if it has not appeared in a search, use
        search_context first.

        For the BOE, `reference` is the regulation identifier shown by search
        (BOE-A-YYYY-NNNNN), optionally followed by `#block` to read an article,
        or a YYYYMMDD date for that day's summary.
        """
        from backend.agent.context_sources import get_source
        from backend.agent.web_context import wrap_untrusted

        source_id = (source_id or "").strip().lower()
        alias = self.by_id.get(source_id) or self.by_id.get((source_id or "").strip())
        if alias and alias["type"] == "source":
            source_id = alias["ref"]
        if source_id not in self.external_ids:
            return (
                f"«{source_id}» is not an attached external source. "
                f"Available: {', '.join(self.external_ids) or '(none)'}"
            )
        source = get_source(source_id)
        if not source:
            return f"External source «{source_id}» is no longer available."
        try:
            body = source.read(reference)
            if "Could not read" in body or "returned no" in body:
                body += (
                    f"\n\nReference «{reference}» does not exist in the source. "
                    "Do NOT answer from memory: use search_context with relevant "
                    "keywords and take an identifier from its results."
                )
            return cast(str, wrap_untrusted(source.LABEL, body))
        except Exception as exc:  # noqa: BLE001
            log.exception("Failed to read %s from external source %s", reference, source_id)
            return f"Error reading «{reference}» from {source.LABEL}: {exc}"

    def read_context_record(self, source_id: str, record_id: str) -> str:
        """Reads one exact record from an attached internal Gnosi source.

        Both identifiers must come from list_context_sources or search_context.
        The stored source scope is re-applied before the record is returned.
        """
        ref = self.by_id.get(str(source_id).strip())
        if not ref or ref["type"] != "internal":
            available = ", ".join(item["id"] for item in self.internal_refs) or "(none)"
            return f"«{source_id}» is not an attached internal source. Available: {available}"
        try:
            from backend.agent.internal_sources import read_internal_record
            from backend.agent.web_context import wrap_untrusted

            body = read_internal_record(ref["ref"], ref.get("scope") or {}, record_id)
            return cast(str, wrap_untrusted(f"Gnosi {ref['label']} record {record_id}", body))
        except KeyError:
            return (
                f"Record «{record_id}» does not exist inside the attached source scope. "
                f"Search {ref['label']} again and use an exact id."
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Internal source %s read failed: %s", ref["ref"], exc)
            return f"Error reading record «{record_id}» from {ref['label']}: {exc}"


def build_core_context_tools(refs: list[dict[str, Any]]) -> list[Any]:
    handlers = ContextCoreTools(refs)
    tools = [
        StructuredTool.from_function(handlers.list_context_sources),
        StructuredTool.from_function(handlers.read_context_source),
        StructuredTool.from_function(handlers.search_context),
        StructuredTool.from_function(handlers.search_context_source),
    ]
    if handlers.table_refs:
        tools.append(StructuredTool.from_function(handlers.query_context_table))
    if handlers.external_ids:
        tools.append(StructuredTool.from_function(handlers.read_external_source))
    if handlers.internal_refs:
        tools.append(StructuredTool.from_function(handlers.read_context_record))
    return tools
