"""Credentialed commercial academic provider adapters."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.domains.literature.connectors.normalization import _location, _occurrence
from backend.domains.literature.connectors.runtime import current_runtime
from backend.domains.literature.connectors.transport import ConnectorError
from backend.services.literature_models import canonical_work, normalize_doi


async def search_springer_nature(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    if not api_key:
        raise ConnectorError("Springer Nature requires an API key.")
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        date_from = filters.get("date_from") or "1800"
        date_to = filters.get("date_to") or datetime.now(timezone.utc).strftime("%Y")
        expression += f" date:{date_from}-{date_to}"
    params = {"q": expression, "api_key": api_key, "p": min(limit, 50)}
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.springernature.com/meta/v2/json", params=params
    )
    works = []
    for item in data.get("records") or []:
        identifier = item.get("identifier") or item.get("doi") or ""
        doi = normalize_doi(item.get("doi") or identifier)
        title = item.get("title")
        creators = item.get("creators") or []
        authors = [
            {"literal": c.get("creator")}
            for c in creators
            if isinstance(c, dict) and c.get("creator")
        ]
        abstract = item.get("abstract")
        publication_name = item.get("publicationName") or ""
        publisher = item.get("publisher") or "Springer Nature"
        pub_date = (
            item.get("publicationDate") or item.get("onlineDate") or item.get("printDate") or ""
        )
        year = (
            int(pub_date[:4])
            if pub_date and len(pub_date) >= 4 and pub_date[:4].isdigit()
            else None
        )
        urls = item.get("url") or []
        display_url = ""
        pdf_url = ""
        if isinstance(urls, list):
            for u in urls:
                if isinstance(u, dict):
                    format_type = u.get("format", "").lower()
                    u_val = u.get("value", "")
                    if format_type == "pdf":
                        pdf_url = u_val
                    elif format_type == "html" or not display_url:
                        display_url = u_val
                elif isinstance(u, str) and not display_url:
                    display_url = u
        if not display_url and doi:
            display_url = f"https://doi.org/{doi}"
        is_oa = item.get("openaccess") == "true" or item.get("genre") == "Open Access"
        genre = item.get("contentType") or item.get("genre") or "article"
        works.append(
            canonical_work(
                "springer-nature",
                identifier or doi or display_url,
                title=title,
                authors=authors,
                dates={
                    "issued": pub_date,
                    "online": item.get("onlineDate", ""),
                    "print": item.get("printDate", ""),
                },
                year=year,
                abstract=abstract,
                type=genre,
                publication={
                    "container_title": publication_name,
                    "publisher": publisher,
                    "volume": item.get("volume", ""),
                    "issue": item.get("number", ""),
                    "pages": item.get("startingPage", ""),
                },
                identifiers={"doi": doi, "isbn13": [], "provider": {"springer_id": identifier}},
                open_access={
                    "is_oa": is_oa,
                    "license": "",
                    "best_location": _location(display_url, pdf_url=pdf_url, is_oa=is_oa)[0],
                },
                locations=_location(display_url, pdf_url=pdf_url, is_oa=is_oa),
                sources=_occurrence("springer-nature", identifier or doi, display_url),
            )
        )
    return works


async def search_scopus(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    if not api_key:
        raise ConnectorError("Scopus requires an API key.")
    headers = {"X-ELS-APIKey": api_key, "Accept": "application/json"}
    params: dict[str, Any] = {"query": f"TITLE-ABS-KEY({query})", "count": min(limit, 25)}
    if filters.get("date_from") or filters.get("date_to"):
        d_from = str(filters.get("date_from") or "1800")
        d_to = str(filters.get("date_to") or datetime.now(timezone.utc).strftime("%Y"))
        params["date"] = f"{d_from}-{d_to}"
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.elsevier.com/content/search/scopus", params=params, headers=headers
    )
    results = (data.get("search-results") or {}).get("entry") or []
    works = []
    for item in results:
        identifier = item.get("dc:identifier", "") or item.get("eid", "")
        title = item.get("dc:title")
        creator = item.get("dc:creator")
        authors = [{"literal": creator}] if creator else []
        pub_name = item.get("prism:publicationName") or ""
        cover_date = item.get("prism:coverDate") or ""
        year = (
            int(cover_date[:4])
            if cover_date and len(cover_date) >= 4 and cover_date[:4].isdigit()
            else None
        )
        doi = normalize_doi(item.get("prism:doi") or "")
        citations = item.get("citedby-count")
        cit_count = int(citations) if citations is not None and str(citations).isdigit() else None
        link_list = item.get("link") or []
        display_url = next(
            (
                link.get("@href")
                for link in link_list
                if isinstance(link, dict) and link.get("@ref") == "scopus"
            ),
            "",
        ) or (f"https://doi.org/{doi}" if doi else "")
        is_oa = item.get("openaccessFlag") is True or item.get("openaccess") == "1"
        works.append(
            canonical_work(
                "scopus",
                identifier or doi or display_url,
                title=title,
                authors=authors,
                dates={"issued": cover_date, "online": "", "print": ""},
                year=year,
                abstract=None,
                type=item.get("subtypeDescription") or "article",
                publication={
                    "container_title": pub_name,
                    "publisher": "Elsevier",
                    "volume": item.get("prism:volume", ""),
                    "issue": item.get("prism:issueIdentifier", ""),
                    "pages": item.get("prism:pageRange", ""),
                },
                identifiers={"doi": doi, "isbn13": [], "provider": {"scopus_id": identifier}},
                open_access={
                    "is_oa": is_oa,
                    "license": "",
                    "best_location": _location(display_url, is_oa=is_oa)[0],
                },
                locations=_location(display_url, is_oa=is_oa),
                sources=_occurrence("scopus", identifier or doi, display_url, citations=cit_count),
                metrics={"citations": {"scopus": cit_count} if cit_count is not None else {}},
            )
        )
    return works


async def search_web_of_science(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    if not api_key:
        raise ConnectorError("Web of Science requires an API key.")
    headers = {"X-ApiKey": api_key, "Accept": "application/json"}
    params = {"q": query, "limit": min(limit, 50), "page": 1}
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.clarivate.com/apis/wos-starter/v1/documents",
        params=params,
        headers=headers,
    )
    hits = data.get("hits") or []
    works = []
    for item in hits:
        uid = item.get("uid") or ""
        title = item.get("title")
        names = item.get("names") or {}
        author_list = names.get("authors") or []
        authors = [
            {"literal": a.get("displayName") or a.get("wosStandard")}
            for a in author_list
            if isinstance(a, dict)
        ]
        source_meta = item.get("source") or {}
        pub_name = source_meta.get("sourceTitle") or ""
        pub_year = source_meta.get("publishYear")
        pub_date = str(pub_year or "")
        year = int(pub_year) if pub_year and str(pub_year).isdigit() else None
        doi = normalize_doi((item.get("identifiers") or {}).get("doi") or "")
        citations = item.get("citations")
        cit_count = None
        if isinstance(citations, list) and citations:
            cit_count = citations[0].get("count")
        elif isinstance(citations, dict):
            cit_count = citations.get("count")
        link_list = item.get("links") or []
        display_url = next(
            (
                link.get("url")
                for link in link_list
                if isinstance(link, dict) and link.get("type") == "record"
            ),
            "",
        ) or (f"https://doi.org/{doi}" if doi else "")
        works.append(
            canonical_work(
                "web-of-science",
                uid or doi or display_url,
                title=title,
                authors=authors,
                dates={"issued": pub_date, "online": "", "print": ""},
                year=year,
                abstract=item.get("abstract"),
                type=item.get("docType") or "article",
                publication={
                    "container_title": pub_name,
                    "publisher": "Clarivate",
                    "volume": source_meta.get("volume", ""),
                    "issue": source_meta.get("issue", ""),
                    "pages": source_meta.get("pages", ""),
                },
                identifiers={"doi": doi, "isbn13": [], "provider": {"wos_uid": uid}},
                open_access={
                    "is_oa": bool(item.get("openAccess")),
                    "license": "",
                    "best_location": _location(display_url, is_oa=bool(item.get("openAccess")))[0],
                },
                locations=_location(display_url, is_oa=bool(item.get("openAccess"))),
                sources=_occurrence("web-of-science", uid or doi, display_url, citations=cit_count),
                metrics={"citations": {"wos": cit_count} if cit_count is not None else {}},
            )
        )
    return works


async def search_dimensions(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    if not api_key:
        raise ConnectorError("Dimensions requires an API token.")
    headers = {"Authorization": f"JWT {api_key}" if not api_key.startswith("JWT ") else api_key}
    clean_q = query.replace('"', '\\"')
    dsl = f'search publications for "{clean_q}" return publications[id+title+authors+year+date+abstract+type+journal+doi+times_cited+open_access] limit {min(limit, 50)}'
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://app.dimensions.ai/api/dsl/v2", params={"dsl": dsl}, headers=headers
    )
    pubs = data.get("publications") or []
    works = []
    for item in pubs:
        identifier = item.get("id") or ""
        title = item.get("title")
        authors_raw = item.get("authors") or []
        authors = [
            {"literal": f"{a.get('first_name', '')} {a.get('last_name', '')}".strip()}
            for a in authors_raw
            if isinstance(a, dict)
        ]
        journal = item.get("journal") or {}
        pub_name = journal.get("title") if isinstance(journal, dict) else str(journal or "")
        pub_date = item.get("date") or ""
        year = item.get("year")
        doi = normalize_doi(item.get("doi") or "")
        citations = item.get("times_cited")
        display_url = (
            f"https://app.dimensions.ai/details/publication/{identifier}"
            if identifier
            else (f"https://doi.org/{doi}" if doi else "")
        )
        works.append(
            canonical_work(
                "dimensions",
                identifier or doi or display_url,
                title=title,
                authors=authors,
                dates={"issued": pub_date, "online": "", "print": ""},
                year=year,
                abstract=item.get("abstract"),
                type=item.get("type") or "article",
                publication={
                    "container_title": pub_name,
                    "publisher": "Digital Science",
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                identifiers={"doi": doi, "isbn13": [], "provider": {"dimensions_id": identifier}},
                open_access={
                    "is_oa": bool(item.get("open_access")),
                    "license": "",
                    "best_location": _location(display_url, is_oa=bool(item.get("open_access")))[0],
                },
                locations=_location(display_url, is_oa=bool(item.get("open_access"))),
                sources=_occurrence(
                    "dimensions", identifier or doi, display_url, citations=citations
                ),
                metrics={"citations": {"dimensions": citations} if citations is not None else {}},
            )
        )
    return works
