"""Typed late-bound compatibility seam for academic connector adapters."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

import httpx

JsonMap = dict[str, Any]
Work = dict[str, Any]


class SafeGetBytes(Protocol):
    async def __call__(self, url: str, **kwargs: Any) -> tuple[bytes, str, dict[str, str]]: ...


class SafeGetJson(Protocol):
    async def __call__(self, url: str, **kwargs: Any) -> tuple[Any, str, dict[str, str]]: ...


class Searcher(Protocol):
    async def __call__(
        self,
        query: str,
        filters: JsonMap,
        limit: int,
        credential: str = "",
    ) -> list[Work]: ...


class GenericSearcher(Protocol):
    async def __call__(
        self,
        definition: JsonMap,
        query: str,
        filters: JsonMap,
        limit: int,
    ) -> list[Work]: ...


class CanonicalWork(Protocol):
    def __call__(self, provider: str, provider_id: Any, **fields: Any) -> Work: ...


class ConnectorRuntime(Protocol):
    USER_AGENT: str
    MAX_RESPONSE_BYTES: int
    MAX_REDIRECTS: int
    DEFAULT_TIMEOUT_SECONDS: float
    CONNECTOR_AUDIT_VERSION: int
    SEARCHERS: dict[str, Searcher]

    safe_get_bytes: SafeGetBytes
    safe_get_json: SafeGetJson
    search_generic_json: GenericSearcher
    canonical_work: CanonicalWork
    clean_text: Callable[[Any, int], str]
    normalize_doi: Callable[[Any], str]
    normalize_language: Callable[[Any], str]
    normalize_title: Callable[[Any], str]
    validate_public_https_url: Callable[[str], str]
    parse_safe_xml: Callable[[bytes], Any]
    parse_oai_page: Callable[[bytes, JsonMap], JsonMap]
    filter_works: Callable[[list[Work], JsonMap], list[Work]]
    _record_request: Callable[[httpx.Response], None]
    _retry_after: Callable[[httpx.Response], int | None]
    _date_parts: Callable[[Any], str]
    _authors: Callable[[Any], list[dict[str, str]]]
    _occurrence: Callable[..., list[JsonMap]]
    _location: Callable[..., list[JsonMap]]
    _filters: Callable[[JsonMap], JsonMap]
    _truthy_provider_value: Callable[[Any], bool | None]
    _matches_mandatory_concept: Callable[[Work, str], bool]
    _crossref_work: Callable[[JsonMap, str], Work]
    _xml_text: Callable[[Any, str], str]
    _xml_texts: Callable[[Any, str], list[str]]
    _openalex_work: Callable[[JsonMap], Work]
    _openalex_identifier: Callable[[Work], str]
    _semantic_scholar_work: Callable[[JsonMap], Work]
    _semantic_scholar_identifier: Callable[[Work], str]


RuntimeResolver = Callable[[], ConnectorRuntime]
_runtime_resolver: RuntimeResolver | None = None


def configure_runtime(resolver: RuntimeResolver) -> None:
    """Install the historical facade resolver once composition is complete."""
    global _runtime_resolver
    _runtime_resolver = resolver


def current_runtime() -> ConnectorRuntime:
    """Resolve current facade attributes so monkeypatch seams remain late-bound."""
    if _runtime_resolver is None:
        raise RuntimeError("Academic connector runtime has not been configured.")
    return _runtime_resolver()
