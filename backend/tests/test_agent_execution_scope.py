"""Check current vault authorization against registered and configured storage paths."""
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.config import app_config
from backend.data import management_db
from backend.models.management import Membership, User, Vault, VaultAccess, Workspace
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import revalidate_scope


@pytest.fixture
def registrations(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'management.sqlite'}")
    tables = [model.__table__ for model in (User, Workspace, Membership, Vault, VaultAccess)]
    management_db.Base.metadata.create_all(engine, tables=tables)
    with Session(engine) as db:
        db.add_all([User(id="alice", email="alice@example.test"), Workspace(id="team", name="Team"),
                    Membership(user_id="alice", workspace_id="team", role="owner")])
        db.commit()

    def sessions():
        with Session(engine) as db:
            yield db

    monkeypatch.setattr(management_db, "get_mgmt_db", sessions)
    scope = ExecutionScope(user_id="alice", workspace_id="team", vault_path=str(tmp_path / "target"), role="owner")
    yield engine, scope
    engine.dispose()


def test_registered_absolute_path_survives_pending_settings_and_checks_current_access(registrations, monkeypatch):
    engine, scope = registrations
    monkeypatch.setattr(app_config, "load_params", lambda **kwargs: pytest.fail("Absolute registrations use live DB paths"))
    with Session(engine) as db:
        db.add_all([Vault(id="other", workspace_id="team", name="Other", path_override=scope.vault_path + "-other"),
                    Vault(id="target", workspace_id="team", name="Target", path_override=scope.vault_path),
                    VaultAccess(user_id="alice", workspace_id="team", vault_id="target")])
        db.commit()
        revalidate_scope(scope)
        grant = db.query(VaultAccess).one()
        grant.vault_id = "other"
        db.commit()
        with pytest.raises(PermissionError, match="vault_revoked"):
            revalidate_scope(scope)
        member = db.query(Membership).one()
        member.role = "viewer"
        db.commit()
        with pytest.raises(PermissionError, match="membership_revoked"):
            revalidate_scope(scope)


def test_unresolvable_alias_cannot_block_another_registered_vault(registrations, monkeypatch, tmp_path):
    engine, scope = registrations
    alias = tmp_path / "loop"
    alias.symlink_to(alias)
    with Session(engine) as db:
        db.add_all([Vault(id="target", workspace_id="team", name="Default"),
                    Vault(id="broken", workspace_id="team", name="Broken", path_override=str(alias))])
        db.commit()
    settings = SimpleNamespace(gnosi_mode="personal", paths={"PROJECT_DIR": tmp_path, "VAULT": scope.vault_path})
    monkeypatch.setattr(app_config, "load_params", lambda **kwargs: settings)
    revalidate_scope(scope)
    with pytest.raises(PermissionError, match="vault_revoked"):
        revalidate_scope(scope.model_copy(update={"vault_path": str(tmp_path / "unregistered")}))


@pytest.mark.parametrize(("override", "mode", "target"), [
    ("relative", "team", "relative"),
    (None, "personal", "default"),
    (None, "team", "workspaces/team/vault"),
])
def test_configured_vault_registrations_use_current_paths(registrations, monkeypatch, tmp_path, override, mode, target):
    engine, scope = registrations
    with Session(engine) as db:
        db.add(Vault(id="registered", workspace_id="team", name="Registered", path_override=override))
        db.commit()
    settings = SimpleNamespace(gnosi_mode=mode, paths={"PROJECT_DIR": tmp_path, "VAULT": tmp_path / "default"})
    monkeypatch.setattr(app_config, "load_params", lambda **kwargs: settings)
    scope = scope.model_copy(update={"vault_path": str(tmp_path / target)})
    revalidate_scope(scope)
    settings.paths.clear()
    with pytest.raises(PermissionError, match="vault_unavailable"):
        revalidate_scope(scope)
