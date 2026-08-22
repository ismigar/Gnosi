"""Authorized academic APIs, safe custom HTTP, and OAI-PMH parsing."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import socket
from contextvars import ContextVar
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlparse, urlunparse

import httpx
from defusedxml import ElementTree as DefusedElementTree

from backend.services.literature_models import canonical_work, clean_text, normalize_doi, normalize_language


USER_AGENT = "Gnosi-Literature/1.0 (+https://github.com/ismigar/Gnosi)"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_REDIRECTS = 3
DEFAULT_TIMEOUT_SECONDS = 20.0
CONNECTOR_AUDIT_VERSION = 1
_REQUEST_AUDIT: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "academic_request_audit",
    default=None,
)
_SENSITIVE_QUERY_KEYS = {
    "access_token", "api_key", "apikey", "email", "key", "mailto",
    "password", "secret", "token",
}


class ConnectorError(RuntimeError):
    """A bounded, user-safe connector failure."""

    def __init__(self, message: str, *, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def begin_request_audit() -> tuple[Any, list[dict[str, Any]]]:
    """Start one task-local audit of public academic GET requests."""
    records: list[dict[str, Any]] = []
    return _REQUEST_AUDIT.set(records), records


def end_request_audit(token: Any) -> None:
    """Restore the previous request-audit context."""
    _REQUEST_AUDIT.reset(token)


def _auditable_url(raw_url: Any) -> str:
    """Return a bounded URL with credential-like query values redacted."""
    parsed = urlparse(str(raw_url or ""))
    query = urlencode([
        (key, "[configured]" if key.lower() in _SENSITIVE_QUERY_KEYS else value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
    ], doseq=True)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", query, ""))[:8_000]


def _record_request(response: httpx.Response) -> None:
    records = _REQUEST_AUDIT.get()
    if records is None or len(records) >= 100:
        return
    records.append({
        "method": "GET",
        "url": _auditable_url(response.request.url),
        "status_code": response.status_code,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "connector_audit_version": CONNECTOR_AUDIT_VERSION,
    })


def _is_public_address(raw: str) -> bool:
    address = ipaddress.ip_address(raw)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def validate_public_https_url(url: str) -> str:
    """Validate HTTPS syntax and reject hostnames resolving to non-public IPs."""
    value = clean_text(url, 4_000)
    parsed = urlparse(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ConnectorError("Repository URLs must use HTTPS.")
    if parsed.username or parsed.password:
        raise ConnectorError("Repository URLs cannot contain embedded credentials.")
    if parsed.port not in (None, 443):
        raise ConnectorError("Repository URLs must use the standard HTTPS port.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ConnectorError("The repository hostname could not be resolved.") from exc
    if not addresses or any(not _is_public_address(item[4][0]) for item in addresses):
        raise ConnectorError("The repository hostname resolves to a blocked network address.")
    return value


def _retry_after(response: httpx.Response) -> int | None:
    value = response.headers.get("retry-after", "").strip()
    if value.isdigit():
        return min(int(value), 86_400)
    if value:
        try:
            seconds = int((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
            return max(0, min(seconds, 86_400))
        except (TypeError, ValueError, OverflowError):
            return None
    return None


async def safe_get_bytes(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    accepted_types: tuple[str, ...] = ("application/json", "application/xml", "text/xml", "application/atom+xml", "text/plain"),
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> tuple[bytes, str, dict[str, str]]:
    """Fetch one bounded public HTTPS response with manual redirect validation."""
    current = validate_public_https_url(url)
    request_headers = {"User-Agent": USER_AGENT, "Accept": ", ".join(accepted_types)}
    request_headers.update(headers or {})
    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=8.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
        for redirect_count in range(MAX_REDIRECTS + 1):
            try:
                async with client.stream("GET", current, params=params if redirect_count == 0 else None, headers=request_headers) as response:
                    _record_request(response)
                    if response.status_code in {301, 302, 303, 307, 308}:
                        if redirect_count >= MAX_REDIRECTS:
                            raise ConnectorError("The repository exceeded the redirect limit.")
                        location = response.headers.get("location")
                        if not location:
                            raise ConnectorError("The repository returned an invalid redirect.")
                        current = validate_public_https_url(urljoin(current, location))
                        continue
                    if response.status_code == 429:
                        raise ConnectorError("The repository rate limit was reached.", retry_after=_retry_after(response))
                    if response.status_code in {401, 403}:
                        raise ConnectorError("The repository rejected the configured credentials.")
                    if response.status_code >= 400:
                        raise ConnectorError(f"The repository returned HTTP {response.status_code}.")
                    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    if accepted_types and content_type and not any(content_type == item or content_type.endswith("+json") or content_type.endswith("+xml") for item in accepted_types):
                        raise ConnectorError(f"The repository returned unsupported content type {content_type}.")
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > max(1_024, min(max_bytes, MAX_RESPONSE_BYTES)):
                            raise ConnectorError("The repository response exceeded the size limit.")
                        chunks.append(chunk)
                    return b"".join(chunks), str(response.url), dict(response.headers)
            except ConnectorError:
                raise
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                raise ConnectorError("The repository did not respond within the safe request limits.") from exc
    raise ConnectorError("The repository request did not complete.")


async def safe_get_json(url: str, **kwargs: Any) -> tuple[Any, str, dict[str, str]]:
    body, final_url, response_headers = await safe_get_bytes(
        url,
        accepted_types=("application/json", "text/json", "application/ld+json", "text/plain"),
        **kwargs,
    )
    try:
        return json.loads(body.decode("utf-8-sig")), final_url, response_headers
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConnectorError("The repository returned invalid JSON.") from exc


def _date_parts(parts: Any) -> str:
    if isinstance(parts, list) and parts and isinstance(parts[0], list):
        values = parts[0]
    elif isinstance(parts, list):
        values = parts
    else:
        return ""
    return "-".join(str(value).zfill(2) if index else str(value) for index, value in enumerate(values[:3]))


def _authors(values: Any) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for value in values if isinstance(values, list) else []:
        if not isinstance(value, dict):
            result.append({"literal": clean_text(value, 400)})
            continue
        result.append({
            "given": clean_text(value.get("given") or value.get("firstName"), 200),
            "family": clean_text(value.get("family") or value.get("lastName"), 200),
            "literal": clean_text(value.get("name") or value.get("collectiveName"), 400),
            "orcid": clean_text(value.get("ORCID") or value.get("orcid"), 120),
        })
    return result


def _occurrence(provider: str, provider_id: Any, url: Any, *, score: Any = None, citations: Any = None) -> list[dict[str, Any]]:
    try:
        normalized_score = float(score) if score not in (None, "") else None
    except (TypeError, ValueError):
        normalized_score = None
    try:
        normalized_citations = int(citations) if citations not in (None, "") else None
    except (TypeError, ValueError):
        normalized_citations = None
    return [{
        "provider": provider,
        "provider_id": clean_text(provider_id, 500),
        "url": clean_text(url, 4_000),
        "score": normalized_score,
        "citations": normalized_citations,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }]


def _location(url: Any, *, pdf_url: Any = "", is_oa: bool | None = None, license_value: Any = "") -> list[dict[str, Any]]:
    landing = clean_text(url, 4_000)
    pdf = clean_text(pdf_url, 4_000)
    if not landing and not pdf:
        return []
    return [{"url": landing or pdf, "landing_page_url": landing, "pdf_url": pdf, "is_oa": is_oa, "license": clean_text(license_value, 300)}]


def _filters(filters: dict[str, Any]) -> dict[str, Any]:
    return filters if isinstance(filters, dict) else {}


def _truthy_provider_value(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    normalized = clean_text(value, 20).lower()
    if normalized in {"1", "true", "t", "yes", "y"}:
        return True
    if normalized in {"0", "false", "f", "no", "n"}:
        return False
    return None


def filter_works(works: list[dict[str, Any]], filters: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply canonical filters consistently after provider-side filtering."""
    selected = _filters(filters)
    try:
        year_from = int(str(selected.get("date_from") or "")[:4]) if selected.get("date_from") else None
        year_to = int(str(selected.get("date_to") or "")[:4]) if selected.get("date_to") else None
    except ValueError:
        year_from = year_to = None
    languages = {
        normalize_language(value)
        for value in re.split(r"[,;\s]+", str(selected.get("language") or ""))
        if value.strip()
    }
    wanted_type = clean_text(selected.get("type"), 100).lower()
    aliases = {"article": "journal-article", "journalarticle": "journal-article"}
    wanted_type = aliases.get(wanted_type, wanted_type)
    result: list[dict[str, Any]] = []
    for work in works:
        year = work.get("year")
        if year_from and (not isinstance(year, int) or year < year_from):
            continue
        if year_to and (not isinstance(year, int) or year > year_to):
            continue
        if languages and normalize_language(work.get("language")) not in languages:
            continue
        work_type = aliases.get(clean_text(work.get("type"), 100).lower(), clean_text(work.get("type"), 100).lower())
        if wanted_type and work_type != wanted_type:
            continue
        if selected.get("open_access") is True and (work.get("open_access") or {}).get("is_oa") is not True:
            continue
        if selected.get("full_text") is True:
            locations = work.get("locations") or []
            has_verified_full_text = any(
                isinstance(location, dict)
                and (location.get("pdf_url") or location.get("is_oa") is True)
                for location in locations
            )
            if not has_verified_full_text:
                continue
        if selected.get("peer_reviewed") is True and work.get("peer_reviewed") is not True:
            continue
        result.append(work)
    return result


