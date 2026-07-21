"""`_safe_calendar_path` ha de confinar el `vault_path` rebut del client al
directori `Calendar/` del vault actiu (patch_event/delete_event hi feien
read+write / move-to-trash sense comprovació → escriptura de fitxers arbitraris).
"""
from pathlib import Path

import backend.api.calendar_routes as cr


def _setup_vault(tmp_path, monkeypatch):
    (tmp_path / "Calendar").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cr, "get_active_vault_path", lambda: tmp_path)
    return tmp_path


def test_accepta_path_dins_calendar(tmp_path, monkeypatch):
    vault = _setup_vault(tmp_path, monkeypatch)
    ev = vault / "Calendar" / "event.md"
    ev.write_text("x")
    assert cr._safe_calendar_path(str(ev)) == ev.resolve()


def test_accepta_subcarpeta_de_calendar(tmp_path, monkeypatch):
    vault = _setup_vault(tmp_path, monkeypatch)
    ev = vault / "Calendar" / "External" / "acc" / "e.md"
    ev.parent.mkdir(parents=True, exist_ok=True)
    ev.write_text("x")
    assert cr._safe_calendar_path(str(ev)) == ev.resolve()


def test_rebutja_traversal(tmp_path, monkeypatch):
    vault = _setup_vault(tmp_path, monkeypatch)
    # Sortir de Calendar cap a un fitxer sensible del vault o del sistema.
    outside = vault / "Calendar" / ".." / ".." / "secret.md"
    (vault.parent / "secret.md").write_text("secret")
    assert cr._safe_calendar_path(str(outside)) is None


def test_rebutja_ruta_absoluta_arbitraria(tmp_path, monkeypatch):
    _setup_vault(tmp_path, monkeypatch)
    assert cr._safe_calendar_path("/etc/hosts") is None
    # Fora del Calendar però dins el vault: també rebutjat.
    assert cr._safe_calendar_path(str(tmp_path / "Notes" / "x.md")) is None


def test_rebutja_buit(tmp_path, monkeypatch):
    _setup_vault(tmp_path, monkeypatch)
    assert cr._safe_calendar_path("") is None
    assert cr._safe_calendar_path(None) is None
