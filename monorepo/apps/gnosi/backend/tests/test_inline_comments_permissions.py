"""Permisos per rol dels inline-comments (paritat amb els comentaris de pàgina).

Les tres mutacions (POST/PATCH/DELETE /pages/{id}/inline-comments) exigeixen
rol `editor`, igual que les dels comentaris de pàgina normals: el frontend no
fa cap gating per rol, així que el backend és l'única barrera. La lectura
(GET) queda oberta a viewers, com el GET de comentaris de pàgina.

Exercita el routing real (les guardes van a `dependencies=[...]` del decorador,
no al cos del handler): app FastAPI mínima amb el router del vault i
`get_workspace_context` sobreescrit per simular cada rol.
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

    # Res no s'ha escrit al vault de prova.
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
