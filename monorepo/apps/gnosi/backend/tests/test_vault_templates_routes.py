"""API round trips for Vault template creation, preview, and export."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.api.vault_templates_routes as routes
import backend.api.vaults_routes as vaults_routes
from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import Vault
from backend.services import vault_templates
from backend.services import workspace_service as workspace

WORKSPACE_ID = "template-workspace"


@pytest.fixture
def api(tmp_path, monkeypatch):
    active = tmp_path / "active"
    active.mkdir()
    (active / ".gnosi").mkdir()
    (active / "Wiki").mkdir()
    (active / "Wiki" / "Existing.md").write_text("# Existing", encoding="utf-8")
    vaults_root = tmp_path / "vaults"
    vaults_root.mkdir()

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    session.add(Vault(
        id="active-vault",
        workspace_id=WORKSPACE_ID,
        name="Active",
        path_override=str(active),
    ))
    session.commit()
    session.close()

    package, _ = vault_templates.build_package(active, {
        "id": "starter-vault",
        "version": "1.0.0",
        "name": "Starter Vault",
        "author": "Gnosi",
    })
    entry = {
        "id": "starter-vault",
        "version": "1.0.0",
        "name": "Starter Vault",
        "url": "https://example.test/starter.zip",
        "sha256": "a" * 64,
        "signature": "signature",
    }
    monkeypatch.setattr(
        routes.vault_templates,
        "load_catalog",
        lambda config_dir: {"templates": [entry], "signedBy": "official"},
    )
    monkeypatch.setattr(
        routes.vault_templates,
        "download_template",
        lambda selected, config_dir: (package, "official"),
    )
    monkeypatch.setattr(vaults_routes, "_vaults_root", lambda: vaults_root)

    app = FastAPI()
    app.include_router(routes.router, prefix="/api")

    def override_db():
        database = session_factory()
        try:
            yield database
        finally:
            database.close()

    app.dependency_overrides[get_mgmt_db] = override_db
    app.dependency_overrides[workspace.get_workspace_context] = lambda: workspace.WorkspaceContext(
        workspace_id=WORKSPACE_ID,
        user_id="template-user",
        role="admin",
        vault_path=active,
    )
    return TestClient(app), session_factory, active, vaults_root


def test_create_from_template_is_registered_after_install(api):
    client, session_factory, _active, vaults_root = api

    response = client.post("/api/vaults/from-template", json={
        "name": "Created from repository",
        "template_id": "starter-vault",
        "version": "1.0.0",
    })

    assert response.status_code == 200, response.text
    target = vaults_root / "Created from repository"
    assert (target / "Wiki" / "Existing.md").exists()
    database = session_factory()
    row = database.get(Vault, response.json()["id"])
    assert row.path_override == str(target)
    database.close()


def test_preview_and_export_round_trip(api):
    client, _session_factory, _active, _vaults_root = api

    preview = client.get("/api/vaults/active-vault/template-export/preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["included"][0]["path"] == "Wiki/Existing.md"

    exported = client.post("/api/vaults/active-vault/template-export", json={
        "id": "active-template",
        "version": "1.0.0",
        "name": "Active template",
        "author": "Tester",
    })
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"] == "application/zip"
    manifest, _infos = vault_templates.validate_package(exported.content)
    assert manifest["id"] == "active-template"


def test_submission_without_broker_fails_closed(api):
    client, _session_factory, _active, _vaults_root = api

    response = client.post("/api/vaults/active-vault/template-submissions", json={
        "id": "active-template",
        "version": "1.0.0",
        "name": "Active template",
    })

    assert response.status_code == 400
    assert "not configured" in response.json()["detail"]
