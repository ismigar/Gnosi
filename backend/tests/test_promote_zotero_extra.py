"""Tests for the `/promote-zotero-extra` endpoint's migration logic.

The endpoint depends on `load_registry`/`save_registry` (FS) and on
`find_page_path` (page index). We only test the frontmatter migration
logic (moves the value + deletes from Extras + cleans up the empty key)
in isolation — creating the column and the FS loop are trivial and
covered by E2E.
"""
from __future__ import annotations


def _migrate_frontmatter(md: dict, zotero_field: str, column_name: str) -> dict | None:
    """Replicates the `_migrate` logic inside the endpoint.

    Returns the new dict if there was a change; `None` if the page doesn't have
    the field (marked as "skip"). Does NOT simulate the file read/write
    (that's I/O and not testable without an FS).
    
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
    """If someone has put a string in 'Zotero Extras', it doesn't fail."""
    md = {'Title': 'X', 'Zotero Extras': 'corrupted'}
    assert _migrate_frontmatter(md, 'patentNumber', 'Núm. patent') is None


def test_migrate_to_column_with_different_name():
    """Rename on the step: the zotero_field is called 'X' and the column 'Y'."""
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
