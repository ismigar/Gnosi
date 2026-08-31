"""Fallback reference metadata derived from a PDF and its filename."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import cast


Metadata = dict[str, object]


@dataclass(frozen=True)
class PdfFallbackDependencies:
    """PDF metadata, author parsing, mapping, and citation-key ports."""

    embedded_metadata: Callable[[bytes], Metadata]
    title_from_filename: Callable[[str], str]
    parse_authors: Callable[[str], Sequence[Mapping[str, object]]]
    map_zotero_item: Callable[[Metadata], Metadata]
    inject_citation_key: Callable[[Metadata], Metadata]


def _creators(author: str, dependencies: PdfFallbackDependencies) -> list[Metadata]:
    normalized = re.sub(
        r"\s+and\s+|\s*&\s*|[\r\n]+",
        "; ",
        author,
        flags=re.IGNORECASE,
    )
    creators: list[Metadata] = []
    for parsed_author in dependencies.parse_authors(normalized):
        creator: Metadata = {"creatorType": "author"}
        family = parsed_author.get("family")
        given = parsed_author.get("given")
        if family:
            creator["lastName"] = family
        if given:
            creator["firstName"] = given
        if creator.get("lastName") or creator.get("firstName"):
            creators.append(creator)
    return creators


def pdf_fallback_metadata(
    data: bytes,
    filename: str,
    identifiers: Metadata | None,
    dependencies: PdfFallbackDependencies,
) -> Metadata:
    """Build one citable Zotero document when online resolution produced nothing."""
    embedded = dependencies.embedded_metadata(data)
    title = embedded.get("title") or dependencies.title_from_filename(filename)
    if not title:
        return {}
    item: Metadata = {"itemType": "document", "title": title}
    ids = identifiers or {}
    if ids.get("doi"):
        item["DOI"] = ids["doi"]
    if ids.get("arxiv"):
        item["url"] = f"https://arxiv.org/abs/{ids['arxiv']}"
    author = embedded.get("author")
    if author:
        creators = _creators(cast(str, author), dependencies)
        if creators:
            item["creators"] = creators
    if embedded.get("year"):
        item["date"] = embedded["year"]
    return dependencies.inject_citation_key(dependencies.map_zotero_item(item))


__all__ = [
    "Metadata",
    "PdfFallbackDependencies",
    "pdf_fallback_metadata",
]
