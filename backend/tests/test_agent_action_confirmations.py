"""One-shot, scope-bound confirmation tests for consequential agent actions."""
import asyncio
import json
import sqlite3
import stat
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.agent import action_confirmations
from backend.agent import gnosi_tools
from backend.agent.factory import _latest_tool_batch_requires_confirmation
from backend.api import agent_routes
from backend.agent.action_confirmations import (
    cancel_confirmation,
    cancel_scope_confirmations,
    claim_confirmation,
    confirmation_context,
    confirmation_event,
    finish_confirmation,
    get_confirmation_status,
    heartbeat_confirmation,
    list_confirmations,
    list_workspace_confirmations,
    maintain_confirmation_store,
    request_confirmation,
)
from backend.services.workspace_service import get_workspace_context


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
    yield database


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


def test_workspace_queue_exposes_only_routing_metadata_for_current_user():
    pending = _prepare()
    with confirmation_context(**_scope(session_id="automation:daily:run-1")):
        request_confirmation(
            "send_mail",
            {"body": "private body", "to": ["person@example.test"]},
            title_key="chat.confirmations.actions.send_mail.title",
            summary_key="chat.confirmations.actions.send_mail.summary",
        )

    records = list_workspace_confirmations(_scope())
    assert len(records) == 2
    assert {record["session_id"] for record in records} == {
        "session-a", "automation:daily:run-1",
    }
    assert records[0]["agent_id"] == "brain"
    assert "arguments" not in records[0]
    assert "private body" not in json.dumps(records)
    assert list_workspace_confirmations(_scope(user_id="other")) == []
    assert pending["confirmation_id"] in {
        record["confirmation_id"] for record in records
    }


def test_automation_governed_confirmation_remains_actionable_for_one_day():
    descriptor = SimpleNamespace(
        id="core.tool.publish",
        name="Publish",
        effects=["external_write"],
        confirmation="always",
        model_dump=lambda **_kwargs: {
            "id": "core.tool.publish",
            "name": "Publish",
            "effects": ["external_write"],
            "confirmation": "always",
        },
    )
    with confirmation_context(**_scope(session_id="automation-daily")):
        raw = action_confirmations.request_governed_tool_confirmation(
            descriptor=descriptor,
            tool_name="publish_social_posts",
            tool_arguments={"posts": {"network": "bounded text"}},
            active_skill_ids=["core.gnosi-social-publishing"],
        )
    event = json.loads(raw)
    assert event["expires_at"] - time.time() > 23 * 60 * 60


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

    async def fake_execute(
        action,
        arguments,
        *,
        workspace_id,
        background_tasks,
    ):
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
            BackgroundTasks(),
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
                BackgroundTasks(),
                context,
            )
        )
    assert repeated.value.status_code == 409


def test_confirmation_http_api_executes_and_rejects_replay(monkeypatch):
    pending = _prepare()
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (Path("/vault"), "vault-a"),
    )
    calls = []

    async def fake_execute(
        action,
        arguments,
        *,
        workspace_id,
        background_tasks,
    ):
        calls.append((action, arguments, workspace_id))
        return {"status": "success"}

    monkeypatch.setattr(agent_routes, "execute_confirmed_action", fake_execute)
    context = agent_routes.WorkspaceContext(
        workspace_id="personal",
        user_id="user-a",
        role="owner",
        vault_path=Path("/vault"),
    )
    app = FastAPI()
    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context

    with TestClient(app) as client:
        endpoint = (
            f"/api/chat/confirmations/{pending['confirmation_id']}/confirm"
        )
        payload = {
            "agent_id": "brain",
            "session_id": "session-a",
        }
        response = client.post(endpoint, json=payload)
        replay = client.post(endpoint, json=payload)

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert replay.status_code == 409
    assert calls == [("empty_trash", {}, "personal")]


