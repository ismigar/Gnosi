from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.data.management_db import Base
from backend.models.management import Membership, User, Vault, VaultAccess, Workspace
from backend.services import public_workflow_scope as scope
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture
def store(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    selected = tmp_path / "selected"
    selected.mkdir()
    monkeypatch.setattr(scope, "load_params", lambda **_: SimpleNamespace(paths={"PROJECT_DIR": tmp_path}))
    with Session(engine) as db:
        db.add_all([User(id="owner", email="owner@example.test"), Workspace(id="w", name="Workspace"),
                    Vault(id="v", workspace_id="w", name="Vault", path_override=str(selected)),
                    Membership(user_id="owner", workspace_id="w", role="editor")])
        db.commit()
        yield db, selected
    engine.dispose()


def test_pins_current_storage_and_restores_request_context_on_error(store, tmp_path):
    db, selected = store
    original = tmp_path / "visitor-vault"
    active_vault_path.set(original)
    with pytest.raises(RuntimeError):
        with scope.public_vault_scope(db, "w", "v", "owner") as context:
            assert context.vault_path == selected
            assert context.user_id == "owner"
            assert active_vault_path.get() == selected
            raise RuntimeError("simulated submission failure")
    assert active_vault_path.get() == original
    private = WorkspaceContext("w", "owner", "editor", selected)
    assert scope.resolve_private_vault(db, private).id == "v"


@pytest.mark.parametrize("workspace,vault,owner", [("other", "v", "owner"), ("w", "missing", "owner"), ("w", "v", "visitor")])
def test_foreign_or_deleted_identity_never_falls_back(store, workspace, vault, owner):
    db, _ = store
    with pytest.raises(HTTPException, match="unavailable") as error:
        with scope.public_vault_scope(db, workspace, vault, owner):
            pytest.fail("foreign storage was accepted")
    assert error.value.status_code == 404


def test_demoted_owner_and_unmounted_vault_disable_links(store):
    db, selected = store
    membership = db.query(Membership).one()
    membership.role = "viewer"
    db.commit()
    with pytest.raises(HTTPException):
        with scope.public_vault_scope(db, "w", "v", "owner"):
            pytest.fail("demoted owner retained public write permission")
    membership.role = "editor"
    db.commit()
    selected.rmdir()
    with pytest.raises(HTTPException):
        with scope.public_vault_scope(db, "w", "v", "owner"):
            pytest.fail("missing storage accepted")
    assert not selected.exists()


@pytest.mark.parametrize("permissions", ['{"capabilities":["read"]}', '{}', 'null', 'invalid'])
def test_vault_grants_require_write_access(store, permissions):
    db, _ = store
    db.add(VaultAccess(vault_id="v", user_id="owner", workspace_id="w", permissions=permissions))
    db.commit()
    with pytest.raises(HTTPException):
        with scope.public_vault_scope(db, "w", "v", "owner"):
            pytest.fail("read-only grant accepted a public write")


def test_enabled_plugin_is_rechecked_in_the_pinned_vault(store, monkeypatch):
    db, selected = store
    calls = []
    monkeypatch.setattr(scope, "plugins_enabled_now", lambda *ids, vault_path: calls.append((ids, vault_path)) or False)
    with pytest.raises(HTTPException):
        with scope.public_vault_scope(db, "w", "v", "owner", ("calendar",)):
            pytest.fail("disabled plugin accepted")
    assert calls == [(("calendar",), selected)]
    assert active_vault_path.get() is None
