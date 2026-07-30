"""One-shot, scope-bound confirmation tests for consequential agent actions."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.agent import action_confirmations
from backend.agent import gnosi_tools
from backend.agent.factory import _latest_tool_batch_requires_confirmation
from backend.api import agent_routes
from backend.agent.action_confirmations import (
    cancel_confirmation,
    claim_confirmation,
    confirmation_context,
    confirmation_event,
    finish_confirmation,
    request_confirmation,
)


def _scope(**overrides):
    result = {
        "vault_scope": "vault-a",
        "workspace_id": "personal",
        "user_id": "user-a",
        "role": "owner",
        "agent_id": "brain",
        "session_id": "session-a",
    }
    result.update(overrides)
    return result


@pytest.fixture(autouse=True)
def isolated_confirmation_database(tmp_path, monkeypatch):
    database = tmp_path / "confirmations.sqlite"
    monkeypatch.setattr(action_confirmations, "_database_path", lambda: database)
    action_confirmations._schema_ready.clear()
    yield database
    action_confirmations._schema_ready.clear()


def _prepare():
    with confirmation_context(**_scope()):
        raw = request_confirmation(
            "empty_trash",
            {},
            title_key="chat.confirmations.actions.empty_trash.title",
            summary_key="chat.confirmations.actions.empty_trash.summary",
            details={"count": 4},
        )
    return json.loads(raw)


def test_pending_action_is_bounded_and_claimed_once():
    pending = _prepare()
    event = confirmation_event(json.dumps(pending))

    assert event["type"] == "confirmation_required"
    assert event["details"] == {"count": 4}
    claimed = claim_confirmation(pending["confirmation_id"], _scope())
    assert claimed["action"] == "empty_trash"
    assert claimed["arguments"] == {}

    finish_confirmation(
        pending["confirmation_id"],
        result={"status": "success"},
    )
    with pytest.raises(RuntimeError):
        claim_confirmation(pending["confirmation_id"], _scope())


def test_scope_mismatch_fails_without_consuming_action():
    pending = _prepare()

    with pytest.raises(PermissionError):
        claim_confirmation(
            pending["confirmation_id"],
            _scope(session_id="another-session"),
        )

    assert claim_confirmation(
        pending["confirmation_id"],
        _scope(),
    )["action"] == "empty_trash"


def test_cancel_is_scope_bound_and_not_replayable():
    pending = _prepare()

    with pytest.raises(PermissionError):
        cancel_confirmation(
            pending["confirmation_id"],
            _scope(agent_id="another-agent"),
        )

    assert cancel_confirmation(pending["confirmation_id"], _scope()) is True
    assert cancel_confirmation(pending["confirmation_id"], _scope()) is False
    with pytest.raises(RuntimeError):
        claim_confirmation(pending["confirmation_id"], _scope())


def test_expired_action_fails_closed(monkeypatch):
    now = 1_000.0
    monkeypatch.setattr(action_confirmations.time, "time", lambda: now)
    pending = _prepare()
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: now + action_confirmations.CONFIRMATION_TTL_SECONDS + 1,
    )

    with pytest.raises(TimeoutError):
        claim_confirmation(pending["confirmation_id"], _scope())


def test_unknown_and_oversized_previews_are_rejected():
    with confirmation_context(**_scope()):
        with pytest.raises(ValueError, match="allowlisted"):
            request_confirmation(
                "run_arbitrary_code",
                {},
                title_key="unknown",
                summary_key="unknown",
            )
        with pytest.raises(ValueError, match="preview"):
            request_confirmation(
                "send_mail",
                {},
                title_key="chat.confirmations.actions.send_mail.title",
                summary_key="chat.confirmations.actions.send_mail.summary",
                details={"subject": "x" * action_confirmations.MAX_PREVIEW_BYTES},
            )


def test_consequential_tool_prepares_without_executing(tmp_path, monkeypatch):
    page = tmp_path / "Page.md"
    page.write_text("unchanged", encoding="utf-8")
    monkeypatch.setattr(gnosi_tools, "_resolve_page", lambda _identifier: page)
    monkeypatch.setattr(
        gnosi_tools,
        "_parse",
        lambda _path: ({"id": "page-1", "title": "Page"}, "unchanged"),
    )
    delete_function = (
        gnosi_tools.delete_page.func
        if hasattr(gnosi_tools.delete_page, "func")
        else gnosi_tools.delete_page
    )

    with confirmation_context(**_scope()):
        pending = json.loads(delete_function("page-1"))

    assert pending["type"] == "confirmation_required"
    assert pending["action"] == "delete_page"
    assert page.read_text(encoding="utf-8") == "unchanged"


def test_confirmation_marker_stops_model_follow_up():
    pending = _prepare()
    messages = [
        SimpleNamespace(type="ai", content="", tool_calls=[{"name": "empty_trash"}]),
        SimpleNamespace(type="tool", content=json.dumps(pending)),
    ]

    assert _latest_tool_batch_requires_confirmation(messages)


def test_confirmation_endpoint_executes_once(monkeypatch):
    pending = _prepare()
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (Path("/vault"), "vault-a"),
    )
    calls = []

    async def fake_execute(action, arguments, *, workspace_id):
        calls.append((action, arguments, workspace_id))
        return {"status": "success"}

    monkeypatch.setattr(agent_routes, "execute_confirmed_action", fake_execute)
    context = agent_routes.WorkspaceContext(
        workspace_id="personal",
        user_id="user-a",
        role="owner",
        vault_path=Path("/vault"),
    )
    payload = agent_routes.ActionConfirmationRequest(
        agent_id="brain",
        session_id="session-a",
    )

    result = asyncio.run(
        agent_routes.confirm_agent_action(
            pending["confirmation_id"],
            payload,
            context,
        )
    )

    assert result["status"] == "completed"
    assert calls == [("empty_trash", {}, "personal")]
    with pytest.raises(HTTPException) as repeated:
        asyncio.run(
            agent_routes.confirm_agent_action(
                pending["confirmation_id"],
                payload,
                context,
            )
        )
    assert repeated.value.status_code == 409
