"""Removing a registry alias must preserve shared storage and the selected identity."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import vaults_routes as routes
from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import Vault
from backend.services import active_vault_middleware, workspace_service


@pytest.fixture
def registry(tmp_path, monkeypatch):
    principal = tmp_path / "Principal"
    proves = tmp_path / "Proves"
    for folder in (principal, proves):
        folder.mkdir()
        (folder / "note.md").write_text("Keep my notes", encoding="utf-8")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add_all([
            Vault(id="principal", workspace_id="ws", name="Principal", slug="principal", path_override=str(principal)),
            Vault(id="main", workspace_id="ws", name="Main Vault", slug="main", path_override=str(principal)),
            Vault(id="proves", workspace_id="ws", name="Proves", slug="proves", path_override=str(proves)),
        ])
        db.commit()
    context = workspace_service.WorkspaceContext("ws", "user", "owner", principal)
    purged = []
    resets = []
    monkeypatch.setattr(routes, "_default_vault_path", lambda *_: principal)
    monkeypatch.setattr(routes, "_vaults_root", lambda: tmp_path)
    monkeypatch.setattr(routes, "load_params", lambda **_: SimpleNamespace(gnosi_mode="personal"))
    monkeypatch.setattr(routes, "get_active_vault_path", lambda: context.vault_path)
    monkeypatch.setattr(routes, "_purge_vault_artifacts", lambda path, *, delete_files: purged.append((path, delete_files)))
    monkeypatch.setattr(active_vault_middleware, "reset_vault_path_cache", lambda: resets.append(True))

    def database():
        with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.dependency_overrides[get_mgmt_db] = database
    app.dependency_overrides[workspace_service.get_workspace_context] = lambda: context
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client, sessions=sessions, context=context, principal=principal,
            proves=proves, purged=purged, resets=resets,
        )
    engine.dispose()


@pytest.mark.parametrize(("headers", "query"), [
    ({"x-vault-id": "principal"}, ""),
    ({"cookie": "gnosi_active_vault=principal"}, ""),
    ({}, "?vault=principal"),
    ({"x-vault-id": "principal", "cookie": "gnosi_active_vault=main"}, "?vault=main"),
    ({}, ""),
    ({"x-vault-id": "missing"}, ""),
])
def test_unregister_inactive_alias_preserves_selected_vault_and_storage(registry, headers, query):
    response = registry.client.delete(f"/api/vaults/main{query}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "success", "deleted": "main"}
    with registry.sessions() as db:
        assert db.get(Vault, "main") is None
        assert db.get(Vault, "principal").path_override == str(registry.principal)
    catalog = registry.client.get("/api/vaults", headers={"x-vault-id": "principal"}).json()
    assert {v["id"] for v in catalog["vaults"]} == {"principal", "proves"}
    assert [v["id"] for v in catalog["vaults"] if v["active"]] == ["principal"]
    assert (registry.principal / "note.md").read_text() == "Keep my notes"
    assert registry.purged == []
    assert registry.resets == [True]


@pytest.mark.parametrize(("identifier", "headers", "query"), [
    ("principal", {"x-vault-id": "principal"}, ""),
    ("main", {"x-vault-id": "main"}, ""),
    ("main", {"cookie": "gnosi_active_vault=main"}, ""),
    ("main", {}, "?vault=main"),
    ("principal", {}, ""),
])
def test_selected_identity_cannot_be_unregistered_even_with_an_alias(registry, identifier, headers, query):
    response = registry.client.delete(f"/api/vaults/{identifier}{query}", headers=headers)
    assert response.status_code == 400
    assert "active vault" in response.json()["detail"]
    with registry.sessions() as db:
        assert db.get(Vault, identifier) is not None
    assert registry.purged == []
    assert registry.resets == []


def test_last_primary_registration_stays_protected_after_switching(registry):
    registry.context.vault_path = registry.proves
    headers = {"x-vault-id": "proves"}
    assert registry.client.delete("/api/vaults/main", headers=headers).status_code == 200
    response = registry.client.delete("/api/vaults/principal", headers=headers)
    assert response.status_code == 400
    assert "primary vault" in response.json()["detail"]
    with registry.sessions() as db:
        assert db.get(Vault, "principal") is not None
    assert registry.purged == []


@pytest.mark.parametrize("active", ["principal", "proves"])
def test_alias_cannot_delete_primary_files(registry, active):
    registry.context.vault_path = getattr(registry, active)
    response = registry.client.delete(
        "/api/vaults/main?delete_files=true", headers={"x-vault-id": active},
    )
    assert response.status_code == 400
    with registry.sessions() as db:
        assert db.get(Vault, "main") is not None
    assert (registry.principal / "note.md").read_text() == "Keep my notes"
    assert registry.purged == []


@pytest.mark.parametrize("workspace", ["ws", "other-workspace"])
def test_shared_nonprimary_files_and_artifacts_are_protected(registry, workspace):
    with registry.sessions() as db:
        db.add(Vault(id="shared", workspace_id=workspace, name="Shared", path_override=str(registry.proves)))
        db.commit()
    response = registry.client.delete("/api/vaults/proves?delete_files=true")
    assert response.status_code == 409
    assert response.json()["detail"] == "vault_switcher.delete_shared_files_error"
    with registry.sessions() as db:
        assert db.get(Vault, "proves") is not None
    assert registry.client.delete("/api/vaults/proves").status_code == 200
    assert (registry.proves / "note.md").read_text() == "Keep my notes"
    assert registry.purged == []


def test_another_workspace_alias_cannot_replace_primary_registration(registry):
    with registry.sessions() as db:
        db.get(Vault, "main").workspace_id = "other-workspace"
        db.commit()
    registry.context.vault_path = registry.proves
    response = registry.client.delete("/api/vaults/principal", headers={"x-vault-id": "proves"})
    assert response.status_code == 400
    assert registry.client.delete("/api/vaults/main").status_code == 404
    assert registry.purged == []


@pytest.mark.parametrize("delete_files", [False, True])
def test_independent_inactive_vault_keeps_existing_deletion_behavior(registry, delete_files):
    response = registry.client.delete(f"/api/vaults/proves?delete_files={str(delete_files).lower()}")
    assert response.status_code == 200, response.text
    with registry.sessions() as db:
        assert db.get(Vault, "proves") is None
    assert registry.proves.exists() is not delete_files
    assert registry.purged == [(registry.proves, delete_files)]


def test_viewer_cannot_unregister_an_alias(registry):
    registry.context.role = "viewer"
    response = registry.client.delete("/api/vaults/main", headers={"x-vault-id": "principal"})
    assert response.status_code == 403
    with registry.sessions() as db:
        assert db.get(Vault, "main") is not None
    assert registry.purged == []
