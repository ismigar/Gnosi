"""Open Library payload normalization."""

from __future__ import annotations

import re
from typing import Any

from backend.domains.vault.citations.normalizers.names import split_full_name
from backend.domains.vault.citations.normalizers.types import Creator, ZoteroItem


def _first_name(values: object) -> str:
    if not isinstance(values, list) or not values:
        return ""
    first = values[0]
    if isinstance(first, dict):
        return str(first.get("name") or "")
    return str(first)


def _book_creators(raw_authors: object) -> list[Creator]:
    creators: list[Creator] = []
    if not isinstance(raw_authors, list):
        return creators
    for author in raw_authors:
        if not isinstance(author, dict):
            continue
        creator = split_full_name(str(author.get("name") or ""))
        if creator:
            creators.append(creator)
    return creators


def _book_year(value: object) -> str | None:
    if not value:
        return None
    match = re.search(r"\b(19|20)\d{2}\b", str(value))
    return match.group(0) if match else None


def _book_isbn(identifiers: object) -> object:
    if not isinstance(identifiers, dict):
        return None
    for key in ("isbn_13", "isbn_10"):
        values = identifiers.get(key)
        if isinstance(values, list) and values:
            return values[0]
    return None


def openlibrary_to_zotero_item(book: dict[str, Any]) -> ZoteroItem:
    """Convert an Open Library ``bibkeys`` result into a Zotero item."""
    if not isinstance(book, dict):
        return {}
    item: ZoteroItem = {"itemType": "book"}
    title = str(book.get("title") or "").strip()
    subtitle = str(book.get("subtitle") or "").strip()
    if title and subtitle:
        item["title"] = f"{title}: {subtitle}"
    elif title or subtitle:
        item["title"] = title or subtitle
    creators = _book_creators(book.get("authors"))
    if creators:
        item["creators"] = creators
    year = _book_year(book.get("publish_date"))
    if year:
        item["date"] = year
    publisher = _first_name(book.get("publishers"))
    if publisher:
        item["publisher"] = publisher
    place = _first_name(book.get("publish_places"))
    if place:
        item["place"] = place
    if book.get("number_of_pages"):
        item["numPages"] = str(book["number_of_pages"])
    isbn = _book_isbn(book.get("identifiers"))
    if isbn:
        item["ISBN"] = isbn
    return item


__all__ = ["openlibrary_to_zotero_item"]
