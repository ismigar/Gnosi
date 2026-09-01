"""Behavior and architecture contracts for reference metadata lookup."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.domains.vault.citations import metadata_lookup, reference_configuration


def _dependencies(
    responses: dict[str, str | None],
    calls: list[str],
) -> metadata_lookup.MetadataLookupDependencies:
    def http_get(url: str) -> str | None:
        calls.append(url)
        return responses.get(url)

    def http_get_public(url: str) -> str | None:
        calls.append(f"public:{url}")
        return responses.get(f"public:{url}")

    return metadata_lookup.MetadataLookupDependencies(
        normalize_doi=lambda raw: raw.removeprefix("doi:") if raw.startswith("doi:") else None,
        normalize_arxiv=lambda raw: (
            raw.removeprefix("arxiv:") if raw.startswith("arxiv:") else None
        ),
        normalize_pmid=lambda raw: raw.removeprefix("pmid:") if raw.startswith("pmid:") else None,
        normalize_isbn=lambda raw: raw.removeprefix("isbn:") if raw.startswith("isbn:") else None,
        http_get=http_get,
        http_get_public=http_get_public,
        crossref_to_metadata=lambda work: {"Title": work["title"]},
        arxiv_to_metadata=lambda body: {"Title": body},
        pubmed_to_metadata=lambda document: {"Title": document["title"]},
        openlibrary_to_metadata=lambda book: {"Title": book["title"]},
        html_to_metadata=lambda body, url: {"Title": body, "URL": url},
        inject_citation_key=lambda metadata: {**metadata, "Citation Key": "stable-key"},
        normalize_item_type=lambda metadata: {**metadata, "Item Type": "document"},
    )


def test_lookup_preserves_identifier_priority_and_normalizes_suggestion() -> None:
    calls: list[str] = []
    doi_url = "https://api.crossref.org/works/10.1/example"
    dependencies = _dependencies(
        {doi_url: json.dumps({"message": {"title": "CrossRef title"}})},
        calls,
    )

    result = asyncio.run(
        metadata_lookup.resolve_metadata(
            {
                "doi": "doi:10.1/example",
                "arxiv": "arxiv:2401.00001",
                "pmid": "pmid:123",
                "isbn": "isbn:9780000000000",
            },
            dependencies,
        )
    )

    assert result == {
        "source": "crossref",
        "identifier": "10.1/example",
        "suggested": {
            "Title": "CrossRef title",
            "Citation Key": "stable-key",
            "Item Type": "document",
        },
        "error": None,
    }
    assert calls == [doi_url]


def test_lookup_uses_ssrf_hardened_port_for_user_url() -> None:
    calls: list[str] = []
    url = "https://example.test/article"
    dependencies = _dependencies({f"public:{url}": "HTML title"}, calls)

    result = asyncio.run(metadata_lookup.resolve_metadata({"url": url}, dependencies))

    assert result["source"] == "url"
    assert result["identifier"] == url
    assert result["suggested"]["URL"] == url
    assert calls == [f"public:{url}"]


def test_lookup_returns_provider_specific_error_for_malformed_response() -> None:
    calls: list[str] = []
    doi_url = "https://api.crossref.org/works/10.1/broken"
    dependencies = _dependencies({doi_url: "not-json"}, calls)

    result = asyncio.run(metadata_lookup.resolve_metadata({"doi": "doi:10.1/broken"}, dependencies))

    assert result == {
        "source": "crossref",
        "identifier": "10.1/broken",
        "suggested": {},
        "error": "CrossRef returned no valid data",
    }


def test_lookup_rejects_payload_without_supported_identifier() -> None:
    result = asyncio.run(metadata_lookup.resolve_metadata({}, _dependencies({}, [])))

    assert result["source"] is None
    assert result["identifier"] is None
    assert result["suggested"] == {}
    assert result["error"] == "No valid identifier (DOI/arXiv/PMID/ISBN/URL)"


def test_metadata_lookup_domain_does_not_import_http_facade() -> None:
    for module in (metadata_lookup, reference_configuration):
        source_path = Path(module.__file__ or "")
        assert source_path.is_file()
        assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
