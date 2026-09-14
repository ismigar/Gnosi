"""Exercise discovery against a disposable registry and folder structure."""

from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.requests import Request


def test_container_catalog_and_active_vault(isolated_validation_runtime, monkeypatch):
    from backend.api import vaults_routes
    from backend.data.management_db import Base
    from backend.models.management import Vault, Workspace
    from backend.services.workspace_service import WorkspaceContext

    root = isolated_validation_runtime / "container"
    for name in ("Principal", "Proves", "Marketplace Smoke Test"):
        (root / name / ".gnosi").mkdir(parents=True)
    (root / "Assets").mkdir()
    (root / "BD").mkdir()
    # An outside symlink must not grant access through discovery.
    (root / "Linked vault").symlink_to(root / "Proves", target_is_directory=True)
    primary = root / "Principal"
    monkeypatch.setenv("GNOSI_DESKTOP_VAULT_DISCOVERY", "1")
    monkeypatch.setenv("GNOSI_VAULTS_ROOT", str(root))
    monkeypatch.setattr(vaults_routes, "load_params", lambda **_: SimpleNamespace(
        gnosi_mode="personal", paths={"VAULT": primary}))
    monkeypatch.setattr(vaults_routes, "get_active_vault_path", lambda: primary)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Workspace(id="personal", name="Personal"))
        db.add(Vault(id="legacy-root", workspace_id="personal", name="Main Vault", path_override=str(root)))
        db.add(Vault(id="kept", workspace_id="personal", name="Proves", path_override=str(root / "Proves")))
        db.add(Vault(id="other-container", workspace_id="personal", name="Old library", path_override=str(root.parent / "other" / "Old library")))
        db.commit()
        context = WorkspaceContext("personal", "test", "owner", primary)
        request = Request({"type": "http", "headers": [], "query_string": b""})
        first = vaults_routes.list_vaults(request, context, db)
        second = vaults_routes.list_vaults(request, context, db)
        assert first == second
        assert {v["name"] for v in first["vaults"]} == {"Principal", "Proves", "Marketplace Smoke Test"}
        assert first["active_path"] == str(primary)
        assert [v["name"] for v in first["vaults"] if v["active"]] == ["Principal"]
        assert next(v["id"] for v in first["vaults"] if v["name"] == "Proves") == "kept"
        assert all(v["slug"] for v in first["vaults"])
        assert (root / "Assets").is_dir()
        assert not list((root / "BD").iterdir())
        assert db.get(Vault, "other-container") is not None
        # Unregistering a vault must not undo itself on the next list/restart.
        db.delete(db.get(Vault, "kept"))
        db.commit()
        third = vaults_routes.list_vaults(request, context, db)
        assert "Proves" not in {v["name"] for v in third["vaults"]}
        assert (root / "Proves").is_dir()
    engine.dispose()


def test_discovery_requires_explicit_desktop_opt_in(tmp_path: Path, monkeypatch):
    from backend.data.management_db import Base
    from backend.models.management import Vault
    from backend.services.desktop_vault_discovery import register_desktop_vaults

    monkeypatch.delenv("GNOSI_DESKTOP_VAULT_DISCOVERY", raising=False)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        register_desktop_vaults(db, "personal", tmp_path / "Principal")
        assert db.query(Vault).count() == 0
    engine.dispose()
