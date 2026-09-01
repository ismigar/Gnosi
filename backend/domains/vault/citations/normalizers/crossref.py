"""Crossref payload normalization."""

from __future__ import annotations

from typing import Any

from backend.domains.vault.citations.normalizers.types import Creator, ZoteroItem

CROSSREF_TYPE_TO_ZOTERO: dict[str, str] = {
    "journal-article": "journalArticle",
    "book": "book",
    "book-chapter": "bookSection",
    "proceedings-article": "conferencePaper",
    "thesis": "thesis",
    "report": "report",
    "posted-content": "preprint",
    "dataset": "dataset",
    "standard": "standard",
}


def _first(value: object) -> object:
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _creators(raw_authors: object) -> list[Creator]:
    creators: list[Creator] = []
    if not isinstance(raw_authors, list):
        return creators
    for raw_author in raw_authors:
        if not isinstance(raw_author, dict):
            continue
        family = str(raw_author.get("family") or "").strip()
        given = str(raw_author.get("given") or "").strip()
        name = str(raw_author.get("name") or "").strip()
        if family:
            creator: Creator = {"creatorType": "author", "lastName": family}
            if given:
                creator["firstName"] = given
            creators.append(creator)
        elif name:
            creators.append({"creatorType": "author", "name": name})
    return creators


def _publication_year(work: dict[str, Any]) -> str | None:
    for key in ("published-print", "published-online", "issued"):
        date_value = work.get(key)
        if not isinstance(date_value, dict):
            continue
        parts = date_value.get("date-parts")
        if not isinstance(parts, list) or not parts or not isinstance(parts[0], list):
            continue
        if not parts[0]:
            continue
        try:
            return str(int(parts[0][0]))
        except (TypeError, ValueError):
            continue
    return None


def _copy_simple_fields(work: dict[str, Any], item: ZoteroItem) -> None:
    field_map = (
        ("publisher", "publisher"),
        ("volume", "volume"),
        ("issue", "issue"),
        ("page", "pages"),
        ("DOI", "DOI"),
        ("URL", "url"),
        ("language", "language"),
    )
    for source, target in field_map:
        value = work.get(source)
        if value:
            item[target] = value


def crossref_to_zotero_item(work: dict[str, Any]) -> ZoteroItem:
    """Convert one Crossref work payload into a canonical Zotero item."""
    if not isinstance(work, dict):
        return {}
    item: ZoteroItem = {}
    crossref_type = work.get("type")
    if crossref_type:
        type_name = str(crossref_type)
        item["itemType"] = CROSSREF_TYPE_TO_ZOTERO.get(type_name, crossref_type)
    title = _first(work.get("title"))
    if title:
        item["title"] = title
    creators = _creators(work.get("author"))
    if creators:
        item["creators"] = creators
    year = _publication_year(work)
    if year:
        item["date"] = year
    container = _first(work.get("container-title"))
    if container:
        item["publicationTitle"] = container
    _copy_simple_fields(work, item)
    isbn = _first(work.get("ISBN"))
    if isbn:
        item["ISBN"] = isbn
    issn = _first(work.get("ISSN"))
    if issn:
        item["ISSN"] = issn
    return item


__all__ = ["CROSSREF_TYPE_TO_ZOTERO", "crossref_to_zotero_item"]
