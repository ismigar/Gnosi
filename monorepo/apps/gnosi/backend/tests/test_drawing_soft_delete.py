"""Esborrar un dibuix passa per la paperera (soft-delete), com les pàgines.

Abans `DELETE /drawings/{id}` feia `unlink()` directe: irreversible a
l'instant, i el backup d'`.history` només existeix si el dibuix s'havia
sobreescrit algun cop — un dibuix nou esborrat es perdia del tot, mentre
que tota la resta de l'app té Restaurar + 90 dies.
"""
import asyncio
import json
from pathlib import Path

import pytest

import backend.api.vault_routes as vr

DID = "11111111-2222-4333-8444-555555555555"


@pytest.fixture()
def vault(monkeypatch, tmp_path):
    root = tmp_path / "vault"
    dib = root / "Dibuixos"
    dib.mkdir(parents=True)

    def fake_get_p(key):
        return {"VAULT": root, "DIBUIXOS": dib}.get(key, root)

    monkeypatch.setattr(vr, "get_p", fake_get_p)
    monkeypatch.setattr(vr, "_trash_root", lambda: root / ".trash")

    drawing = dib / f"{DID}.tldraw.json"
    drawing.write_text(json.dumps({"title": "El meu croquis", "data": {"document": {"x": 1}}}),
                       encoding="utf-8")
    return {"root": root, "dib": dib, "drawing": drawing}


def test_delete_moves_drawing_to_trash(vault):
    res = asyncio.run(vr.delete_drawing(DID))

    assert res["status"] == "soft_deleted"
    assert res["title"] == "El meu croquis"
    assert not vault["drawing"].exists(), "el fitxer ha de sortir de Dibuixos/"

    entry = vault["root"] / ".trash" / DID
    assert (entry / "page.md").exists(), "el contingut viu a la paperera"
    sidecar = json.loads((entry / "_trash.json").read_text(encoding="utf-8"))
    assert sidecar["original_path"] == f"Dibuixos/{DID}.tldraw.json"
    assert sidecar["title"] == "El meu croquis"


def test_restore_puts_drawing_back(vault):
    asyncio.run(vr.delete_drawing(DID))

    restored = vr._restore_page_from_trash(DID)

    assert vault["drawing"].exists(), "Restaurar torna el dibuix a Dibuixos/"
    payload = json.loads(vault["drawing"].read_text(encoding="utf-8"))
    assert payload["data"]["document"] == {"x": 1}
    assert restored.get("id") == DID or restored is not None


def test_delete_missing_drawing_404(vault):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(vr.delete_drawing("99999999-9999-4999-8999-999999999999"))
    assert e.value.status_code == 404
