"""Tests for the deduplication helpers in `/import-references`.

Covers:
  - `_normalize_title_for_dedup`: robust equivalence with tolerance for
    accents, punctuation, multiple spaces, and capitalization.
  - `_find_existing_match`: priority order citation_key > DOI > ISBN > title.

Does NOT test the whole endpoint (would require mocking FastAPI + page index + create_page);
that's left for integration tests. Here just the pure helpers, imported
directly from the module.
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
    """If the key already exists, nothing else is checked."""
    entry = {'Citation Key': 'lee2019', 'DOI': '10.999/new', 'Title': 'New Title'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('citation_key', 'lee2019')


def test_match_by_doi():
    """With no key collision, normalized DOI → match."""
    entry = {'Citation Key': 'newkey', 'DOI': '10.1234/abc'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('doi', 'smith2020')


def test_match_by_doi_with_url_prefix():
    """`https://doi.org/10.1234/abc` should also match."""
    entry = {'Citation Key': 'newkey', 'DOI': 'https://doi.org/10.1234/abc'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('doi', 'smith2020')


def test_match_by_isbn_normalized():
    """ISBN with hyphens should match the normalized one."""
    entry = {'Citation Key': 'newkey', 'ISBN': '978-0-374-27563-1'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('isbn', 'kahneman2011')


def test_match_by_title_with_punctuation():
    """Title with different punctuation → matches the normalized one."""
    entry = {'Citation Key': 'newkey', 'Title': 'ATTENTION IS ALL YOU NEED!'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('title', 'vaswani2017')


def test_no_match_returns_none():
    entry = {'Citation Key': 'fresh', 'DOI': '10.5555/zzz', 'Title': 'A really unique title nobody has'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) is None


def test_no_match_when_all_fields_empty():
    """Input with no identifiers → no match (always created)."""
    entry = {'Citation Key': 'fresh'}
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) is None


def test_priority_doi_beats_title_collision():
    """A unique DOI must avoid matching by generic title."""
    entry = {
        'Citation Key': 'fresh',
        'DOI': '10.5555/zzz',           # not in the index
        'Title': 'attention is all you need',  # same title as vaswani2017
    }
    # Without a DOI match, falls back to matching by title (default).
    # In this design, title is the last resort.
    assert _find_existing_match(entry, EXISTING_DEDUP, EXISTING_KEYS) == ('title', 'vaswani2017')


def test_empty_dedup_index_means_no_match():
    """Empty vault (nothing has ever been imported) → no match possible."""
    empty = {'doi': {}, 'isbn': {}, 'title': {}}
    entry = {'Citation Key': 'fresh', 'DOI': '10.1234/abc'}
    assert _find_existing_match(entry, empty, set()) is None


# ---------- add_to_indexes (to avoid internal duplicates within a single import) ----------

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
    """If the key already exists in the indexes, the first ck wins (setdefault)."""
    dedup = {'doi': {'10.5555/a': 'first'}, 'isbn': {}, 'title': {}}
    entry = {'DOI': '10.5555/a'}
    add_to_indexes(entry, 'second', dedup)
    assert dedup['doi']['10.5555/a'] == 'first'  # No change.


def test_add_to_indexes_skips_empty_fields():
    dedup = {'doi': {}, 'isbn': {}, 'title': {}}
    entry = {'DOI': '', 'ISBN': None, 'Title': ''}
    add_to_indexes(entry, 'k', dedup)
    assert dedup == {'doi': {}, 'isbn': {}, 'title': {}}