def _crossref_work(item: dict[str, Any], provider: str = "crossref") -> dict[str, Any]:
    doi = normalize_doi(item.get("DOI"))
    licenses = item.get("license") or []
    links = item.get("link") or []
    oa = bool(licenses)
    locations = _location(item.get("URL"), pdf_url=next((link.get("URL") for link in links if isinstance(link, dict) and "pdf" in str(link.get("content-type", ""))), ""), is_oa=oa, license_value=(licenses[0].get("URL") if licenses else ""))
    citations = item.get("is-referenced-by-count")
    return canonical_work(
        provider, doi or item.get("URL"),
        title=((item.get("title") or [""])[0]), authors=_authors(item.get("author")),
        dates={"issued": _date_parts((item.get("issued") or {}).get("date-parts")), "online": _date_parts((item.get("published-online") or {}).get("date-parts")), "print": _date_parts((item.get("published-print") or {}).get("date-parts"))},
        year=_date_parts((item.get("issued") or {}).get("date-parts")), abstract=item.get("abstract"), type=item.get("type") or "other",
        publication={"container_title": ((item.get("container-title") or [""])[0]), "publisher": item.get("publisher") or "", "volume": item.get("volume") or "", "issue": item.get("issue") or "", "pages": item.get("page") or ""},
        language=item.get("language"), identifiers={"doi": doi, "isbn13": item.get("ISBN") or [], "provider": {}},
        open_access={"is_oa": oa, "license": (licenses[0].get("URL") if licenses else ""), "best_location": locations[0] if locations else None},
        locations=locations, sources=_occurrence(provider, doi or item.get("URL"), item.get("URL"), citations=citations), metrics={"citations": {provider: citations} if citations is not None else {}},
    )


async def search_crossref(query: str, filters: dict[str, Any], limit: int, contact_email: str = "") -> list[dict[str, Any]]:
    params: dict[str, Any] = {"query.bibliographic": query, "rows": limit, "select": "DOI,title,author,issued,published-online,published-print,abstract,type,container-title,publisher,volume,issue,page,URL,is-referenced-by-count,license,link"}
    range_filters: list[str] = []
    if _filters(filters).get("date_from"):
        range_filters.append(f"from-pub-date:{filters['date_from']}")
    if _filters(filters).get("date_to"):
        range_filters.append(f"until-pub-date:{filters['date_to']}")
    if range_filters:
        params["filter"] = ",".join(range_filters)
    if contact_email:
        params["mailto"] = contact_email
    data, _, _ = await safe_get_json("https://api.crossref.org/works", params=params)
    return [_crossref_work(item) for item in (data.get("message") or {}).get("items") or []]


async def search_scielo_articles(query: str, filters: dict[str, Any], limit: int, contact_email: str = "") -> list[dict[str, Any]]:
    """Search SciELO deposits through the authorized Crossref member endpoints."""
    per_member = max(1, min(limit, 100))
    params: dict[str, Any] = {"query.bibliographic": query, "rows": per_member, "select": "DOI,title,author,issued,published-online,published-print,abstract,type,container-title,publisher,volume,issue,page,URL,is-referenced-by-count,license,link"}
    range_filters: list[str] = []
    if filters.get("date_from"):
        range_filters.append(f"from-pub-date:{filters['date_from']}")
    if filters.get("date_to"):
        range_filters.append(f"until-pub-date:{filters['date_to']}")
    if range_filters:
        params["filter"] = ",".join(range_filters)
    if contact_email:
        params["mailto"] = contact_email
    responses = await asyncio.gather(*(
        safe_get_json(f"https://api.crossref.org/members/{member_id}/works", params=params)
        for member_id in (530, 2516, 2868)
    ))
    works = [
        _crossref_work(item, "scielo-articles")
        for data, _, _ in responses
        for item in (data.get("message") or {}).get("items") or []
    ]
    return works[:limit]


