"""A pre-workflow outage is a localized error, never a successful answer."""

import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.domains.agent.routes import chat_route, learning_context
from backend.domains.agent.routes.chat_error_messages import failure_message
from backend.services import principal_agent_migration
from backend.services.workspace_service import WorkspaceContext
from backend.utils.metadata_io import MetadataUnavailable


LANGUAGES = {
    "ca": "Busca totes les entrades de la taula Cervell Digital.",
    "es": "Busca todas las entradas de la tabla Cervell Digital.",
    "en": "Find all entries in the Cervell Digital table.",
    "fr": "Trouve toutes les entrées de la table Cervell Digital.",
}


@pytest.mark.parametrize("language", LANGUAGES)
@pytest.mark.parametrize("failure", ["agent_model_unavailable", "service_unavailable", "private_detail", "metadata_unavailable"])
def test_chat_http_outage_preserves_language_and_failed_outcome(monkeypatch, tmp_path, language, failure):
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {
        "agents": [{"id": "fixture", "enabled": True}],
    })
    monkeypatch.setattr(chat_route, "_vault_scope", lambda: (tmp_path, "synthetic-vault"))
    monkeypatch.setattr(chat_route, "_chat_user_content", lambda request, **_: (request.message, []))
    monkeypatch.setattr(learning_context, "prepare_learning_context", lambda *args, **kwargs: ("", [], "", None))
    calls = []

    async def unavailable(*args, **kwargs):
        calls.append(True)
        if failure == "metadata_unavailable":
            raise MetadataUnavailable("synthetic-secret /private/vault")
        detail = "synthetic-secret /private/vault" if failure == "private_detail" else {"code": failure}
        raise HTTPException(status_code=503, detail=detail)

    monkeypatch.setattr(chat_route, "get_agent_workflow", unavailable)
    app = FastAPI()
    app.add_api_route("/api/agent/chat", chat_route.chat_endpoint, methods=["POST"])
    dependency = app.routes[-1].dependant.dependencies[0].call
    app.dependency_overrides[dependency] = lambda: WorkspaceContext("workspace", "user", "owner", tmp_path)
    with TestClient(app) as client:
        response = client.post("/api/agent/chat", headers={"Accept-Language": language}, json={
            "agent_id": "fixture", "session_id": "session",
            "message": "hola" if failure == "metadata_unavailable" else LANGUAGES[language],
        })
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in response.text.splitlines() if line]
    errors = [event for event in events if event["type"] == "error"]
    assert len(errors) == 1
    code = "service_unavailable" if failure == "private_detail" else failure
    error = errors[0]
    assert error["code"] == code
    assert error["content_language"] == language
    if code == "metadata_unavailable":
        assert {"ca": "núvol", "es": "nube", "en": "Cloud", "fr": "cloud"}[language] in error["content"]
        assert error["retryable"] is True
    else:
        assert error["content"] == failure_message(language, code)
    assert error["recovery"]["automatic"] is False
    assert error["recovery"]["retryable"] is (code in {"service_unavailable", "metadata_unavailable"})
    assert "synthetic-secret" not in response.text and "/private/vault" not in response.text
    done = [event for event in events if event["type"] == "done"]
    assert len(done) == 1
    assert done[0]["has_response"] is False and done[0]["message_count"] == 0
    assert calls == [True]


@pytest.mark.parametrize(("reason", "status", "retry_after", "detail"), [
    ("pending", 503, "2", "encara"),
    ("offline", 503, "30", "connexió"),
    ("permission", 403, None, "permís"),
    ("no_space", 507, None, "espai"),
    ("unavailable", 503, "30", "servei"),
])
def test_file_errors_report_the_cause_without_disclosing_private_paths(reason, status, retry_after, detail):
    from pathlib import Path
    from backend.app.errors import register_error_handlers

    app = FastAPI()
    register_error_handlers(app)

    @app.get("/document")
    def unavailable():
        raise MetadataUnavailable("private data", path=Path("/private/file.pdf"), reason=reason)

    with TestClient(app) as client:
        response = client.get("/document", headers={"Accept-Language": "ca-ES,ca;q=0.9"})
    assert response.status_code == status
    assert response.headers.get("Retry-After") == retry_after
    assert response.headers["X-Gnosi-File-Availability"] == reason
    assert response.json()["retryable"] is (retry_after is not None)
    assert detail in response.json()["detail"]
    assert "private" not in response.text
