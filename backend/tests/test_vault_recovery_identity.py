"""Recover a moved library without recreating its old location or rewriting peers."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from backend.api.vaults_routes import _ensure_main_vault
from backend.data import management_db
from backend.data.management_db import Base
from backend.models.management import Vault, Workspace
from backend.services import active_vault_middleware as routing


@pytest.fixture
def registry(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'management.sqlite'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(Workspace(id="workspace", name="Synthetic workspace"))
        db.commit()
    monkeypatch.setattr(management_db, "_get_or_init_mgmt_engine", lambda: (engine, sessions))
    routing.reset_vault_path_cache()
    yield sessions
    routing.reset_vault_path_cache()
    engine.dispose()


def add_vault(registry, directory: Path, identifier: str):
    directory.mkdir()
    with registry() as db:
        db.add(Vault(id=identifier, workspace_id="workspace", name=identifier,
                     slug=identifier, path_override=str(directory)))
        db.commit()


def test_relocated_library_is_readable_by_new_selection_without_recreating_old_path(registry, tmp_path):
    original = tmp_path / "original"
    relocated = tmp_path / "relocated"
    add_vault(registry, original, "original-id")
    (original / "note.md").write_text("Synthetic note survives recovery.")
    original.rename(relocated)

    assert routing._read_vault_identity("original-id") is None
    assert not original.exists()
    with registry() as db:
        selected = _ensure_main_vault(db, "workspace", relocated)
        selected_id = selected.id
        assert selected_id != "original-id"
        assert db.get(Vault, "original-id").path_override == str(original)
    identity = routing._read_vault_identity(selected_id)
    assert identity == (selected_id, str(relocated))
    assert (Path(identity[1]) / "note.md").read_text() == "Synthetic note survives recovery."
    assert not original.exists()


def test_unknown_or_unavailable_canonical_identity_returns_404_without_filesystem_writes(registry, tmp_path):
    directory = tmp_path / "unavailable"
    add_vault(registry, directory, "missing-id")
    directory.rmdir()

    async def unexpected_app(scope, receive, send):
        raise AssertionError("An unavailable canonical library must not reach its endpoint")

    client = TestClient(routing.ActiveVaultMiddleware(unexpected_app))
    try:
        for identifier in ("missing-id", "not-registered"):
            response = client.get(f"/api/v1/vaults/{identifier}/knowledge/pages")
            assert response.status_code == 404
    finally:
        client.close()
    assert not directory.exists()


def test_same_path_upgrade_reuses_identity_and_leaves_note_unchanged(registry, tmp_path):
    directory = tmp_path / "unchanged"
    add_vault(registry, directory, "existing-id")
    note = directory / "note.md"
    note.write_text("Created before upgrade.")
    with registry() as db:
        assert _ensure_main_vault(db, "workspace", directory).id == "existing-id"
        assert db.query(Vault).count() == 1
    assert routing._read_vault_identity("existing-id") == ("existing-id", str(directory))
    assert note.read_text() == "Created before upgrade."


def test_two_existing_libraries_keep_distinct_identities_when_selection_changes(registry, tmp_path):
    directories = {identifier: tmp_path / identifier for identifier in ("first", "second")}
    for identifier, directory in directories.items():
        add_vault(registry, directory, identifier)
        (directory / "note.md").write_text(identifier)
    for identifier in ("first", "second", "first"):
        with registry() as db:
            assert _ensure_main_vault(db, "workspace", directories[identifier]).id == identifier
        identity = routing._read_vault_identity(identifier)
        assert identity == (identifier, str(directories[identifier]))
        assert (Path(identity[1]) / "note.md").read_text() == identifier
    with registry() as db:
        assert {row.id: row.path_override for row in db.query(Vault)} == {
            identifier: str(directory) for identifier, directory in directories.items()
        }
