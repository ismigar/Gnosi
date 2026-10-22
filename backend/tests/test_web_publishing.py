"""Disposable tests for the configured staging adapter and scope-bound previews."""
import json
import subprocess
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from backend.domains.vault.publishing import api, web
from backend.services.auth_service import require_authenticated
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


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


def test_api_requires_authentication_and_editor_role(state):
    app = FastAPI()
    app.include_router(web.router)
    app.dependency_overrides[get_workspace_context] = lambda: state
    app.dependency_overrides[require_authenticated] = lambda: (_ for _ in ()).throw(web.HTTPException(401, "Authentication required"))
    with TestClient(app) as client:
        assert client.get("/web-publishing/status").status_code == 401
        app.dependency_overrides[require_authenticated] = lambda: state.user_id
        state.role = "viewer"
        assert client.get("/web-publishing/status").status_code == 403


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
