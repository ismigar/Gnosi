import asyncio

import pytest
from pydantic import ValidationError

from backend.agent.factory import (
    _model_supports_tools,
    _obvious_route,
    _safe_mcp_definitions,
)
from backend.agent import system_tools
from backend.api import agent_routes


def test_identifiers_reject_path_components():
    with pytest.raises(Exception) as exc:
        agent_routes._validated_identifier("foo/../../escape", "agent_id")
    assert getattr(exc.value, "status_code", None) == 422


def test_checkpoint_scope_is_deterministic_and_vault_specific():
    first = agent_routes.hashlib.sha256("vault-a:agent".encode()).hexdigest()[:32]
    second = agent_routes.hashlib.sha256("vault-b:agent".encode()).hexdigest()[:32]
    assert first != second
    assert "/" not in first


def test_attachment_context_rejects_files_outside_chat_directory(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    outside = vault / "secret.txt"
    outside.write_text("secret", encoding="utf-8")
    ref = agent_routes.AttachmentRef(
        name="secret.txt",
        size=6,
        type="text/plain",
        path="secret.txt",
    )
    with pytest.raises(Exception) as exc:
        agent_routes._attachment_context(vault, [ref])
    assert getattr(exc.value, "status_code", None) == 422


def test_attachment_context_extracts_bounded_text(tmp_path):
    vault = tmp_path / "vault"
    root = vault / ".gnosi" / "chat-attachments"
    root.mkdir(parents=True)
    attachment = root / "safe.txt"
    attachment.write_text("verified text", encoding="utf-8")
    ref = agent_routes.AttachmentRef(
        name="notes.txt",
        size=13,
        type="text/plain",
        path=".gnosi/chat-attachments/safe.txt",
    )
    assert "verified text" in agent_routes._attachment_context(vault, [ref])


def test_obvious_general_route_avoids_supervisor_call():
    assert _obvious_route("hola") == "General"
    assert _obvious_route("Explain this concept briefly") == "General"


def test_obvious_specialist_routes():
    assert _obvious_route("Fix this Python bug") == "Coder"
    assert _obvious_route("Read this PDF", has_context=True) == "Brain"


@pytest.mark.parametrize(
    "message",
    [
        "Quines reunions tinc demà?",
        "Busca els correus pendents",
        "Resumeix @[Pla](page:abc-123)",
        "Quin temps farà demà?",
    ],
)
def test_integration_and_mention_intents_route_to_brain(message):
    assert _obvious_route(message) == "Brain"


def test_ambiguous_short_request_keeps_supervisor():
    assert _obvious_route("Organitza això per demà") is None


def test_mcp_read_only_policy_uses_annotations_not_name_prefix():
    definitions = [
        {"name": "get_and_delete", "annotations": {"destructiveHint": True}},
        {"name": "fetch_notes", "annotations": {"readOnlyHint": True}},
        {"name": "trusted_custom"},
    ]
    assert [item["name"] for item in _safe_mcp_definitions(definitions)] == ["fetch_notes"]
    assert [
        item["name"]
        for item in _safe_mcp_definitions(definitions, ["trusted_custom"])
    ] == ["fetch_notes", "trusted_custom"]


def test_agent_can_explicitly_disable_tool_binding():
    assert not _model_supports_tools(
        "custom",
        "text-only",
        {"capabilities": {"tools": False}},
    )


def test_sensitive_project_paths_are_not_readable():
    assert system_tools._is_sensitive_path(system_tools.BASE_DIR / ".env_shared")
    assert system_tools._is_sensitive_path(
        system_tools.BASE_DIR / "local_data" / "system" / "secrets.json"
    )
    result = system_tools.inspect_codebase.invoke({"path": ".env_shared"})
    assert result.startswith("Error: Access denied")


def test_chat_request_limits_attachment_count():
    refs = [
        agent_routes.AttachmentRef(
            name=f"notes-{index}.txt",
            path=f".gnosi/chat-attachments/{index}.txt",
        )
        for index in range(9)
    ]
    with pytest.raises(ValidationError):
        agent_routes.ChatRequest(message="Summarize", attachments=refs)


def test_structured_model_content_is_normalized():
    content = [
        {"type": "reasoning", "content": "Internal"},
        {"type": "text", "text": "Visible answer"},
        "Final line",
    ]
    assert agent_routes._message_text(content) == "Visible answer\nFinal line"


def test_attachment_delete_is_contained(tmp_path):
    vault = tmp_path / "vault"
    root = vault / ".gnosi" / "chat-attachments"
    root.mkdir(parents=True)
    attachment = root / "safe.txt"
    attachment.write_text("temporary", encoding="utf-8")
    agent_routes._delete_attachment(
        vault,
        ".gnosi/chat-attachments/safe.txt",
    )
    assert not attachment.exists()


def test_session_delete_removes_checkpoint_thread(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    checkpoints = tmp_path / "checkpoints"
    checkpoints.mkdir()
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (vault, "vault-scope"),
    )
    monkeypatch.setitem(agent_routes.cfg.paths, "CHECKPOINTS", checkpoints)
    checkpoint_key = agent_routes.hashlib.sha256(
        "vault-scope:agent".encode("utf-8")
    ).hexdigest()[:32]
    db_path = checkpoints / f"agent_{checkpoint_key}.sqlite"
    async def exercise():
        async with agent_routes.AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
            await saver.setup()
        return await agent_routes.delete_chat_session("agent", "session")

    assert asyncio.run(exercise()) == {"deleted": True}
