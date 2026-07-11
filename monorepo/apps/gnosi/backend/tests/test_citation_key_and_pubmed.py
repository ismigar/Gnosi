"""Unit tests for Citation Key generation (P0) and PubMed mapping (P3).

Pure functions — no live backend required.

    docker exec gnosi_backend python -m pytest backend/tests/test_citation_key_and_pubmed.py -v
"""
from __future__ import annotations

import pytest

from backend.api.vault_routes import (
    generate_citation_key,
    _alpha_suffix,
    _first_author_family,
    _normalize_pmid,
    _pubmed_author_to_canonical,
    _pubmed_to_recursos,
    _identifiers_from_text,
    _zotero_creators_to_authors,
    _zotero_item_to_recursos,
)


# --- P0: Citation Key -------------------------------------------------------


def test_structured_authors_basic():
    authors = [{"nom": "Sinéad", "cognom1": "Murphy", "cognom2": ""}]
    assert generate_citation_key(authors, 2017) == "murphy2017"


def test_string_authors_comma_format():
    assert generate_citation_key("Murphy, Sinéad", 2017) == "murphy2017"


def test_string_authors_multiple_semicolon():
    # Primer autor mana
    assert generate_citation_key("Margulis, Lynn; Sagan, Dorion", 1986) == "margulis1986"


def test_diacritics_stripped():
    assert generate_citation_key([{"cognom1": "Görür"}], 2001) == "gorur2001"


def test_collision_suffix():
    existing = {"murphy2017"}
    assert generate_citation_key("Murphy, S.", 2017, existing=existing) == "murphy2017a"
    existing |= {"murphy2017a", "murphy2017b"}
    assert generate_citation_key("Murphy, S.", 2017, existing=existing) == "murphy2017c"


def test_no_year_uses_nd():
    assert generate_citation_key("Murphy, S.", None) == "murphynd"
    assert generate_citation_key("Murphy, S.", "") == "murphynd"


def test_no_author_falls_back_to_title():
    assert generate_citation_key(None, 2020, title="The Great Gatsby") == "great2020"


def test_no_author_no_title_uses_ref():
    assert generate_citation_key(None, None, title="") == "refnd"
    assert generate_citation_key("", 2020, title="") == "ref2020"


def test_year_as_string_or_float():
    assert generate_citation_key("Murphy, S.", "2017") == "murphy2017"
    assert generate_citation_key("Murphy, S.", 2017.0) == "murphy2017"


@pytest.mark.parametrize("i,expected", [(0, "a"), (1, "b"), (25, "z"), (26, "aa"), (27, "ab")])
def test_alpha_suffix(i, expected):
    assert _alpha_suffix(i) == expected


def test_first_author_family_structured_literal_only():
    # author with only a first name (no surname) → last token of the name
    assert _first_author_family([{"nom": "Plató"}]) == "Plató"


# --- P3: PubMed -------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("12345678", "12345678"),
    ("PMID: 12345", "12345"),
    ("pmid:9", "9"),
    ("  42 ", "42"),
    ("not-a-pmid", None),
    ("", None),
    ("978-0-13-110362-7", None),  # ISBN must not be confused with PMID
])
def test_normalize_pmid(raw, expected):
    assert _normalize_pmid(raw) == expected


def test_pubmed_author_canonical():
    assert _pubmed_author_to_canonical("Murphy SA") == "Murphy, SA"
    assert _pubmed_author_to_canonical("Van Der Berg AB") == "Van Der Berg, AB"
    assert _pubmed_author_to_canonical("Murphy, S.") == "Murphy, S."  # already has a comma


def test_pubmed_mapping_and_citable():
    doc = {
        "uid": "31000000",
        "title": "A study on something.",
        "authors": [
            {"name": "Smith JA", "authtype": "Author"},
            {"name": "Doe RB", "authtype": "Author"},
        ],
        "pubdate": "2020 May 3",
        "fulljournalname": "Journal of Things",
        "volume": "12",
        "issue": "4",
        "pages": "100-110",
        "articleids": [{"idtype": "doi", "value": "10.1/abc"}],
        "lang": ["eng"],
    }
    out = _pubmed_to_recursos(doc)
    assert out["Title"] == "A study on something"
    assert out["Authors"] == "Smith, JA; Doe, RB"
    assert out["Any"] == 2020
    assert out["Llibre/Revista"] == "Journal of Things"
    assert out["Volum"] == "12"
    assert out["Número"] == "4"
    assert out["Pàgines"] == "100-110"
    assert out["DOI"] == "10.1/abc"
    assert out["PMID"] == "31000000"
    assert out["Item Type"] == "journalArticle"
    # and the key generated from these authors must be correct
    assert generate_citation_key(out["Authors"], out["Any"]) == "smith2020"


# --- P4: identifiers from the text of a PDF -------------------------------


def test_pdf_text_doi():
    text = "Some article. https://doi.org/10.1234/abcd.5678 Published 2020."
    assert _identifiers_from_text(text) == {"doi": "10.1234/abcd.5678"}


def test_pdf_text_arxiv_requires_prefix():
    # With prefix → detected
    assert _identifiers_from_text("Preprint arXiv:2103.00020v2 ...") == {"arxiv": "2103.00020v2"}
    # Without a prefix, a number that matches the pattern must NOT be a false positive
    assert _identifiers_from_text("Revenue grew 2103.00020 in Q4") == {}


def test_pdf_text_none():
    assert _identifiers_from_text("No identifiers here at all.") == {}


# --- P2: Zotero item mapping (translation-server) -------------------------


def test_zotero_creators():
    creators = [
        {"firstName": "Sherry", "lastName": "Turkle", "creatorType": "author"},
        {"firstName": "Ed", "lastName": "Itor", "creatorType": "editor"},  # ignorat
        {"name": "World Health Organization", "creatorType": "author"},
    ]
    assert _zotero_creators_to_authors(creators) == "Turkle, Sherry; World Health Organization"


def test_zotero_item_mapping_and_citable():
    item = {
        "itemType": "journalArticle",
        "title": "Reclaiming Conversation",
        "creators": [{"firstName": "Sherry", "lastName": "Turkle", "creatorType": "author"}],
        "date": "2015-10-06",
        "publicationTitle": "Tech Review",
        "volume": "5",
        "issue": "2",
        "pages": "10-20",
        "DOI": "10.5/xyz",
        "ISSN": "1234-5678",
        "url": "https://example.com/x",
        "language": "en",
    }
    out = _zotero_item_to_recursos(item)
    assert out["Item Type"] == "journalArticle"
    assert out["Title"] == "Reclaiming Conversation"
    assert out["Authors"] == "Turkle, Sherry"
    assert out["Any"] == 2015
    assert out["Llibre/Revista"] == "Tech Review"
    assert out["Volum"] == "5"
    assert out["Pàgines"] == "10-20"
    assert out["DOI"] == "10.5/xyz"
    assert out["URL"] == "https://example.com/x"
    assert generate_citation_key(out["Authors"], out["Any"]) == "turkle2015"


def test_zotero_item_book_container():
    item = {"itemType": "bookSection", "title": "A chapter", "bookTitle": "The Book", "date": "1999"}
    out = _zotero_item_to_recursos(item)
    assert out["Item Type"] == "bookSection"
    assert out["Llibre/Revista"] == "The Book"
    assert out["Any"] == 1999
