"""Tests del bulk update — només la lògica pura del patch.

L'endpoint `/bulk-update-metadata` és principalment un loop que crida
`save_page_md`. Aquí valido la lògica del **merge** que es repeteix
per cada pàgina (updates + remove + comparació `dict`).

NO testa l'endpoint sencer ni el filesystem; cal entorn FastAPI per això.
"""
from __future__ import annotations


def _apply_patch(md: dict, updates: dict | None, remove: list | None) -> dict:
    """Replica la lògica del `_apply` interna a `bulk_update_metadata`.

    Aquesta funció no importa de `vault_routes` per evitar arrossegar FastAPI.
    Si el codi de `vault_routes._apply` canvia, cal actualitzar aquesta còpia.
    """
    out = dict(md)
    for k, v in (updates or {}).items():
        if v is None or v == '':
            out.pop(k, None)
        else:
            out[k] = v
    for k in (remove or []):
        out.pop(k, None)
    return out


# ---------- updates ----------

def test_update_existing_key():
    md = {'Item Type': 'article', 'Title': 'X'}
    out = _apply_patch(md, {'Item Type': 'preprint'}, [])
    assert out == {'Item Type': 'preprint', 'Title': 'X'}


def test_update_adds_new_key():
    md = {'Title': 'X'}
    out = _apply_patch(md, {'Idioma': 'en'}, [])
    assert out == {'Title': 'X', 'Idioma': 'en'}


def test_update_with_empty_string_removes_key():
    md = {'Title': 'X', 'Notes': 'old'}
    out = _apply_patch(md, {'Notes': ''}, [])
    assert out == {'Title': 'X'}


def test_update_with_none_removes_key():
    md = {'Title': 'X', 'Notes': 'old'}
    out = _apply_patch(md, {'Notes': None}, [])
    assert out == {'Title': 'X'}


# ---------- remove ----------

def test_remove_existing_keys():
    md = {'A': 1, 'B': 2, 'C': 3}
    out = _apply_patch(md, {}, ['B', 'C'])
    assert out == {'A': 1}


def test_remove_missing_keys_is_noop():
    md = {'A': 1}
    out = _apply_patch(md, {}, ['Nonexistent'])
    assert out == {'A': 1}


# ---------- combinacions ----------

def test_updates_and_remove_together():
    md = {'Item Type': 'old', 'Stale': 'X'}
    out = _apply_patch(md, {'Item Type': 'preprint'}, ['Stale'])
    assert out == {'Item Type': 'preprint'}


def test_update_remove_collision_remove_wins():
    """Si una clau és tant a updates com a remove, prevaleix remove."""
    md = {'X': 'old'}
    out = _apply_patch(md, {'X': 'new'}, ['X'])
    assert out == {}


def test_empty_patch_returns_clone():
    md = {'A': 1}
    out = _apply_patch(md, {}, [])
    assert out == {'A': 1}
    assert out is not md  # còpia, no mutació


def test_falsy_zero_keeps_value():
    """`0` no és buit — s'ha de mantenir."""
    md = {'Count': 1}
    out = _apply_patch(md, {'Count': 0}, [])
    assert out == {'Count': 0}
