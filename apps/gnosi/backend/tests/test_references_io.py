"""Tests per a import/export BibTeX i RIS (P1). Mòdul pur — sense backend viu.

    docker exec gnosi_backend python -m pytest backend/tests/test_references_io.py -v
"""
from __future__ import annotations

from backend.services.references_io import (
    parse_bibtex,
    parse_ris,
    to_bibtex,
    to_ris,
    detect_format,
    parse_references,
    _name_to_canonical,
)

BIB = r"""
@article{murphy2017,
  title = {Which Is to Say: Children at Work},
  author = {Murphy, Sin\'ead and Olendzenski, Lorraine},
  journal = {Zombie University},
  year = {2017},
  volume = {3},
  number = {2},
  pages = {67--90},
  publisher = {Repeater Books},
  doi = {10.1000/xyz},
}

@book{darwin1859,
  title = {On the Origin of Species},
  author = {Charles Darwin},
  year = {1859},
  publisher = {John Murray},
  address = {London},
}
"""

RIS = """TY  - JOUR
ID  - smith2020
TI  - A study on something
AU  - Smith, John
AU  - Doe, Jane
PY  - 2020
JO  - Journal of Things
VL  - 12
IS  - 4
SP  - 100
EP  - 110
DO  - 10.1/abc
ER  -
"""


def test_detect_format():
    assert detect_format(BIB) == 'bibtex'
    assert detect_format(RIS) == 'ris'
    assert detect_format('plain text') == 'unknown'


def test_name_to_canonical():
    assert _name_to_canonical('Charles Darwin') == 'Darwin, Charles'
    assert _name_to_canonical('Murphy, Sinéad') == 'Murphy, Sinéad'
    assert _name_to_canonical('Plato') == 'Plato'


def test_parse_bibtex_article():
    entries = parse_bibtex(BIB)
    assert len(entries) == 2
    art = entries[0]
    assert art['Citation Key'] == 'murphy2017'
    assert art['Item Type'] == 'journalArticle'
    assert art['Title'] == 'Which Is to Say: Children at Work'
    assert art['Authors'] == 'Murphy, Sinéad; Olendzenski, Lorraine'
    assert art['Any'] == 2017
    assert art['Llibre/Revista'] == 'Zombie University'
    assert art['Volum'] == '3'
    assert art['Número'] == '2'
    assert art['Pàgines'] == '67-90'
    assert art['Editorial'] == 'Repeater Books'
    assert art['DOI'] == '10.1000/xyz'


def test_parse_bibtex_book_author_no_comma():
    book = parse_bibtex(BIB)[1]
    assert book['Item Type'] == 'book'
    assert book['Authors'] == 'Darwin, Charles'
    assert book['Lloc'] == 'London'


def test_parse_ris():
    entries = parse_ris(RIS)
    assert len(entries) == 1
    e = entries[0]
    assert e['Citation Key'] == 'smith2020'
    assert e['Item Type'] == 'journalArticle'
    assert e['Title'] == 'A study on something'
    assert e['Authors'] == 'Smith, John; Doe, Jane'
    assert e['Any'] == 2020
    assert e['Llibre/Revista'] == 'Journal of Things'
    assert e['Pàgines'] == '100-110'
    assert e['DOI'] == '10.1/abc'


def test_bibtex_roundtrip():
    entries = parse_bibtex(BIB)
    reparsed = parse_bibtex(to_bibtex(entries))
    assert len(reparsed) == 2
    for a, b in zip(entries, reparsed):
        for k in ('Citation Key', 'Item Type', 'Title', 'Authors', 'Any', 'DOI'):
            assert a.get(k) == b.get(k), f"{k}: {a.get(k)!r} != {b.get(k)!r}"


def test_ris_roundtrip():
    entries = parse_ris(RIS)
    reparsed = parse_ris(to_ris(entries))
    assert len(reparsed) == 1
    a, b = entries[0], reparsed[0]
    for k in ('Citation Key', 'Item Type', 'Title', 'Authors', 'Any', 'Pàgines', 'DOI'):
        assert a.get(k) == b.get(k), f"{k}: {a.get(k)!r} != {b.get(k)!r}"


def test_cross_format_bibtex_to_ris():
    entries = parse_bibtex(BIB)
    ris_text = to_ris(entries)
    back = parse_ris(ris_text)
    assert back[0]['Citation Key'] == 'murphy2017'
    assert back[0]['Authors'] == 'Murphy, Sinéad; Olendzenski, Lorraine'
    assert back[0]['Any'] == 2017


def test_parse_references_auto():
    assert len(parse_references(BIB)) == 2
    assert len(parse_references(RIS)) == 1
