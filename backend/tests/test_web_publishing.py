"""Disposable tests for the configured staging adapter and scope-bound previews."""
import json
import subprocess
from types import SimpleNamespace

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from backend.domains.vault.publishing import api, web
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture
def state(tmp_path, monkeypatch):
    root = tmp_path / "vault"
    root.mkdir()
    context = WorkspaceContext("workspace", "owner", "editor", root)
    driver = tmp_path / "driver.py"
    driver.write_text("# disposable configured driver\n")
    monkeypatch.setenv("GNOSI_WEB_PUBLISH_DRIVER", str(driver))
    monkeypatch.setenv("GNOSI_WEB_PUBLISH_PYTHON", "/usr/bin/python3")
    monkeypatch.setenv("GNOSI_JWT_SECRET", "NEVER-FORWARD")
    monkeypatch.setattr(api, "dependencies", lambda context: SimpleNamespace(validate_access=lambda: None))
    web._previews.clear()
    return context


def test_driver_uses_context_path_safe_argv_and_minimal_environment(state, monkeypatch):
    def run(argv, **options):
        assert argv[0] == "/usr/bin/python3"
        assert len(argv) == 2 and argv[1].endswith("driver.py")
        assert options.get("shell", False) is False
        assert options["timeout"] == 600
        assert "GNOSI_JWT_SECRET" not in options["env"]
        assert json.loads(options["input"]) == {
            "action": "status", "vault_path": str(state.vault_path.resolve()), "request": {},
        }
        return SimpleNamespace(returncode=0, stdout='{"configured":true,"target":"staging","pages":[],"releases":[]}')
    monkeypatch.setattr(web.subprocess, "run", run)
    assert web.status(state).target == "staging"


@pytest.mark.parametrize("part", ["user_id", "workspace_id", "vault_path"])
def test_tokens_are_scope_bound_one_use_and_cannot_cross_action(state, part):
    token = web._remember(state, "publish", "driver-preview")
    other = WorkspaceContext(state.workspace_id, state.user_id, "editor", state.vault_path)
    setattr(other, part, state.vault_path / "other" if part == "vault_path" else "other")
    for context, action in ((other, "publish"), (state, "newsletter_send")):
        with pytest.raises(web.HTTPException) as error:
            web._consume(context, action, token)
        assert error.value.status_code == 409
    assert web._consume(state, "publish", token) == "driver-preview"
    with pytest.raises(web.HTTPException):
        web._consume(state, "publish", token)


def test_preview_expires_and_driver_errors_are_sanitized(state, monkeypatch):
    token = web._remember(state, "publish", "driver-preview")
    monkeypatch.setattr(web.time, "monotonic", lambda: float("inf"))
    with pytest.raises(web.HTTPException) as error:
        web._consume(state, "publish", token)
    assert error.value.status_code == 409
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("SECRET-COMMAND", 180, stderr="SECRET-TRACE")
    monkeypatch.setattr(web.subprocess, "run", timeout)
    with pytest.raises(web.HTTPException) as error:
        web.status(state)
    assert error.value.status_code == 504
    assert "SECRET" not in str(error.value.detail)


def test_rejects_vault_override_and_conflicting_selection(state):
    with pytest.raises(ValidationError):
        web.WebSelection.model_validate({"page_ids": [], "vault_path": "/private"})
    with pytest.raises(web.HTTPException) as error:
        web.preview(web.WebSelection(page_ids=["one"], withdraw_ids=["one"]), state)
    assert error.value.status_code == 422



def test_newsletter_refuses_a_real_delivery_response(state, monkeypatch):
    monkeypatch.setattr(web, "_driver", lambda *args: {
        "subscribers": {"pending": 0, "active": 1, "unsubscribed": 0}, "campaigns": [], "test_mode": False,
    })
    with pytest.raises(web.HTTPException) as error:
        web.newsletter_status(state)
    assert error.value.status_code == 502


def test_driver_stale_error_is_safe_even_on_nonzero_exit(state, monkeypatch):
    monkeypatch.setattr(web.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(
        returncode=1, stdout=json.dumps({"error": {"code": "preview_stale", "message": "SECRET-PATH"}}),
    ))
    with pytest.raises(web.HTTPException) as error:
        web.status(state)
    assert error.value.status_code == 409
    assert "SECRET" not in str(error.value.detail)


