"""Role-based permissions for inline comments (parity with page comments).

The three mutations (POST/PATCH/DELETE /pages/{id}/inline-comments) require
`editor` role, same as regular page comments: the frontend does no
role gating at all, so the backend is the only barrier. Reading
(GET) is left open to viewers, like the page comments GET.

Exercises the real routing (the guards live in the decorator's `dependencies=[...]`,
not in the handler body): minimal FastAPI app with the vault router and
`get_workspace_context` overridden to simulate each role.
"""
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.api.vault_routes as vr
from backend.services import workspace_service as ws


def _client(role: str, tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(vr, "get_active_vault_path", lambda: str(tmp_path))

    app = FastAPI()
    app.include_router(vr.router, prefix="/api/vault")
    app.dependency_overrides[ws.get_workspace_context] = lambda: ws.WorkspaceContext(
        workspace_id="ws-test",
        user_id="user-test",
        role=role,
        vault_path=tmp_path,
    )
    return TestClient(app)


def test_viewer_cannot_mutate_inline_comments(tmp_path, monkeypatch):
    client = _client("viewer", tmp_path, monkeypatch)

    r = client.post(
        "/api/vault/pages/p1/inline-comments",
        json={"quote": "hola", "comment": "no hauria d'entrar"},
    )
    assert r.status_code == 403, r.text

    r = client.patch(
        "/api/vault/pages/p1/inline-comments/qualsevol-id",
        json={"resolved": True},
    )
    assert r.status_code == 403, r.text

    r = client.delete("/api/vault/pages/p1/inline-comments/qualsevol-id")
    assert r.status_code == 403, r.text

    # Nothing has been written to the test vault.
    sidecar_dir = tmp_path / ".gnosi" / "inline_comments"
    assert not sidecar_dir.exists() or not list(sidecar_dir.glob("*.json"))


def test_viewer_can_list_inline_comments(tmp_path, monkeypatch):
    client = _client("viewer", tmp_path, monkeypatch)
    r = client.get("/api/vault/pages/p1/inline-comments")
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_editor_full_inline_comment_cycle(tmp_path, monkeypatch):
    client = _client("editor", tmp_path, monkeypatch)

    r = client.post(
        "/api/vault/pages/p1/inline-comments",
        json={"quote": "fragment", "comment": "primer"},
    )
    assert r.status_code == 200, r.text
    cid = r.json()["id"]

    r = client.patch(
        f"/api/vault/pages/p1/inline-comments/{cid}",
        json={"resolved": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["resolved"] is True

    r = client.delete(f"/api/vault/pages/p1/inline-comments/{cid}")
    assert r.status_code == 200, r.text
    assert client.get("/api/vault/pages/p1/inline-comments").json() == []
