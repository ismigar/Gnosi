"""A conversation may address a different assistant on each turn."""
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

from backend.domains.agent.routes import chat_route, learning_context
from backend.domains.agent.routes.checkpoints import _public_checkpoint_messages
from backend.services import principal_agent_migration
from backend.services.workspace_service import WorkspaceContext


def test_addressed_profile_is_journaled_and_restored_from_the_server_turn(tmp_path, monkeypatch):
    member = {"id": "research", "name": "Research", "managed_by": "builtin:resources", "command": "/research"}
    identity = {"id": "research", "name": "Research", "managed_by": "builtin:resources"}
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {"agents": [member]})
    monkeypatch.setattr(learning_context, "prepare_learning_context", lambda *args, **kwargs: ("", [], "", None))
    monkeypatch.setitem(chat_route.cfg.paths, "CHECKPOINTS", tmp_path / "checkpoints")
    monkeypatch.setattr(chat_route, "_vault_scope", lambda: (tmp_path, "vault"))
    stored = []

    async def workflow(request, profile, **kwargs):
        assert profile == member["id"]
        return None, {"provider": "fixture", "model": "fake"}

    async def stream(*, inputs, **kwargs):
        stored.extend(inputs["messages"])
        yield json.dumps({"type": "confirmation_required", "confirmation_id": "example"}) + "\n"
        yield json.dumps({"type": "message", "role": "ai", "content": "Done"}) + "\n"
        yield json.dumps({"type": "done", "has_response": True, "message_count": 1}) + "\n"

    monkeypatch.setattr(chat_route, "get_agent_workflow", workflow)
    monkeypatch.setattr(chat_route, "stream_agent_events", stream)
    app = FastAPI()
    app.add_api_route("/api/chat", chat_route.chat_endpoint, methods=["POST"])
    context = WorkspaceContext("workspace", "user", "owner", tmp_path)
    app.dependency_overrides[app.routes[-1].dependant.dependencies[0].call] = lambda: context
    with TestClient(app) as client:
        response = client.post("/api/chat", json={"agent_id": "conversation", "profile_id": "other",
                                                  "session_id": "session", "message": "/research Verify this"})
    response.raise_for_status()
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event["assistant_profile"] for event in events if event["type"] != "done"] == [identity] * 3
    from backend.domains.agent.routes.shared import chat_stream_scope
    from backend.services.agent_stream_journal import replay, scope_digest
    encoded = replay(events[0]["stream_id"], scope_digest(chat_stream_scope(context, "conversation", "session")))
    assert [json.loads(raw) for raw in encoded] == events
    stored.append(AIMessage(content="Done", response_metadata={"model_name": "model A", "model_provider": "service"}))
    stored.extend([HumanMessage(content="Legacy"), AIMessage(content="Older answer")])
    first, answer, _, legacy_answer = _public_checkpoint_messages(stored)
    assert first["content"] == "/research Verify this" and "assistant_profile" not in first
    assert answer["assistant_profile"] == identity and answer["llm"] == {"model": "model A", "provider": "service"}
    assert "assistant_profile" not in legacy_answer and "llm" not in legacy_answer


def test_truncated_transcript_still_attributes_replies_to_their_own_turn():
    user = HumanMessage(content="Start", additional_kwargs={"gnosi_assistant_profile": {"id": "one", "name": "First"}})
    rows = _public_checkpoint_messages([user] + [AIMessage(content="Part") for _ in range(205)])
    assert len(rows) == 200
    assert all(row["assistant_profile"] == {"id": "one", "name": "First"} for row in rows)
