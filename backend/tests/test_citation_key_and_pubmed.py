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
    _pdf_embedded_metadata,
    _pdf_fallback_to_recursos,
    _title_from_filename,
    _zotero_creators_to_authors,
    _zotero_item_to_recursos,
)


# --- P0: Citation Key -------------------------------------------------------


def test_structured_authors_basic():
    authors = [{"nom": "Sinéad", "cognom1": "Murphy", "cognom2": ""}]
    assert generate_citation_key(authors, 2017) == "murphy2017"


def test_string_authors_comma_format():
    assert generate_citation_key("Murphy, Sinéad", 2017) == "murphy2017"


def test_both_surnames_key_the_same_from_either_field():
    """The structured field and the legacy string describe the same author, so
    they must produce the same key. Taking only `cognom1` from the structured
    branch keyed them as `garcia…` vs `garciafernandez…`."""
    structured = [{"nom": "Ismael", "cognom1": "García", "cognom2": "Fernández"}]
    assert generate_citation_key(structured, 2026) == "garciafernandez2026"
    assert generate_citation_key("García Fernández, Ismael", 2026) == "garciafernandez2026"


def test_institutional_author_collapses_to_acronym():
    """Entities are cited by acronym; the whole name makes an unusable key."""
    rae = [{"nom": "", "cognom1": "Real Academia Española", "cognom2": ""}]
    assert generate_citation_key(rae, 2025) == "rae2025"


def test_two_word_surname_is_a_person_not_an_entity():
    """Word count, not length: 'Cormenzana Victoria' is 18 chars but a person,
    and must NOT collapse to `cv`."""
    person = [{"nom": "", "cognom1": "Cormenzana", "cognom2": "Victoria"}]
    assert generate_citation_key(person, 2020) == "cormenzanavictoria2020"


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


# --- P4b: id-less PDF fallback (register from embedded metadata / filename) --


def _make_pdf(*, title=None, author=None, creation_date=None) -> bytes:
    """A minimal one-page PDF carrying the given document-info fields."""
    import io

    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    meta = {}
    if title is not None:
        meta["/Title"] = title
    if author is not None:
        meta["/Author"] = author
    if creation_date is not None:
        meta["/CreationDate"] = creation_date
    if meta:
        w.add_metadata(meta)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_title_from_filename_cleans_and_strips_extension():
    assert _title_from_filename("Tras_la_virtud.pdf") == "Tras la virtud"
    assert _title_from_filename("/var/data/Report.PDF") == "Report"  # path + case
    assert _title_from_filename("e-learning-2020.pdf") == "e-learning-2020"  # hyphens kept
    assert _title_from_filename("") == ""
    assert _title_from_filename("   .pdf") == ""


def test_pdf_embedded_metadata_reads_docinfo():
    pdf = _make_pdf(
        title="Crítica de la razón pura",
        author="Immanuel Kant",
        creation_date="D:20210517093000+02'00'",
    )
    assert _pdf_embedded_metadata(pdf) == {
        "title": "Crítica de la razón pura",
        "author": "Immanuel Kant",
        "year": "2021",
    }


def test_pdf_embedded_metadata_unreadable_is_empty():
    # Not a PDF → best-effort empty dict, never raises.
    assert _pdf_embedded_metadata(b"not a pdf at all") == {}


def test_pdf_fallback_uses_embedded_metadata():
    pdf = _make_pdf(title="Paz por medios pacíficos", author="Johan Galtung",
                    creation_date="D:19960101000000")
    rec = _pdf_fallback_to_recursos(pdf, "Galtung - anything.pdf")
    assert rec["Item Type"] == "document"
    assert rec["Title"] == "Paz por medios pacíficos"
    assert rec["Authors"] == "Galtung, Johan"
    assert rec["Any"] == 1996
    assert rec["Citation Key"] == "galtung1996"


def test_pdf_fallback_multi_author_separators():
    # '<a> and <b> & <c>' must split into three creators.
    pdf = _make_pdf(title="Shared", author="John Smith and Jane Doe & WHO")
    rec = _pdf_fallback_to_recursos(pdf, "x.pdf")
    assert rec["Authors"] == "Smith, John; Doe, Jane; WHO"


def test_pdf_fallback_title_from_filename_when_no_metadata():
    # A scanned book with no document-info: the filename still yields a citable record.
    pdf = _make_pdf()
    rec = _pdf_fallback_to_recursos(pdf, "New_Age.pdf")
    assert rec["Title"] == "New Age"
    assert rec["Item Type"] == "document"
    assert rec["Citation Key"]  # citable even with only a title


