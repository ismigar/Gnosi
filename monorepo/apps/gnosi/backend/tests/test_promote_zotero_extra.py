"""Tests de la lògica de migració del `/promote-zotero-extra` endpoint.

L'endpoint depèn de `load_registry`/`save_registry` (FS) i de
`find_page_path` (page index). Testem només la lògica de migració
del frontmatter (mou valor + esborra de Extras + neteja la clau buida)
en isolation — la creació de columna i el loop FS són trivials i
covers per E2E.
"""
from __future__ import annotations


def _migrate_frontmatter(md: dict, zotero_field: str, column_name: str) -> dict | None:
    """Replica la lògica de `_migrate` dins l'endpoint.

    Retorna el nou dict si hi ha hagut canvi; `None` si la pàgina no porta
    el camp (es marca com a "skip"). NO simula el read/write del fitxer
    (això és I/O i no testable sense FS).
    """
    extras = md.get('Zotero Extras')
    if not isinstance(extras, dict) or zotero_field not in extras:
        return None
    out = dict(md)
    out_extras = dict(extras)
    value = out_extras.pop(zotero_field)
    if not out_extras:
        out.pop('Zotero Extras', None)
    else:
        out['Zotero Extras'] = out_extras
    out[column_name] = value
    return out


def test_migrate_with_remaining_extras():
    md = {
        'Title': 'X',
        'Zotero Extras': {'patentNumber': 'US123', 'country': 'US'},
    }
    out = _migrate_frontmatter(md, 'patentNumber', 'Núm. patent')
    assert out == {
        'Title': 'X',
        'Zotero Extras': {'country': 'US'},
        'Núm. patent': 'US123',
    }


def test_migrate_last_extra_removes_zotero_extras_key():
    md = {'Title': 'X', 'Zotero Extras': {'patentNumber': 'US123'}}
    out = _migrate_frontmatter(md, 'patentNumber', 'Núm. patent')
    assert 'Zotero Extras' not in out
    assert out == {'Title': 'X', 'Núm. patent': 'US123'}


def test_migrate_field_absent_returns_none():
    md = {'Title': 'X', 'Zotero Extras': {'other': 'value'}}
    assert _migrate_frontmatter(md, 'patentNumber', 'Núm. patent') is None


def test_migrate_no_extras_returns_none():
    md = {'Title': 'X'}
    assert _migrate_frontmatter(md, 'patentNumber', 'Núm. patent') is None


def test_migrate_extras_is_not_dict_returns_none():
    """Si algú ha posat un string a 'Zotero Extras', no falla."""
    md = {'Title': 'X', 'Zotero Extras': 'corrupted'}
    assert _migrate_frontmatter(md, 'patentNumber', 'Núm. patent') is None


def test_migrate_to_column_with_different_name():
    """Renomenar al pas: el zotero_field s'anomena 'X' i la columna 'Y'."""
    md = {'Zotero Extras': {'X': 'val'}}
    out = _migrate_frontmatter(md, 'X', 'Y')
    assert out == {'Y': 'val'}


def test_migrate_preserves_other_metadata():
    md = {
        'Title': 'Article',
        'Authors': 'Smith',
        'DOI': '10.x/y',
        'Zotero Extras': {'patentNumber': 'P1', 'country': 'US'},
    }
    out = _migrate_frontmatter(md, 'patentNumber', 'Patent')
    assert out['Title'] == 'Article'
    assert out['Authors'] == 'Smith'
    assert out['DOI'] == '10.x/y'
    assert out['Patent'] == 'P1'
    assert out['Zotero Extras'] == {'country': 'US'}
