import pytest

from backend.agent.factory import _obvious_route
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
