"""When purging a page, its id must be removed from inverse relations.

(Soft) deleting a source page preserves the relations in case it's restored, but
PURGE is permanent: without cleaning them up, pages that pointed to it are left
with a dangling relation to an id that no longer exists anywhere (audited against the
real vault: 4 pages with `Font →` a purged id). `_purge_trash_entry` reads the
relations from the trash's `page.md` BEFORE the rmtree and propagates the removal
(`_propagate_relation_inverse` with an empty new_meta → all "remove").
"""
import json

import pytest

import backend.api.vault_routes as vr

PID = "11111111-2222-4333-8444-555555555555"
TID = "table-articles"


@pytest.fixture()
def vault(monkeypatch, tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    monkeypatch.setattr(vr, "get_p", lambda key: root)
    monkeypatch.setattr(vr, "_trash_root", lambda: root / ".trash")
    monkeypatch.setattr(vr, "delete_sidecar_for_page", lambda vroot, pid: None)
    monkeypatch.setattr(vr, "_load_comments", lambda: {})
    monkeypatch.setattr(vr, "_save_comments", lambda d: None)
    monkeypatch.setattr(vr, "_inline_comments_path", lambda pid: root / ".gnosi" / f"{pid}.json")

    calls = []
    monkeypatch.setattr(
        vr, "_propagate_relation_inverse",
        lambda page_id, table_id, old, new: calls.append((page_id, table_id, old, new)),
    )
    return {"root": root, "calls": calls}


def _make_trash_entry(root, frontmatter: dict):
    entry = root / ".trash" / PID
    entry.mkdir(parents=True)
    fm = "\n".join(f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in frontmatter.items())
    (entry / "page.md").write_text(f"---\n{fm}\n---\ncos\n", encoding="utf-8")
    (entry / "_trash.json").write_text(json.dumps({"id": PID}), encoding="utf-8")
    return entry


def test_purge_propagates_relation_removal(vault):
    _make_trash_entry(vault["root"], {
        "id": PID, "table_id": TID,
        "Font": ["target-a", "target-b"],
    })

    res = vr._purge_trash_entry(PID)

    assert res["id"] == PID
    assert not (vault["root"] / ".trash" / PID).exists(), "l'entrada s'ha de purgar"
    assert len(vault["calls"]) == 1, "s'ha de propagar la retirada de relacions una vegada"
    page_id, table_id, old, new = vault["calls"][0]
    assert page_id == PID
    assert table_id == TID
    assert old.get("Font") == ["target-a", "target-b"], "old_meta ha de portar les relacions"
    assert new == {}, "new_meta buit → totes les relacions compten com a 'remove'"


def test_purge_without_table_skips_propagation(vault):
    # A wiki page without table_id has no DB relations → doesn't propagate.
    _make_trash_entry(vault["root"], {"id": PID, "title": "Nota solta"})

    vr._purge_trash_entry(PID)

    assert vault["calls"] == [], "sense table_id no s'ha de propagar res"


def test_purge_survives_propagation_failure(vault, monkeypatch):
    _make_trash_entry(vault["root"], {"id": PID, "table_id": TID, "Font": ["x"]})

    def boom(*a, **k):
        raise RuntimeError("relation sync en flames")

    monkeypatch.setattr(vr, "_propagate_relation_inverse", boom)
    res = vr._purge_trash_entry(PID)  # must not propagate the exception
    assert res["id"] == PID
    assert not (vault["root"] / ".trash" / PID).exists()
