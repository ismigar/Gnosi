"""Tests for the declarative Zotero item → Recursos mapper.

Covers:
  - Bit-identical equivalence with the original `_zotero_item_to_recursos`
    from `vault_routes.py` for realistic fixtures (translation-server,
    Zotero web library export). No regressions before the refactor.
  - Partial cases and edge cases (empty item, non-dict, unusual dates,
    creators with only `name`).
  - `Llibre/Revista` fallback chain (publicationTitle → bookTitle →
    proceedingsTitle → encyclopediaTitle depending on availability).
  - Force-str: fields that may come as int in the JSON and that Recursos
    stores as string (Volum, Número, Pàgines, Edició).
"""
from __future__ import annotations

import re

import pytest

from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos


# ---------- Original implementation (snapshot, pre-refactor) ----------
# Literal copy of _zotero_item_to_recursos / _zotero_creators_to_authors
# from vault_routes.py as of 2026-05-28. If we update the mapper and this
# differs from the new version, the equivalence tests catch it.

def _legacy_creators_to_authors(creators) -> str:
    parts = []
    for c in creators or []:
        if not isinstance(c, dict) or (c.get('creatorType') or 'author') != 'author':
            continue
        last = (c.get('lastName') or '').strip()
        first = (c.get('firstName') or '').strip()
        name = (c.get('name') or '').strip()
        if last and first:
            parts.append(f"{last}, {first}")
        elif last:
            parts.append(last)
        elif name:
            parts.append(name)
    return '; '.join(parts)


def _legacy_zotero_item_to_recursos(item: dict) -> dict:
    out: dict = {}
    if item.get('itemType'):
        out['Item Type'] = item['itemType']
    if item.get('title'):
        out['Title'] = item['title']
    authors = _legacy_creators_to_authors(item.get('creators'))
    if authors:
        out['Authors'] = authors
    m = re.search(r'\d{4}', str(item.get('date') or ''))
    if m:
        out['Any'] = int(m.group(0))
    container = (item.get('publicationTitle') or item.get('bookTitle')
                 or item.get('proceedingsTitle') or item.get('encyclopediaTitle'))
    if container:
        out['Llibre/Revista'] = container
    if item.get('publisher'):
        out['Editorial'] = item['publisher']
    if item.get('place'):
        out['Lloc'] = item['place']
    if item.get('volume'):
        out['Volum'] = str(item['volume'])
    if item.get('issue'):
        out['Número'] = str(item['issue'])
    if item.get('pages'):
        out['Pàgines'] = str(item['pages'])
    if item.get('edition'):
        out['Edició'] = str(item['edition'])
    if item.get('DOI'):
        out['DOI'] = item['DOI']
    if item.get('ISBN'):
        out['ISBN'] = item['ISBN']
    if item.get('ISSN'):
        out['ISSN'] = item['ISSN']
    if item.get('url'):
        out['URL'] = item['url']
    if item.get('language'):
        out['Idioma'] = item['language']
    return out


# ---------- Fixtures ----------

JOURNAL_ARTICLE = {
    'itemType': 'journalArticle',
    'title': 'Attention Is All You Need',
    'creators': [
        {'creatorType': 'author', 'firstName': 'Ashish', 'lastName': 'Vaswani'},
        {'creatorType': 'author', 'firstName': 'Noam', 'lastName': 'Shazeer'},
        {'creatorType': 'editor', 'firstName': 'Ignored', 'lastName': 'Editor'},
    ],
    'date': '2017-06-12',
    'publicationTitle': 'arXiv preprint',
    'volume': '1706',
    'issue': '03762',
    'pages': '1-15',
    'DOI': '10.48550/arXiv.1706.03762',
    'ISSN': '2331-8422',
    'url': 'https://arxiv.org/abs/1706.03762',
    'language': 'en',
}

BOOK = {
    'itemType': 'book',
    'title': 'Thinking, Fast and Slow',
    'creators': [{'creatorType': 'author', 'firstName': 'Daniel', 'lastName': 'Kahneman'}],
    'date': '2011',
    'publisher': 'Farrar, Straus and Giroux',
    'place': 'New York',
    'edition': '1st',
    'ISBN': '978-0374275631',
    'language': 'en',
}

