"""La purga de paperera ha d'endur-se TOTS els rastres de la pàgina.

Abans només s'esborrava el directori de .trash (+ sidecar): l'historial de
versions (.history/{id}/ — amb el CONTINGUT COMPLET de la pàgina a dins),
el fil de comentaris (page_comments.json) i els inline comments quedaven
orfes per sempre. Auditat al vault real: 158 directoris d'historial de
pàgines ja purgades (408 fitxers) — l'usuari creu que la pàgina és fora
però .history encara la conserva.
"""
import json
from pathlib import Path

import pytest

import backend.api.vault_routes as vr

PID = "11111111-2222-4333-8444-555555555555"


@pytest.fixture()
def vault(monkeypatch, tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    monkeypatch.setattr(vr, "get_p", lambda key: root)

    # Entrada de paperera amb un fitxer dins.
    trash = root / ".trash" / PID
    trash.mkdir(parents=True)
    (trash / "page.md").write_text("contingut esborrat", encoding="utf-8")
    monkeypatch.setattr(vr, "_trash_entry_dir", lambda pid: root / ".trash" / pid)
    monkeypatch.setattr(vr, "delete_sidecar_for_page", lambda vroot, pid: None)

    # Historial amb un snapshot.
    hist = root / ".history" / PID
    hist.mkdir(parents=True)
    (hist / "20260706_000000.md").write_text("versió antiga sencera", encoding="utf-8")

    # Comentaris: el fil de la pàgina + un altre que ha de sobreviure.
    comments_path = root / "page_comments.json"
    comments_path.write_text(json.dumps({PID: [{"id": "c1", "body": "hola"}],
                                         "altra-pagina": [{"id": "c2", "body": "resta"}]}),
                             encoding="utf-8")
    monkeypatch.setattr(vr, "_get_comments_path", lambda: comments_path)

    # Inline comments de la pàgina (path via monkeypatch: el helper real depèn
    # del vault actiu del context).
    inline_dir = root / ".gnosi" / "inline_comments"
    inline_dir.mkdir(parents=True)
    real_inline = inline_dir / f"{PID}.json"
    real_inline.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(vr, "_inline_comments_path", lambda pid: inline_dir / f"{pid}.json")

    return {"root": root, "hist": hist, "comments": comments_path, "inline": real_inline}


def test_purge_removes_all_traces(vault):
    res = vr._purge_trash_entry(PID)

    assert res["id"] == PID
    assert res["freed_bytes"] > 0
    assert not (vault["root"] / ".trash" / PID).exists()
    assert not vault["hist"].exists(), "l'historial ha de morir amb la purga"
    data = json.loads(vault["comments"].read_text(encoding="utf-8"))
    assert PID not in data, "el fil de comentaris ha de morir amb la purga"
    assert "altra-pagina" in data, "els fils d'altres pàgines no es toquen"
    assert not vault["inline"].exists(), "els inline comments han de morir amb la purga"


def test_purge_survives_cleanup_failures(vault, monkeypatch):
    # Si la neteja extra peta, la purga en si NO ha de fallar.
    def boom():
        raise RuntimeError("disc en flames")

    monkeypatch.setattr(vr, "_load_comments", boom)
    res = vr._purge_trash_entry(PID)
    assert res["id"] == PID
    assert not (vault["root"] / ".trash" / PID).exists()