def test_database_is_private_and_terminal_rows_scrub_arguments(
    isolated_confirmation_database,
):
    with confirmation_context(**_scope()):
        pending = json.loads(request_confirmation(
            "send_mail",
            {
                "to": "person@example.com",
                "body": "sensitive body",
            },
            title_key="send",
            summary_key="send",
            details={"subject": "Private"},
        ))
    mode = stat.S_IMODE(isolated_confirmation_database.stat().st_mode)
    assert mode == 0o600

    claim_confirmation(pending["confirmation_id"], _scope())
    finish_confirmation(
        pending["confirmation_id"],
        result={
            "status": "sent",
            "body": "must not persist",
            "token": "must not persist",
        },
    )
    connection = sqlite3.connect(isolated_confirmation_database)
    try:
        row = connection.execute(
            """
            SELECT status, arguments_json, preview_json, result_json
            FROM pending_agent_actions WHERE id = ?
            """,
            (pending["confirmation_id"],),
        ).fetchone()
    finally:
        connection.close()
    assert row == (
        "completed",
        "{}",
        action_confirmations.SCRUBBED_PREVIEW_JSON,
        '{"status":"sent"}',
    )
    public = get_confirmation_status(pending["confirmation_id"], _scope())
    assert public["title_key"].endswith(".send_mail.title")
    assert public["summary_key"] == "chat.confirmations.summary"
    assert public["details"] == {}


def test_expiry_and_session_deletion_scrub_arguments(
    isolated_confirmation_database,
    monkeypatch,
):
    now = 5_000.0
    monkeypatch.setattr(action_confirmations.time, "time", lambda: now)
    expired = _prepare()
    later = now + action_confirmations.CONFIRMATION_TTL_SECONDS + 1
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: later,
    )
    assert list_confirmations(_scope())[0]["status"] == "expired"
    cancelled = _prepare()
    assert cancel_scope_confirmations(_scope()) == 1

    connection = sqlite3.connect(isolated_confirmation_database)
    try:
        rows = dict(connection.execute(
            "SELECT id, arguments_json FROM pending_agent_actions"
        ).fetchall())
    finally:
        connection.close()
    assert rows[expired["confirmation_id"]] == "{}"
    assert rows[cancelled["confirmation_id"]] == "{}"


def test_stale_execution_becomes_unknown_and_cannot_retry(monkeypatch):
    now = 7_000.0
    monkeypatch.setattr(action_confirmations.time, "time", lambda: now)
    pending = _prepare()
    claim_confirmation(pending["confirmation_id"], _scope())
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: now + action_confirmations.EXECUTION_LEASE_SECONDS + 1,
    )

    status = get_confirmation_status(pending["confirmation_id"], _scope())
    assert status["status"] == "outcome_unknown"
    with pytest.raises(RuntimeError):
        claim_confirmation(pending["confirmation_id"], _scope())


def test_terminal_audit_rows_are_removed_after_retention(
    isolated_confirmation_database,
    monkeypatch,
):
    now = 8_000.0
    monkeypatch.setattr(action_confirmations.time, "time", lambda: now)
    pending = _prepare()
    claim_confirmation(pending["confirmation_id"], _scope())
    finish_confirmation(
        pending["confirmation_id"],
        result={"status": "completed"},
    )
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: now + action_confirmations.TERMINAL_RETENTION_SECONDS + 1,
    )

    assert list_confirmations(_scope()) == []
    connection = sqlite3.connect(isolated_confirmation_database)
    try:
        count = connection.execute(
            "SELECT COUNT(*) FROM pending_agent_actions"
        ).fetchone()[0]
    finally:
        connection.close()
    assert count == 0


