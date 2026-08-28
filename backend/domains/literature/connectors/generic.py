"""Declarative custom JSON repository adapter."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

from backend.domains.literature.connectors.normalization import (
    _location,
    _occurrence,
    _truthy_provider_value,
)
from backend.domains.literature.connectors.runtime import current_runtime
from backend.domains.literature.connectors.transport import ConnectorError
from backend.services.literature_models import clean_text

JsonMap = dict[str, Any]


@dataclass
class _PaginationState:
    base_url: str
    base_params: JsonMap
    pagination: str
    final_url: str
    next_url: str
    page: int = 1
    offset: int = 0
    cursor: str = ""


def _value_at_path(record: Any, path: Any, default: Any = "") -> Any:
    value = record
    for part in str(path or "").split("."):
        if part:
            value = value.get(part) if isinstance(value, dict) else default
    return value if value is not None else default


def _initial_state(definition: JsonMap, query: str) -> _PaginationState:
    runtime = current_runtime()
    base_url = runtime.validate_public_https_url(str(definition.get("base_url") or ""))
    query_parameter = clean_text(definition.get("query_parameter") or "q", 100)
    raw_static_filters = definition.get("static_filters")
    static_filters = raw_static_filters if isinstance(raw_static_filters, dict) else {}
    base_params = {
        str(key)[:100]: clean_text(value, 1_000) for key, value in static_filters.items()
    }
    base_params[query_parameter] = query
    return _PaginationState(
        base_url=base_url,
        base_params=base_params,
        pagination=str(definition.get("pagination") or "none"),
        final_url=base_url,
        next_url=base_url,
    )


def _request_params(definition: JsonMap, state: _PaginationState, remaining: int) -> JsonMap:
    params = dict(state.base_params) if state.next_url == state.base_url else {}
    params[clean_text(definition.get("limit_parameter") or "limit", 100)] = remaining
    if state.pagination == "page":
        params[clean_text(definition.get("page_parameter") or "page", 100)] = state.page
    elif state.pagination == "offset":
        params[clean_text(definition.get("offset_parameter") or "offset", 100)] = state.offset
    elif state.pagination == "cursor" and state.cursor:
        params[clean_text(definition.get("cursor_parameter") or "cursor", 100)] = state.cursor
    return params


def _next_link(response_headers: dict[str, str]) -> str:
    link_header = str(response_headers.get("link") or response_headers.get("Link") or "")
    match = next(
        (
            candidate
            for candidate in re.finditer(r'<([^>]+)>\s*;\s*rel="?([^",;]+)"?', link_header)
            if candidate.group(2).strip().lower() == "next"
        ),
        None,
    )
    return match.group(1) if match is not None else ""


def _advance_pagination(
    definition: JsonMap,
    state: _PaginationState,
    data: Any,
    response_headers: dict[str, str],
    record_count: int,
) -> bool:
    if state.pagination == "page":
        state.page += 1
        return True
    if state.pagination == "offset":
        state.offset += record_count
        return True
    if state.pagination == "cursor":
        next_cursor = _value_at_path(data, definition.get("next_cursor_path") or "next_cursor", "")
        if not next_cursor or str(next_cursor) == state.cursor:
            return False
        state.cursor = clean_text(next_cursor, 2_000)
        return True
    if state.pagination == "link":
        next_link = _next_link(response_headers)
        if not next_link:
            return False
        state.next_url = current_runtime().validate_public_https_url(
            urljoin(state.final_url, next_link)
        )
        state.base_params = {}
    return True


async def _collect_records(definition: JsonMap, query: str, limit: int) -> tuple[list[Any], str]:
    state = _initial_state(definition, query)
    collected: list[Any] = []
    for _page_index in range(10):
        remaining = limit - len(collected)
        if remaining <= 0:
            break
        data, state.final_url, response_headers = await current_runtime().safe_get_json(
            state.next_url,
            params=_request_params(definition, state, remaining),
        )
        records = _value_at_path(data, definition.get("results_path") or "results", [])
        if not isinstance(records, list):
            raise ConnectorError("The configured results path does not resolve to a JSON list.")
        collected.extend(records[:remaining])
        if state.pagination == "none" or not records or len(collected) >= limit:
            break
        if not _advance_pagination(definition, state, data, response_headers, len(records)):
            break
    return collected, state.final_url


def _mapped_work(
    record: Any,
    mapping: JsonMap,
    provider: str,
    final_url: str,
) -> JsonMap:
    def value_at(path: Any, default: Any = "") -> Any:
        return _value_at_path(record, path, default)

    provider_id = value_at(mapping.get("provider_id") or mapping.get("id")) or value_at(
        mapping.get("doi")
    )
    url = value_at(mapping.get("url")) or final_url
    citations = value_at(mapping.get("citations"), None)
    is_oa = value_at(mapping.get("is_oa"), None)
    license_value = value_at(mapping.get("license"))
    locations = _location(
        url,
        pdf_url=value_at(mapping.get("pdf_url")),
        is_oa=is_oa,
        license_value=license_value,
    )
    return dict(
        current_runtime().canonical_work(
            provider,
            provider_id,
            title=value_at(mapping.get("title")),
            authors=value_at(mapping.get("authors"), []),
            dates={"issued": value_at(mapping.get("date")), "online": "", "print": ""},
            year=value_at(mapping.get("year")) or value_at(mapping.get("date")),
            abstract=value_at(mapping.get("abstract")),
            type=value_at(mapping.get("type"), "other"),
            publication={
                "container_title": value_at(mapping.get("container") or mapping.get("publication")),
                "publisher": value_at(mapping.get("publisher")),
                "volume": value_at(mapping.get("volume")),
                "issue": value_at(mapping.get("issue")),
                "pages": value_at(mapping.get("pages")),
            },
            language=value_at(mapping.get("language")),
            identifiers={
                "doi": value_at(mapping.get("doi")),
                "pmid": value_at(mapping.get("pmid")),
                "pmcid": value_at(mapping.get("pmcid")),
                "arxiv": value_at(mapping.get("arxiv")),
                "isbn13": value_at(mapping.get("isbn") or mapping.get("isbn13"), []),
                "provider": {},
            },
            peer_reviewed=_truthy_provider_value(value_at(mapping.get("peer_reviewed"), None)),
            open_access={
                "is_oa": is_oa,
                "license": license_value,
                "best_location": locations[0],
            },
            locations=locations,
            sources=_occurrence(provider, provider_id, url, citations=citations),
            metrics={"citations": {provider: citations} if citations not in (None, "") else {}},
        )
    )


async def search_generic_json(
    definition: dict[str, Any], query: str, filters: dict[str, Any], limit: int
) -> list[dict[str, Any]]:
    """Execute one bounded declarative GET/JSON repository definition."""
    collected, final_url = await _collect_records(definition, query, limit)
    raw_mapping = definition.get("mapping")
    mapping = raw_mapping if isinstance(raw_mapping, dict) else {}
    provider = clean_text(definition.get("id") or definition.get("name") or "custom-rest", 100)
    return [_mapped_work(record, mapping, provider, final_url) for record in collected[:limit]]