async def search_datacite(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    params: dict[str, Any] = {"query": query, "page[size]": limit}
    if filters.get("date_from") or filters.get("date_to"):
        year_from = str(filters.get("date_from") or "1500")[:4]
        year_to = str(filters.get("date_to") or "2100")[:4]
        params["query"] = f"({query}) AND publicationYear:[{year_from} TO {year_to}]"
    data, _, _ = await safe_get_json("https://api.datacite.org/dois", params=params)
    works = []
    for row in data.get("data") or []:
        attrs = row.get("attributes") or {}
        doi = normalize_doi(attrs.get("doi") or row.get("id"))
        titles = attrs.get("titles") or []
        descriptions = attrs.get("descriptions") or []
        creators = attrs.get("creators") or []
        url = attrs.get("url") or f"https://doi.org/{doi}"
        rights = attrs.get("rightsList") or []
        oa = any("open" in str(item.get("rights", "")).lower() or str(item.get("rightsUri", "")).startswith("https://creativecommons.org") for item in rights if isinstance(item, dict))
        works.append(canonical_work(
            "datacite", doi or row.get("id"), title=(titles[0].get("title") if titles else ""),
            authors=[{"given": item.get("givenName"), "family": item.get("familyName"), "literal": item.get("name"), "orcid": next((identifier.get("nameIdentifier", "") for identifier in item.get("nameIdentifiers") or [] if "orcid" in str(identifier.get("nameIdentifierScheme", "")).lower()), "")} for item in creators],
            dates={"issued": attrs.get("published") or attrs.get("publicationYear") or "", "online": "", "print": ""}, year=attrs.get("publicationYear"),
            abstract=next((item.get("description") for item in descriptions if item.get("descriptionType") == "Abstract"), ""), type=(attrs.get("types") or {}).get("resourceTypeGeneral") or "other",
            publication={"container_title": attrs.get("container", {}).get("title", "") if isinstance(attrs.get("container"), dict) else "", "publisher": attrs.get("publisher") or "", "volume": "", "issue": "", "pages": ""},
            language=attrs.get("language"), identifiers={"doi": doi, "isbn13": [], "provider": {}},
            open_access={"is_oa": oa, "license": (rights[0].get("rightsUri") if rights else ""), "best_location": _location(url, is_oa=oa, license_value=(rights[0].get("rightsUri") if rights else ""))[0]},
            locations=_location(url, is_oa=oa, license_value=(rights[0].get("rightsUri") if rights else "")), sources=_occurrence("datacite", doi or row.get("id"), url),
        ))
    return works


def _xml_text(element: Any, suffix: str) -> str:
    for child in element.iter():
        if str(child.tag).endswith(suffix):
            return clean_text(child.text)
    return ""


def _xml_texts(element: Any, suffix: str) -> list[str]:
    return [clean_text(child.text) for child in element.iter() if str(child.tag).endswith(suffix) and clean_text(child.text)]


def parse_safe_xml(body: bytes) -> Any:
    """Parse bounded XML with entity and external-reference defenses."""
    upper = body[:100_000].upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ConnectorError("The repository returned unsafe XML declarations.")
    try:
        return DefusedElementTree.fromstring(body)
    except Exception as exc:  # defusedxml exposes several security exception types
        raise ConnectorError("The repository returned invalid or unsafe XML.") from exc


async def search_arxiv(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    params = {"search_query": f"all:{query}", "start": 0, "max_results": limit, "sortBy": "relevance"}
    body, _, _ = await safe_get_bytes("https://export.arxiv.org/api/query", params=params, accepted_types=("application/atom+xml", "application/xml", "text/xml"))
    root = parse_safe_xml(body)
    works = []
    for entry in [item for item in root.iter() if str(item.tag).endswith("entry")]:
        identifier = _xml_text(entry, "id").rsplit("/", 1)[-1]
        url = _xml_text(entry, "id")
        links = [{key.rsplit("}", 1)[-1]: value for key, value in link.attrib.items()} for link in entry if str(link.tag).endswith("link")]
        pdf = next((item.get("href", "") for item in links if item.get("type") == "application/pdf"), "")
        authors = [{"literal": _xml_text(author, "name")} for author in entry if str(author.tag).endswith("author")]
        published = _xml_text(entry, "published")
        works.append(canonical_work(
            "arxiv", identifier, title=_xml_text(entry, "title"), authors=authors,
            dates={"issued": published, "online": published, "print": ""}, year=published,
            abstract=_xml_text(entry, "summary"), type="preprint", publication={"container_title": "arXiv", "publisher": "Cornell University", "volume": "", "issue": "", "pages": ""},
            identifiers={"doi": _xml_text(entry, "doi"), "arxiv": identifier, "isbn13": [], "provider": {}},
            open_access={"is_oa": True, "license": "", "best_location": _location(url, pdf_url=pdf, is_oa=True)[0]}, locations=_location(url, pdf_url=pdf, is_oa=True), sources=_occurrence("arxiv", identifier, url),
        ))
    return works


async def search_europe_pmc(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        expression += f" AND FIRST_PDATE:[{filters.get('date_from') or '1500-01-01'} TO {filters.get('date_to') or '2100-12-31'}]"
    if filters.get("open_access") is True:
        expression += " AND OPEN_ACCESS:Y"
    data, _, _ = await safe_get_json("https://www.ebi.ac.uk/europepmc/webservices/rest/search", params={"query": expression, "format": "json", "pageSize": limit, "resultType": "core"})
    works = []
    for item in (data.get("resultList") or {}).get("result") or []:
        identifier = item.get("id") or item.get("pmid") or item.get("pmcid")
        url = f"https://europepmc.org/article/{item.get('source') or 'MED'}/{identifier}"
        oa = str(item.get("isOpenAccess", "")).upper() == "Y"
        citations = item.get("citedByCount")
        works.append(canonical_work(
            "europe-pmc", identifier, title=item.get("title"), authors=item.get("authorString", "").replace(", ", "; "),
            dates={"issued": item.get("firstPublicationDate") or item.get("journalInfo", {}).get("printPublicationDate", ""), "online": item.get("electronicPublicationDate") or "", "print": item.get("printPublicationDate") or ""},
            year=item.get("pubYear"), abstract=item.get("abstractText"), type=item.get("pubType") or "journal-article",
            publication={"container_title": item.get("journalTitle") or (item.get("journalInfo") or {}).get("journal", {}).get("title", ""), "publisher": "", "volume": (item.get("journalInfo") or {}).get("volume", ""), "issue": (item.get("journalInfo") or {}).get("issue", ""), "pages": item.get("pageInfo") or ""},
            language=item.get("language"), identifiers={"doi": item.get("doi"), "pmid": item.get("pmid"), "pmcid": item.get("pmcid"), "isbn13": [], "provider": {}},
            open_access={"is_oa": oa, "license": item.get("license") or "", "best_location": _location(url, is_oa=oa, license_value=item.get("license"))[0]}, locations=_location(url, is_oa=oa, license_value=item.get("license")),
            sources=_occurrence("europe-pmc", identifier, url, citations=citations), metrics={"citations": {"europe-pmc": citations} if citations is not None else {}},
        ))
    return works


async def search_eric(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    expression = query
    if filters.get("peer_reviewed") is True:
        expression += " AND peerreviewed:T"
    params = {
        "search": expression,
        "rows": max(20, min(limit, 200)),
        "format": "json",
        "fields": "id,title,author,description,publicationtype,publicationdateyear,language,publisher,source,peerreviewed,url,isbn,issn",
    }
    data, _, _ = await safe_get_json("https://api.ies.ed.gov/eric/", params=params)
    works = []
    for item in (data.get("response") or {}).get("docs") or []:
        year = item.get("publicationdateyear")
        if filters.get("date_from") and year and int(year) < int(str(filters["date_from"])[:4]):
            continue
        if filters.get("date_to") and year and int(year) > int(str(filters["date_to"])[:4]):
            continue
        identifier = item.get("id")
        url = item.get("url") or f"https://eric.ed.gov/?id={identifier}"
        works.append(canonical_work(
            "eric", identifier, title=item.get("title"), authors=[{"literal": value} for value in item.get("author") or []],
            dates={"issued": year or "", "online": "", "print": ""}, year=year, abstract=item.get("description"), type=((item.get("publicationtype") or ["other"])[0]),
            publication={"container_title": item.get("source") or "", "publisher": item.get("publisher") or "", "volume": "", "issue": "", "pages": ""},
            language=((item.get("language") or [""])[0]), identifiers={"doi": "", "isbn13": item.get("isbn") or [], "provider": {"eric": identifier}},
            peer_reviewed=_truthy_provider_value(item.get("peerreviewed")),
            open_access={"is_oa": None, "license": "", "best_location": _location(url)[0]}, locations=_location(url), sources=_occurrence("eric", identifier, url),
        ))
    return works[:limit]


async def search_openaire(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    params: dict[str, Any] = {"search": query, "type": "publication", "page": 1, "pageSize": limit, "sortBy": "relevance DESC"}
    if filters.get("date_from"):
        params["fromPublicationDate"] = f"{str(filters['date_from'])[:4]}-01-01"
    if filters.get("date_to"):
        params["toPublicationDate"] = f"{str(filters['date_to'])[:4]}-12-31"
    if filters.get("peer_reviewed") is True:
        params["isPeerReviewed"] = "true"
    if filters.get("open_access") is True:
        params["isOpenAccess"] = "true"
    data, _, _ = await safe_get_json("https://api.openaire.eu/graph/v3/research-products", params=params)
    works = []
    for item in data.get("results") or []:
        pids = {str(pid.get("scheme", "")).lower(): pid.get("value") for pid in item.get("pids") or [] if isinstance(pid, dict)}
        instances = item.get("instances") or []
        urls = [url for instance in instances if isinstance(instance, dict) for url in instance.get("urls") or [] if str(url).startswith("https://")]
        url = urls[0] if urls else f"https://explore.openaire.eu/search/publication?pid={quote(str(item.get('id') or ''), safe='')}"
        access = item.get("bestAccessRight") or {}
        oa = str(access.get("label") or "").upper() in {"OPEN", "OPEN ACCESS"}
        license_value = next((str(instance.get("license") or "") for instance in instances if isinstance(instance, dict) and instance.get("license")), "")
        container = item.get("container") or {}
        citations = item.get("citationCount")
        works.append(canonical_work(
            "openaire", item.get("id"), title=item.get("mainTitle"),
            authors=[{"given": author.get("name"), "family": author.get("surname"), "literal": author.get("fullName"), "orcid": (((author.get("pid") or {}).get("id") or {}).get("value"))} for author in item.get("authors") or []],
            dates={"issued": item.get("publicationDate") or "", "online": item.get("publicationDate") or "", "print": ""}, year=item.get("publicationDate"), abstract=((item.get("descriptions") or [""])[0]), type=item.get("type") or "other",
            publication={"container_title": container.get("name") or container.get("title") or "", "publisher": item.get("publisher") or "", "volume": container.get("volume") or "", "issue": container.get("issue") or "", "pages": container.get("startPage") or ""},
            language=(item.get("language") or {}).get("code") if isinstance(item.get("language"), dict) else item.get("language"), identifiers={"doi": pids.get("doi"), "pmid": pids.get("pmid"), "isbn13": [], "provider": {}},
            peer_reviewed=_truthy_provider_value(item.get("isPeerReviewed")),
            open_access={"is_oa": oa, "license": license_value, "best_location": _location(url, is_oa=oa, license_value=license_value)[0]}, locations=_location(url, is_oa=oa, license_value=license_value),
            sources=_occurrence("openaire", item.get("id"), url, citations=citations), metrics={"citations": {"openaire": citations} if citations is not None else {}},
        ))
    return works


async def search_core(query: str, filters: dict[str, Any], limit: int, api_key: str = "") -> list[dict[str, Any]]:
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        expression += f" AND yearPublished:[{filters.get('date_from') or 1500} TO {filters.get('date_to') or 2100}]"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    data, _, _ = await safe_get_json("https://api.core.ac.uk/v3/search/works/", params={"q": expression, "limit": limit}, headers=headers)
    works = []
    for item in data.get("results") or []:
        identifier = item.get("id")
        links = item.get("links") or []
        url = next((link.get("url") for link in links if link.get("type") == "display"), "") or f"https://core.ac.uk/works/{identifier}"
        pdf = item.get("downloadUrl") or next((link.get("url") for link in links if link.get("type") == "download"), "")
        journals = item.get("journals") or []
        citations = item.get("citationCount")
        works.append(canonical_work(
            "core", identifier, title=item.get("title"), authors=[{"literal": author.get("name")} for author in item.get("authors") or []],
            dates={"issued": item.get("publishedDate") or item.get("yearPublished") or "", "online": "", "print": ""}, year=item.get("yearPublished"), abstract=item.get("abstract"), type=item.get("documentType") or "other",
            publication={"container_title": (journals[0].get("title") if journals and isinstance(journals[0], dict) else ""), "publisher": item.get("publisher") or "", "volume": "", "issue": "", "pages": ""},
            identifiers={"doi": item.get("doi"), "pmid": item.get("pubmedId"), "arxiv": item.get("arxivId"), "isbn13": [], "provider": {}},
            open_access={"is_oa": True, "license": "", "best_location": _location(url, pdf_url=pdf, is_oa=True)[0]}, locations=_location(url, pdf_url=pdf, is_oa=True),
            sources=_occurrence("core", identifier, url, citations=citations), metrics={"citations": {"core": citations} if citations is not None else {}},
        ))
    return works


async def search_hal(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    params = {"q": query, "wt": "json", "rows": limit, "fl": "halId_s,title_s,authFullName_s,producedDate_s,publicationDate_s,abstract_s,docType_s,journalTitle_s,publisher_s,volume_s,issue_s,page_s,language_s,doiId_s,uri_s,fileMain_s,openAccess_bool"}
    data, _, _ = await safe_get_json("https://api.archives-ouvertes.fr/search/", params=params)
    works = []
    for item in (data.get("response") or {}).get("docs") or []:
        identifier = item.get("halId_s")
        url = item.get("uri_s") or f"https://hal.science/{identifier}"
        oa = item.get("openAccess_bool") is True or bool(item.get("fileMain_s"))
        works.append(canonical_work(
            "hal", identifier, title=item.get("title_s"), authors=[{"literal": value} for value in item.get("authFullName_s") or []],
            dates={"issued": item.get("producedDate_s") or item.get("publicationDate_s") or "", "online": item.get("producedDate_s") or "", "print": item.get("publicationDate_s") or ""}, year=item.get("publicationDate_s"),
            abstract=item.get("abstract_s"), type=item.get("docType_s") or "other", publication={"container_title": item.get("journalTitle_s") or "", "publisher": item.get("publisher_s") or "", "volume": item.get("volume_s") or "", "issue": item.get("issue_s") or "", "pages": item.get("page_s") or ""},
            language=(item.get("language_s") or [""])[0] if isinstance(item.get("language_s"), list) else item.get("language_s"), identifiers={"doi": item.get("doiId_s"), "isbn13": [], "provider": {}},
            open_access={"is_oa": oa, "license": "", "best_location": _location(url, pdf_url=item.get("fileMain_s"), is_oa=oa)[0]}, locations=_location(url, pdf_url=item.get("fileMain_s"), is_oa=oa), sources=_occurrence("hal", identifier, url),
        ))
    return works


async def search_open_library(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    data, _, _ = await safe_get_json("https://openlibrary.org/search.json", params={"q": query, "limit": limit, "fields": "key,title,author_name,first_publish_year,publish_date,publisher,isbn,language,openlibrary_edition,edition_key,ebook_access"})
    works = []
    for item in data.get("docs") or []:
        identifier = item.get("key") or (item.get("edition_key") or [""])[0]
        url = f"https://openlibrary.org{identifier}" if str(identifier).startswith("/") else f"https://openlibrary.org/works/{identifier}"
        oa = item.get("ebook_access") == "public"
        works.append(canonical_work(
            "open-library", identifier, title=item.get("title"), authors=[{"literal": value} for value in item.get("author_name") or []],
            dates={"issued": (item.get("publish_date") or [item.get("first_publish_year") or ""])[0], "online": "", "print": ""}, year=item.get("first_publish_year"), type="book",
            publication={"container_title": "", "publisher": (item.get("publisher") or [""])[0], "volume": "", "issue": "", "pages": ""}, language=(item.get("language") or [""])[0],
            identifiers={"doi": "", "isbn13": item.get("isbn") or [], "provider": {}}, open_access={"is_oa": oa, "license": "", "best_location": _location(url, is_oa=oa)[0]}, locations=_location(url, is_oa=oa), sources=_occurrence("open-library", identifier, url),
        ))
    return works


async def search_doaj(query: str, filters: dict[str, Any], limit: int, _: str = "") -> list[dict[str, Any]]:
    encoded = quote(query, safe="")
    data, _, _ = await safe_get_json(f"https://doaj.org/api/search/articles/{encoded}", params={"pageSize": limit})
    works = []
    for row in data.get("results") or []:
        bib = row.get("bibjson") or {}
        identifiers = {str(item.get("type", "")).lower(): item.get("id") for item in bib.get("identifier") or [] if isinstance(item, dict)}
        links = bib.get("link") or []
        url = next((item.get("url", "") for item in links if item.get("type") == "fulltext"), "") or f"https://doaj.org/article/{row.get('id')}"
        works.append(canonical_work(
            "doaj-articles", row.get("id"), title=bib.get("title"), authors=[{"literal": item.get("name"), "orcid": item.get("orcid_id")} for item in bib.get("author") or []],
            dates={"issued": bib.get("year") or "", "online": "", "print": ""}, year=bib.get("year"), abstract=bib.get("abstract"), type="journal-article",
            publication={"container_title": (bib.get("journal") or {}).get("title", ""), "publisher": (bib.get("publisher") or {}).get("name", "") if isinstance(bib.get("publisher"), dict) else bib.get("publisher") or "", "volume": (bib.get("journal") or {}).get("volume", ""), "issue": (bib.get("journal") or {}).get("number", ""), "pages": bib.get("start_page") or ""},
            language=(bib.get("language") or [""])[0], identifiers={"doi": identifiers.get("doi"), "pmid": identifiers.get("pmid"), "isbn13": [], "provider": {}},
            peer_reviewed=True,
            open_access={"is_oa": True, "license": ((bib.get("license") or [{}])[0].get("type", "")), "best_location": _location(url, is_oa=True, license_value=((bib.get("license") or [{}])[0].get("type", "")))[0]},
            locations=_location(url, is_oa=True, license_value=((bib.get("license") or [{}])[0].get("type", ""))), sources=_occurrence("doaj-articles", row.get("id"), url),
        ))
    return works


async def search_pubmed(query: str, filters: dict[str, Any], limit: int, contact_email: str = "") -> list[dict[str, Any]]:
    expression = query
    if filters.get("date_from") or filters.get("date_to"):
        expression += f" AND ({filters.get('date_from') or '1500/01/01'}:{filters.get('date_to') or '2100/12/31'}[dp])"
    common = {"tool": "gnosi", "email": contact_email} if contact_email else {"tool": "gnosi"}
    search_data, _, _ = await safe_get_json("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params={**common, "db": "pubmed", "term": expression, "retmode": "json", "retmax": limit})
    ids = (search_data.get("esearchresult") or {}).get("idlist") or []
    if not ids:
        return []
    data, _, _ = await safe_get_json("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params={**common, "db": "pubmed", "id": ",".join(ids), "retmode": "json", "version": "2.0"})
    works = []
    result = data.get("result") or {}
    for pmid in ids:
        item = result.get(pmid) or {}
        article_ids = {str(value.get("idtype", "")).lower(): value.get("value") for value in item.get("articleids") or [] if isinstance(value, dict)}
        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        works.append(canonical_work(
            "pubmed", pmid, title=item.get("title"), authors=[{"literal": author.get("name")} for author in item.get("authors") or []],
            dates={"issued": item.get("pubdate") or item.get("sortpubdate") or "", "online": "", "print": item.get("pubdate") or ""}, year=item.get("pubdate"), type="journal-article",
            publication={"container_title": item.get("fulljournalname") or item.get("source") or "", "publisher": "", "volume": item.get("volume") or "", "issue": item.get("issue") or "", "pages": item.get("pages") or ""},
            language=(item.get("lang") or [""])[0], identifiers={"doi": article_ids.get("doi"), "pmid": pmid, "pmcid": article_ids.get("pmc"), "isbn13": [], "provider": {}},
            open_access={"is_oa": None, "license": "", "best_location": _location(url)[0]}, locations=_location(url), sources=_occurrence("pubmed", pmid, url),
        ))
    return works


def _openalex_work(item: dict[str, Any]) -> dict[str, Any]:
    primary = item.get("primary_location") or {}
    source = primary.get("source") or {}
    url = primary.get("landing_page_url") or item.get("id")
    pdf = primary.get("pdf_url") or ""
    oa = bool((item.get("open_access") or {}).get("is_oa"))
    citations = item.get("cited_by_count")
    return canonical_work(
        "openalex", item.get("id"), title=item.get("display_name"), authors=[{"literal": (entry.get("author") or {}).get("display_name"), "orcid": (entry.get("author") or {}).get("orcid")} for entry in item.get("authorships") or []],
        dates={"issued": item.get("publication_date") or "", "online": item.get("publication_date") or "", "print": ""}, year=item.get("publication_year"), type=item.get("type") or "other",
        publication={"container_title": source.get("display_name") or "", "publisher": source.get("host_organization_name") or "", "volume": item.get("biblio", {}).get("volume", ""), "issue": item.get("biblio", {}).get("issue", ""), "pages": item.get("biblio", {}).get("first_page", "")},
        language=item.get("language"), identifiers={"doi": (item.get("ids") or {}).get("doi"), "pmid": (item.get("ids") or {}).get("pmid"), "pmcid": (item.get("ids") or {}).get("pmcid"), "isbn13": [], "provider": {}},
        open_access={"is_oa": oa, "license": primary.get("license") or "", "best_location": _location(url, pdf_url=pdf, is_oa=oa, license_value=primary.get("license"))[0]}, locations=_location(url, pdf_url=pdf, is_oa=oa, license_value=primary.get("license")),
        sources=_occurrence("openalex", item.get("id"), url, citations=citations), metrics={"citations": {"openalex": citations} if citations is not None else {}},
    )


async def search_openalex(query: str, filters: dict[str, Any], limit: int, api_key: str = "") -> list[dict[str, Any]]:
    params: dict[str, Any] = {"search": query, "per-page": limit}
    if api_key:
        params["api_key"] = api_key
    data, _, _ = await safe_get_json("https://api.openalex.org/works", params=params)
    return [_openalex_work(item) for item in data.get("results") or []]


def _openalex_identifier(work: dict[str, Any]) -> str:
    identifiers = work.get("identifiers") if isinstance(work.get("identifiers"), dict) else {}
    providers = identifiers.get("provider") if isinstance(identifiers.get("provider"), dict) else {}
    provider_id = str(providers.get("openalex") or "")
    if provider_id:
        return provider_id.rsplit("/", 1)[-1]
    if identifiers.get("doi"):
        return f"doi:{identifiers['doi']}"
    return ""


async def openalex_neighbors(
    seeds: list[dict[str, Any]], direction: str, limit: int, api_key: str,
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
        seed_data, _, _ = await safe_get_json(
            f"https://api.openalex.org/works/{quote(identifier, safe=':')}",
            params={"api_key": api_key},
        )
        openalex_id = str(seed_data.get("id") or "").rsplit("/", 1)[-1]
        if not openalex_id:
            continue
        if direction == "forward":
            data, _, _ = await safe_get_json(
                "https://api.openalex.org/works",
                params={"filter": f"cites:{openalex_id}", "sort": "-publication_date", "per_page": per_seed, "api_key": api_key},
            )
            neighbors.extend(_openalex_work(item) for item in data.get("results") or [])
        else:
            reference_ids = [str(value).rsplit("/", 1)[-1] for value in seed_data.get("referenced_works") or [] if value]
            for start in range(0, min(len(reference_ids), per_seed), 100):
                batch = reference_ids[start:start + 100]
                if not batch:
                    continue
                data, _, _ = await safe_get_json(
                    "https://api.openalex.org/works",
                    params={"filter": f"openalex:{'|'.join(batch)}", "per_page": len(batch), "api_key": api_key},
                )
                neighbors.extend(_openalex_work(item) for item in data.get("results") or [])
        if len(neighbors) >= 500:
            break
    return neighbors[:500]


def _semantic_scholar_work(item: dict[str, Any]) -> dict[str, Any]:
    external = item.get("externalIds") or {}
    oa_pdf = item.get("openAccessPdf") or {}
    citations = item.get("citationCount")
    locations = _location(item.get("url"), pdf_url=oa_pdf.get("url"), is_oa=bool(oa_pdf.get("url")), license_value=oa_pdf.get("license"))
    return canonical_work(
        "semantic-scholar", item.get("paperId"), title=item.get("title"), authors=[{"literal": author.get("name")} for author in item.get("authors") or []],
        dates={"issued": item.get("publicationDate") or item.get("year") or "", "online": item.get("publicationDate") or "", "print": ""}, year=item.get("year"), abstract=item.get("abstract"), type=((item.get("publicationTypes") or ["other"])[0]),
        publication={"container_title": item.get("venue") or "", "publisher": "", "volume": "", "issue": "", "pages": ""}, identifiers={"doi": external.get("DOI"), "pmid": external.get("PubMed"), "pmcid": external.get("PubMedCentral"), "arxiv": external.get("ArXiv"), "isbn13": [], "provider": {}},
        open_access={"is_oa": bool(oa_pdf.get("url")), "license": oa_pdf.get("license") or "", "best_location": locations[0] if locations else None},
        locations=locations, sources=_occurrence("semantic-scholar", item.get("paperId"), item.get("url"), citations=citations), metrics={"citations": {"semantic-scholar": citations} if citations is not None else {}},
    )


async def search_semantic_scholar(query: str, filters: dict[str, Any], limit: int, api_key: str = "") -> list[dict[str, Any]]:
    headers = {"x-api-key": api_key} if api_key else {}
    data, _, _ = await safe_get_json("https://api.semanticscholar.org/graph/v1/paper/search", params={"query": query, "limit": min(limit, 100), "fields": "paperId,title,abstract,year,authors,venue,publicationTypes,publicationDate,externalIds,url,openAccessPdf,citationCount"}, headers=headers)
    return [_semantic_scholar_work(item) for item in data.get("data") or []]


def _semantic_scholar_identifier(work: dict[str, Any]) -> str:
    identifiers = work.get("identifiers") if isinstance(work.get("identifiers"), dict) else {}
    providers = identifiers.get("provider") if isinstance(identifiers.get("provider"), dict) else {}
    semantic_id = providers.get("semantic-scholar")
    if semantic_id:
        return str(semantic_id)
    for prefix, key in (("DOI", "doi"), ("PMID", "pmid"), ("PMCID", "pmcid"), ("ARXIV", "arxiv")):
        if identifiers.get(key):
            return f"{prefix}:{identifiers[key]}"
    return ""


async def semantic_scholar_neighbors(
    seeds: list[dict[str, Any]], direction: str, limit: int, api_key: str,
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
        data, _, _ = await safe_get_json(
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


async def search_generic_json(definition: dict[str, Any], query: str, filters: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    """Execute one bounded declarative GET/JSON repository definition."""
    base_url = validate_public_https_url(str(definition.get("base_url") or ""))
    query_parameter = clean_text(definition.get("query_parameter") or "q", 100)
    base_params = {str(key)[:100]: clean_text(value, 1_000) for key, value in (definition.get("static_filters") or {}).items()}
    base_params[query_parameter] = query
    pagination = str(definition.get("pagination") or "none")
    collected: list[Any] = []
    final_url = base_url
    page = 1
    offset = 0
    cursor = ""
    next_url = base_url

    def value_at_path(record: Any, path: Any, default: Any = "") -> Any:
        value = record
        for part in str(path or "").split("."):
            if not part:
                continue
            value = value.get(part) if isinstance(value, dict) else default
        return value if value is not None else default

    for _page_index in range(10):
        remaining = limit - len(collected)
        if remaining <= 0:
            break
        params = dict(base_params) if next_url == base_url else {}
        params[clean_text(definition.get("limit_parameter") or "limit", 100)] = remaining
        if pagination == "page":
            params[clean_text(definition.get("page_parameter") or "page", 100)] = page
        elif pagination == "offset":
            params[clean_text(definition.get("offset_parameter") or "offset", 100)] = offset
        elif pagination == "cursor" and cursor:
            params[clean_text(definition.get("cursor_parameter") or "cursor", 100)] = cursor
        data, final_url, response_headers = await safe_get_json(next_url, params=params)
        records = value_at_path(data, definition.get("results_path") or "results", [])
        if not isinstance(records, list):
            raise ConnectorError("The configured results path does not resolve to a JSON list.")
        collected.extend(records[:remaining])
        if pagination == "none" or not records or len(collected) >= limit:
            break
        if pagination == "page":
            page += 1
        elif pagination == "offset":
            offset += len(records)
        elif pagination == "cursor":
            next_cursor = value_at_path(data, definition.get("next_cursor_path") or "next_cursor", "")
            if not next_cursor or str(next_cursor) == cursor:
                break
            cursor = clean_text(next_cursor, 2_000)
        elif pagination == "link":
            link_header = str(response_headers.get("link") or response_headers.get("Link") or "")
            match = next((match for match in re.finditer(r"<([^>]+)>\s*;\s*rel=\"?([^\",;]+)\"?", link_header) if match.group(2).strip().lower() == "next"), None)
            if match is None:
                break
            next_url = validate_public_https_url(urljoin(final_url, match.group(1)))
            base_params = {}
    mapping = definition.get("mapping") if isinstance(definition.get("mapping"), dict) else {}

    def value_at(record: Any, path: Any, default: Any = "") -> Any:
        return value_at_path(record, path, default)

    provider = clean_text(definition.get("id") or definition.get("name") or "custom-rest", 100)
    works = []
    for record in collected[:limit]:
        provider_id = value_at(record, mapping.get("provider_id") or mapping.get("id")) or value_at(record, mapping.get("doi"))
        url = value_at(record, mapping.get("url")) or final_url
        authors = value_at(record, mapping.get("authors"), [])
        citations = value_at(record, mapping.get("citations"), None)
        works.append(canonical_work(
            provider, provider_id, title=value_at(record, mapping.get("title")), authors=authors,
            dates={"issued": value_at(record, mapping.get("date")), "online": "", "print": ""}, year=value_at(record, mapping.get("year")) or value_at(record, mapping.get("date")),
            abstract=value_at(record, mapping.get("abstract")), type=value_at(record, mapping.get("type"), "other"), publication={"container_title": value_at(record, mapping.get("container") or mapping.get("publication")), "publisher": value_at(record, mapping.get("publisher")), "volume": value_at(record, mapping.get("volume")), "issue": value_at(record, mapping.get("issue")), "pages": value_at(record, mapping.get("pages"))},
            language=value_at(record, mapping.get("language")), identifiers={"doi": value_at(record, mapping.get("doi")), "pmid": value_at(record, mapping.get("pmid")), "pmcid": value_at(record, mapping.get("pmcid")), "arxiv": value_at(record, mapping.get("arxiv")), "isbn13": value_at(record, mapping.get("isbn") or mapping.get("isbn13"), []), "provider": {}},
            peer_reviewed=_truthy_provider_value(value_at(record, mapping.get("peer_reviewed"), None)),
            open_access={"is_oa": value_at(record, mapping.get("is_oa"), None), "license": value_at(record, mapping.get("license")), "best_location": _location(url, pdf_url=value_at(record, mapping.get("pdf_url")), is_oa=value_at(record, mapping.get("is_oa"), None), license_value=value_at(record, mapping.get("license")))[0]},
            locations=_location(url, pdf_url=value_at(record, mapping.get("pdf_url")), is_oa=value_at(record, mapping.get("is_oa"), None), license_value=value_at(record, mapping.get("license"))), sources=_occurrence(provider, provider_id, url, citations=citations), metrics={"citations": {provider: citations} if citations not in (None, "") else {}},
        ))
    return works


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
}


async def search_source(source_id: str, query: str, filters: dict[str, Any], limit: int, credential: str = "", definition: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Dispatch a built-in or custom REST connector."""
    if definition and definition.get("kind") == "rest":
        return filter_works(await search_generic_json(definition, query, filters, limit), filters)
    searcher = SEARCHERS.get(source_id)
    if searcher is None:
        raise ConnectorError("This source requires a local index or a configured provider adapter.")
    works = await searcher(query, filters, max(1, min(int(limit), 100)), credential)
    return filter_works(works, filters)


def parse_oai_page(body: bytes, source: dict[str, Any]) -> dict[str, Any]:
    """Parse one OAI ListRecords response into canonical works and cursor state."""
    root = parse_safe_xml(body)
    errors = [clean_text(node.text) for node in root.iter() if str(node.tag).endswith("error")]
    if errors:
        raise ConnectorError(errors[0] or "The OAI repository returned an error.")
    records = [node for node in root.iter() if str(node.tag).endswith("record")]
    works: list[dict[str, Any]] = []
    deleted: list[str] = []
    provider = clean_text(source.get("id") or source.get("name") or "oai", 100)
    for record in records:
        header = next((node for node in record.iter() if str(node.tag).endswith("header")), None)
        if header is None:
            continue
        identifier = _xml_text(header, "identifier")
        if header.attrib.get("status") == "deleted":
            if identifier:
                deleted.append(identifier)
            continue
        titles = _xml_texts(record, "title")
        creators = _xml_texts(record, "creator")
        descriptions = _xml_texts(record, "description")
        dates = _xml_texts(record, "date")
        identifiers = _xml_texts(record, "identifier")
        relations = _xml_texts(record, "relation")
        doi = next((normalize_doi(value) for value in identifiers + relations if normalize_doi(value)), "")
        isbn_values = [value for value in identifiers if re.search(r"(?:97[89])?[\dXx -]{10,17}", value)]
        url = next((value for value in identifiers if value.startswith("https://")), "")
        works.append(canonical_work(
            provider, identifier, title=titles[0] if titles else identifier, authors=[{"literal": value} for value in creators],
            dates={"issued": dates[0] if dates else "", "online": "", "print": ""}, year=dates[0] if dates else None,
            abstract=descriptions[0] if descriptions else "", type=(_xml_texts(record, "type") or ["other"])[0],
            publication={"container_title": (_xml_texts(record, "source") or [""])[0], "publisher": (_xml_texts(record, "publisher") or [""])[0], "volume": "", "issue": "", "pages": ""},
            language=(_xml_texts(record, "language") or [""])[0], identifiers={"doi": doi, "isbn13": isbn_values, "provider": {}},
            open_access={"is_oa": None, "license": (_xml_texts(record, "rights") or [""])[0], "best_location": _location(url)[0] if url else None}, locations=_location(url), sources=_occurrence(provider, identifier, url),
        ))
    token_node = next((node for node in root.iter() if str(node.tag).endswith("resumptionToken")), None)
    token = clean_text(token_node.text, 4_000) if token_node is not None else ""
    complete_size = None
    cursor = None
    if token_node is not None:
        try:
            complete_size = int(token_node.attrib.get("completeListSize", ""))
        except (TypeError, ValueError):
            complete_size = None
        try:
            cursor = int(token_node.attrib.get("cursor", ""))
        except (TypeError, ValueError):
            cursor = None
    return {"works": works, "deleted": deleted, "resumption_token": token, "complete_list_size": complete_size, "cursor": cursor}


async def fetch_oai_page(source: dict[str, Any], *, resumption_token: str = "", from_date: str = "") -> dict[str, Any]:
    """Fetch and parse one authorized OAI-PMH ListRecords page."""
    base_url = validate_public_https_url(str(source.get("base_url") or ""))
    if resumption_token:
        params = {"verb": "ListRecords", "resumptionToken": resumption_token}
    else:
        params = {"verb": "ListRecords", "metadataPrefix": clean_text(source.get("metadata_prefix") or "oai_dc", 100)}
        if source.get("set"):
            params["set"] = clean_text(source.get("set"), 500)
        if from_date:
            params["from"] = from_date
    body, _, _ = await safe_get_bytes(base_url, params=params, accepted_types=("application/xml", "text/xml"))
    return parse_oai_page(body, source)


async def enrich_unpaywall(work: dict[str, Any], email: str) -> dict[str, Any]:
    """Add only verified Unpaywall OA locations to one DOI-bearing work."""
    doi = normalize_doi((work.get("identifiers") or {}).get("doi"))
    if not doi or not email:
        return work
    data, _, _ = await safe_get_json(f"https://api.unpaywall.org/v2/{quote(doi, safe='')}", params={"email": email})
    best = data.get("best_oa_location") or {}
    locations = []
    for item in data.get("oa_locations") or []:
        if not isinstance(item, dict):
            continue
        locations.extend(_location(item.get("url_for_landing_page") or item.get("url"), pdf_url=item.get("url_for_pdf"), is_oa=True, license_value=item.get("license")))
    if locations:
        work["locations"] = work.get("locations", []) + locations
        work["open_access"] = {"is_oa": bool(data.get("is_oa")), "license": best.get("license") or "", "best_location": _location(best.get("url_for_landing_page") or best.get("url"), pdf_url=best.get("url_for_pdf"), is_oa=True, license_value=best.get("license"))[0] if best else locations[0]}
        work.setdefault("provenance", {}).setdefault("open_access", []).append("unpaywall")
    return work


def run(coroutine: Any) -> Any:
    """Execute one connector coroutine from a durable worker thread."""
    return asyncio.run(coroutine)
