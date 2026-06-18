"""Round-trip dels wikilinks de relació al frontmatter.

Format canònic d'un ítem de camp relació (claus 📀): "[[Títol|id]]" — el
valor és exactament un wikilink (Obsidian l'indexa) i l'id viu a l'àlies
(mana sempre). En llegir es despulla a id; en desar es decora amb el títol
actual. Vegeu docs/dev_memory/directives/relation_wikilinks_frontmatter.md.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

import backend.api.vault_routes as vr
from backend.api.vault_routes import parse_frontmatter, save_page_md
from backend.services.relation_links import (
    decorate_relation_wikilinks,
    strip_relation_wikilinks,
)

RID = "9604a0ed-f4c2-4e72-b4ae-a39f81a7c58f"
RID2 = "a70d2f6f-d943-4f3a-8256-8517be6c839a"
TITLE = "A favor de la teodicea"
TITLE2 = "Dues tradicions del mal"


# ---------------------------------------------------------------- unitats

def test_strip_decorated_to_id():
    md = {"📀 Àrees": [f"[[Filosofia i espiritualitat|{RID}]]"]}
    assert strip_relation_wikilinks(md)["📀 Àrees"] == [RID]


def test_strip_scalar_value():
    md = {"📀 Original": f"[[{TITLE}|{RID}]]"}
    assert strip_relation_wikilinks(md)["📀 Original"] == RID


def test_strip_does_not_touch_non_relation_keys():
    wikilink = f"[[Filosofia|{RID}]]"
    md = {"Notes": [wikilink], "Cita": wikilink}
    out = strip_relation_wikilinks(md)
    assert out["Notes"] == [wikilink]
    assert out["Cita"] == wikilink


def test_strip_keeps_bare_ids_title_only_and_nonstrings():
    items = [RID, "[[Sense àlies]]", 7, None, {"k": 1}]
    md = {"📀 X": list(items)}
    assert strip_relation_wikilinks(md)["📀 X"] == items


def test_decorate_bare_id_with_title():
    md = {"📀 X": [RID]}
    decorate_relation_wikilinks(md, id_to_title={RID: TITLE}.get)
    assert md["📀 X"] == [f"[[{TITLE}|{RID}]]"]


def test_decorate_unknown_title_keeps_bare_id():
    md = {"📀 X": [RID]}
    decorate_relation_wikilinks(md, id_to_title=lambda _: None)
    assert md["📀 X"] == [RID]


@pytest.mark.parametrize("bad_title", ["Tí|tol", "Nota [4]", "Secció#2", "Bloc^x", "salt\nde línia"])
def test_decorate_unsafe_title_keeps_bare_id(bad_title):
    md = {"📀 X": [RID]}
    decorate_relation_wikilinks(md, id_to_title={RID: bad_title}.get)
    assert md["📀 X"] == [RID]


def test_decorate_refreshes_stale_title():
    md = {"📀 X": [f"[[Títol vell|{RID}]]"]}
    decorate_relation_wikilinks(md, id_to_title={RID: "Títol nou"}.get)
    assert md["📀 X"] == [f"[[Títol nou|{RID}]]"]


def test_decorate_preserves_decorated_item_when_index_cold():
    """Amb l'índex fred no es perd l'últim títol bo conegut."""
    item = f"[[Títol vell|{RID}]]"
    md = {"📀 X": [item]}
    decorate_relation_wikilinks(md, id_to_title=lambda _: None)
    assert md["📀 X"] == [item]


def test_decorate_heals_title_only_wikilink_when_unique():
    """Una edició manual a Obsidian ([[Títol]]) es canonicalitza en desar."""
    md = {"📀 X": [f"[[{TITLE}]]"]}
    decorate_relation_wikilinks(
        md,
        id_to_title={RID: TITLE}.get,
        title_to_id=lambda t: RID if t == TITLE else None,
    )
    assert md["📀 X"] == [f"[[{TITLE}|{RID}]]"]


def test_decorate_keeps_title_only_when_ambiguous():
    md = {"📀 X": ["[[Títol repetit]]"]}
    decorate_relation_wikilinks(md, id_to_title=lambda _: None, title_to_id=lambda _: None)
    assert md["📀 X"] == ["[[Títol repetit]]"]


def test_decorate_is_idempotent():
    md = {"📀 X": [RID, RID2]}
    titles = {RID: TITLE, RID2: TITLE2}
    decorate_relation_wikilinks(md, id_to_title=titles.get)
    once = dict(md)
    decorate_relation_wikilinks(md, id_to_title=titles.get)
    assert md == once


def test_decorate_respects_schema_relation_keys():
    """Un camp relació SENSE prefix 📀 (hipotètic) es decora si ve a l'esquema."""
    md = {"Relacionats": [RID]}
    decorate_relation_wikilinks(
        md, relation_keys={"Relacionats"}, id_to_title={RID: TITLE}.get
    )
    assert md["Relacionats"] == [f"[[{TITLE}|{RID}]]"]