def test_rejects_production_target_from_driver(state, monkeypatch):
    monkeypatch.setattr(web, "_driver", lambda *args: {"configured": True, "target": "production"})
    with pytest.raises(web.HTTPException) as error:
        web.status(state)
    assert error.value.status_code == 502


@pytest.mark.parametrize("language", ["ca", "es", "en-gb"])
def test_newsletter_accepts_only_site_content_languages(language):
    assert web.NewsletterDraft(subject="Test", body_markdown="Test body", language=language).language == language


@pytest.mark.parametrize("language", ["en", "fr"])
def test_newsletter_rejects_non_site_languages(language):
    with pytest.raises(ValidationError):
        web.NewsletterDraft(subject="Test", body_markdown="Test body", language=language)


@pytest.fixture
def web_http(isolated_validation_runtime, monkeypatch):
    """Real auth/context/plugin guards over disposable users, Vaults and storage."""
    from fastapi import Depends
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from backend.api import vault_routes
    from backend.config import app_config, env_config
    from backend.data import management_db
    from backend.models.management import Membership, User, Vault, VaultAccess, Workspace
    from backend.services import auth_service, workspace_service, vault_warmup
    from backend.services.auth_public_surface import enforce_authentication

    root = isolated_validation_runtime
    vault = root / "vault"
    alternate = root / "alternate"
    alternate.mkdir()
    settings = SimpleNamespace(gnosi_mode="personal", paths={"PROJECT_DIR": root, "VAULT": vault})
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (User, Workspace, Membership, Vault, VaultAccess):
        model.__table__.create(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add_all([
            User(id="unrelated", email="unrelated@example.invalid"),
            User(id="owner", email="owner@example.invalid"),
            User(id="viewer", email="viewer@example.invalid"),
            Workspace(id="personal", name="Personal"),
            Workspace(id="organization", name="Organization"),
            Membership(user_id="owner", workspace_id="personal", role="owner"),
            Membership(user_id="viewer", workspace_id="organization", role="viewer"),
            Vault(id="main", workspace_id="personal", name="Main", path_override=str(vault)),
            Vault(id="other", workspace_id="personal", name="Other", path_override=str(alternate)),
            Vault(id="org-vault", workspace_id="organization", name="Organization", path_override=str(vault)),
        ])
        db.commit()

    def database():
        with sessions() as db:
            yield db

    monkeypatch.delenv(auth_service.REQUIRE_AUTH_ENV, raising=False)
    monkeypatch.setattr(env_config, "_is_docker", lambda: False)
    monkeypatch.setattr(app_config, "load_params", lambda **kwargs: settings)
    monkeypatch.setattr(workspace_service, "load_params", lambda **kwargs: settings)
    monkeypatch.setattr(vault_warmup, "kickoff_critical_warmup", lambda *args: None)
    # Existing synthetic session identities only; no password, PAT or signing key is created.
    monkeypatch.setattr(auth_service, "decode_access_token", lambda token: {
        "existing-viewer-session": "viewer", "existing-owner-session": "owner",
    }.get(token))
    monkeypatch.setattr(management_db, "get_mgmt_db", database)
    monkeypatch.setattr(auth_service, "get_mgmt_db", database)
    plugins = {"schema_version": 2, "enabled_builtin": ["share-links"]}
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: plugins)
    seen = []

    def driver(action, context, request):
        seen.append((action, context, request))
        if action == "preview":
            return {"preview_id": "driver-preview", "expires_at": "2030-01-01T00:00:00Z", "target": "staging", "changes": []}
        return {"configured": True, "target": "staging", "pages": [], "releases": []}

    monkeypatch.setattr(web, "_driver", driver)
    monkeypatch.setenv("GNOSI_WEB_PUBLISH_DRIVER", str(root / "driver.py"))
    auth_service.reset_auth_policy_cache()
    app = FastAPI(dependencies=[Depends(enforce_authentication)])
    # Routes captured the original database dependency before the storage override.
    from backend.services.workspace_service import get_mgmt_db as context_database
    app.dependency_overrides[context_database] = database
    router = APIRouter(prefix="/api/vault")
    api.register_routes(router)
    app.include_router(router)
    web._previews.clear()
    try:
        with TestClient(app) as client:
            yield SimpleNamespace(client=client, settings=settings, seen=seen, plugins=plugins, sessions=sessions, vault=vault)
    finally:
        auth_service.reset_auth_policy_cache()
        engine.dispose()


