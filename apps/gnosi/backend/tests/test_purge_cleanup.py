"""Trash purge must take ALL traces of the page with it.

Previously only the .trash directory (+ sidecar) was deleted: the version
history (.history/{id}/ — with the page's FULL CONTENT inside),
the comment thread (page_comments.json), and the inline comments were left
orphaned forever. Audited against the real vault: 158 history directories for
already-purged pages (408 files) — the user believes the page is gone
but .history still keeps it.
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

    # Trash entry with a file inside.
    trash = root / ".trash" / PID
    trash.mkdir(parents=True)
    (trash / "page.md").write_text("contingut esborrat", encoding="utf-8")
    monkeypatch.setattr(vr, "_trash_entry_dir", lambda pid: root / ".trash" / pid)
    monkeypatch.setattr(vr, "delete_sidecar_for_page", lambda vroot, pid: None)

    # History with a snapshot.
    hist = root / ".history" / PID
    hist.mkdir(parents=True)
    (hist / "20260706_000000.md").write_text("versió antiga sencera", encoding="utf-8")

    # Comments: the page's thread + another one that must survive.
    comments_path = root / "page_comments.json"
    comments_path.write_text(json.dumps({PID: [{"id": "c1", "body": "hola"}],
                                         "altra-pagina": [{"id": "c2", "body": "resta"}]}),
                             encoding="utf-8")
    monkeypatch.setattr(vr, "_get_comments_path", lambda: comments_path)

    # Inline comments on the page (path via monkeypatch: the real helper depends
    # on the context's active vault).
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
    # If the extra cleanup fails, the purge itself must NOT fail.
    def boom():
        raise RuntimeError("disc en flames")

    monkeypatch.setattr(vr, "_load_comments", boom)
    res = vr._purge_trash_entry(PID)
    assert res["id"] == PID
    assert not (vault["root"] / ".trash" / PID).exists()
