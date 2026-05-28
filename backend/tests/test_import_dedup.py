"""Tests dels helpers de deduplicació al `/import-references`.

Cobreix:
  - `_normalize_title_for_dedup`: equivalence robusta amb tolerància a
    accents, puntuació, espais múltiples i capitalització.
  - `_find_existing_match`: ordre de prioritat citation_key > DOI > ISBN > títol.

NO testa l'endpoint sencer (requeriria mockejar FastAPI + page index + create_page);
això queda per a tests d'integració. Aquí només els pure helpers, importats
directament del mòdul.
"""
from __future__ import annotations

import pytest

from backend.services.import_dedup import (
    add_to_indexes,
    find_existing_match as _find_existing_match,
    normalize_title_for_dedup as _normalize_title_for_dedup,
)


# ---------- _normalize_title_for_dedup ----------

@pytest.mark.parametrize("raw,expected", [
    ('Attention Is All You Need',     'attention is all you need'),
    ('ATTENTION IS ALL YOU NEED',     'attention is all you need'),
    ('attention  is  all  you  need', 'attention is all you need'),
    ('Attention Is All You Need!',    'attention is all you need'),
    ('Atención: Es Tot El Que Cal',   'atencion es tot el que cal'),
    ('Some\ttitle\nwith\nwhitespace', 'some title with whitespace'),
    ('"Quotes" and (parens)',         'quotes and parens'),
    ('',                              ''),
    (None,                            ''),
    (123,                             ''),                  # non-string
])
def test_normalize_title(raw, expected):
    assert _normalize_title_for_dedup(raw) == expected


# ---------- _find_existing_match ----------

EXISTING_DEDUP = {
    'doi': {'10.1234/abc': 'smith2020'},
    'isbn': {'9780374275631': 'kahneman2011'},
    'title': {
        'attention is all you need': 'vaswani2017',
        'thinking fast and slow': 'kahneman2011',
    },
}
EXISTING_KEYS = {'smith2020', 'kahneman2011', 'vaswani2017', 'lee2019'}


def test_match_by_citation_key_first():
    """Si la clau ja existeix, no es comprova res més."""
    entry = {'Citation Key': 'lee2019', 'DOI': '10.999/new', 'Title': 'New Title'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('citation_key', 'lee2019')


def test_match_by_doi():
    """Sense col·lisió de key, DOI normalitzat → match."""
    entry = {'Citation Key': 'newkey', 'DOI': '10.1234/abc'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('doi', 'smith2020')


def test_match_by_doi_with_url_prefix():
    """`https://doi.org/10.1234/abc` també hauria de coincidir."""
    entry = {'Citation Key': 'newkey', 'DOI': 'https://doi.org/10.1234/abc'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('doi', 'smith2020')


def test_match_by_isbn_normalized():
    """ISBN amb guionets hauria de coincidir amb el normalitzat."""
    entry = {'Citation Key': 'newkey', 'ISBN': '978-0-374-27563-1'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('isbn', 'kahneman2011')


def test_match_by_title_with_punctuation():
    """Títol amb puntuació diferent → coincideix amb el normalitzat."""
    entry = {'Citation Key': 'newkey', 'Title': 'ATTENTION IS ALL YOU NEED!'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('title', 'vaswani2017')


def test_no_match_returns_none():
    entry = {'Citation Key': 'fresh', 'DOI': '10.5555/zzz', 'Title': 'A really unique title nobody has'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) is None


def test_no_match_when_all_fields_empty():
    """Entrada sense identificadors → no match (es crea sempre)."""
    entry = {'Citation Key': 'fresh'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) is None


def test_priority_doi_beats_title_collision():
    """DOI únic ha d'evitar el match per títol genèric."""
    entry = {
        'Citation Key': 'fresh',
        'DOI': '10.5555/zzz',           # no és al index
        'Title': 'attention is all you need',  # mateix títol que vaswani2017
    }
    # Sense match per DOI, cau al match per títol (per defecte).
    # En aquest disseny, el títol és l'últim recurs.
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('title', 'vaswani2017')


def test_empty_dedup_index_means_no_match():
    """Vault buit (mai s'ha importat res) → cap match possible."""
    empty = {'doi': {}, 'isbn': {}, 'title': {}}
    entry = {'Citation Key': 'fresh', 'DOI': '10.1234/abc'}
    assert _find_existing_match(entry, empty, set()) is None


# ---------- add_to_indexes (per evitar duplicats interns d'un sol import) ----------

def test_add_to_indexes_populates_all_three():
    dedup = {'doi': {}, 'isbn': {}, 'title': {}}
    entry = {
        'DOI': '10.5555/new',
        'ISBN': '978-0-12-345678-9',
        'Title': 'A Brand New Title',
    }
    add_to_indexes(entry, 'newkey2024', dedup)
    assert dedup['doi'] == {'10.5555/new': 'newkey2024'}
    assert dedup['isbn'] == {'9780123456789': 'newkey2024'}
    assert dedup['title'] == {'a brand new title': 'newkey2024'}


def test_add_to_indexes_does_not_overwrite():
    """Si la clau ja existeix als índexs, la primera ck guanya (setdefault)."""
    dedup = {'doi': {'10.5555/a': 'first'}, 'isbn': {}, 'title': {}}
    entry = {'DOI': '10.5555/a'}
    add_to_indexes(entry, 'second', dedup)
    assert dedup['doi']['10.5555/a'] == 'first'  # no canvi


def test_add_to_indexes_skips_empty_fields():
    dedup = {'doi': {}, 'isbn': {}, 'title': {}}
    entry = {'DOI': '', 'ISBN': None, 'Title': ''}
    add_to_indexes(entry, 'k', dedup)
    assert dedup == {'doi': {}, 'isbn': {}, 'title': {}}
