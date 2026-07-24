"""`PATCH /api/vaults/{id}` renames a vault's LOGICAL name (the DB row, not the
disk folder). Requires the `editor` role, like the other vault mutations. The
handler validates an empty name (400) and a missing vault (404).

Exercises the real routing with an in-memory management DB and
`get_workspace_context` overridden to simulate each role.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.api.vaults_routes as vr
from backend.services import workspace_service as ws
from backend.data.management_db import Base, get_mgmt_db
from backend.models.management import Vault

WS_ID = "ws-test"


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    # Seed one vault in the test workspace.
    s = Session()
    s.add(Vault(id="v1", workspace_id=WS_ID, name="Original"))
    s.commit()
    s.close()
    return Session


def _client(role: str, session_factory) -> TestClient:
    app = FastAPI()
    app.include_router(vr.router, prefix="/api")

    def _override_db():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[ws.get_workspace_context] = lambda: ws.WorkspaceContext(
        workspace_id=WS_ID,
        user_id="user-test",
        role=role,
        vault_path=None,
    )
    app.dependency_overrides[get_mgmt_db] = _override_db
    return TestClient(app)


def test_editor_renames_active_vault(session_factory):
    client = _client("editor", session_factory)
    r = client.patch("/api/vaults/v1", json={"name": "Nou nom"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Nou nom"
    # Persisted in the DB.
    s = session_factory()
    assert s.get(Vault, "v1").name == "Nou nom"
    s.close()


def test_empty_name_is_rejected(session_factory):
    client = _client("editor", session_factory)
    r = client.patch("/api/vaults/v1", json={"name": "   "})
    assert r.status_code == 400, r.text
    s = session_factory()
    assert s.get(Vault, "v1").name == "Original"  # unchanged
    s.close()


def test_unknown_vault_is_404(session_factory):
    client = _client("editor", session_factory)
    r = client.patch("/api/vaults/does-not-exist", json={"name": "x"})
    assert r.status_code == 404, r.text


def test_viewer_cannot_rename(session_factory):
    client = _client("viewer", session_factory)
    r = client.patch("/api/vaults/v1", json={"name": "hack"})
    assert r.status_code == 403, r.text
    s = session_factory()
    assert s.get(Vault, "v1").name == "Original"  # unchanged
    s.close()
