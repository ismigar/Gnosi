"""PubMed E-utilities payload normalization."""

from __future__ import annotations

import re
from typing import Any

from backend.domains.vault.citations.normalizers.names import pubmed_name_to_creator
from backend.domains.vault.citations.normalizers.types import Creator, ZoteroItem


def _creators(raw_authors: object) -> list[Creator]:
    creators: list[Creator] = []
    if not isinstance(raw_authors, list):
        return creators
    for author in raw_authors:
        if not isinstance(author, dict) or author.get("authtype", "Author") != "Author":
            continue
        creator = pubmed_name_to_creator(str(author.get("name") or ""))
        if creator:
            creators.append(creator)
    return creators


def _doi(article_ids: object) -> object:
    if not isinstance(article_ids, list):
        return None
    for article_id in article_ids:
        if not isinstance(article_id, dict):
            continue
        if article_id.get("idtype") == "doi" and article_id.get("value"):
            return article_id["value"]
    return None


def _copy_bibliographic_fields(doc: dict[str, Any], item: ZoteroItem) -> None:
    journal = doc.get("fulljournalname") or doc.get("source")
    if journal:
        item["publicationTitle"] = journal
    field_map = (("volume", "volume"), ("issue", "issue"), ("pages", "pages"))
    for source, target in field_map:
        value = doc.get(source)
        if value:
            item[target] = str(value)


def pubmed_to_zotero_item(doc: dict[str, Any]) -> ZoteroItem:
    """Convert one PubMed esummary document into a Zotero item."""
    if not isinstance(doc, dict):
        return {}
    item: ZoteroItem = {"itemType": "journalArticle"}
    if doc.get("title"):
        item["title"] = str(doc["title"]).rstrip(".")
    creators = _creators(doc.get("authors"))
    if creators:
        item["creators"] = creators
    date_raw = str(doc.get("pubdate") or doc.get("epubdate") or "")
    year = re.search(r"\d{4}", date_raw)
    if year:
        item["date"] = year.group(0)
    _copy_bibliographic_fields(doc, item)
    doi = _doi(doc.get("articleids"))
    if doi:
        item["DOI"] = doi
    languages = doc.get("lang")
    if isinstance(languages, list) and languages:
        item["language"] = languages[0]
    if doc.get("uid"):
        item["PMID"] = str(doc["uid"])
    return item


__all__ = ["pubmed_to_zotero_item"]
