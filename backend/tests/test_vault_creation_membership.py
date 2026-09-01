"""First-vault authorization, tested before importing app configuration.

Only the outer wrapper is collected normally. Its clean child exercises real
JWT dependencies and SQLite membership with no live server or user data.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_vault_creation_in_isolated_subprocess() -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-first-vault-tests-") as temporary:
        root = Path(temporary).resolve()
        for child in ("data", "vault", "host"):
            (root / child).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_JWT_SECRET": "synthetic-first-vault-test-secret-not-a-real-key",
        }
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
             "--basetemp", str(root / "tests"), "-o", "python_functions=check_*",
             "backend/tests/test_vault_creation_membership.py"],
            cwd=Path(__file__).resolve().parents[2], env=environment,
            capture_output=True, text=True, timeout=90, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@dataclass
class CreationFixture:
    client: TestClient
    db: Session
    root: Path
    token: str

    def headers(self, workspace: str = "owned") -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "X-Workspace-ID": workspace}

    def assert_unchanged(self) -> None:
        from backend.models.management import Vault

        assert self.db.query(Vault).count() == 0
        assert list(self.root.iterdir()) == []


@pytest.fixture
def fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[CreationFixture]:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from backend.api import vaults_routes
    from backend.data.management_db import Base, get_mgmt_db
    from backend.models.management import Membership, User, Workspace
    from backend.services import workspace_service
    from backend.services.auth_service import create_access_token, reset_auth_policy_cache

    root = tmp_path / "vaults"
    root.mkdir()
    params = SimpleNamespace(paths={"PROJECT_DIR": tmp_path, "VAULT": root / "main"},
                             gnosi_mode="organization")
    monkeypatch.setattr(workspace_service, "load_params", lambda **_: params)
    monkeypatch.setattr(vaults_routes, "load_params", lambda **_: params)
    monkeypatch.setenv("GNOSI_VAULTS_ROOT", str(root))
    reset_auth_policy_cache()
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        db.add_all([
            User(id="member", email="member@example.com", name="Member"),
            User(id="stranger", email="stranger@example.com", name="Stranger"),
            Workspace(id="owned", name="Owned"), Workspace(id="other", name="Other"),
        ])
        db.flush()
        db.add_all([
            Membership(user_id="member", workspace_id="owned", role="owner"),
            Membership(user_id="stranger", workspace_id="other", role="owner"),
        ])
        db.commit()

        def database() -> Iterator[Session]:
            yield db

        app = FastAPI()
        app.include_router(vaults_routes.router, prefix="/api")
        app.dependency_overrides[get_mgmt_db] = database
        with TestClient(app) as client:
            yield CreationFixture(client, db, root, create_access_token("member"))
    engine.dispose()
    reset_auth_policy_cache()


@pytest.mark.parametrize("role", ["owner", "admin", "editor"])
def check_first_vault_requires_membership_not_existing_vault(
    fixture: CreationFixture, role: str,
) -> None:
    from sqlalchemy import update

    from backend.models.management import Membership, Vault

    fixture.db.execute(update(Membership).where(Membership.user_id == "member").values(role=role))
    fixture.db.commit()
    response = fixture.client.post("/api/vaults", headers=fixture.headers(),
                                   json={"name": "First Vault"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert set(data) == {"id", "name", "slug", "path"}
    assert data["name"] == "First Vault"
    assert data["path"] == str(fixture.root / "First Vault")
    assert (fixture.root / "First Vault" / "BD").is_dir()
    vault = fixture.db.query(Vault).one()
    assert vault.id == data["id"]
    assert vault.workspace_id == "owned"


@pytest.mark.parametrize("headers", [{}, {"X-User-ID": "member"},
                                      {"Authorization": "Bearer invalid"}])
def check_unauthenticated_caller_cannot_create(
    fixture: CreationFixture, headers: dict[str, str],
) -> None:
    response = fixture.client.post("/api/vaults", headers={"X-Workspace-ID": "owned", **headers},
                                   json={"name": "Forbidden"})
    assert response.status_code == 401
    fixture.assert_unchanged()


@pytest.mark.parametrize("role", ["viewer", "unrecognized"])
def check_readonly_membership_cannot_create(fixture: CreationFixture, role: str) -> None:
    from sqlalchemy import update

    from backend.models.management import Membership

    fixture.db.execute(update(Membership).where(Membership.user_id == "member").values(role=role))
    fixture.db.commit()
    response = fixture.client.post("/api/vaults", headers=fixture.headers(),
                                   json={"name": "Forbidden"})
    assert response.status_code == 403
    fixture.assert_unchanged()


@pytest.mark.parametrize("workspace", ["other", "missing"])
def check_forged_headers_cannot_cross_workspace(
    fixture: CreationFixture, workspace: str,
) -> None:
    headers = {**fixture.headers(workspace), "X-User-ID": "stranger", "X-Vault-ID": "invented"}
    response = fixture.client.post("/api/vaults", headers=headers, json={"name": "Forbidden"})
    assert response.status_code == 403
    fixture.assert_unchanged()


def check_vault_selector_does_not_block_authorized_creation(fixture: CreationFixture) -> None:
    response = fixture.client.post(
        "/api/vaults", headers={**fixture.headers(), "X-Vault-ID": "stale-selection"},
        json={"name": "First"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize("via_symlink", [False, True])
def check_explicit_path_remains_confined(fixture: CreationFixture, via_symlink: bool) -> None:
    outside = fixture.root.parent / "outside"
    outside.mkdir()
    target = fixture.root / ".." / "outside" / "Forbidden"
    if via_symlink:
        link = fixture.root / "link"
        link.symlink_to(outside, target_is_directory=True)
        target = link / "Forbidden"
    response = fixture.client.post("/api/vaults", headers=fixture.headers(),
                                   json={"name": "Forbidden", "path": str(target)})
    assert response.status_code == 400
    assert list(outside.iterdir()) == []
    if via_symlink:
        (fixture.root / "link").unlink()
    fixture.assert_unchanged()


def check_existing_vault_operations_still_require_a_vault(fixture: CreationFixture) -> None:
    response = fixture.client.get("/api/vaults", headers=fixture.headers())
    assert response.status_code == 404
    fixture.assert_unchanged()


def check_organization_listing_never_registers_global_personal_storage(
    fixture: CreationFixture,
) -> None:
    from backend.models.management import Vault

    created = fixture.client.post("/api/vaults", headers=fixture.headers(),
                                  json={"name": "First"}).json()
    for _ in range(2):
        response = fixture.client.get("/api/vaults", headers=fixture.headers())
        assert response.status_code == 200
        assert response.json() == {
            "vaults": [{**created, "active": True}], "active_path": created["path"],
        }
        assert fixture.db.query(Vault).count() == 1
    assert not (fixture.root / "main").exists()


def check_organization_listing_keeps_cross_workspace_denial(fixture: CreationFixture) -> None:
    response = fixture.client.get("/api/vaults", headers=fixture.headers("other"))
    assert response.status_code == 403
    fixture.assert_unchanged()


def check_personal_bootstrap_remains_compatible(
    fixture: CreationFixture, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.models.management import Vault
    from backend.services import workspace_service

    params = SimpleNamespace(paths={"PROJECT_DIR": fixture.root.parent,
                                    "VAULT": fixture.root / "main"}, gnosi_mode="personal")
    monkeypatch.setattr(workspace_service, "load_params", lambda **_: params)
    response = fixture.client.post(
        "/api/vaults", headers=fixture.headers(), json={"name": "Second"},
    )
    assert response.status_code == 200
    assert fixture.db.query(Vault).filter(Vault.workspace_id == "personal").count() == 2
    assert fixture.db.query(Vault).filter(Vault.workspace_id == "owned").count() == 0


def check_creation_keeps_legacy_header_and_response_contract(fixture: CreationFixture) -> None:
    schema = fixture.client.get("/openapi.json").json()
    operation = schema["paths"]["/api/vaults"]["post"]
    headers = {item["name"] for item in operation["parameters"] if item["in"] == "header"}
    assert {"x-workspace-id", "x-user-id", "x-vault-id"} <= headers
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/VaultMutationResponse",
    }