def test_personal_http_uses_stored_owner_and_ignores_forged_identity(web_http):
    headers = {"X-Gnosi-Web-Expected-User-ID": "owner", "X-User-ID": "ghost", "X-Vault-ID": "main"}
    result = web_http.client.get("/api/vault/web-publishing/status", headers=headers)
    assert result.status_code == 200, result.text
    context = web_http.seen[-1][1]
    assert (context.user_id, context.workspace_id, context.role, context.vault_path) == ("owner", "personal", "owner", web_http.vault)
    from backend.models.management import User
    with web_http.sessions() as db:
        assert db.query(User).filter(User.id == "ghost").first() is None
        assert db.query(User).count() == 3


def test_web_expected_account_is_required_and_can_only_restrict(web_http):
    endpoint = "/api/vault/web-publishing/status"
    assert web_http.client.get(endpoint).status_code == 422
    result = web_http.client.get(endpoint, headers={"X-Gnosi-Web-Expected-User-ID": "unrelated", "X-User-ID": "unrelated"})
    assert result.status_code == 409
    assert result.json()["detail"] == {"code": "account_changed"}
    assert web_http.seen == []


@pytest.mark.parametrize("policy", ["enforced", "organization", "exposed"])
def test_http_central_policy_rejects_anonymous(web_http, monkeypatch, policy):
    from backend.services import auth_service
    if policy == "enforced":
        monkeypatch.setenv(auth_service.REQUIRE_AUTH_ENV, "1")
    elif policy == "organization":
        web_http.settings.gnosi_mode = "org"
    else:
        monkeypatch.setattr("backend.config.env_config._is_docker", lambda: True)
    auth_service.reset_auth_policy_cache()
    response = web_http.client.get("/api/vault/web-publishing/status", headers={"X-Gnosi-Web-Expected-User-ID": "owner", "X-User-ID": "owner"})
    assert response.status_code == 401, response.text
    assert web_http.seen == []


def test_authenticated_viewer_cannot_reach_driver(web_http):
    web_http.settings.gnosi_mode = "org"
    from backend.services.auth_service import reset_auth_policy_cache
    reset_auth_policy_cache()
    web_http.client.cookies.set("gnosi_session", "existing-viewer-session")
    response = web_http.client.get("/api/vault/web-publishing/status", headers={
        "X-Gnosi-Web-Expected-User-ID": "viewer", "X-Workspace-ID": "organization", "X-Vault-ID": "org-vault",
    })
    assert response.status_code == 403, response.text
    assert web_http.seen == []


def test_plugin_disabled_still_blocks_trusted_personal(web_http):
    web_http.plugins["enabled_builtin"] = []
    response = web_http.client.get("/api/vault/web-publishing/status", headers={"X-Gnosi-Web-Expected-User-ID": "owner"})
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "plugin_disabled"
    assert web_http.seen == []


def test_http_preview_cannot_cross_resolved_vault(web_http):
    headers = {"X-Gnosi-Web-Expected-User-ID": "owner", "X-Vault-ID": "main"}
    response = web_http.client.post("/api/vault/web-publishing/preview", headers=headers, json={"page_ids": ["one"]})
    assert response.status_code == 200, response.text
    token = response.json()["preview_id"]
    response = web_http.client.post("/api/vault/web-publishing/publish", headers={**headers, "X-Vault-ID": "other"}, json={"preview_id": token})
    assert response.status_code == 409, response.text
    assert [action for action, *_ in web_http.seen] == ["preview"]


def test_general_expected_account_semantics_stay_auth_only(web_http):
    endpoint = "/api/vault/web-publishing/status"
    headers = {"X-Gnosi-Web-Expected-User-ID": "owner", "X-Gnosi-Expected-User-ID": "owner"}
    assert web_http.client.get(endpoint, headers=headers).status_code == 401
    web_http.client.cookies.set("gnosi_session", "existing-owner-session")
    response = web_http.client.get(endpoint, headers={**headers, "X-Gnosi-Expected-User-ID": "viewer"})
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "account_changed"}
    assert web_http.seen == []
