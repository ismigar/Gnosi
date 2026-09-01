"""Typed normalizers from external citation payloads to Zotero items."""

from backend.domains.vault.citations.normalizers.arxiv import arxiv_to_zotero_item
from backend.domains.vault.citations.normalizers.crossref import (
    CROSSREF_TYPE_TO_ZOTERO,
    crossref_to_zotero_item,
)
from backend.domains.vault.citations.normalizers.html import (
    html_meta_to_zotero_item,
    parse_meta_tags,
)
from backend.domains.vault.citations.normalizers.identifiers import (
    DOI_RE,
    normalize_doi,
    normalize_isbn,
)
from backend.domains.vault.citations.normalizers.names import (
    pubmed_name_to_creator,
    split_full_name,
)
from backend.domains.vault.citations.normalizers.open_library import (
    openlibrary_to_zotero_item,
)
from backend.domains.vault.citations.normalizers.pubmed import pubmed_to_zotero_item

__all__ = [
    "CROSSREF_TYPE_TO_ZOTERO",
    "DOI_RE",
    "arxiv_to_zotero_item",
    "crossref_to_zotero_item",
    "html_meta_to_zotero_item",
    "normalize_doi",
    "normalize_isbn",
    "openlibrary_to_zotero_item",
    "parse_meta_tags",
    "pubmed_name_to_creator",
    "pubmed_to_zotero_item",
    "split_full_name",
]
