"""Sincronització bidireccional de relacions (directe → invers).

Quan una pàgina canvia un camp de relació, el camp INVERS de l'altre costat
s'ha d'actualitzar (o les vistes incrustades, que filtren per l'invers, surten
buides). Tests de la propagació `_propagate_relation_inverse` amb I/O real
(`save_page_md`/`parse_frontmatter`) i registry + `find_page_path` mockejats.

Vegeu docs/dev_memory/directives/vault_relation_inverse_sync.md
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

# Esquema de prova: Àrees (origen) ←→ Recursos (destí). El camp directe a Àrees
# es diu "Recursos" (registry) però al frontmatter és "📀 Recursos"; el camp
# invers a Recursos es diu "Àrees" amb àlies "📀 Àrees" (com al vault real).
ORIGIN = "origin_arees"
DEST = "dest_recursos"
HOST = "11111111-1111-4111-8111-111111111111"   # pàgina d'àrea (host)
T1 = "22222222-2222-4222-8222-222222222222"      # recurs target
OTHER_AREA = "33333333-3333-4333-8333-333333333333"

TABLES = {
    ORIGIN: {"id": ORIGIN, "name": "Àrees", "properties": [
        {"id": "fld_dir", "name": "Recursos", "type": "relation",
         "relation_database_id": DEST, "cardinality": "many-to-many"},
    ]},
    DEST: {"id": DEST, "name": "Recursos", "properties": [
        {"id": "fld_inv", "name": "Àrees", "type": "relation",
         "relation_database_id": ORIGIN, "cardinality": "many-to-many",
         "aliases": ["📀 Àrees"]},
    ]},
}

# Esquema ambigu: l'origen té DOS camps cap a la mateixa taula destí → no es pot
# saber quin invers toca → NO s'ha de propagar.
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
    """Crea el recurs target, amb o sense el camp invers ja poblat."""
    f = vault / "recurs.md"
    md = {"id": T1, "title": "Recurs", "table_id": DEST}
    if inverse_value is not None:
        md["📀 Àrees"] = inverse_value
    save_page_md(f, md, "cos de la nota")
    return f


def _wire(monkeypatch, tfile: Path, tables=TABLES):
    monkeypatch.setattr(vr, "_link_index_built", False)  # índex fred → id nu, net
    monkeypatch.setattr(vr, "_table_by_id", lambda tid: tables.get(tid))
    monkeypatch.setattr(
        vr, "find_page_path", lambda pid, **k: tfile if pid == T1 else None
    )


def _inv(md, name="Àrees"):
    """Ids del camp invers, sigui quina sigui la clau (`Àrees` o `📀 Àrees`):
    `save_page_md` canonicalitza al `name` del registry, que pot dur o no el 📀."""
    nk = relation_sync._norm(name)
    for k, v in md.items():
        if relation_sync.is_relation_key(k) or relation_sync._norm(k) == nk:
            if relation_sync._norm(k) == nk:
                return relation_sync.to_ids(v)
    return []


def _inv_key_count(md, name="Àrees"):
    """Quantes claus del frontmatter normalitzen al camp invers (ha de ser ≤1:
    no s'ha de crear una clau duplicada `Àrees` + `📀 Àrees`)."""
    nk = relation_sync._norm(name)
    return sum(1 for k in md if relation_sync._norm(k) == nk)


def test_add_inverse_to_target_without_field(vault, monkeypatch):
    tfile = _target(vault)  # sense camp invers
    _wire(monkeypatch, tfile)
    # L'àrea afegeix el recurs al seu camp directe.
    _propagate_relation_inverse(HOST, ORIGIN, {"📀 Recursos": []},
                                {"📀 Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [HOST]


def test_add_preserves_existing_inverse_many_to_many(vault, monkeypatch):
    tfile = _target(vault, inverse_value=[OTHER_AREA])  # ja apunta a una altra àrea
    _wire(monkeypatch, tfile)
    _propagate_relation_inverse(HOST, ORIGIN, {"📀 Recursos": []},
                                {"📀 Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    # No crea clau duplicada; reusa la clau existent i conserva l'existent.
    assert _inv_key_count(md) == 1
    assert set(_inv(md)) == {OTHER_AREA, HOST}


def test_remove_inverse(vault, monkeypatch):
    tfile = _target(vault, inverse_value=[OTHER_AREA, HOST])
    _wire(monkeypatch, tfile)
    # L'àrea treu el recurs del seu camp directe.
    _propagate_relation_inverse(HOST, ORIGIN, {"📀 Recursos": [T1]},
                                {"📀 Recursos": []})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [OTHER_AREA]


def test_idempotent_add_when_already_present(vault, monkeypatch):
    tfile = _target(vault, inverse_value=[HOST])
    _wire(monkeypatch, tfile)
    before = tfile.read_text(encoding="utf-8")
    _propagate_relation_inverse(HOST, ORIGIN, {"📀 Recursos": []},
                                {"📀 Recursos": [T1]})
    # Ja hi era → no afegeix duplicat (i no reescriu).
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [HOST]
    assert tfile.read_text(encoding="utf-8") == before


def test_ambiguous_relation_is_not_propagated(vault, monkeypatch):
    tfile = _target(vault)  # sense camp invers
    _wire(monkeypatch, tfile, tables=TABLES_AMBIG)
    # "📀 Experiència" mapeja a una taula on l'origen té 2 camps → ambigu.
    _propagate_relation_inverse(HOST, AMB_ORIGIN, {"📀 Experiència": []},
                                {"📀 Experiència": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv_key_count(md, "Àrea") == 0  # res propagat


def test_detects_renamed_direct_field_without_emoji(vault, monkeypatch):
    """El camp DIRECTE renomenat sense `📀` (p.ex. `Recursos`) es detecta via
    l'esquema (no pel prefix) → la propagació inversa segueix funcionant."""
    tfile = _target(vault)
    _wire(monkeypatch, tfile)
    _propagate_relation_inverse(HOST, ORIGIN, {"Recursos": []}, {"Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert _inv(md) == [HOST]


def test_no_self_reference(vault, monkeypatch):
    """Si el host es llistés a si mateix, no s'escriu (defensiu)."""
    tfile = _target(vault)
    _wire(monkeypatch, tfile)
    monkeypatch.setattr(vr, "find_page_path", lambda pid, **k: tfile)
    _propagate_relation_inverse(T1, ORIGIN, {"📀 Recursos": []},
                                {"📀 Recursos": [T1]})
    md, _ = parse_frontmatter(tfile.read_text(encoding="utf-8"), tfile)
    assert not _inv(md)
