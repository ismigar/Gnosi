"""Connector dispatch, enrichment, and worker bridging."""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote

from backend.domains.literature.connectors.commercial import (
    search_dimensions,
    search_scopus,
    search_springer_nature,
    search_web_of_science,
)
from backend.domains.literature.connectors.crossref import (
    search_crossref,
    search_datacite,
    search_scielo_articles,
)
from backend.domains.literature.connectors.graphs import (
    search_openalex,
    search_semantic_scholar,
)
from backend.domains.literature.connectors.public import (
    search_core,
    search_doaj,
    search_eric,
    search_europe_pmc,
    search_hal,
    search_open_library,
    search_openaire,
    search_pubmed,
)
from backend.domains.literature.connectors.runtime import current_runtime
from backend.domains.literature.connectors.transport import ConnectorError
from backend.domains.literature.connectors.xml import search_arxiv

SEARCHERS = {
    "crossref": search_crossref,
    "datacite": search_datacite,
    "arxiv": search_arxiv,
    "europe-pmc": search_europe_pmc,
    "eric": search_eric,
    "openaire": search_openaire,
    "hal": search_hal,
    "core": search_core,
    "open-library": search_open_library,
    "scielo-articles": search_scielo_articles,
    "doaj-articles": search_doaj,
    "pubmed": search_pubmed,
    "openalex": search_openalex,
    "semantic-scholar": search_semantic_scholar,
    "springer-nature": search_springer_nature,
    "scopus": search_scopus,
    "web-of-science": search_web_of_science,
    "dimensions": search_dimensions,
}


async def search_source(
    source_id: str,
    query: str,
    filters: dict[str, Any],
    limit: int,
    credential: str = "",
    definition: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Dispatch a built-in or custom REST connector."""
    requested_limit = max(1, min(int(limit), 100))
    has_language_filter = bool(filters.get("languages") or filters.get("language"))
    fetch_limit = min(100, requested_limit * 4) if has_language_filter else requested_limit
    runtime = current_runtime()
    if definition and definition.get("kind") == "rest":
        works = await runtime.search_generic_json(definition, query, filters, fetch_limit)
        return runtime.filter_works(
            [work for work in works if runtime._matches_mandatory_concept(work, query)],
            filters,
        )[:requested_limit]
    searcher = runtime.SEARCHERS.get(source_id)
    if searcher is None:
        raise ConnectorError("This source requires a local index or a configured provider adapter.")
    works = await searcher(query, filters, fetch_limit, credential)
    works = [work for work in works if runtime._matches_mandatory_concept(work, query)]
    return runtime.filter_works(works, filters)[:requested_limit]


async def enrich_unpaywall(work: dict[str, Any], email: str) -> dict[str, Any]:
    """Add only verified Unpaywall OA locations to one DOI-bearing work."""
    runtime = current_runtime()
    doi = runtime.normalize_doi((work.get("identifiers") or {}).get("doi"))
    if not doi or not email:
        return work
    data, _final_url, _response_headers = await runtime.safe_get_json(
        f"https://api.unpaywall.org/v2/{quote(doi, safe='')}",
        params={"email": email},
    )
    best = data.get("best_oa_location") or {}
    locations = []
    for item in data.get("oa_locations") or []:
        if not isinstance(item, dict):
            continue
        locations.extend(
            runtime._location(
                item.get("url_for_landing_page") or item.get("url"),
                pdf_url=item.get("url_for_pdf"),
                is_oa=True,
                license_value=item.get("license"),
            )
        )
    if locations:
        work["locations"] = work.get("locations", []) + locations
        work["open_access"] = {
            "is_oa": bool(data.get("is_oa")),
            "license": best.get("license") or "",
            "best_location": (
                runtime._location(
                    best.get("url_for_landing_page") or best.get("url"),
                    pdf_url=best.get("url_for_pdf"),
                    is_oa=True,
                    license_value=best.get("license"),
                )[0]
                if best
                else locations[0]
            ),
        }
        work.setdefault("provenance", {}).setdefault("open_access", []).append("unpaywall")
    return work


def run(coroutine: Any) -> Any:
    """Execute one connector coroutine from a durable worker thread."""
    return asyncio.run(coroutine)
