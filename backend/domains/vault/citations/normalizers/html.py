"""HTML metadata normalization for citation capture."""

from __future__ import annotations

import re

from backend.domains.vault.citations.normalizers.identifiers import (
    normalize_doi,
    normalize_isbn,
)
from backend.domains.vault.citations.normalizers.types import Creator, MetaPair, ZoteroItem

META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
META_KEY_RE = re.compile(
    r"\b(?:name|property)\s*=\s*[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
META_CONTENT_RE = re.compile(
    r"\bcontent\s*=\s*[\"']([^\"']*)[\"']",
    re.IGNORECASE,
)


def parse_meta_tags(html: str) -> tuple[list[MetaPair], list[MetaPair], list[MetaPair]]:
    """Extract Highwire, Open Graph and Dublin Core metadata pairs."""
    citations: list[MetaPair] = []
    open_graph: list[MetaPair] = []
    dublin_core: list[MetaPair] = []
    for tag in META_TAG_RE.findall(html):
        key_match = META_KEY_RE.search(tag)
        content_match = META_CONTENT_RE.search(tag)
        if not key_match or content_match is None:
            continue
        key = key_match.group(1)
        value = content_match.group(1)
        lowered = key.lower()
        if lowered.startswith("citation_"):
            citations.append((key[len("citation_") :], value))
        elif lowered.startswith("og:"):
            open_graph.append((key[len("og:") :], value))
        elif lowered.startswith("dc."):
            dublin_core.append((key[len("dc.") :], value))
    return citations, open_graph, dublin_core


def _source_values(
    citations: list[MetaPair],
    open_graph: list[MetaPair],
    dublin_core: list[MetaPair],
) -> dict[str, str]:
    sources: dict[str, str] = {}
    for source in (open_graph, dublin_core, citations):
        for key, value in source:
            sources[key.lower()] = value
    return sources


def _first_source(sources: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = sources.get(key.lower())
        if value:
            return value
    return None


def _author_strings(
    citations: list[MetaPair],
    dublin_core: list[MetaPair],
    sources: dict[str, str],
) -> list[str]:
    authors = [value for key, value in citations if key.lower() == "author"]
    authors.extend(value for key, value in dublin_core if key.lower() in ("creator", "contributor"))
    fallback = _first_source(sources, "author")
    if not authors and fallback:
        authors = [fallback]
    return authors


def _creator(raw_author: str) -> Creator | None:
    normalized = raw_author.strip()
    if not normalized:
        return None
    if "," in normalized:
        family, _, given = normalized.partition(",")
        family = family.strip()
        given = given.strip()
        if not family:
            return None
        creator: Creator = {"creatorType": "author", "lastName": family}
        if given:
            creator["firstName"] = given
        return creator
    tokens = normalized.split()
    if len(tokens) >= 2:
        return {
            "creatorType": "author",
            "lastName": tokens[-1],
            "firstName": " ".join(tokens[:-1]),
        }
    return {"creatorType": "author", "name": normalized}


def _unique_creators(authors: list[str]) -> list[Creator]:
    creators: list[Creator] = []
    seen: set[str] = set()
    for raw_author in authors:
        creator = _creator(raw_author)
        if not creator:
            continue
        token = f"{creator.get('lastName', creator.get('name', '')).lower()}|"
        token += creator.get("firstName", "").lower()
        if token in seen:
            continue
        seen.add(token)
        creators.append(creator)
    return creators


def _copy_identity_fields(sources: dict[str, str], item: ZoteroItem) -> None:
    doi_raw = _first_source(sources, "doi")
    if doi_raw:
        item["DOI"] = normalize_doi(doi_raw) or doi_raw
    isbn_raw = _first_source(sources, "isbn")
    if isbn_raw:
        item["ISBN"] = normalize_isbn(isbn_raw) or isbn_raw


def _copy_issue_fields(sources: dict[str, str], item: ZoteroItem) -> None:
    for field in ("volume", "issue"):
        value = _first_source(sources, field)
        if value:
            item[field] = value
    first = _first_source(sources, "firstpage")
    last = _first_source(sources, "lastpage")
    if first and last:
        item["pages"] = f"{first}-{last}"
    elif first:
        item["pages"] = first
    language = _first_source(sources, "language")
    if language:
        item["language"] = language


def html_meta_to_zotero_item(html: str, url: str) -> ZoteroItem:
    """Convert Highwire, Dublin Core and Open Graph tags into a Zotero item."""
    if not isinstance(html, str):
        return {"url": url} if url else {}
    citations, open_graph, dublin_core = parse_meta_tags(html)
    sources = _source_values(citations, open_graph, dublin_core)
    item: ZoteroItem = {}
    title = _first_source(sources, "title")
    fallback_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    fallback_title = fallback_match.group(1).strip() if fallback_match else None
    if title:
        item["title"] = title.strip()
    elif fallback_title:
        item["title"] = fallback_title
    creators = _unique_creators(_author_strings(citations, dublin_core, sources))
    if creators:
        item["creators"] = creators
    year_raw = _first_source(sources, "date", "publication_date")
    year = re.search(r"\b(19|20)\d{2}\b", year_raw) if year_raw else None
    if year:
        item["date"] = year.group(0)
    journal = _first_source(sources, "journal_title")
    if journal:
        item["publicationTitle"] = journal
    publisher = _first_source(sources, "publisher")
    if publisher:
        item["publisher"] = publisher
    _copy_identity_fields(sources, item)
    _copy_issue_fields(sources, item)
    if url:
        item["url"] = url
    return item


__all__ = ["html_meta_to_zotero_item", "parse_meta_tags"]
