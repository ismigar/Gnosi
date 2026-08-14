"""Tests for the bulk update — only the pure patch logic.

The `/bulk-update-metadata` endpoint is mainly a loop that calls
`save_page_md`. Here I validate the **merge** logic that repeats
for each page (updates + remove + `dict` comparison).

Does NOT test the whole endpoint or the filesystem; a FastAPI environment is needed for that.
"""
from __future__ import annotations


def _apply_patch(md: dict, updates: dict | None, remove: list | None) -> dict:
    """Replicates the internal `_apply` logic in `bulk_update_metadata`.

    This function doesn't import from `vault_routes` to avoid dragging in FastAPI.
    If `vault_routes._apply`'s code changes, this copy must be updated.
    
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
    """If a key is in both updates and remove, remove takes precedence."""
    md = {'X': 'old'}
    out = _apply_patch(md, {'X': 'new'}, ['X'])
    assert out == {}


def test_empty_patch_returns_clone():
    md = {'A': 1}
    out = _apply_patch(md, {}, [])
    assert out == {'A': 1}
    assert out is not md  # copy, not mutation


def test_falsy_zero_keeps_value():
    """`0` is not empty — it must be kept."""
    md = {'Count': 1}
    out = _apply_patch(md, {'Count': 0}, [])
    assert out == {'Count': 0}
