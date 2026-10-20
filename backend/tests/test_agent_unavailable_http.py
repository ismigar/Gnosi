"""A pre-workflow outage is a localized error, never a successful answer."""

import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.domains.agent.routes import chat_route, learning_context
from backend.domains.agent.routes.chat_error_messages import failure_message
from backend.services import principal_agent_migration
from backend.services.workspace_service import WorkspaceContext


LANGUAGES = {
    "ca": "Busca totes les entrades de la taula Cervell Digital.",
    "es": "Busca todas las entradas de la tabla Cervell Digital.",
    "en": "Find all entries in the Cervell Digital table.",
    "fr": "Trouve toutes les entrées de la table Cervell Digital.",
}


@pytest.mark.parametrize("language", LANGUAGES)
@pytest.mark.parametrize("failure", ["agent_model_unavailable", "service_unavailable", "private_detail"])
def test_chat_http_outage_preserves_language_and_failed_outcome(monkeypatch, tmp_path, language, failure):
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {
        "agents": [{"id": "fixture", "enabled": True}],
    })
    monkeypatch.setattr(chat_route, "_vault_scope", lambda: (tmp_path, "synthetic-vault"))
    monkeypatch.setattr(chat_route, "_chat_user_content", lambda request, **_: (request.message, []))
    monkeypatch.setattr(learning_context, "prepare_learning_context", lambda *_: ("", [], "", None))
    calls = []

    async def unavailable(*args, **kwargs):
        calls.append(True)
        detail = "synthetic-secret /private/vault" if failure == "private_detail" else {"code": failure}
        raise HTTPException(status_code=503, detail=detail)

    monkeypatch.setattr(chat_route, "get_agent_workflow", unavailable)
    app = FastAPI()
    app.add_api_route("/api/agent/chat", chat_route.chat_endpoint, methods=["POST"])
    dependency = app.routes[-1].dependant.dependencies[0].call
    app.dependency_overrides[dependency] = lambda: WorkspaceContext("workspace", "user", "owner", tmp_path)
    with TestClient(app) as client:
        response = client.post("/api/agent/chat", json={
            "agent_id": "fixture", "session_id": "session", "message": LANGUAGES[language],
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
    assert error["content"] == failure_message(language, code)
    assert error["recovery"]["automatic"] is False
    assert error["recovery"]["retryable"] is (code == "service_unavailable")
    assert "synthetic-secret" not in response.text and "/private/vault" not in response.text
    done = [event for event in events if event["type"] == "done"]
    assert len(done) == 1
    assert done[0]["has_response"] is False and done[0]["message_count"] == 0
    assert calls == [True]
