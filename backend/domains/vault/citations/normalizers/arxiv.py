"""arXiv Atom payload normalization."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from backend.domains.vault.citations.normalizers.names import split_full_name
from backend.domains.vault.citations.normalizers.types import Creator, ZoteroItem

ATOM_NS = "http://www.w3.org/2005/Atom"
ARXIV_NS = "http://arxiv.org/schemas/atom"
NAMESPACES = {"atom": ATOM_NS, "arxiv": ARXIV_NS}


def _text(entry: ET.Element, path: str) -> str:
    element = entry.find(path, NAMESPACES)
    return str(element.text or "").strip() if element is not None else ""


def _authors(entry: ET.Element) -> list[Creator]:
    creators: list[Creator] = []
    for author in entry.findall("atom:author", NAMESPACES):
        creator = split_full_name(_text(author, "atom:name"))
        if creator:
            creators.append(creator)
    return creators


def arxiv_to_zotero_item(entry_xml: str) -> ZoteroItem:
    """Convert an arXiv Atom response into a Zotero preprint item."""
    if not entry_xml or not isinstance(entry_xml, str):
        return {}
    try:
        root = ET.fromstring(entry_xml)
    except ET.ParseError:
        return {}
    entry = root.find("atom:entry", NAMESPACES)
    if entry is None:
        return {}
    item: ZoteroItem = {"itemType": "preprint"}
    title = _text(entry, "atom:title")
    if title:
        item["title"] = re.sub(r"\s+", " ", title).strip()
    creators = _authors(entry)
    if creators:
        item["creators"] = creators
    published = _text(entry, "atom:published")
    year = re.match(r"(\d{4})", published)
    if year:
        item["date"] = year.group(1)
    field_map = (
        ("arxiv:doi", "DOI"),
        ("arxiv:journal_ref", "publicationTitle"),
        ("atom:id", "url"),
    )
    for path, field in field_map:
        value = _text(entry, path)
        if value:
            item[field] = value
    return item


__all__ = ["arxiv_to_zotero_item"]