BOOK_SECTION = {
    'itemType': 'bookSection',
    'title': 'The Two Cultures',
    'creators': [{'creatorType': 'author', 'firstName': 'C. P.', 'lastName': 'Snow'}],
    'date': '1959',
    'bookTitle': 'The Two Cultures and the Scientific Revolution',
    'publisher': 'Cambridge University Press',
    'place': 'Cambridge',
    'pages': '1-21',
}

CONFERENCE = {
    'itemType': 'conferencePaper',
    'title': 'BERT: Pre-training of Deep Bidirectional Transformers',
    'creators': [{'creatorType': 'author', 'firstName': 'Jacob', 'lastName': 'Devlin'}],
    'date': '2019-06',
    'proceedingsTitle': 'Proceedings of NAACL-HLT 2019',
    'pages': '4171-4186',
}

INSTITUTIONAL_AUTHOR = {
    'itemType': 'report',
    'title': 'World Health Statistics 2024',
    'creators': [{'creatorType': 'author', 'name': 'World Health Organization'}],
    'date': 'June 2024',
    'publisher': 'WHO',
    'place': 'Geneva',
}

# Pathological case: int instead of string for numeric fields
NUMERIC_VOLUME = {
    'itemType': 'journalArticle',
    'title': 'Some article',
    'volume': 42,        # int in the JSON
    'issue': 7,
    'pages': 123,
    'edition': 2,
}

EMPTY_ITEM = {}
NON_DICT = "not an item"


# ---------- Bit-identical equivalence ----------

@pytest.mark.parametrize("fixture", [
    JOURNAL_ARTICLE, BOOK, BOOK_SECTION, CONFERENCE, INSTITUTIONAL_AUTHOR,
    NUMERIC_VOLUME, EMPTY_ITEM,
], ids=['journalArticle', 'book', 'bookSection', 'conference',
        'institutional_author', 'numeric_volume', 'empty'])
def test_equivalence_with_legacy(fixture):
    """The new mapper produces exactly the same output as the
    legacy implementation. If it differs, it's a silent regression."""
    assert zotero_item_to_recursos(fixture) == _legacy_zotero_item_to_recursos(fixture)


def test_non_dict_returns_empty():
    assert zotero_item_to_recursos(NON_DICT) == {}
    assert zotero_item_to_recursos(None) == {}
    assert zotero_item_to_recursos(123) == {}


# ---------- Behavioral checks (no via legacy) ----------

def test_fallback_chain_for_container():
    """Llibre/Revista falls back to bookTitle when there is no publicationTitle."""
    out = zotero_item_to_recursos(BOOK_SECTION)
    assert out['Llibre/Revista'] == 'The Two Cultures and the Scientific Revolution'


def test_fallback_chain_first_wins():
    """If publicationTitle is present, ignore bookTitle (first in the chain)."""
    item = {'publicationTitle': 'Journal X', 'bookTitle': 'Book Y'}
    assert zotero_item_to_recursos(item)['Llibre/Revista'] == 'Journal X'


def test_authors_excludes_non_author_creators():
    out = zotero_item_to_recursos(JOURNAL_ARTICLE)
    # Vaswani and Shazeer; the editor is ignored
    assert out['Authors'] == 'Vaswani, Ashish; Shazeer, Noam'


def test_authors_institutional_uses_name_field():
    out = zotero_item_to_recursos(INSTITUTIONAL_AUTHOR)
    assert out['Authors'] == 'World Health Organization'


def test_any_extracted_from_various_date_formats():
    assert zotero_item_to_recursos({'date': '2017-06-12'})['Any'] == 2017
    assert zotero_item_to_recursos({'date': '2019'})['Any'] == 2019
    assert zotero_item_to_recursos({'date': 'June 2024'})['Any'] == 2024
    assert zotero_item_to_recursos({'date': 'May 15, 2024'})['Any'] == 2024
    assert 'Any' not in zotero_item_to_recursos({'date': 'undated'})
    assert 'Any' not in zotero_item_to_recursos({})


