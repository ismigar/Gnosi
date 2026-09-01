"""OpenAlex and Semantic Scholar graph adapters."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from backend.domains.literature.connectors.normalization import _location, _occurrence
from backend.domains.literature.connectors.runtime import current_runtime
from backend.domains.literature.connectors.transport import ConnectorError


def _openalex_work(item: dict[str, Any]) -> dict[str, Any]:
    primary = item.get("primary_location") or {}
    source = primary.get("source") or {}
    url = primary.get("landing_page_url") or item.get("id")
    pdf = primary.get("pdf_url") or ""
    oa = bool((item.get("open_access") or {}).get("is_oa"))
    citations = item.get("cited_by_count")
    return current_runtime().canonical_work(
        "openalex",
        item.get("id"),
        title=item.get("display_name"),
        authors=[
            {
                "literal": (entry.get("author") or {}).get("display_name"),
                "orcid": (entry.get("author") or {}).get("orcid"),
            }
            for entry in item.get("authorships") or []
        ],
        dates={
            "issued": item.get("publication_date") or "",
            "online": item.get("publication_date") or "",
            "print": "",
        },
        year=item.get("publication_year"),
        type=item.get("type") or "other",
        publication={
            "container_title": source.get("display_name") or "",
            "publisher": source.get("host_organization_name") or "",
            "volume": item.get("biblio", {}).get("volume", ""),
            "issue": item.get("biblio", {}).get("issue", ""),
            "pages": item.get("biblio", {}).get("first_page", ""),
        },
        language=item.get("language"),
        identifiers={
            "doi": (item.get("ids") or {}).get("doi"),
            "pmid": (item.get("ids") or {}).get("pmid"),
            "pmcid": (item.get("ids") or {}).get("pmcid"),
            "isbn13": [],
            "provider": {},
        },
        open_access={
            "is_oa": oa,
            "license": primary.get("license") or "",
            "best_location": _location(
                url, pdf_url=pdf, is_oa=oa, license_value=primary.get("license")
            )[0],
        },
        locations=_location(url, pdf_url=pdf, is_oa=oa, license_value=primary.get("license")),
        sources=_occurrence("openalex", item.get("id"), url, citations=citations),
        metrics={"citations": {"openalex": citations} if citations is not None else {}},
    )


async def search_openalex(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"search": query, "per-page": limit}
    if api_key:
        params["api_key"] = api_key
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.openalex.org/works", params=params
    )
    return [_openalex_work(item) for item in data.get("results") or []]


def _openalex_identifier(work: dict[str, Any]) -> str:
    raw_identifiers = work.get("identifiers")
    identifiers = raw_identifiers if isinstance(raw_identifiers, dict) else {}
    raw_providers = identifiers.get("provider")
    providers = raw_providers if isinstance(raw_providers, dict) else {}
    provider_id = str(providers.get("openalex") or "")
    if provider_id:
        return provider_id.rsplit("/", 1)[-1]
    if identifiers.get("doi"):
        return f"doi:{identifiers['doi']}"
    return ""


async def openalex_neighbors(
    seeds: list[dict[str, Any]],
    direction: str,
    limit: int,
    api_key: str,
) -> list[dict[str, Any]]:
    """Retrieve real citation neighbors through the documented OpenAlex graph fields."""
    if not api_key:
        raise ConnectorError("Configure an OpenAlex API key to retrieve citation neighbors.")
    if direction not in {"backward", "forward"}:
        raise ConnectorError("Citation direction must be backward or forward.")
    neighbors: list[dict[str, Any]] = []
    per_seed = max(1, min(int(limit), 100))
    for seed in seeds[:20]:
        identifier = _openalex_identifier(seed)
        if not identifier:
            continue
        seed_data, _final_url, _response_headers = await current_runtime().safe_get_json(
            f"https://api.openalex.org/works/{quote(identifier, safe=':')}",
            params={"api_key": api_key},
        )
        openalex_id = str(seed_data.get("id") or "").rsplit("/", 1)[-1]
        if not openalex_id:
            continue
        if direction == "forward":
            data, _final_url, _response_headers = await current_runtime().safe_get_json(
                "https://api.openalex.org/works",
                params={
                    "filter": f"cites:{openalex_id}",
                    "sort": "-publication_date",
                    "per_page": per_seed,
                    "api_key": api_key,
                },
            )
            neighbors.extend(_openalex_work(item) for item in data.get("results") or [])
        else:
            reference_ids = [
                str(value).rsplit("/", 1)[-1]
                for value in seed_data.get("referenced_works") or []
                if value
            ]
            for start in range(0, min(len(reference_ids), per_seed), 100):
                batch = reference_ids[start : start + 100]
                if not batch:
                    continue
                data, _final_url, _response_headers = await current_runtime().safe_get_json(
                    "https://api.openalex.org/works",
                    params={
                        "filter": f"openalex:{'|'.join(batch)}",
                        "per_page": len(batch),
                        "api_key": api_key,
                    },
                )
                neighbors.extend(_openalex_work(item) for item in data.get("results") or [])
        if len(neighbors) >= 500:
            break
    return neighbors[:500]


def _semantic_scholar_work(item: dict[str, Any]) -> dict[str, Any]:
    external = item.get("externalIds") or {}
    oa_pdf = item.get("openAccessPdf") or {}
    citations = item.get("citationCount")
    locations = _location(
        item.get("url"),
        pdf_url=oa_pdf.get("url"),
        is_oa=bool(oa_pdf.get("url")),
        license_value=oa_pdf.get("license"),
    )
    return current_runtime().canonical_work(
        "semantic-scholar",
        item.get("paperId"),
        title=item.get("title"),
        authors=[{"literal": author.get("name")} for author in item.get("authors") or []],
        dates={
            "issued": item.get("publicationDate") or item.get("year") or "",
            "online": item.get("publicationDate") or "",
            "print": "",
        },
        year=item.get("year"),
        abstract=item.get("abstract"),
        type=((item.get("publicationTypes") or ["other"])[0]),
        publication={
            "container_title": item.get("venue") or "",
            "publisher": "",
            "volume": "",
            "issue": "",
            "pages": "",
        },
        identifiers={
            "doi": external.get("DOI"),
            "pmid": external.get("PubMed"),
            "pmcid": external.get("PubMedCentral"),
            "arxiv": external.get("ArXiv"),
            "isbn13": [],
            "provider": {},
        },
        open_access={
            "is_oa": bool(oa_pdf.get("url")),
            "license": oa_pdf.get("license") or "",
            "best_location": locations[0] if locations else None,
        },
        locations=locations,
        sources=_occurrence(
            "semantic-scholar", item.get("paperId"), item.get("url"), citations=citations
        ),
        metrics={"citations": {"semantic-scholar": citations} if citations is not None else {}},
    )


async def search_semantic_scholar(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    headers = {"x-api-key": api_key} if api_key else {}
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={
            "query": query,
            "limit": min(limit, 100),
            "fields": "paperId,title,abstract,year,authors,venue,publicationTypes,publicationDate,externalIds,url,openAccessPdf,citationCount",
        },
        headers=headers,
    )
    return [_semantic_scholar_work(item) for item in data.get("data") or []]


def _semantic_scholar_identifier(work: dict[str, Any]) -> str:
    raw_identifiers = work.get("identifiers")
    identifiers = raw_identifiers if isinstance(raw_identifiers, dict) else {}
    raw_providers = identifiers.get("provider")
    providers = raw_providers if isinstance(raw_providers, dict) else {}
    semantic_id = providers.get("semantic-scholar")
    if semantic_id:
        return str(semantic_id)
    for prefix, key in (("DOI", "doi"), ("PMID", "pmid"), ("PMCID", "pmcid"), ("ARXIV", "arxiv")):
        if identifiers.get(key):
            return f"{prefix}:{identifiers[key]}"
    return ""


async def semantic_scholar_neighbors(
    seeds: list[dict[str, Any]],
    direction: str,
    limit: int,
    api_key: str,
) -> list[dict[str, Any]]:
    """Retrieve real backward or forward citation neighbors for canonical seeds."""
    if not api_key:
        raise ConnectorError("Configure a Semantic Scholar API key to retrieve citation neighbors.")
    if direction not in {"backward", "forward"}:
        raise ConnectorError("Citation direction must be backward or forward.")
    relation = "references" if direction == "backward" else "citations"
    paper_field = "citedPaper" if direction == "backward" else "citingPaper"
    fields = "paperId,title,abstract,year,authors,venue,publicationTypes,publicationDate,externalIds,url,openAccessPdf,citationCount"
    headers = {"x-api-key": api_key}
    neighbors: list[dict[str, Any]] = []
    per_seed = max(1, min(int(limit), 100))
    for seed in seeds[:20]:
        identifier = _semantic_scholar_identifier(seed)
        if not identifier:
            continue
        data, _final_url, _response_headers = await current_runtime().safe_get_json(
            f"https://api.semanticscholar.org/graph/v1/paper/{quote(identifier, safe='')}/{relation}",
            params={"offset": 0, "limit": per_seed, "fields": fields},
            headers=headers,
        )
        for relation_row in data.get("data") or []:
            paper = relation_row.get(paper_field) if isinstance(relation_row, dict) else None
            if isinstance(paper, dict) and paper.get("title"):
                neighbors.append(_semantic_scholar_work(paper))
        if len(neighbors) >= 500:
            break
    return neighbors[:500]