def test_yaml_roundtrip_of_decorated_values():
    """PyYAML ha d'encomillar sol els valors que comencen per '['."""
    md = {"📀 X": [f"[[{TITLE}|{RID}]]"]}
    dumped = yaml.dump(md, default_flow_style=False, sort_keys=False, allow_unicode=True)
    loaded = yaml.safe_load(dumped)
    assert loaded == md


# ------------------------------------------------------------ integració

@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    """Vault mínim amb `.gnosi/` perquè `persist_sidecar_from` el detecti."""
    (tmp_path / ".gnosi").mkdir()
    return tmp_path


@pytest.fixture()
def warm_index(monkeypatch):
    """Simula l'índex d'enllaços calent amb dos títols coneguts."""
    monkeypatch.setattr(vr, "_link_index_built", True)
    monkeypatch.setattr(
        vr,
        "_page_meta_by_id",
        {
            RID: {"title": TITLE, "path": "x"},
            RID2: {"title": TITLE2, "path": "y"},
        },
    )


PAGE_ID = "11111111-1111-4111-8111-111111111111"


def test_save_decorates_and_parse_strips(vault: Path, warm_index):
    f = vault / "recurs.md"
    save_page_md(
        f,
        {"id": PAGE_ID, "title": "Recurs", "📀 Extractes i notes": [RID, RID2]},
        "cos de la nota",
    )
    raw = f.read_text(encoding="utf-8")
    assert f"[[{TITLE}|{RID}]]" in raw
    assert f"[[{TITLE2}|{RID2}]]" in raw
    # El cos no porta seccions de relació.
    assert "# Extractes i notes" not in raw

    md, body = parse_frontmatter(raw, f)
    assert md["📀 Extractes i notes"] == [RID, RID2]
    assert body.strip() == "cos de la nota"


def test_save_with_cold_index_keeps_bare_ids(vault: Path, monkeypatch):
    monkeypatch.setattr(vr, "_link_index_built", False)
    f = vault / "recurs.md"
    save_page_md(f, {"id": PAGE_ID, "title": "Recurs", "📀 Àrees": [RID]}, "cos")
    raw = f.read_text(encoding="utf-8")
    assert RID in raw
    assert "[[" not in raw.split("---")[1]  # frontmatter sense wikilinks
    md, _ = parse_frontmatter(raw, f)
    assert md["📀 Àrees"] == [RID]


def test_save_heals_obsidian_title_only_edit(vault: Path, warm_index):
    """Si Obsidian deixa '[[Títol]]' al camp 📀, la desada el canonicalitza."""
    f = vault / "recurs.md"
    save_page_md(
        f,
        {"id": PAGE_ID, "title": "Recurs", "📀 Extractes i notes": [f"[[{TITLE}]]"]},
        "cos",
    )
    raw = f.read_text(encoding="utf-8")
    assert f"[[{TITLE}|{RID}]]" in raw
    md, _ = parse_frontmatter(raw, f)
    assert md["📀 Extractes i notes"] == [RID]
