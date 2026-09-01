"""Compatibility contract for the typed academic connector domain."""

from __future__ import annotations

import asyncio
import inspect
from pathlib import Path
from typing import Any

import pytest

from backend.domains.literature.connectors import dispatcher, generic, transport
from backend.services import academic_connectors
from backend.services.literature_models import canonical_work

EXPECTED_SEARCHERS = {
    "arxiv": "search_arxiv",
    "core": "search_core",
    "crossref": "search_crossref",
    "datacite": "search_datacite",
    "dimensions": "search_dimensions",
    "doaj-articles": "search_doaj",
    "eric": "search_eric",
    "europe-pmc": "search_europe_pmc",
    "hal": "search_hal",
    "open-library": "search_open_library",
    "openaire": "search_openaire",
    "openalex": "search_openalex",
    "pubmed": "search_pubmed",
    "scielo-articles": "search_scielo_articles",
    "scopus": "search_scopus",
    "semantic-scholar": "search_semantic_scholar",
    "springer-nature": "search_springer_nature",
    "web-of-science": "search_web_of_science",
}

EXPECTED_SIGNATURES = {
    "safe_get_bytes": (
        "(url: 'str', *, params: 'dict[str, Any] | None' = None, "
        "headers: 'dict[str, str] | None' = None, accepted_types: 'tuple[str, ...]' = "
        "('application/json', 'application/xml', 'text/xml', 'application/atom+xml', "
        "'text/plain'), max_bytes: 'int' = 8388608) -> "
        "'tuple[bytes, str, dict[str, str]]'"
    ),
    "search_generic_json": (
        "(definition: 'dict[str, Any]', query: 'str', filters: 'dict[str, Any]', "
        "limit: 'int') -> 'list[dict[str, Any]]'"
    ),
    "search_source": (
        "(source_id: 'str', query: 'str', filters: 'dict[str, Any]', limit: 'int', "
        "credential: 'str' = '', definition: 'dict[str, Any] | None' = None) -> "
        "'list[dict[str, Any]]'"
    ),
    "fetch_oai_page": (
        "(source: 'dict[str, Any]', *, resumption_token: 'str' = '', "
        "from_date: 'str' = '') -> 'dict[str, Any]'"
    ),
}


def test_facade_exports_canonical_domain_functions_and_signatures() -> None:
    assert academic_connectors.ConnectorError is transport.ConnectorError
    assert academic_connectors.search_generic_json is generic.search_generic_json
    assert academic_connectors.search_source is dispatcher.search_source
    assert {
        source_id: searcher.__name__
        for source_id, searcher in academic_connectors.SEARCHERS.items()
    } == EXPECTED_SEARCHERS
    for name, expected in EXPECTED_SIGNATURES.items():
        assert str(inspect.signature(getattr(academic_connectors, name))) == expected


def test_safe_json_keeps_late_bound_transport_seam(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_get_bytes(url: str, **kwargs: Any) -> tuple[bytes, str, dict[str, str]]:
        calls.append((url, kwargs))
        return b'{"ok": true}', url, {"content-type": "application/json"}

    monkeypatch.setattr(academic_connectors, "safe_get_bytes", fake_get_bytes)

    payload, final_url, headers = asyncio.run(
        academic_connectors.safe_get_json("https://repository.example/items", params={"q": "x"})
    )

    assert payload == {"ok": True}
    assert final_url == "https://repository.example/items"
    assert headers == {"content-type": "application/json"}
    assert calls[0][1]["params"] == {"q": "x"}


def test_dispatch_keeps_late_bound_searcher_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_searcher(
        query: str,
        filters: dict[str, Any],
        limit: int,
        credential: str = "",
    ) -> list[dict[str, Any]]:
        assert (query, filters, limit, credential) == ("evidence", {}, 1, "configured")
        return [canonical_work("fixture", "one", title="Evidence")]

    monkeypatch.setattr(academic_connectors, "SEARCHERS", {"fixture": fake_searcher})

    works = asyncio.run(
        academic_connectors.search_source("fixture", "evidence", {}, 1, "configured")
    )

    assert [work["title"] for work in works] == ["Evidence"]


def test_connector_modules_stay_below_the_source_limit() -> None:
    root = Path(__file__).parents[1] / "domains" / "literature" / "connectors"
    modules = sorted(root.glob("*.py"))
    assert modules
    assert max(len(path.read_text(encoding="utf-8").splitlines()) for path in modules) <= 800
    assert all(
        "backend.services import academic_connectors" not in path.read_text(encoding="utf-8")
        for path in modules
    )