def test_pdf_fallback_nothing_derivable_is_empty():
    # No metadata and no filename → nothing to register.
    assert _pdf_fallback_to_recursos(b"garbage", "") == {}


def test_pdf_fallback_keeps_detected_identifiers():
    # DOI detected in the text but the online lookup failed: the id must survive.
    pdf = _make_pdf(title="Some paper")
    rec = _pdf_fallback_to_recursos(pdf, "x.pdf", {"doi": "10.1234/abcd.5678"})
    assert rec["DOI"] == "10.1234/abcd.5678"
    rec = _pdf_fallback_to_recursos(pdf, "x.pdf", {"arxiv": "2103.00020"})
    assert rec["URL"] == "https://arxiv.org/abs/2103.00020"


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


# --- Create-from-source: Authors (text) → Autoría (structured) --------------

from backend.api.vault_routes import (  # noqa: E402
    _authors_string_to_autoria,
    _fill_autoria_from_authors,
    _reference_autoria_prop,
)

_AUTORIA_TABLE = {
    "id": "tbl-ref",
    "properties": [
        {"id": "fld_00000001", "name": "Autoría", "type": "autoria"},
        {"id": "fld_00000002", "name": "Authors", "type": "text"},
        {"id": "fld_00000003", "name": "Title", "type": "title"},
    ],
}


def test_authors_string_to_autoria_single_surname():
    assert _authors_string_to_autoria("Turing, Alan M.") == [
        {"nom": "Alan M.", "cognom1": "Turing", "cognom2": ""}
    ]


def test_authors_string_to_autoria_two_surnames():
    assert _authors_string_to_autoria("García Fernández, Ismael") == [
        {"nom": "Ismael", "cognom1": "García", "cognom2": "Fernández"}
    ]


def test_authors_string_to_autoria_multiple():
    out = _authors_string_to_autoria("Turing, Alan; Turkle, Sherry")
    assert out == [
        {"nom": "Alan", "cognom1": "Turing", "cognom2": ""},
        {"nom": "Sherry", "cognom1": "Turkle", "cognom2": ""},
    ]


def test_authors_string_to_autoria_institution_no_comma():
    assert _authors_string_to_autoria("WHO") == [
        {"nom": "", "cognom1": "WHO", "cognom2": ""}
    ]


def test_authors_string_to_autoria_empty():
    assert _authors_string_to_autoria("") == []
    assert _authors_string_to_autoria(None) == []


def test_reference_autoria_prop_detection():
    assert _reference_autoria_prop(_AUTORIA_TABLE)["name"] == "Autoría"
    assert _reference_autoria_prop({"properties": [{"name": "Authors", "type": "text"}]}) is None
    assert _reference_autoria_prop(None) is None


def test_fill_autoria_routes_authors_to_structured(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id", lambda: "tbl-ref")
    md = {"table_id": "tbl-ref", "Authors": "Turing, Alan M.", "Title": "X"}
    out = _fill_autoria_from_authors(md, _AUTORIA_TABLE)
    assert out["Autoría"] == [{"nom": "Alan M.", "cognom1": "Turing", "cognom2": ""}]
    # Legacy text column is left untouched (empty / absent).
    assert "Authors" not in out


def test_fill_autoria_noop_when_not_reference_table(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id", lambda: "other-tbl")
    md = {"table_id": "tbl-ref", "Authors": "Turing, Alan M."}
    out = _fill_autoria_from_authors(md, _AUTORIA_TABLE)
    assert out.get("Authors") == "Turing, Alan M."
    assert "Autoría" not in out


def test_fill_autoria_noop_when_no_autoria_field(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id", lambda: "tbl-ref")
    table = {"id": "tbl-ref", "properties": [{"name": "Authors", "type": "text"}]}
    md = {"table_id": "tbl-ref", "Authors": "Turing, Alan M."}
    out = _fill_autoria_from_authors(md, table)
    assert out.get("Authors") == "Turing, Alan M."


def test_fill_autoria_preserves_existing_value(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id", lambda: "tbl-ref")
    existing = [{"nom": "Sherry", "cognom1": "Turkle", "cognom2": ""}]
    md = {"table_id": "tbl-ref", "Autoría": existing, "Authors": "Turing, Alan M."}
    out = _fill_autoria_from_authors(md, _AUTORIA_TABLE)
    # Does not overwrite a value the caller already provided.
    assert out["Autoría"] == existing
    assert out["Authors"] == "Turing, Alan M."