def test_retention_maintenance_runs_without_listing(
    isolated_confirmation_database,
    monkeypatch,
):
    now = 9_000.0
    monkeypatch.setattr(action_confirmations.time, "time", lambda: now)
    pending = _prepare()
    claim_confirmation(pending["confirmation_id"], _scope())
    finish_confirmation(pending["confirmation_id"], result={"status": "completed"})
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: now + action_confirmations.TERMINAL_RETENTION_SECONDS + 1,
    )

    maintain_confirmation_store()

    connection = sqlite3.connect(isolated_confirmation_database)
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM pending_agent_actions"
        ).fetchone()[0] == 0
    finally:
        connection.close()


def test_heartbeat_preserves_a_live_execution_lease(monkeypatch):
    now = 10_000.0
    monkeypatch.setattr(action_confirmations.time, "time", lambda: now)
    pending = _prepare()
    claim_confirmation(pending["confirmation_id"], _scope())
    heartbeat_at = now + action_confirmations.EXECUTION_LEASE_SECONDS - 10
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: heartbeat_at,
    )
    assert heartbeat_confirmation(pending["confirmation_id"])
    monkeypatch.setattr(
        action_confirmations.time,
        "time",
        lambda: now + action_confirmations.EXECUTION_LEASE_SECONDS + 10,
    )

    assert get_confirmation_status(
        pending["confirmation_id"],
        _scope(),
    )["status"] == "executing"


def test_new_pending_confirmation_is_not_crowded_out_by_terminal_history():
    for _index in range(100):
        terminal = _prepare()
        claim_confirmation(terminal["confirmation_id"], _scope())
        finish_confirmation(
            terminal["confirmation_id"],
            result={"status": "completed"},
        )
    newest = _prepare()

    visible = list_confirmations(_scope())

    assert len(visible) == 100
    assert newest["confirmation_id"] in {
        item["confirmation_id"] for item in visible
    }
    assert any(item["status"] == "pending" for item in visible)


def test_concurrent_claim_and_cancel_have_one_winner():
    pending = _prepare()

    def claim():
        try:
            claim_confirmation(pending["confirmation_id"], _scope())
            return "claimed"
        except RuntimeError:
            return "lost"

    def cancel():
        return "cancelled" if cancel_confirmation(
            pending["confirmation_id"],
            _scope(),
        ) else "lost"

    with ThreadPoolExecutor(max_workers=2) as pool:
        claim_future = pool.submit(claim)
        cancel_future = pool.submit(cancel)
        results = {
            claim_future.result(),
            cancel_future.result(),
        }
    assert "lost" in results
    assert len({"claimed", "cancelled"}.intersection(results)) == 1


def test_endpoint_surfaces_partial_and_unknown_outcomes(monkeypatch):
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (Path("/vault"), "vault-a"),
    )
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

    partial = _prepare()

    async def partial_execute(*_args, **_kwargs):
        return {
            "status": "partial",
            "purged_count": 2,
            "failed_count": 1,
        }

    monkeypatch.setattr(
        agent_routes,
        "execute_confirmed_action",
        partial_execute,
    )
    result = asyncio.run(agent_routes.confirm_agent_action(
        partial["confirmation_id"],
        payload,
        BackgroundTasks(),
        context,
    ))
    assert result["status"] == "partial"
    assert result["result"]["failed_count"] == 1

    unknown = _prepare()

    async def uncertain_execute(*_args, **_kwargs):
        raise RuntimeError("connection lost after request")

    monkeypatch.setattr(
        agent_routes,
        "execute_confirmed_action",
        uncertain_execute,
    )
    with pytest.raises(HTTPException) as response:
        asyncio.run(agent_routes.confirm_agent_action(
            unknown["confirmation_id"],
            payload,
            BackgroundTasks(),
            context,
        ))
    assert response.value.detail["code"] == "confirmation_outcome_unknown"
    assert get_confirmation_status(
        unknown["confirmation_id"],
        _scope(),
    )["status"] == "outcome_unknown"


