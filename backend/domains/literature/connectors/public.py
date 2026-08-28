"""Public and open academic repository adapters."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from backend.domains.literature.connectors.normalization import (
    _location,
    _occurrence,
    _truthy_provider_value,
)
from backend.domains.literature.connectors.runtime import current_runtime
from backend.services.literature_models import canonical_work, normalize_language


async def search_europe_pmc(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        expression += f" AND FIRST_PDATE:[{filters.get('date_from') or '1500-01-01'} TO {filters.get('date_to') or '2100-12-31'}]"
    if filters.get("open_access") is True:
        expression += " AND OPEN_ACCESS:Y"
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        params={"query": expression, "format": "json", "pageSize": limit, "resultType": "core"},
    )
    works = []
    for item in (data.get("resultList") or {}).get("result") or []:
        identifier = item.get("id") or item.get("pmid") or item.get("pmcid")
        url = f"https://europepmc.org/article/{item.get('source') or 'MED'}/{identifier}"
        oa = str(item.get("isOpenAccess", "")).upper() == "Y"
        citations = item.get("citedByCount")
        works.append(
            canonical_work(
                "europe-pmc",
                identifier,
                title=item.get("title"),
                authors=item.get("authorString", "").replace(", ", "; "),
                dates={
                    "issued": item.get("firstPublicationDate")
                    or item.get("journalInfo", {}).get("printPublicationDate", ""),
                    "online": item.get("electronicPublicationDate") or "",
                    "print": item.get("printPublicationDate") or "",
                },
                year=item.get("pubYear"),
                abstract=item.get("abstractText"),
                type=item.get("pubType") or "journal-article",
                publication={
                    "container_title": item.get("journalTitle")
                    or (item.get("journalInfo") or {}).get("journal", {}).get("title", ""),
                    "publisher": "",
                    "volume": (item.get("journalInfo") or {}).get("volume", ""),
                    "issue": (item.get("journalInfo") or {}).get("issue", ""),
                    "pages": item.get("pageInfo") or "",
                },
                language=item.get("language"),
                identifiers={
                    "doi": item.get("doi"),
                    "pmid": item.get("pmid"),
                    "pmcid": item.get("pmcid"),
                    "isbn13": [],
                    "provider": {},
                },
                open_access={
                    "is_oa": oa,
                    "license": item.get("license") or "",
                    "best_location": _location(url, is_oa=oa, license_value=item.get("license"))[0],
                },
                locations=_location(url, is_oa=oa, license_value=item.get("license")),
                sources=_occurrence("europe-pmc", identifier, url, citations=citations),
                metrics={"citations": {"europe-pmc": citations} if citations is not None else {}},
            )
        )
    return works


async def search_eric(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    expression = query
    if filters.get("peer_reviewed") is True:
        expression += " AND peerreviewed:T"
    params = {
        "search": expression,
        "rows": max(20, min(limit, 200)),
        "format": "json",
        "fields": "id,title,author,description,publicationtype,publicationdateyear,language,publisher,source,peerreviewed,url,isbn,issn",
    }
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.ies.ed.gov/eric/", params=params
    )
    works = []
    for item in (data.get("response") or {}).get("docs") or []:
        year = item.get("publicationdateyear")
        if filters.get("date_from") and year and int(year) < int(str(filters["date_from"])[:4]):
            continue
        if filters.get("date_to") and year and int(year) > int(str(filters["date_to"])[:4]):
            continue
        identifier = item.get("id")
        url = item.get("url") or f"https://eric.ed.gov/?id={identifier}"
        works.append(
            canonical_work(
                "eric",
                identifier,
                title=item.get("title"),
                authors=[{"literal": value} for value in item.get("author") or []],
                dates={"issued": year or "", "online": "", "print": ""},
                year=year,
                abstract=item.get("description"),
                type=((item.get("publicationtype") or ["other"])[0]),
                publication={
                    "container_title": item.get("source") or "",
                    "publisher": item.get("publisher") or "",
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                language=((item.get("language") or [""])[0]),
                identifiers={
                    "doi": "",
                    "isbn13": item.get("isbn") or [],
                    "provider": {"eric": identifier},
                },
                peer_reviewed=_truthy_provider_value(item.get("peerreviewed")),
                open_access={"is_oa": None, "license": "", "best_location": _location(url)[0]},
                locations=_location(url),
                sources=_occurrence("eric", identifier, url),
            )
        )
    return works[:limit]


async def search_openaire(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    plain_query = " ".join(re.findall(r"[\wÀ-ÿ-]+", query)[:24])
    plain_query = re.sub(r"\b(?:AND|OR|NOT)\b", " ", plain_query, flags=re.IGNORECASE)
    params: dict[str, Any] = {
        "search": " ".join(plain_query.split()),
        "type": "publication",
        "page": 1,
        "pageSize": limit,
        "sortBy": "relevance DESC",
    }
    if filters.get("date_from"):
        params["fromPublicationDate"] = f"{str(filters['date_from'])[:4]}-01-01"
    if filters.get("date_to"):
        params["toPublicationDate"] = f"{str(filters['date_to'])[:4]}-12-31"
    if filters.get("peer_reviewed") is True:
        params["isPeerReviewed"] = "true"
    if filters.get("open_access") is True:
        params["isOpenAccess"] = "true"
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.openaire.eu/graph/v3/research-products", params=params
    )
    works = []
    for item in data.get("results") or []:
        pids = {
            str(pid.get("scheme", "")).lower(): pid.get("value")
            for pid in item.get("pids") or []
            if isinstance(pid, dict)
        }
        instances = item.get("instances") or []
        urls = [
            url
            for instance in instances
            if isinstance(instance, dict)
            for url in instance.get("urls") or []
            if str(url).startswith("https://")
        ]
        url = (
            urls[0]
            if urls
            else f"https://explore.openaire.eu/search/publication?pid={quote(str(item.get('id') or ''), safe='')}"
        )
        access = item.get("bestAccessRight") or {}
        oa = str(access.get("label") or "").upper() in {"OPEN", "OPEN ACCESS"}
        license_value = next(
            (
                str(instance.get("license") or "")
                for instance in instances
                if isinstance(instance, dict) and instance.get("license")
            ),
            "",
        )
        container = item.get("container") or {}
        citations = item.get("citationCount")
        works.append(
            canonical_work(
                "openaire",
                item.get("id"),
                title=item.get("mainTitle"),
                authors=[
                    {
                        "given": author.get("name"),
                        "family": author.get("surname"),
                        "literal": author.get("fullName"),
                        "orcid": (((author.get("pid") or {}).get("id") or {}).get("value")),
                    }
                    for author in item.get("authors") or []
                ],
                dates={
                    "issued": item.get("publicationDate") or "",
                    "online": item.get("publicationDate") or "",
                    "print": "",
                },
                year=item.get("publicationDate"),
                abstract=((item.get("descriptions") or [""])[0]),
                type=item.get("type") or "other",
                publication={
                    "container_title": container.get("name") or container.get("title") or "",
                    "publisher": item.get("publisher") or "",
                    "volume": container.get("volume") or "",
                    "issue": container.get("issue") or "",
                    "pages": container.get("startPage") or "",
                },
                language=(item.get("language") or {}).get("code")
                if isinstance(item.get("language"), dict)
                else item.get("language"),
                identifiers={
                    "doi": pids.get("doi"),
                    "pmid": pids.get("pmid"),
                    "isbn13": [],
                    "provider": {},
                },
                peer_reviewed=_truthy_provider_value(item.get("isPeerReviewed")),
                open_access={
                    "is_oa": oa,
                    "license": license_value,
                    "best_location": _location(url, is_oa=oa, license_value=license_value)[0],
                },
                locations=_location(url, is_oa=oa, license_value=license_value),
                sources=_occurrence("openaire", item.get("id"), url, citations=citations),
                metrics={"citations": {"openaire": citations} if citations is not None else {}},
            )
        )
    return works


async def search_core(
    query: str, filters: dict[str, Any], limit: int, api_key: str = ""
) -> list[dict[str, Any]]:
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        expression += f" AND yearPublished:[{filters.get('date_from') or 1500} TO {filters.get('date_to') or 2100}]"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.core.ac.uk/v3/search/works/",
        params={"q": expression, "limit": limit},
        headers=headers,
    )
    works = []
    for item in data.get("results") or []:
        identifier = item.get("id")
        links = item.get("links") or []
        url = (
            next((link.get("url") for link in links if link.get("type") == "display"), "")
            or f"https://core.ac.uk/works/{identifier}"
        )
        pdf = item.get("downloadUrl") or next(
            (link.get("url") for link in links if link.get("type") == "download"), ""
        )
        journals = item.get("journals") or []
        citations = item.get("citationCount")
        works.append(
            canonical_work(
                "core",
                identifier,
                title=item.get("title"),
                authors=[{"literal": author.get("name")} for author in item.get("authors") or []],
                dates={
                    "issued": item.get("publishedDate") or item.get("yearPublished") or "",
                    "online": "",
                    "print": "",
                },
                year=item.get("yearPublished"),
                abstract=item.get("abstract"),
                type=item.get("documentType") or "other",
                publication={
                    "container_title": (
                        journals[0].get("title")
                        if journals and isinstance(journals[0], dict)
                        else ""
                    ),
                    "publisher": item.get("publisher") or "",
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                identifiers={
                    "doi": item.get("doi"),
                    "pmid": item.get("pubmedId"),
                    "arxiv": item.get("arxivId"),
                    "isbn13": [],
                    "provider": {},
                },
                open_access={
                    "is_oa": True,
                    "license": "",
                    "best_location": _location(url, pdf_url=pdf, is_oa=True)[0],
                },
                locations=_location(url, pdf_url=pdf, is_oa=True),
                sources=_occurrence("core", identifier, url, citations=citations),
                metrics={"citations": {"core": citations} if citations is not None else {}},
            )
        )
    return works


async def search_hal(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    params = {
        "q": query,
        "wt": "json",
        "rows": limit,
        "fl": "halId_s,title_s,authFullName_s,producedDate_s,publicationDate_s,abstract_s,docType_s,journalTitle_s,publisher_s,volume_s,issue_s,page_s,language_s,doiId_s,uri_s,fileMain_s,openAccess_bool",
    }
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://api.archives-ouvertes.fr/search/", params=params
    )
    works = []
    for item in (data.get("response") or {}).get("docs") or []:
        identifier = item.get("halId_s")
        url = item.get("uri_s") or f"https://hal.science/{identifier}"
        oa = item.get("openAccess_bool") is True or bool(item.get("fileMain_s"))
        works.append(
            canonical_work(
                "hal",
                identifier,
                title=item.get("title_s"),
                authors=[{"literal": value} for value in item.get("authFullName_s") or []],
                dates={
                    "issued": item.get("producedDate_s") or item.get("publicationDate_s") or "",
                    "online": item.get("producedDate_s") or "",
                    "print": item.get("publicationDate_s") or "",
                },
                year=item.get("publicationDate_s"),
                abstract=item.get("abstract_s"),
                type=item.get("docType_s") or "other",
                publication={
                    "container_title": item.get("journalTitle_s") or "",
                    "publisher": item.get("publisher_s") or "",
                    "volume": item.get("volume_s") or "",
                    "issue": item.get("issue_s") or "",
                    "pages": item.get("page_s") or "",
                },
                language=(item.get("language_s") or [""])[0]
                if isinstance(item.get("language_s"), list)
                else item.get("language_s"),
                identifiers={"doi": item.get("doiId_s"), "isbn13": [], "provider": {}},
                open_access={
                    "is_oa": oa,
                    "license": "",
                    "best_location": _location(url, pdf_url=item.get("fileMain_s"), is_oa=oa)[0],
                },
                locations=_location(url, pdf_url=item.get("fileMain_s"), is_oa=oa),
                sources=_occurrence("hal", identifier, url),
            )
        )
    return works


async def search_open_library(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://openlibrary.org/search.json",
        params={
            "q": query,
            "limit": limit,
            "fields": "key,title,author_name,first_publish_year,publish_date,publisher,isbn,language,openlibrary_edition,edition_key,ebook_access",
        },
    )
    works = []
    for item in data.get("docs") or []:
        identifier = item.get("key") or (item.get("edition_key") or [""])[0]
        url = (
            f"https://openlibrary.org{identifier}"
            if str(identifier).startswith("/")
            else f"https://openlibrary.org/works/{identifier}"
        )
        oa = item.get("ebook_access") == "public"
        works.append(
            canonical_work(
                "open-library",
                identifier,
                title=item.get("title"),
                authors=[{"literal": value} for value in item.get("author_name") or []],
                dates={
                    "issued": (item.get("publish_date") or [item.get("first_publish_year") or ""])[
                        0
                    ],
                    "online": "",
                    "print": "",
                },
                year=item.get("first_publish_year"),
                type="book",
                publication={
                    "container_title": "",
                    "publisher": (item.get("publisher") or [""])[0],
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                language=(item.get("language") or [""])[0],
                identifiers={"doi": "", "isbn13": item.get("isbn") or [], "provider": {}},
                open_access={
                    "is_oa": oa,
                    "license": "",
                    "best_location": _location(url, is_oa=oa)[0],
                },
                locations=_location(url, is_oa=oa),
                sources=_occurrence("open-library", identifier, url),
            )
        )
    return works


async def search_doaj(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    encoded = quote(query, safe="")
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        f"https://doaj.org/api/search/articles/{encoded}", params={"pageSize": limit}
    )
    works = []
    for row in data.get("results") or []:
        bib = row.get("bibjson") or {}
        identifiers = {
            str(item.get("type", "")).lower(): item.get("id")
            for item in bib.get("identifier") or []
            if isinstance(item, dict)
        }
        links = bib.get("link") or []
        url = (
            next((item.get("url", "") for item in links if item.get("type") == "fulltext"), "")
            or f"https://doaj.org/article/{row.get('id')}"
        )
        works.append(
            canonical_work(
                "doaj-articles",
                row.get("id"),
                title=bib.get("title"),
                authors=[
                    {"literal": item.get("name"), "orcid": item.get("orcid_id")}
                    for item in bib.get("author") or []
                ],
                dates={"issued": bib.get("year") or "", "online": "", "print": ""},
                year=bib.get("year"),
                abstract=bib.get("abstract"),
                type="journal-article",
                publication={
                    "container_title": (bib.get("journal") or {}).get("title", ""),
                    "publisher": (bib.get("publisher") or {}).get("name", "")
                    if isinstance(bib.get("publisher"), dict)
                    else bib.get("publisher") or "",
                    "volume": (bib.get("journal") or {}).get("volume", ""),
                    "issue": (bib.get("journal") or {}).get("number", ""),
                    "pages": bib.get("start_page") or "",
                },
                language=(bib.get("language") or [""])[0],
                identifiers={
                    "doi": identifiers.get("doi"),
                    "pmid": identifiers.get("pmid"),
                    "isbn13": [],
                    "provider": {},
                },
                peer_reviewed=True,
                open_access={
                    "is_oa": True,
                    "license": ((bib.get("license") or [{}])[0].get("type", "")),
                    "best_location": _location(
                        url,
                        is_oa=True,
                        license_value=((bib.get("license") or [{}])[0].get("type", "")),
                    )[0],
                },
                locations=_location(
                    url, is_oa=True, license_value=((bib.get("license") or [{}])[0].get("type", ""))
                ),
                sources=_occurrence("doaj-articles", row.get("id"), url),
            )
        )
    return works


async def search_pubmed(
    query: str, filters: dict[str, Any], limit: int, contact_email: str = ""
) -> list[dict[str, Any]]:
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        expression += f" AND ({filters.get('date_from') or '1500/01/01'}:{filters.get('date_to') or '2100/12/31'}[dp])"
    language_names = {
        "ca": "catalan",
        "de": "german",
        "en": "english",
        "es": "spanish",
        "fr": "french",
        "it": "italian",
        "pt": "portuguese",
    }
    raw_language_filter = filters.get("languages")
    raw_languages = (
        raw_language_filter
        if isinstance(raw_language_filter, list)
        else re.split(r"[,;\s]+", str(filters.get("language") or ""))
    )
    pubmed_languages = [language_names.get(normalize_language(value)) for value in raw_languages]
    pubmed_languages = [value for value in pubmed_languages if value]
    if pubmed_languages:
        expression += " AND (" + " OR ".join(f"{value}[lang]" for value in pubmed_languages) + ")"
    common = {"tool": "gnosi", "email": contact_email} if contact_email else {"tool": "gnosi"}
    search_data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        params={**common, "db": "pubmed", "term": expression, "retmode": "json", "retmax": limit},
    )
    ids = (search_data.get("esearchresult") or {}).get("idlist") or []
    if not ids:
        return []
    data, _final_url, _response_headers = await current_runtime().safe_get_json(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
        params={**common, "db": "pubmed", "id": ",".join(ids), "retmode": "json", "version": "2.0"},
    )
    works = []
    result = data.get("result") or {}
    for pmid in ids:
        item = result.get(pmid) or {}
        article_ids = {
            str(value.get("idtype", "")).lower(): value.get("value")
            for value in item.get("articleids") or []
            if isinstance(value, dict)
        }
        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        works.append(
            canonical_work(
                "pubmed",
                pmid,
                title=item.get("title"),
                authors=[{"literal": author.get("name")} for author in item.get("authors") or []],
                dates={
                    "issued": item.get("pubdate") or item.get("sortpubdate") or "",
                    "online": "",
                    "print": item.get("pubdate") or "",
                },
                year=item.get("pubdate"),
                type="journal-article",
                publication={
                    "container_title": item.get("fulljournalname") or item.get("source") or "",
                    "publisher": "",
                    "volume": item.get("volume") or "",
                    "issue": item.get("issue") or "",
                    "pages": item.get("pages") or "",
                },
                language=(item.get("lang") or [""])[0],
                identifiers={
                    "doi": article_ids.get("doi"),
                    "pmid": pmid,
                    "pmcid": article_ids.get("pmc"),
                    "isbn13": [],
                    "provider": {},
                },
                open_access={"is_oa": None, "license": "", "best_location": _location(url)[0]},
                locations=_location(url),
                sources=_occurrence("pubmed", pmid, url),
            )
        )
    return works
