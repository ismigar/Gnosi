"""XML, arXiv, and OAI-PMH provider adapters."""

from __future__ import annotations

import re
from typing import Any

from defusedxml import ElementTree as DefusedElementTree

from backend.domains.literature.connectors.normalization import _location, _occurrence
from backend.domains.literature.connectors.runtime import current_runtime
from backend.domains.literature.connectors.transport import ConnectorError
from backend.services.literature_models import canonical_work, clean_text, normalize_doi


def _xml_text(element: Any, suffix: str) -> str:
    for child in element.iter():
        if str(child.tag).endswith(suffix):
            return str(clean_text(child.text))
    return ""


def _xml_texts(element: Any, suffix: str) -> list[str]:
    return [
        clean_text(child.text)
        for child in element.iter()
        if str(child.tag).endswith(suffix) and clean_text(child.text)
    ]


def parse_safe_xml(body: bytes) -> Any:
    """Parse bounded XML with entity and external-reference defenses."""
    upper = body[:100_000].upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ConnectorError("The repository returned unsafe XML declarations.")
    try:
        return DefusedElementTree.fromstring(body)
    except Exception as exc:  # defusedxml exposes several security exception types
        raise ConnectorError("The repository returned invalid or unsafe XML.") from exc


async def search_arxiv(
    query: str, filters: dict[str, Any], limit: int, _: str = ""
) -> list[dict[str, Any]]:
    params = {
        "search_query": f"all:{query}",
        "start": 0,
        "max_results": limit,
        "sortBy": "relevance",
    }
    runtime = current_runtime()
    body, _final_url, _response_headers = await runtime.safe_get_bytes(
        "https://export.arxiv.org/api/query",
        params=params,
        accepted_types=("application/atom+xml", "application/xml", "text/xml"),
    )
    root = runtime.parse_safe_xml(body)
    works = []
    for entry in [item for item in root.iter() if str(item.tag).endswith("entry")]:
        identifier = _xml_text(entry, "id").rsplit("/", 1)[-1]
        url = _xml_text(entry, "id")
        links = [
            {key.rsplit("}", 1)[-1]: value for key, value in link.attrib.items()}
            for link in entry
            if str(link.tag).endswith("link")
        ]
        pdf = next(
            (item.get("href", "") for item in links if item.get("type") == "application/pdf"), ""
        )
        authors = [
            {"literal": _xml_text(author, "name")}
            for author in entry
            if str(author.tag).endswith("author")
        ]
        published = _xml_text(entry, "published")
        works.append(
            canonical_work(
                "arxiv",
                identifier,
                title=_xml_text(entry, "title"),
                authors=authors,
                dates={"issued": published, "online": published, "print": ""},
                year=published,
                abstract=_xml_text(entry, "summary"),
                type="preprint",
                publication={
                    "container_title": "arXiv",
                    "publisher": "Cornell University",
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                identifiers={
                    "doi": _xml_text(entry, "doi"),
                    "arxiv": identifier,
                    "isbn13": [],
                    "provider": {},
                },
                open_access={
                    "is_oa": True,
                    "license": "",
                    "best_location": _location(url, pdf_url=pdf, is_oa=True)[0],
                },
                locations=_location(url, pdf_url=pdf, is_oa=True),
                sources=_occurrence("arxiv", identifier, url),
            )
        )
    return works


def parse_oai_page(body: bytes, source: dict[str, Any]) -> dict[str, Any]:
    """Parse one OAI ListRecords response into canonical works and cursor state."""
    root = current_runtime().parse_safe_xml(body)
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
        doi = next(
            (normalize_doi(value) for value in identifiers + relations if normalize_doi(value)), ""
        )
        isbn_values = [
            value for value in identifiers if re.search(r"(?:97[89])?[\dXx -]{10,17}", value)
        ]
        url = next((value for value in identifiers if value.startswith("https://")), "")
        works.append(
            canonical_work(
                provider,
                identifier,
                title=titles[0] if titles else identifier,
                authors=[{"literal": value} for value in creators],
                dates={"issued": dates[0] if dates else "", "online": "", "print": ""},
                year=dates[0] if dates else None,
                abstract=descriptions[0] if descriptions else "",
                type=(_xml_texts(record, "type") or ["other"])[0],
                publication={
                    "container_title": (_xml_texts(record, "source") or [""])[0],
                    "publisher": (_xml_texts(record, "publisher") or [""])[0],
                    "volume": "",
                    "issue": "",
                    "pages": "",
                },
                language=(_xml_texts(record, "language") or [""])[0],
                identifiers={"doi": doi, "isbn13": isbn_values, "provider": {}},
                open_access={
                    "is_oa": None,
                    "license": (_xml_texts(record, "rights") or [""])[0],
                    "best_location": _location(url)[0] if url else None,
                },
                locations=_location(url),
                sources=_occurrence(provider, identifier, url),
            )
        )
    token_node = next(
        (node for node in root.iter() if str(node.tag).endswith("resumptionToken")), None
    )
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
    return {
        "works": works,
        "deleted": deleted,
        "resumption_token": token,
        "complete_list_size": complete_size,
        "cursor": cursor,
    }


async def fetch_oai_page(
    source: dict[str, Any], *, resumption_token: str = "", from_date: str = ""
) -> dict[str, Any]:
    """Fetch and parse one authorized OAI-PMH ListRecords page."""
    runtime = current_runtime()
    base_url = runtime.validate_public_https_url(str(source.get("base_url") or ""))
    if resumption_token:
        params = {"verb": "ListRecords", "resumptionToken": resumption_token}
    else:
        params = {
            "verb": "ListRecords",
            "metadataPrefix": clean_text(source.get("metadata_prefix") or "oai_dc", 100),
        }
        if source.get("set"):
            params["set"] = clean_text(source.get("set"), 500)
        if from_date:
            params["from"] = from_date
    body, _final_url, _response_headers = await runtime.safe_get_bytes(
        base_url, params=params, accepted_types=("application/xml", "text/xml")
    )
    return runtime.parse_oai_page(body, source)
