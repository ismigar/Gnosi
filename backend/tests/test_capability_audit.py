"""Tests for metadata-only governed capability auditing."""
from __future__ import annotations

from backend.services import capability_audit


def _scope(**overrides):
    scope = {
        "vault_scope": "vault-a",
        "workspace_id": "workspace-a",
        "user_id": "user-a",
        "role": "editor",
        "agent_id": "agent-a",
        "session_id": "session-a",
    }
    scope.update(overrides)
    return scope


def test_audit_retains_keys_but_not_argument_values(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    capability_audit._schema_ready.clear()

    capability_audit.record_capability_event(
        _scope(),
        tool_id="core.mail.search",
        tool_name="search_mail",
        effects=["read", "external_read", "personal_data"],
        status="completed",
        argument_keys=["query", "secret"],
        result_kind="ToolMessage",
        duration_ms=12,
    )

    events = capability_audit.list_capability_events(_scope())
    assert events[0]["argument_keys"] == ["query", "secret"]
    assert events[0]["effects"] == ["external_read", "personal_data", "read"]
    database_bytes = (tmp_path / "capability_audit.sqlite").read_bytes()
    assert b"secret-value" not in database_bytes


def test_audit_is_exact_scope_bound(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    capability_audit._schema_ready.clear()
    capability_audit.record_capability_event(
        _scope(),
        tool_id="core.reader.search",
        tool_name="search_reader",
        effects=["read"],
        status="completed",
    )

    assert capability_audit.list_capability_events(
        _scope(session_id="another-session")
    ) == []
