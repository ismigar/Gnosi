"""`_safe_calendar_path` confines client-provided paths to `Calendar/`.

Previously patch_event and delete_event performed reads, writes, and moves to
Trash without containment, allowing arbitrary file writes.
"""
from pathlib import Path

import backend.api.calendar_routes as cr


def _setup_vault(tmp_path, monkeypatch):
    (tmp_path / "Calendar").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cr, "get_active_vault_path", lambda: tmp_path)
    return tmp_path


def test_accepts_path_inside_calendar(tmp_path, monkeypatch):
    vault = _setup_vault(tmp_path, monkeypatch)
    ev = vault / "Calendar" / "event.md"
    ev.write_text("x")
    assert cr._safe_calendar_path(str(ev)) == ev.resolve()


def test_accepts_calendar_subfolder(tmp_path, monkeypatch):
    vault = _setup_vault(tmp_path, monkeypatch)
    ev = vault / "Calendar" / "External" / "acc" / "e.md"
    ev.parent.mkdir(parents=True, exist_ok=True)
    ev.write_text("x")
    assert cr._safe_calendar_path(str(ev)) == ev.resolve()


def test_rejects_traversal(tmp_path, monkeypatch):
    vault = _setup_vault(tmp_path, monkeypatch)
    # Escape Calendar toward a sensitive vault or system file.
    outside = vault / "Calendar" / ".." / ".." / "secret.md"
    (vault.parent / "secret.md").write_text("secret")
    assert cr._safe_calendar_path(str(outside)) is None


def test_rejects_arbitrary_absolute_path(tmp_path, monkeypatch):
    _setup_vault(tmp_path, monkeypatch)
    assert cr._safe_calendar_path("/etc/hosts") is None
    # A path outside Calendar but inside the vault is also rejected.
    assert cr._safe_calendar_path(str(tmp_path / "Notes" / "x.md")) is None


def test_rejects_empty_path(tmp_path, monkeypatch):
    _setup_vault(tmp_path, monkeypatch)
    assert cr._safe_calendar_path("") is None
    assert cr._safe_calendar_path(None) is None
