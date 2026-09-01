"""Crossref and DataCite provider adapters."""

from __future__ import annotations

import asyncio
from typing import Any

from backend.domains.literature.connectors.normalization import (
    _authors,
    _date_parts,
    _filters,
    _location,
    _occurrence,
)
from backend.domains.literature.connectors.runtime import current_runtime
from backend.services.literature_models import canonical_work, normalize_doi


def _crossref_work(item: dict[str, Any], provider: str = "crossref") -> dict[str, Any]:
    doi = normalize_doi(item.get("DOI"))
    licenses = item.get("license") or []
    links = item.get("link") or []
    oa = bool(licenses)
    locations = _location(
        item.get("URL"),
        pdf_url=next(
            (
                link.get("URL")
                for link in links
                if isinstance(link, dict) and "pdf" in str(link.get("content-type", ""))
            ),
            "",
        ),
        is_oa=oa,
        license_value=(licenses[0].get("URL") if licenses else ""),
    )
    citations = item.get("is-referenced-by-count")
    return current_runtime().canonical_work(
        provider,
        doi or item.get("URL"),
        title=((item.get("title") or [""])[0]),
        authors=_authors(item.get("author")),
        dates={
            "issued": _date_parts((item.get("issued") or {}).get("date-parts")),
            "online": _date_parts((item.get("published-online") or {}).get("date-parts")),
            "print": _date_parts((item.get("published-print") or {}).get("date-parts")),
        },
        year=_date_parts((item.get("issued") or {}).get("date-parts")),
        abstract=item.get("abstract"),
        type=item.get("type") or "other",
        publication={
            "container_title": ((item.get("container-title") or [""])[0]),
            "publisher": item.get("publisher") or "",
            "volume": item.get("volume") or "",
            "issue": item.get("issue") or "",
            "pages": item.get("page") or "",
        },
        language=item.get("language"),
        identifiers={"doi": doi, "isbn13": item.get("ISBN") or [], "provider": {}},
        open_access={
            "is_oa": oa,
            "license": (licenses[0].get("URL") if licenses else ""),
            "best_location": locations[0] if locations else None,
        },
        locations=locations,
        sources=_occurrence(provider, doi or item.get("URL"), item.get("URL"), citations=citations),
        metrics={"citations": {provider: citations} if citations is not None else {}},
    )


async def search_crossref(
    query: str, filters: dict[str, Any], limit: int, contact_email: str = ""
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "query.bibliographic": query,
        "rows": limit,
        "select": "DOI,title,author,issued,published-online,published-print,abstract,type,container-title,publisher,volume,issue,page,URL,is-referenced-by-count,license,link",
    }
    range_filters: list[str] = []
    if _filters(filters).get("date_from"):
        range_filters.append(f"from-pub-date:{filters['date_from']}")
    if _filters(filters).get("date_to"):
        range_filters.append(f"until-pub-date:{filters['date_to']}")
    if range_filters:
        params["filter"] = ",".join(range_filters)
    if contact_email:
        params["mailto"] = contact_email
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.crossref.org/works", params=params
    )
    return [_crossref_work(item) for item in (data.get("message") or {}).get("items") or []]


async def search_scielo_articles(
    query: str, filters: dict[str, Any], limit: int, contact_email: str = ""
) -> list[dict[str, Any]]:
    """Search SciELO deposits through the authorized Crossref member endpoints."""
    per_member = max(1, min(limit, 100))
    params: dict[str, Any] = {
        "query.bibliographic": query,
        "rows": per_member,
        "select": "DOI,title,author,issued,published-online,published-print,abstract,type,container-title,publisher,volume,issue,page,URL,is-referenced-by-count,license,link",
    }
    range_filters: list[str] = []
    if filters.get("date_from"):
        range_filters.append(f"from-pub-date:{filters['date_from']}")
    if filters.get("date_to"):
        range_filters.append(f"until-pub-date:{filters['date_to']}")
    if range_filters:
        params["filter"] = ",".join(range_filters)
    if contact_email:
        params["mailto"] = contact_email
    responses = await asyncio.gather(
        *(
            current_runtime().safe_get_json(
                f"https://api.crossref.org/members/{member_id}/works", params=params
            )
            for member_id in (530, 2516, 2868)
        )
    )
    works = [
        _crossref_work(item, "scielo-articles")
        for data, _final_url, _response_headers in responses
        for item in (data.get("message") or {}).get("items") or []
    ]
    return works[:limit]


async def search_datacite(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"query": query, "page[size]": limit}
    if filters.get("date_from") or filters.get("date_to"):
        year_from = str(filters.get("date_from") or "1500")[:4]
        year_to = str(filters.get("date_to") or "2100")[:4]
        params["query"] = f"({query}) AND publicationYear:[{year_from} TO {year_to}]"
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.datacite.org/dois", params=params
    )
    works = []
    for row in data.get("data") or []:
        attrs = row.get("attributes") or {}
        doi = normalize_doi(attrs.get("doi") or row.get("id"))
        titles = attrs.get("titles") or []
        descriptions = attrs.get("descriptions") or []
        creators = attrs.get("creators") or []
        url = attrs.get("url") or f"https://doi.org/{doi}"
        rights = attrs.get("rightsList") or []
        oa = any(
            "open" in str(item.get("rights", "")).lower()
            or str(item.get("rightsUri", "")).startswith("https://creativecommons.org")
            for item in rights
            if isinstance(item, dict)
        )
        works.append(
            canonical_work(
                "datacite",
                doi or row.get("id"),
                title=(titles[0].get("title") if titles else ""),
                authors=[
                    {
                        "given": item.get("givenName"),
                        "family": item.get("familyName"),
                        "literal": item.get("name"),
                        "orcid": next(
                            (
                                identifier.get("nameIdentifier", "")
                                for identifier in item.get("nameIdentifiers") or []
                                if "orcid"
                                in str(identifier.get("nameIdentifierScheme", "")).lower()
                            ),
                            "",
                        ),
                    }
                    for item in creators
                ],
                dates={
                    "issued": attrs.get("published") or attrs.get("publicationYear") or "",
                    "online": "",
                    "print": "",
                },
                year=attrs.get("publicationYear"),
                abstract=next(
                    (
                        item.get("description")
                        for item in descriptions
                        if item.get("descriptionType") == "Abstract"
                    ),
                    "",
                ),
                type=(attrs.get("types") or {}).get("resourceTypeGeneral") or "other",
                publication={
                    "container_title": attrs.get("container", {}).get("title", "")
                    if isinstance(attrs.get("container"), dict)
                    else "",
                    "publisher": attrs.get("publisher") or "",
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                language=attrs.get("language"),
                identifiers={"doi": doi, "isbn13": [], "provider": {}},
                open_access={
                    "is_oa": oa,
                    "license": (rights[0].get("rightsUri") if rights else ""),
                    "best_location": _location(
                        url, is_oa=oa, license_value=(rights[0].get("rightsUri") if rights else "")
                    )[0],
                },
                locations=_location(
                    url, is_oa=oa, license_value=(rights[0].get("rightsUri") if rights else "")
                ),
                sources=_occurrence("datacite", doi or row.get("id"), url),
            )
        )
    return works