def test_numeric_fields_forced_to_str():
    """volume/issue/pages/edition en int es desen com a str a Recursos."""
    out = zotero_item_to_recursos(NUMERIC_VOLUME)
    assert out['Volum'] == '42'
    assert out['Número'] == '7'
    assert out['Pàgines'] == '123'
    assert out['Edició'] == '2'
    assert all(isinstance(out[k], str) for k in ('Volum', 'Número', 'Pàgines', 'Edició'))


def test_unmapped_zotero_fields_go_to_extras():
    """L3.4: fields with no correspondence go to `Zotero Extras`."""
    item = {'itemType': 'patent', 'title': 'X', 'patentNumber': 'US123', 'country': 'US'}
    out = zotero_item_to_recursos(item)
    assert out['Item Type'] == 'patent'
    assert out['Title'] == 'X'
    assert out['Zotero Extras'] == {'patentNumber': 'US123', 'country': 'US'}


# ---------- L3.4: Zotero Extras ----------

def test_no_extras_when_all_fields_mapped():
    """An item with only consumed fields does NOT generate 'Zotero Extras'."""
    item = {
        'itemType': 'journalArticle', 'title': 'X',
        'creators': [{'creatorType': 'author', 'lastName': 'Smith'}],
        'date': '2024', 'DOI': '10.x/y',
    }
    out = zotero_item_to_recursos(item)
    assert 'Zotero Extras' not in out


def test_extras_includes_patent_specific_fields():
    item = {
        'itemType': 'patent', 'title': 'Some Patent',
        'patentNumber': 'US123', 'applicationNumber': 'APP456',
        'country': 'US', 'issuingAuthority': 'USPTO',
        'priorityNumbers': 'PR789', 'filingDate': '2023-01-15',
    }
    out = zotero_item_to_recursos(item)
    assert out['Zotero Extras'] == {
        'patentNumber': 'US123', 'applicationNumber': 'APP456',
        'country': 'US', 'issuingAuthority': 'USPTO',
        'priorityNumbers': 'PR789', 'filingDate': '2023-01-15',
    }


def test_extras_includes_conference_specific_fields():
    item = {
        'itemType': 'conferencePaper', 'title': 'Some Talk',
        'conferenceName': 'NeurIPS 2024', 'presentationType': 'oral',
    }
    out = zotero_item_to_recursos(item)
    assert out['Zotero Extras'] == {
        'conferenceName': 'NeurIPS 2024', 'presentationType': 'oral',
    }


def test_extras_excludes_technical_fields():
    """`key`, `version`, `tags`, `dateAdded`, etc. NO van a Extras."""
    item = {
        'itemType': 'book', 'title': 'X',
        'key': 'ABC123', 'version': 5,
        'tags': [{'tag': 'foo'}, {'tag': 'bar'}],
        'dateAdded': '2020-01-01', 'dateModified': '2024-05-28',
        'relations': {}, 'attachments': [], 'notes': [],
        'collections': ['col1'], 'accessDate': '2024-06',
        # And one field that's genuinely Extra so the test doesn't end up with nothing
        'callNumber': 'QA76.5',
    }
    out = zotero_item_to_recursos(item)
    assert out.get('Zotero Extras') == {'callNumber': 'QA76.5'}


def test_extras_excludes_consumed_field_chain():
    """If a column takes `publicationTitle`, `bookTitle` will NOT appear
    in Extras even if the item carries it (it's part of the same chain)."""
    item = {
        'itemType': 'journalArticle', 'title': 'X',
        'publicationTitle': 'Journal Y',
        'bookTitle': 'should not appear in extras',
    }
    out = zotero_item_to_recursos(item)
    assert out['Llibre/Revista'] == 'Journal Y'
    assert 'Zotero Extras' not in out  # bookTitle is also consumed


def test_extras_dict_skips_falsy_values():
    """Fields with value None/'' do not go to Extras (consistent with the rest of the mapper)."""
    item = {
        'itemType': 'patent', 'title': 'X',
        'patentNumber': 'US1', 'country': '', 'priorityNumbers': None,
    }
    out = zotero_item_to_recursos(item)
    assert out['Zotero Extras'] == {'patentNumber': 'US1'}
