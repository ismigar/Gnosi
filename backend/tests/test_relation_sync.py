"""Bidirectional relation sync (direct → inverse).

When a page changes a relation field, the INVERSE field on the other side
must be updated (otherwise embedded views that filter by the inverse come out
empty). Tests for `_propagate_relation_inverse` propagation with real I/O
(`save_page_md`/`parse_frontmatter`) and registry + `find_page_path` mocked.

See docs/dev_memory/directives/vault_relation_inverse_sync.md
"""
from __future__ import annotations

from pathlib import Path

import pytest

import backend.api.vault_routes as vr
from backend.api.vault_routes import (
    _propagate_relation_inverse,
    parse_frontmatter,
    save_page_md,
)
from backend.services import relation_sync

# Test schema: Àrees (source) ←→ Recursos (destination). The direct field on Àrees
# is called "Recursos" and the inverse field on Recursos is called "Àrees". Detection of
# relation fields is always by SCHEMA (type=="relation"), never by any prefix.
ORIGIN = "origin_arees"
DEST = "dest_recursos"
HOST = "11111111-1111-4111-8111-111111111111"   # area page (host)
T1 = "22222222-2222-4222-8222-222222222222"      # recurs target
OTHER_AREA = "33333333-3333-4333-8333-333333333333"

TABLES = {
    ORIGIN: {"id": ORIGIN, "name": "Àrees", "properties": [
        {"id": "fld_dir", "name": "Recursos", "type": "relation",
         "relation_database_id": DEST, "cardinality": "many-to-many"},
    ]},
    DEST: {"id": DEST, "name": "Recursos", "properties": [
        {"id": "fld_inv", "name": "Àrees", "type": "relation",
         "relation_database_id": ORIGIN, "cardinality": "many-to-many"},
    ]},
}

# Ambiguous schema: the source has TWO fields pointing to the same destination table → can't
# know which inverse applies → must NOT be propagated.
AMB_ORIGIN = "amb_origin"
AMB_DEST = "amb_dest"
TABLES_AMBIG = {
    AMB_ORIGIN: {"id": AMB_ORIGIN, "name": "Àrees", "properties": [
        {"id": "f1", "name": "Experiència", "type": "relation",
         "relation_database_id": AMB_DEST},
        {"id": "f2", "name": "Titulacions", "type": "relation",
         "relation_database_id": AMB_DEST},
    ]},
    AMB_DEST: {"id": AMB_DEST, "name": "Formació", "properties": [
        {"id": "f3", "name": "Àrea", "type": "relation",
         "relation_database_id": AMB_ORIGIN},
    ]},
}


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    (tmp_path / ".gnosi").mkdir()
    return tmp_path


def _target(vault: Path, inverse_value=None) -> Path:
    """Creates the target resource, with or without the inverse field already populated."""
    f = vault / "recurs.md"
    md = {"id": T1, "title": "Recurs", "table_id": DEST}
    if inverse_value is not None:
        md["Àrees"] = inverse_value
    save_page_md(f, md, "cos de la nota")
    return f


def _wire(monkeypatch, tfile: Path, tables=TABLES):
    monkeypatch.setattr(vr, "_link_index_built", False)  # cold index → bare, clean id
    monkeypatch.setattr(vr, "_table_by_id", lambda tid: tables.get(tid))
    monkeypatch.setattr(
        vr, "find_page_path", lambda pid, **k: tfile if pid == T1 else None
    )


def _inv(md, name="Àrees"):
    """Ids from the inverse field, matching the frontmatter key against the
    schema name via normalization (robust to formatting variations)."""
    nk = relation_sync._norm(name)
    for k, v in md.items():
        if relation_sync._norm(k) == nk:
            return relation_sync.to_ids(v)
    return []


def _inv_key_count(md, name="Àrees"):
    """How many frontmatter keys normalize to the inverse field (must be ≤1:
    a duplicate key must not be created)."""
    nk = relation_sync._norm(name)
    return sum(1 for k in md if relation_sync._norm(k) == nk)


def test_add_inverse_to_target_without_field(vault, monkeypatch):
    tfile = _target(vault)  # without inverse field
    _wire(monkeypatch, tfile)
    # The area adds the resource to its direct field.
    _propagate_relation_inverse(HOST, ORIGIN, {"Recursos": []},
                                {"Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [HOST]


def test_add_preserves_existing_inverse_many_to_many(vault, monkeypatch):
    tfile = _target(vault, inverse_value=[OTHER_AREA])  # already points to another area
    _wire(monkeypatch, tfile)
    _propagate_relation_inverse(HOST, ORIGIN, {"Recursos": []},
                                {"Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    # Does not create a duplicate key; reuses the existing key and keeps the existing one.
    assert _inv_key_count(md) == 1
    assert set(_inv(md)) == {OTHER_AREA, HOST}


def test_remove_inverse(vault, monkeypatch):
    tfile = _target(vault, inverse_value=[OTHER_AREA, HOST])
    _wire(monkeypatch, tfile)
    # The area removes the resource from its direct field.
    _propagate_relation_inverse(HOST, ORIGIN, {"Recursos": [T1]},
                                {"Recursos": []})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [OTHER_AREA]


def test_idempotent_add_when_already_present(vault, monkeypatch):
    tfile = _target(vault, inverse_value=[HOST])
    _wire(monkeypatch, tfile)
    before = tfile.read_text(encoding="utf-8")
    _propagate_relation_inverse(HOST, ORIGIN, {"Recursos": []},
                                {"Recursos": [T1]})
    # Already there → doesn't add a duplicate (and doesn't rewrite).
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [HOST]
    assert tfile.read_text(encoding="utf-8") == before


def test_ambiguous_relation_is_not_propagated(vault, monkeypatch):
    tfile = _target(vault)  # without inverse field
    _wire(monkeypatch, tfile, tables=TABLES_AMBIG)
    # "Experiència" maps to a table where the source has 2 fields → ambiguous.
    _propagate_relation_inverse(HOST, AMB_ORIGIN, {"Experiència": []},
                                {"Experiència": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv_key_count(md, "Àrea") == 0  # nothing propagated


def test_detects_direct_field_via_schema(vault, monkeypatch):
    """The DIRECT field is detected via the schema (type==relation), not by any
    prefix in the name → inverse propagation works with clean names."""
    tfile = _target(vault)
    _wire(monkeypatch, tfile)
    _propagate_relation_inverse(HOST, ORIGIN, {"Recursos": []}, {"Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [HOST]


def test_no_self_reference(vault, monkeypatch):
    """If the host were to list itself, it doesn't get written (defensive)."""
    tfile = _target(vault)
    _wire(monkeypatch, tfile)
    monkeypatch.setattr(vr, "find_page_path", lambda pid, **k: tfile)
    _propagate_relation_inverse(T1, ORIGIN, {"Recursos": []},
                                {"Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert not _inv(md)
