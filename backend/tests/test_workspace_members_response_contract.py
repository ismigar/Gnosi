"""Typed HTTP contracts for workspace membership and Vault access."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import workspace_routes
from backend.data.management_db import Base, get_mgmt_db
from backend.domains.workspace.api.schemas import (
    WorkspaceMemberOperationResponse,
    WorkspaceMemberVaultResponse,
)
from backend.models.management import (
    MemberResponse,
    Membership,
    User,
    Vault,
    VaultAccess,
    VaultAccessResponse,
    Workspace,
)
from backend.services.workspace_service import WorkspaceContext, get_workspace_context

WORKSPACE_ID = "workspace-contract"
ADMIN_ID = "admin-contract"
MEMBER_ID = "member-contract"
VAULT_ID = "vault-contract"
SECOND_VAULT_ID = "vault-secondary"


def _routes() -> dict[str, APIRoute]:
    return {
        route.endpoint.__name__: route
        for route in workspace_routes.router.routes
        if isinstance(route, APIRoute)
    }


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    with session_factory() as db:
        db.add(Workspace(id=WORKSPACE_ID, name="Contract Workspace", slug="contract"))
        db.add_all(
            [
                User(
                    id=ADMIN_ID,
                    email="admin@corp.com",
                    name="Admin",
                    password_hash="x",
                ),
                User(
                    id=MEMBER_ID,
                    email="member@corp.com",
                    name="Member",
                    password_hash="x",
                ),
            ]
        )
        db.add_all(
            [
                Membership(
                    user_id=ADMIN_ID,
                    workspace_id=WORKSPACE_ID,
                    role="owner",
                ),
                Membership(
                    user_id=MEMBER_ID,
                    workspace_id=WORKSPACE_ID,
                    role="editor",
                    permissions=json.dumps(
                        {
                            "capabilities": ["read", "write"],
                            "extension": {"source": "contract"},
                        }
                    ),
                ),
            ]
        )
        db.add_all(
            [
                Vault(id=VAULT_ID, workspace_id=WORKSPACE_ID, name="Research"),
                Vault(id=SECOND_VAULT_ID, workspace_id=WORKSPACE_ID, name="Archive"),
            ]
        )
        db.add(
            VaultAccess(
                id="access-contract",
                vault_id=VAULT_ID,
                user_id=MEMBER_ID,
                workspace_id=WORKSPACE_ID,
                permissions=json.dumps(
                    {
                        "capabilities": ["read"],
                        "extension": {"expires": None},
                    }
                ),
            )
        )
        db.commit()

    app = FastAPI()
    app.include_router(workspace_routes.router)

    def _db() -> Iterator[Session]:
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_mgmt_db] = _db
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext(
        workspace_id=WORKSPACE_ID,
        user_id=ADMIN_ID,
        role="owner",
        vault_path=tmp_path,
    )

    with TestClient(app) as test_client:
        yield test_client


def test_workspace_member_routes_publish_exact_response_models() -> None:
    mutation = WorkspaceMemberOperationResponse
    routes = _routes()
    expected: dict[str, tuple[str, set[str], object]] = {
        "list_workspace_members": (
            "/api/workspaces/{workspace_id}/members",
            {"GET"},
            list[MemberResponse],
        ),
        "list_workspace_vaults": (
            "/api/workspaces/{workspace_id}/vaults",
            {"GET"},
            list[WorkspaceMemberVaultResponse],
        ),
        "list_member_vault_access": (
            "/api/workspaces/{workspace_id}/members/{user_id}/vaults",
            {"GET"},
            list[VaultAccessResponse],
        ),
        "add_workspace_member": (
            "/api/workspaces/{workspace_id}/members",
            {"POST"},
            mutation,
        ),
        "remove_workspace_member": (
            "/api/workspaces/{workspace_id}/members/{target_user_id}",
            {"DELETE"},
            mutation,
        ),
        "update_member_role": (
            "/api/workspaces/{workspace_id}/members/{target_user_id}/role",
            {"PUT"},
            mutation,
        ),
        "grant_vault_access": (
            "/api/workspaces/{workspace_id}/members/{user_id}/vaults",
            {"POST"},
            mutation,
        ),
        "revoke_vault_access": (
            "/api/workspaces/{workspace_id}/members/{user_id}/vaults/{vault_id}",
            {"DELETE"},
            mutation,
        ),
    }

    for handler_name, (path, methods, response_model) in expected.items():
        route = routes[handler_name]
        assert route.path == path
        assert route.methods == methods
        assert route.status_code is None
        assert route.response_model == response_model


def test_workspace_member_models_preserve_dynamic_keys() -> None:
    member = {
        "user_id": MEMBER_ID,
        "email": "member@corp.com",
        "name": "Member",
        "role": "editor",
        "permissions": {
            "capabilities": ["read", "write"],
            "extension": {"quota": 12},
        },
        "joined_at": "2026-08-29T10:00:00+00:00",
    }
    access = {
        "vault_id": VAULT_ID,
        "vault_name": "Research",
        "permissions": {
            "capabilities": ["read"],
            "extension": {"expires": None},
        },
    }
    vault = {"id": VAULT_ID, "name": "Research", "provider": "local"}
    mutation = {
        "status": "ok",
        "message": "Membre actualitzat",
        "audit": {"request_id": "req-1"},
    }

    assert MemberResponse.model_validate(member).model_dump() == member
    assert VaultAccessResponse.model_validate(access).model_dump() == access
    assert WorkspaceMemberVaultResponse.model_validate(vault).model_dump() == vault
    assert WorkspaceMemberOperationResponse.model_validate(mutation).model_dump() == mutation


def test_workspace_facade_reexports_domain_owned_models() -> None:
    assert workspace_routes.WorkspaceMemberOperationResponse is WorkspaceMemberOperationResponse
    assert workspace_routes.WorkspaceMemberVaultResponse is WorkspaceMemberVaultResponse


def test_workspace_member_http_operations_keep_status_and_payload_shapes(
    client: TestClient,
) -> None:
    members_response = client.get(f"/api/workspaces/{WORKSPACE_ID}/members")
    assert members_response.status_code == 200
    members = members_response.json()
    member = next(item for item in members if item["user_id"] == MEMBER_ID)
    assert member["permissions"] == {
        "capabilities": ["read", "write"],
        "extension": {"source": "contract"},
    }

    vaults_response = client.get(f"/api/workspaces/{WORKSPACE_ID}/vaults")
    assert vaults_response.status_code == 200
    assert vaults_response.json() == [
        {"id": VAULT_ID, "name": "Research"},
        {"id": SECOND_VAULT_ID, "name": "Archive"},
    ]

    access_response = client.get(f"/api/workspaces/{WORKSPACE_ID}/members/{MEMBER_ID}/vaults")
    assert access_response.status_code == 200
    assert access_response.json() == [
        {
            "vault_id": VAULT_ID,
            "vault_name": "Research",
            "permissions": {
                "capabilities": ["read"],
                "extension": {"expires": None},
            },
        }
    ]

    invite_response = client.post(
        f"/api/workspaces/{WORKSPACE_ID}/members",
        json={"email": "invitee@corp.com", "role": "viewer"},
    )
    assert invite_response.status_code == 200, invite_response.text
    assert invite_response.json() == {
        "status": "ok",
        "message": "User invitee@corp.com added successfully",
    }

    role_response = client.put(
        f"/api/workspaces/{WORKSPACE_ID}/members/{MEMBER_ID}/role",
        json={
            "role": "admin",
            "permissions": {
                "capabilities": ["read", "write", "admin"],
                "extension": {"managed": True},
            },
        },
    )
    assert role_response.status_code == 200
    assert role_response.json() == {
        "status": "ok",
        "message": "Membre actualitzat",
    }

    grant_response = client.post(
        f"/api/workspaces/{WORKSPACE_ID}/members/{MEMBER_ID}/vaults",
        json={
            "vault_id": SECOND_VAULT_ID,
            "user_id": MEMBER_ID,
            "permissions": {
                "capabilities": ["read"],
                "extension": {"source": "manual"},
            },
        },
    )
    assert grant_response.status_code == 200
    assert grant_response.json() == {
        "status": "ok",
        "message": "Accés a Vault actualitzat",
    }

    revoke_response = client.delete(
        f"/api/workspaces/{WORKSPACE_ID}/members/{MEMBER_ID}/vaults/{SECOND_VAULT_ID}"
    )
    assert revoke_response.status_code == 200
    assert revoke_response.json() == {
        "status": "ok",
        "message": "Accés revocat",
    }

    refreshed_members = client.get(f"/api/workspaces/{WORKSPACE_ID}/members").json()
    invitee_id = next(
        item["user_id"] for item in refreshed_members if item["email"] == "invitee@corp.com"
    )
    remove_response = client.delete(f"/api/workspaces/{WORKSPACE_ID}/members/{invitee_id}")
    assert remove_response.status_code == 200
    assert remove_response.json() == {
        "status": "ok",
        "message": "Membre eliminat",
    }
