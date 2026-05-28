"""Tests dels normalitzadors de lookup (font cru → Zotero item canònic).

Cada normalitzador es valida amb:
  1. **Equivalence vs legacy**: el pipeline
     `normalitzador → zotero_item_to_recursos` produeix EXACTAMENT els
     mateixos camps Recursos que el mapper hardcoded original. Snapshot
     literal del legacy a la part superior del fitxer.
  2. **Behavioral checks**: que el Zotero item intermedi té els camps
     que el mapper central espera (per detectar drift entre el
     normalitzador i `RECURSOS_TO_ZOTERO_FIELDS`).

Cada font tindrà la seva pròpia secció. L3.2 cobreix CrossRef.
"""
from __future__ import annotations

import pytest

from backend.services.lookup_normalizers import crossref_to_zotero_item
from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos


# ---------- Snapshot literal de _crossref_to_recursos (pre-refactor) ----------
# Còpia exacta del codi a vault_routes.py:4159 just abans del refactor.
# Si la sortida del pipeline nou difereix d'aquesta legacy, els tests d'eq
# ho marquen com a regressió.

def _legacy_crossref_to_recursos(work: dict) -> dict:
    out: dict = {}
    if work.get('title'):
        out['Title'] = work['title'][0] if isinstance(work['title'], list) else work['title']
    authors = work.get('author') or []
    if authors:
        parts = []
        for a in authors:
            family = (a.get('family') or '').strip()
            given = (a.get('given') or '').strip()
            if family and given:
                parts.append(f'{family}, {given}')
            elif family:
                parts.append(family)
            elif a.get('name'):
                parts.append(a['name'])
        if parts:
            out['Authors'] = '; '.join(parts)
    for key in ('published-print', 'published-online', 'issued'):
        date_obj = work.get(key) or {}
        parts = date_obj.get('date-parts') or []
        if parts and parts[0]:
            try:
                out['Any'] = int(parts[0][0])
                break
            except (TypeError, ValueError):
                pass
    if work.get('container-title'):
        ct = work['container-title']
        out['Llibre/Revista'] = ct[0] if isinstance(ct, list) else ct
    if work.get('publisher'):
        out['Editorial'] = work['publisher']
    if work.get('volume'):
        out['Volum'] = str(work['volume'])
    if work.get('issue'):
        out['Número'] = str(work['issue'])
    if work.get('page'):
        out['Pàgines'] = str(work['page'])
    if work.get('DOI'):
        out['DOI'] = work['DOI']
    if work.get('ISBN'):
        isbns = work['ISBN']
        out['ISBN'] = isbns[0] if isinstance(isbns, list) else isbns
    if work.get('ISSN'):
        issns = work['ISSN']
        out['ISSN'] = issns[0] if isinstance(issns, list) else issns
    if work.get('URL'):
        out['URL'] = work['URL']
    if work.get('language'):
        out['Idioma'] = work['language']
    if work.get('type'):
        type_map = {
            'journal-article': 'journalArticle',
            'book': 'book',
            'book-chapter': 'bookSection',
            'proceedings-article': 'conferencePaper',
            'thesis': 'thesis',
            'report': 'report',
        }
        out['Item Type'] = type_map.get(work['type'], work['type'])
    return out


# ---------- Fixtures CrossRef reals ----------
# Respostes reduïdes (només els camps que el mapper toca) extretes de
# crides reals a https://api.crossref.org/works/<doi> sota .message.

CROSSREF_JOURNAL_ARTICLE = {
    'type': 'journal-article',
    'title': ['Attention Is All You Need'],
    'author': [
        {'family': 'Vaswani', 'given': 'Ashish'},
        {'family': 'Shazeer', 'given': 'Noam'},
    ],
    'published-print': {'date-parts': [[2017, 6, 12]]},
    'container-title': ['arXiv preprint'],
    'volume': '1706',
    'issue': '03762',
    'page': '1-15',
    'DOI': '10.48550/arXiv.1706.03762',
    'ISSN': ['2331-8422'],
    'URL': 'https://doi.org/10.48550/arXiv.1706.03762',
    'language': 'en',
    'publisher': 'arXiv',
}

CROSSREF_BOOK_CHAPTER = {
    'type': 'book-chapter',
    'title': ['The Two Cultures'],
    'author': [{'family': 'Snow', 'given': 'C. P.'}],
    'issued': {'date-parts': [[1959]]},
    'container-title': ['The Two Cultures and the Scientific Revolution'],
    'publisher': 'Cambridge University Press',
    'page': '1-21',
    'ISBN': ['978-0-521-45730-9'],
    'DOI': '10.1017/CBO9780511819940',
}

