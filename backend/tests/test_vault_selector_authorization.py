"""HTTP selectors must authorize the Vault whose configuration they expose."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.data import management_db
from backend.domains.configuration.api import settings
from backend.models.management import Membership, User, Vault, Workspace
from backend.services import active_vault_middleware as routing
from backend.services import auth_service, workspace_service


@pytest.fixture(params=["personal", "organization"])
def selected_vault_client(request, tmp_path, monkeypatch):
    mode = request.param
    workspace_id = "personal" if mode == "personal" else "owned"
    main = tmp_path / "main"
    selected = tmp_path / "selected"
    foreign = tmp_path / "foreign"
    for path in (main, selected, foreign):
        path.mkdir()
    engine = create_engine(
        f"sqlite:///{tmp_path / 'management.sqlite'}",
        connect_args={"check_same_thread": False},
    )
    management_db.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add_all([
            User(id="member", email="selector@example.com", name="Member"),
            Workspace(id=workspace_id, name="Owned"),
            Workspace(id="foreign", name="Foreign"),
        ])
        db.flush()
        db.add(Membership(user_id="member", workspace_id=workspace_id, role="owner"))
        db.add_all([
            Vault(id="main", workspace_id=workspace_id, name="Main", path_override=str(main)),
            Vault(id="selected", workspace_id=workspace_id, name="Selected", path_override=str(selected)),
            Vault(id="foreign", workspace_id="foreign", name="Foreign", path_override=str(foreign)),
            Vault(id="offline", workspace_id=workspace_id, name="Offline",
                  path_override=str(tmp_path / "missing-mount" / "vault")),
        ])
        db.commit()

    params = SimpleNamespace(params={}, paths={"PROJECT_DIR": tmp_path, "VAULT": main}, gnosi_mode=mode)
    monkeypatch.setattr(workspace_service, "load_params", lambda **_: params)
    monkeypatch.setattr(settings, "load_params", lambda **_: params)
    monkeypatch.setattr(management_db, "_get_or_init_mgmt_engine", lambda: (engine, factory))
    monkeypatch.setattr(auth_service, "SECRET_KEY", "synthetic-selector-test-secret-never-used-outside-tests")
    monkeypatch.setenv("GNOSI_REQUIRE_AUTH", "1")
    monkeypatch.setenv("VAULT_HOST_PATH", str(main))
    auth_service.reset_auth_policy_cache()
    routing.reset_vault_path_cache()

    def database():
        with factory() as db:
            yield db

    app = FastAPI()
    app.include_router(settings.router, prefix="/api")
    app.add_middleware(routing.ActiveVaultMiddleware)
    app.dependency_overrides[management_db.get_mgmt_db] = database
    try:
        with TestClient(app) as client:
            yield client, factory, workspace_id, selected, auth_service.create_access_token("member")
    finally:
        routing.reset_vault_path_cache()
        auth_service.reset_auth_policy_cache()
        engine.dispose()


@pytest.mark.parametrize("signal", ["header", "query", "cookie"])
@pytest.mark.parametrize("target", ["selected", "missing", "foreign", "offline"])
def test_configuration_selection_is_authorized_before_reading(selected_vault_client, signal, target):
    client, factory, workspace_id, selected, token = selected_vault_client
    headers = {"Authorization": f"Bearer {token}", "X-Workspace-ID": workspace_id}
    url = "/api/config/editor"
    if signal == "header":
        headers["X-Vault-ID"] = target
        client.cookies.set("gnosi_active_vault", "foreign")
    elif signal == "query":
        url += f"?vault={target}"
        client.cookies.set("gnosi_active_vault", "foreign")
    else:
        client.cookies.set("gnosi_active_vault", target)
    response = client.get(url, headers=headers)
    if target == "selected":
        assert response.status_code == 200, response.text
        assert response.json()["paths"]["vault"] == str(selected)
    else:
        expected = 503 if target == "offline" else (404 if workspace_id == "personal" else 403)
        assert response.status_code == expected, response.text
        assert "paths" not in response.json()
    assert not (selected.parent / "missing-mount").exists()
    with factory() as db:
        assert db.query(Membership).count() == 1
        assert db.query(Vault).count() == 4


@pytest.mark.parametrize("signal", ["header", "query", "cookie"])
def test_invalid_credentials_cannot_read_selected_configuration(selected_vault_client, signal):
    client, _, workspace_id, _, _ = selected_vault_client
    headers = {"Authorization": "Bearer invalid", "X-Workspace-ID": workspace_id}
    url = "/api/config/editor"
    if signal == "header":
        headers["X-Vault-ID"] = "selected"
    elif signal == "query":
        url += "?vault=selected"
    else:
        client.cookies.set("gnosi_active_vault", "selected")
    response = client.get(url, headers=headers)
    assert response.status_code == 401
    assert "paths" not in response.json()


@pytest.mark.parametrize("signal", ["header", "query", "cookie"])
def test_viewer_selection_cannot_upgrade_membership(selected_vault_client, signal):
    client, factory, workspace_id, _, token = selected_vault_client
    with factory() as db:
        membership = db.query(Membership).one()
        membership.role = "viewer"
        db.commit()
    headers = {"Authorization": f"Bearer {token}", "X-Workspace-ID": workspace_id}
    url = "/api/config/editor"
    if signal == "header":
        headers["X-Vault-ID"] = "selected"
    elif signal == "query":
        url += "?vault=selected"
    else:
        client.cookies.set("gnosi_active_vault", "selected")
    response = client.get(url, headers=headers)
    assert response.status_code == 403
    assert "paths" not in response.json()
    if workspace_id == "personal":
        assert response.json()["detail"] == {"code": "personal_owner_required"}
    with factory() as db:
        assert db.query(Membership).one().role == "viewer"
        assert db.query(Vault).count() == 4
