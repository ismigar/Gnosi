"""Exhaustive deterministic inventory tool for attached Vault context."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, cast

from langchain_core.tools import StructuredTool

from backend.domains.agent.context_matching import (
    MAX_CONTEXT_INVENTORY_QUERY_CHARS,
    MAX_CONTEXT_INVENTORY_ROWS,
    _canonical_metadata,
    _inventory_match,
    _inventory_query_terms,
    _normalized_phrase,
    _normalized_words,
)
from backend.domains.agent.context_storage import (
    _authorized_inventory_tables,
    _inventory_table_matches,
    _page_body,
    _searchable_page_records,
    _vault_root,
)

log = logging.getLogger(__name__)


class InventoryContextTool:
    """Bound exhaustive inventory handler for one reference set."""

    def __init__(self, inventory_refs: list[dict[str, Any]]) -> None:
        self.inventory_refs = inventory_refs

    @staticmethod
    def _requested_types(record_types: Optional[list[str]]) -> list[str]:
        requested: list[str] = []
        seen: set[str] = set()
        for raw_type in record_types or []:
            value = " ".join(str(raw_type or "").split())[:128]
            key = _normalized_phrase(value)
            if not value or not key or key in seen:
                continue
            seen.add(key)
            requested.append(value)
            if len(requested) >= 12:
                break
        return requested

    @staticmethod
    def _dynamic_types(
        query: str,
        requested: list[str],
        authorized_tables: list[dict[str, Any]],
    ) -> tuple[str, list[str]]:
        if requested or not query:
            return query, requested
        query_words = _normalized_words(query, minimum_length=1)
        query_word_set = set(query_words)
        dynamic_types: list[str] = []
        dynamic_type_words: set[str] = set()
        for table in authorized_tables:
            table_name = str(table.get("name") or table.get("title") or "").strip()
            table_words = set(_normalized_words(table_name, minimum_length=1))
            if table_name and table_words and table_words.issubset(query_word_set):
                dynamic_types.append(table_name)
                dynamic_type_words.update(table_words)
        if not dynamic_types:
            return query, requested
        bounded_query = " ".join(word for word in query_words if word not in dynamic_type_words)[
            :MAX_CONTEXT_INVENTORY_QUERY_CHARS
        ]
        return bounded_query, [*requested, *dynamic_types[:12]]

    @staticmethod
    def _cached_indexes(
        records: list[dict[str, Any]],
    ) -> tuple[dict[str, str], dict[str, tuple[frozenset[str], frozenset[str]]], float]:
        try:
            from backend.api.vault_routes import (
                get_cached_document_texts,
                get_link_index_terms,
            )

            read_documents = cast(
                Callable[[Iterable[str]], dict[str, str]],
                get_cached_document_texts,
            )
            read_terms = cast(
                Callable[
                    [Iterable[str]],
                    tuple[
                        dict[str, tuple[frozenset[str], frozenset[str]]],
                        float,
                    ],
                ],
                get_link_index_terms,
            )
            documents = read_documents(record["path"] for record in records)
            terms, built_at = read_terms(record["id"] for record in records)
            return documents, terms, built_at
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not read the cached Vault text index: %s", exc)
            return {}, {}, 0.0

    @staticmethod
    def _table_resolution(
        authorized_tables: list[dict[str, Any]], requested: list[str]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
        available: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for table in authorized_tables:
            table_id = str(table.get("id") or "")
            if table_id and table_id not in seen_ids:
                seen_ids.add(table_id)
                available.append(table)
        resolved = [table for table in available if _inventory_table_matches(table, requested)]
        unresolved = [
            value
            for value in requested
            if not any(_inventory_table_matches(table, [value]) for table in available)
        ]
        return available, resolved, unresolved

    @staticmethod
    def _record_text(
        record: dict[str, Any],
        documents: dict[str, str],
        indexed_terms: dict[str, tuple[frozenset[str], frozenset[str]]],
        *,
        include_relations: bool,
    ) -> tuple[str, str, bool]:
        cached_body = documents.get(record["path"])
        cached_terms = indexed_terms.get(record["id"])
        if cached_body is None and cached_terms is None:
            return _page_body(record["page"]), "", False
        body = cached_body or (" ".join(cached_terms[0]) if cached_terms else "")
        related = (
            " ".join(cached_terms[1]) if cached_terms is not None and include_relations else ""
        )
        return body, related, True

    @staticmethod
    def _relative_path(path_text: str, root: Path | None) -> str:
        if not path_text:
            return ""
        try:
            path = Path(path_text).resolve()
            return str(path.relative_to(root)) if root else path.name
        except (OSError, ValueError):
            return Path(path_text).name

    def _matches(
        self,
        records: list[dict[str, Any]],
        query: str,
        semantic_terms: list[str],
        resolved_ids: set[str],
        requested_types: list[str],
        documents: dict[str, str],
        indexed_terms: dict[str, tuple[frozenset[str], frozenset[str]]],
        root: Path | None,
        *,
        include_relations: bool,
    ) -> tuple[list[dict[str, Any]], int, int]:
        matches: list[dict[str, Any]] = []
        direct_reads = 0
        cache_covered = 0
        for record in records:
            table = record["table"]
            if requested_types and str(table.get("id") or "") not in resolved_ids:
                continue
            body, related, cached = self._record_text(
                record, documents, indexed_terms, include_relations=include_relations
            )
            cache_covered += int(cached)
            direct_reads += int(not cached)
            score, basis, kind = _inventory_match(
                query,
                record["title"],
                body,
                record["metadata"],
                related,
                semantic_terms,
            )
            if score:
                matches.append(
                    {
                        "score": score,
                        "id": record["id"],
                        "title": record["title"],
                        "source_id": record["source_id"],
                        "record_type": table,
                        "path": self._relative_path(str(record.get("path") or ""), root),
                        "match_basis": basis,
                        "match_kind": kind,
                        "metadata": _canonical_metadata(record["metadata"]),
                    }
                )
        matches.sort(
            key=lambda item: (
                -int(item["score"]),
                _normalized_phrase(item["record_type"].get("name")),
                _normalized_phrase(item["title"]),
                item["id"],
            )
        )
        return matches, direct_reads, cache_covered

    @staticmethod
    def _counts(matches: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int]]:
        by_type: dict[str, int] = {}
        by_kind = {"direct": 0, "relation": 0}
        for match in matches:
            type_name = str(match["record_type"].get("name") or "Unknown")
            by_type[type_name] = by_type.get(type_name, 0) + 1
            kind = "relation" if match.get("match_kind") == "relation" else "direct"
            by_kind[kind] += 1
        return by_type, by_kind

    @staticmethod
    def _freshness(requested: int, covered: int, direct_reads: int) -> dict[str, Any]:
        try:
            from backend.api.vault_routes import get_agent_index_freshness

            read_freshness = cast(
                Callable[..., dict[str, Any]],
                get_agent_index_freshness,
            )
            return dict(
                read_freshness(
                    requested_count=requested,
                    covered_count=covered,
                    direct_reads=direct_reads,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not resolve Vault index freshness: %s", exc)
            return {
                "status": "unknown",
                "requested_records": requested,
                "cached_records": covered,
                "direct_reads": direct_reads,
                "refresh_scheduled": False,
            }

    def inventory_context(
        self,
        query: str = "",
        record_types: Optional[list[str]] = None,
        include_relations: bool = True,
        offset: int = 0,
        limit: int = MAX_CONTEXT_INVENTORY_ROWS,
    ) -> str:
        """Enumerate exact matching records across attached Vault sources.

        Use this for requests asking which records exist, a count, a list, all
        matches, or records of one or more types. The scan is exhaustive inside
        the attached table, active view, database group, or Vault. Results are
        canonical, type-grouped, and paginated. `record_types` accepts live
        table names or common localized labels such as sources, notes, articles,
        tasks, projects, and areas. An empty query lists every record in scope.
        Set `include_relations` to false when the request asks for a literal
        occurrence rather than records conceptually related through links.
        """
        bounded_query = " ".join(str(query or "").split())[:MAX_CONTEXT_INVENTORY_QUERY_CHARS]
        root = _vault_root()
        _literal, semantic_terms = _inventory_query_terms(bounded_query, vault_path=root)
        authorized = [item["table"] for item in _authorized_inventory_tables(self.inventory_refs)]
        requested = self._requested_types(record_types)
        bounded_query, requested = self._dynamic_types(bounded_query, requested, authorized)
        records = _searchable_page_records(self.inventory_refs, requested_types=requested)
        documents, indexed_terms, built_at = self._cached_indexes(records)
        available, resolved, unresolved = self._table_resolution(authorized, requested)
        resolved_ids = {str(table.get("id") or "") for table in resolved}
        matches, direct_reads, covered = self._matches(
            records,
            bounded_query,
            semantic_terms,
            resolved_ids,
            requested,
            documents,
            indexed_terms,
            root,
            include_relations=include_relations,
        )
        counts_by_type, counts_by_kind = self._counts(matches)
        bounded_offset = max(0, min(int(offset), len(matches)))
        bounded_limit = max(1, min(int(limit), MAX_CONTEXT_INVENTORY_ROWS))
        page = matches[bounded_offset : bounded_offset + bounded_limit]
        for record in page:
            record.pop("score", None)
        payload = {
            "query": bounded_query,
            "query_expansion": {
                "applied": bool(semantic_terms),
                "terms": semantic_terms[:24],
                "method": (
                    "bounded_and_reviewed_semantic_vocabulary"
                    if semantic_terms
                    else "literal_tokens"
                ),
            },
            "include_relations": bool(include_relations),
            "match_semantics": (
                "all normalized query tokens must occur in canonical text, metadata, "
                "or resolved relation titles"
            ),
            "record_types_requested": requested,
            "record_types_resolved": [
                str(table.get("name") or table.get("id") or "") for table in resolved
            ],
            "record_types_unresolved": unresolved,
            "available_record_types": [
                str(table.get("name") or table.get("id") or "") for table in available
            ],
            "searched_count": len(records),
            "text_index": {
                "cached_document_count": len(documents),
                "cached_term_count": len(indexed_terms),
                "direct_body_reads": direct_reads,
                "built_at": built_at or None,
            },
            "freshness": self._freshness(len(records), covered, direct_reads),
            "matching_count": len(matches),
            "counts_by_type": counts_by_type,
            "counts_by_match_kind": counts_by_kind,
            "offset": bounded_offset,
            "limit": bounded_limit,
            "has_more": bounded_offset + len(page) < len(matches),
            "next_offset": (
                bounded_offset + len(page) if bounded_offset + len(page) < len(matches) else None
            ),
            "records": page,
        }
        return json.dumps(payload, ensure_ascii=False, default=str)


def build_inventory_context_tools(
    inventory_refs: list[dict[str, Any]],
) -> list[Any]:
    if not inventory_refs:
        return []
    handler = InventoryContextTool(inventory_refs)
    return [StructuredTool.from_function(handler.inventory_context)]