CROSSREF_PROCEEDINGS = {
    'type': 'proceedings-article',
    'title': ['BERT: Pre-training of Deep Bidirectional Transformers'],
    'author': [{'family': 'Devlin', 'given': 'Jacob'}],
    'published-online': {'date-parts': [[2019, 6]]},
    'container-title': ['Proceedings of NAACL-HLT 2019'],
    'page': '4171-4186',
}

CROSSREF_INSTITUTIONAL_AUTHOR = {
    'type': 'report',
    'title': ['World Health Statistics 2024'],
    'author': [{'name': 'World Health Organization'}],
    'issued': {'date-parts': [[2024]]},
    'publisher': 'WHO',
}

CROSSREF_FALLBACK_DATE = {
    # Sense `published-print` ni `published-online`; cau a `issued`.
    'type': 'journal-article',
    'title': ['Old paper'],
    'issued': {'date-parts': [[2005]]},
}

CROSSREF_NEW_TYPES = {
    # Tipus moderns que el mapper legacy NO contemplava (queien al
    # default sense traduir). Ara els reconeixem.
    'type': 'posted-content',
    'title': ['Some preprint'],
}

CROSSREF_EMPTY: dict = {}


# ---------- Equivalence: pipeline nou == legacy ----------

@pytest.mark.parametrize("fixture", [
    CROSSREF_JOURNAL_ARTICLE, CROSSREF_BOOK_CHAPTER, CROSSREF_PROCEEDINGS,
    CROSSREF_INSTITUTIONAL_AUTHOR, CROSSREF_FALLBACK_DATE, CROSSREF_EMPTY,
], ids=['journal-article', 'book-chapter', 'proceedings', 'institutional',
        'fallback-date', 'empty'])
def test_crossref_pipeline_equivalent_to_legacy(fixture):
    """`crossref_to_zotero_item → zotero_item_to_recursos` produeix el
    mateix output que el `_crossref_to_recursos` original. Cap regressió
    abans del refactor a vault_routes.py."""
    new = zotero_item_to_recursos(crossref_to_zotero_item(fixture))
    legacy = _legacy_crossref_to_recursos(fixture)
    assert new == legacy


def test_non_dict_returns_empty():
    assert crossref_to_zotero_item(None) == {}
    assert crossref_to_zotero_item("not a dict") == {}
    assert crossref_to_zotero_item(42) == {}


# ---------- Behavioral checks del Zotero item intermedi ----------

def test_creators_have_proper_zotero_structure():
    """Els creators han de tenir la forma que el mapper central espera."""
    item = crossref_to_zotero_item(CROSSREF_JOURNAL_ARTICLE)
    assert 'creators' in item
    for c in item['creators']:
        assert c['creatorType'] == 'author'
        assert 'lastName' in c or 'name' in c


def test_institutional_creator_uses_name_field():
    item = crossref_to_zotero_item(CROSSREF_INSTITUTIONAL_AUTHOR)
    assert item['creators'] == [{'creatorType': 'author', 'name': 'World Health Organization'}]


def test_container_goes_to_publication_title():
    """Container ha d'anar a `publicationTitle` (primer del fallback chain)."""
    item = crossref_to_zotero_item(CROSSREF_JOURNAL_ARTICLE)
    assert item['publicationTitle'] == 'arXiv preprint'


def test_date_priority_print_before_issued():
    """`published-print` guanya sobre `issued`."""
    work = {
        'published-print': {'date-parts': [[2020]]},
        'issued': {'date-parts': [[1999]]},
    }
    item = crossref_to_zotero_item(work)
    assert item['date'] == '2020'


def test_date_fallback_to_issued():
    item = crossref_to_zotero_item(CROSSREF_FALLBACK_DATE)
    assert item['date'] == '2005'


# ---------- Bonus de L3.2: tipus moderns ----------

def test_modern_types_now_recognized():
    """Tipus que el mapper legacy no traduïa (caien al string original)
    ara són reconeguts com a clau canònica Zotero."""
    item = crossref_to_zotero_item(CROSSREF_NEW_TYPES)
    assert item['itemType'] == 'preprint'
    # Però el legacy ho deixava com a 'posted-content'
    assert _legacy_crossref_to_recursos(CROSSREF_NEW_TYPES)['Item Type'] == 'posted-content'


def test_unknown_type_passes_through():
    """Un type no llistat queda tal qual (igual que el legacy)."""
    item = crossref_to_zotero_item({'type': 'monograph'})
    assert item['itemType'] == 'monograph'
