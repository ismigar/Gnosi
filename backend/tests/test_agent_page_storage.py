"""Agent writes use canonical page storage and compensate sidecar failures."""

import json

import pytest
import yaml

from backend.api import vault_routes
from backend.domains.agent.gnosi_support import _rollback_page_items, _sidecar_snapshot, _write_page
from backend.services.context_vars import active_vault_path
from backend.services.page_sidecar import read_sidecar, sidecar_path_for


def test_agent_write_keeps_internal_flags_out_of_markdown(monkeypatch, tmp_path):
    (tmp_path / ".gnosi").mkdir()
    path = tmp_path / "Note.md"
    monkeypatch.setattr(vault_routes, "_create_page_version", lambda *_args: None)
    monkeypatch.setattr(vault_routes, "register_page_in_index", lambda _path: None)
    token = active_vault_path.set(tmp_path)
    try:
        _write_page(path, {"id": "note", "title": "Note", "estat": "En revisió", "estat_manual": True}, "Body")
    finally:
        active_vault_path.reset(token)
    metadata = yaml.safe_load(path.read_text().split("---", 2)[1])
    assert not any(key.endswith("_manual") for key in metadata)
    assert read_sidecar(tmp_path, "note")["estat_manual"] is True
    assert "Body" in path.read_text()


@pytest.mark.parametrize("had_sidecar", [False, True])
def test_failed_page_write_restores_both_storage_files(monkeypatch, tmp_path, had_sidecar):
    (tmp_path / ".gnosi/page_meta").mkdir(parents=True)
    path = tmp_path / "Note.md"
    path.write_text("original page")
    sidecar = sidecar_path_for(tmp_path, "note")
    original = b'{"estat_manual":false}'
    if had_sidecar:
        sidecar.write_bytes(original)
    monkeypatch.setattr(vault_routes, "_create_page_version", lambda *_args: None)
    def fail(page_path, _metadata, _body):
        sidecar.write_text(json.dumps({"estat_manual": True}))
        page_path.write_text("partial page")
        raise OSError("failed after sidecar write")
    monkeypatch.setattr(vault_routes, "save_page_md", fail)
    with pytest.raises(OSError):
        _write_page(path, {"id": "note"}, "body")
    assert path.read_text() == "original page"
    assert sidecar.read_bytes() == original if had_sidecar else not sidecar.exists()


def test_bulk_compensation_restores_a_previously_written_sidecar(monkeypatch, tmp_path):
    (tmp_path / ".gnosi/page_meta").mkdir(parents=True)
    path = tmp_path / "Note.md"
    path.write_text("original page")
    sidecar = sidecar_path_for(tmp_path, "note")
    sidecar.write_text('{"estat_manual":false}')
    snapshot = {"id": "note", "path": path, "original": path.read_bytes(), **_sidecar_snapshot(path, "note")}
    path.write_text("changed page")
    sidecar.write_text('{"estat_manual":true}')
    monkeypatch.setattr(vault_routes, "register_page_in_index", lambda _path: None)
    assert _rollback_page_items([snapshot]) == []
    assert path.read_text() == "original page"
    assert sidecar.read_bytes() == snapshot["sidecar_original"]
