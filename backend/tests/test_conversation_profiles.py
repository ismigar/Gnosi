"""Conversation profiles select a model without changing checkpoint ownership."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.domains.agent.routes import chat_route
from backend.domains.agent.routes.contracts import ChatRequest
from backend.domains.agent.runtime_tools import _select_agent_profile
from backend.services import principal_agent_migration
from backend.services.workspace_service import WorkspaceContext


def profiles():
    return {"active_agent_id": "default", "agents": [
        {"id": "default", "provider": "one", "model": "small"},
        {"id": "research", "provider": "two", "model": "large", "persona": "Research",
         "model_strategy": {"mode": "adaptive", "decision_engine": "jev", "allowed_models": [{"provider": "three", "model": "other"}]}},
        {"id": "disabled", "enabled": False},
        {"id": "wiki", "managed_by": "llm-wiki"},
    ]}


def test_explicit_profile_uses_its_single_model_without_mutating_saved_settings():
    config = profiles()
    selected = _select_agent_profile(config, "research")
    assert selected["model"] == "large"
    assert selected["persona"] == "Research"
    assert selected["model_strategy"] == {"schema_version": 1, "mode": "pinned", "decision_engine": "rules", "allowed_models": []}
    assert config["agents"][1]["model_strategy"]["mode"] == "adaptive"
    assert _select_agent_profile(config, "")["id"] == "default"


@pytest.mark.parametrize("identifier", ["disabled", "wiki", "missing"])
def test_unavailable_profiles_never_fall_back_to_default(identifier):
    assert _select_agent_profile(profiles(), identifier) is None


def test_chat_uses_selected_profile_but_keeps_attachment_session_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", profiles)
    monkeypatch.setattr(chat_route, "_vault_scope", lambda: (tmp_path, "vault"))
    async def notebook(*args):
        return None, "user", "session"
    monkeypatch.setattr(chat_route, "_resolve_notebook_turn", notebook)
    monkeypatch.setattr("backend.domains.agent.routes.learning_context.prepare_learning_context", lambda *args: ("", [], "", None))
    captured = {}
    def content(req, **kwargs):
        captured.update(kwargs)
        return req.message, []
    monkeypatch.setattr(chat_route, "_chat_user_content", content)
    async def workflow(request, profile_id, **kwargs):
        captured["profile_id"] = profile_id
        captured["llm_mode"] = kwargs["llm_mode"]
        assert "llm_provider" not in kwargs and "llm_model" not in kwargs
        raise HTTPException(418, "stop before external model call")
    monkeypatch.setattr(chat_route, "get_agent_workflow", workflow)
    context = WorkspaceContext(user_id="user", workspace_id="workspace", role="owner", vault_path=tmp_path)
    with pytest.raises(HTTPException) as error:
        asyncio.run(chat_route.chat_endpoint(SimpleNamespace(), ChatRequest(message="Continue", agent_id="original", profile_id="research", session_id="session", llm_mode="manual", llm_provider="ignored", llm_model="ignored"), context))
    assert error.value.status_code == 418
    assert captured["profile_id"] == "research"
    assert captured["agent_id"] == "original"
    assert captured["session_id"] == "session"
    assert captured["llm_mode"] == "agent_default"


def test_confirmation_keeps_the_original_profile_in_server_owned_arguments(monkeypatch):
    from backend.agent import action_confirmations as confirmations
    captured = {}
    def store(action, arguments, **kwargs):
        captured.update(arguments)
        return "stored"
    monkeypatch.setattr(confirmations, "request_confirmation", store)
    descriptor = SimpleNamespace(id="tool", name="Tool", effects=[], model_dump=lambda **kwargs: {})
    with confirmations.confirmation_context(vault_scope="vault", workspace_id="workspace", user_id="user", role="owner", agent_id="original", session_id="session", profile_id="research"):
        confirmations.request_governed_tool_confirmation(descriptor=descriptor, tool_name="tool", tool_arguments={}, active_skill_ids=[])
    assert captured["profile_id"] == "research"