def test_external_http_5xx_is_unknown_but_http_409_is_known(monkeypatch):
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (Path("/vault"), "vault-a"),
    )
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

    async def provider_5xx(*_args, **_kwargs):
        raise HTTPException(status_code=500, detail="response lost")

    monkeypatch.setattr(
        agent_routes,
        "execute_confirmed_action",
        provider_5xx,
    )
    unknown = _prepare()
    with pytest.raises(HTTPException) as unknown_response:
        asyncio.run(agent_routes.confirm_agent_action(
            unknown["confirmation_id"],
            payload,
            BackgroundTasks(),
            context,
        ))
    assert unknown_response.value.detail["code"] == "confirmation_outcome_unknown"
    assert get_confirmation_status(
        unknown["confirmation_id"],
        _scope(),
    )["status"] == "outcome_unknown"

    async def known_conflict(*_args, **_kwargs):
        raise HTTPException(status_code=409, detail="stale")

    monkeypatch.setattr(
        agent_routes,
        "execute_confirmed_action",
        known_conflict,
    )
    conflict = _prepare()
    with pytest.raises(HTTPException) as conflict_response:
        asyncio.run(agent_routes.confirm_agent_action(
            conflict["confirmation_id"],
            payload,
            BackgroundTasks(),
            context,
        ))
    assert conflict_response.value.status_code == 409
    assert get_confirmation_status(
        conflict["confirmation_id"],
        _scope(),
    )["status"] == "failed"


def test_confirmed_action_timeout_is_an_unknown_outcome(monkeypatch):
    monkeypatch.setattr(
        agent_routes,
        "_vault_scope",
        lambda: (Path("/vault"), "vault-a"),
    )
    monkeypatch.setattr(
        agent_routes,
        "CONFIRMED_ACTION_TIMEOUT_SECONDS",
        0.01,
    )

    async def slow_execute(*_args, **_kwargs):
        time.sleep(0.1)
        return {"status": "success"}

    monkeypatch.setattr(
        agent_routes,
        "execute_confirmed_action",
        slow_execute,
    )
    pending = _prepare()
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

    with pytest.raises(HTTPException) as response:
        asyncio.run(agent_routes.confirm_agent_action(
            pending["confirmation_id"],
            payload,
            BackgroundTasks(),
            context,
        ))

    assert response.value.status_code == 409
    assert response.value.detail["code"] == "confirmation_outcome_unknown"
    assert get_confirmation_status(
        pending["confirmation_id"],
        _scope(),
    )["status"] == "outcome_unknown"


def test_governed_tool_descriptor_change_blocks_execution(monkeypatch):
    from langchain_core.tools import tool

    from backend.models.agent_skills import (
        CatalogOrigin,
        ConfirmationPolicy,
        OriginType,
        ToolDescriptor,
        ToolEffect,
    )

    @tool
    def external_write(target: str) -> str:
        """Write to a test external target."""
        return target

    common = {
        "id": "plugin.example.external-write",
        "name": "External write",
        "origin": CatalogOrigin(type=OriginType.PLUGIN, id="example"),
        "effects": [ToolEffect.EXTERNAL_WRITE],
        "confirmation": ConfirmationPolicy.ALWAYS,
    }
    original = ToolDescriptor(description="Original", **common)
    changed = ToolDescriptor(description="Changed", **common)
    monkeypatch.setattr(
        agent_routes,
        "prepare_agent_runtime",
        lambda *_args, **_kwargs: (
            {},
            {"id": "brain"},
            SimpleNamespace(
                tool_descriptors=(changed,),
                tools=(external_write,),
            ),
        ),
    )

    with pytest.raises(gnosi_tools.ActionConflictError):
        asyncio.run(agent_routes._execute_governed_tool(
            {
                "tool_id": original.id,
                "tool_name": external_write.name,
                "tool_arguments": {"target": "exact"},
                "descriptor_digest": action_confirmations._descriptor_digest(
                    original
                ),
                "active_skill_ids": ["plugin.example.external"],
            },
            scope=_scope(role="admin"),
            vault=Path("/vault"),
        ))
