"""The HTTP request owns setup; an accepted stream can outlive its subscriber."""

import asyncio
import json
import sqlite3
import uuid

import httpx
import pytest
from fastapi import FastAPI, Request
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langgraph.graph import END, START, StateGraph

from backend.domains.agent.policy import AgentState
from backend.domains.agent.routes import chat_route, learning_context, misc
from backend.domains.agent.stream_protocol import _ACTIVE_PRODUCERS
from backend.services import agent_execution, agent_execution_store, principal_agent_migration
from backend.services import agent_cancellation as cancellation
from backend.services.agent_execution_models import AgentExecutionSnapshot, ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.services.workspace_service import WorkspaceContext


def test_cancel_matches_every_scope_field_and_survives_slow_setup(monkeypatch):
    scope = {"workspace_id": "w", "user_id": "u", "vault_path": "/a", "agent_id": "a", "session_id": "s"}
    other = {**scope, "vault_path": "/b"}
    attempt = f"request-{uuid.uuid4()}"

    async def exercise():
        # Force a prune in the next concurrent submission while setup is still active.
        monkeypatch.setattr(cancellation, "_TTL_SECONDS", 0)
        first = cancellation.create_cancel_token(owner=asyncio.current_task())
        try:
            assert cancellation.bind_stream(first, attempt, scope)
            second = cancellation.create_cancel_token(owner=asyncio.current_task())
            try:
                assert cancellation.bind_stream(second, attempt, other)
                for field in scope:
                    assert cancellation.cancel_stream(attempt, {**scope, field: "unrelated"})
                assert not cancellation.is_cancelled(first) and not cancellation.is_cancelled(second)
                assert cancellation.cancel_stream(attempt, scope)
                assert cancellation.is_cancelled(first) and not cancellation.is_cancelled(second)
            finally:
                cancellation.release(second)
        finally:
            cancellation.release(first)
    asyncio.run(exercise())


async def _post_chat(app, payload, disconnected, delivered):
    body = json.dumps(payload).encode()
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await disconnected.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        # ASGI 2.3 servers such as Uvicorn h11 discard sends after disconnect.
        if not disconnected.is_set():
            delivered(message)

    await app({
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": "POST", "scheme": "http", "path": "/api/chat",
        "raw_path": b"/api/chat", "query_string": b"", "root_path": "",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 100), "server": ("fixture.invalid", 80),
    }, receive, send)


@pytest.mark.parametrize("timing", ["before_submit", "during_setup", "legacy_abort", "after_open", "after_open_cancel", "wrong_vault"])
def test_chat_cancel_and_reconnect_at_the_http_boundary(tmp_path, monkeypatch, timing):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    vault = tmp_path / "vault"
    vault.mkdir()
    context = WorkspaceContext("workspace", "user", "owner", vault)
    scope = ExecutionScope(workspace_id="workspace", user_id="user", role="owner", vault_path=str(vault))
    profile = {"id": "agent", "provider": "fixture", "model": "fake"}
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id="agent", profile=profile,
                                      skill_ids=[], instructions=[], catalog_revision="base", revision="base")
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {"agents": [profile]})
    monkeypatch.setattr(learning_context, "prepare_learning_context", lambda *_, **__: ("", [], "", None))
    monkeypatch.setattr(chat_route, "_vault_scope", lambda: (vault, "fixture-vault"))
    monkeypatch.setitem(chat_route.cfg.paths, "CHECKPOINTS", tmp_path / "checkpoints")
    monkeypatch.setattr(agent_execution, "revalidate_scope", lambda _: None)
    monkeypatch.setattr(agent_execution, "revalidate_scope_async", lambda scope: asyncio.to_thread(agent_execution.revalidate_scope, scope))
    monkeypatch.setattr(agent_execution, "prepare_snapshot", lambda *_, **__: snapshot)

    def authenticated_context(request: Request):
        if request.headers.get("X-Vault-Id") == "other":
            return WorkspaceContext("workspace", "user", "owner", tmp_path / "other")
        return context

    app = FastAPI()
    for path, handler, method in [
        ("/api/chat", chat_route.chat_endpoint, "POST"),
        ("/api/chat/streams/{stream_id}/cancel", misc.cancel_running_agent_stream, "POST"),
        ("/api/chat/streams/{stream_id}", misc.resume_agent_stream, "GET"),
    ]:
        app.add_api_route(path, handler, methods=[method])
        app.dependency_overrides[app.routes[-1].dependant.dependencies[0].call] = authenticated_context

    async def exercise():
        entered, finish, disconnected = (asyncio.Event() for _ in range(3))
        opened = asyncio.Event()
        lock = asyncio.Lock()
        if timing == "after_open_cancel":
            await lock.acquire()
            monkeypatch.setattr(chat_route, "_thread_lock", lambda _: lock)
        calls, frames = [], []
        model = FakeListChatModel(responses=["Synthetic answer"])

        async def assistant(state):
            calls.append("invoked")
            return {"messages": [await model.ainvoke(state["messages"])]}

        graph = StateGraph(AgentState)
        graph.add_node("general", assistant)
        graph.add_edge(START, "general")
        graph.add_edge("general", END)

        async def prepare(*_, **__):
            entered.set()
            await finish.wait()
            return graph, {"mode": "agent_default", "provider": "fixture", "model": "fake", "tools": []}

        def delivered(frame):
            frames.append(frame)
            if b'"type":"stream_open"' in frame.get("body", b""):
                opened.set()
                if timing == "after_open":
                    disconnected.set()

        monkeypatch.setattr(chat_route, "get_agent_workflow", prepare)
        cancel_id = str(uuid.uuid4())
        payload = {"agent_id": "agent", "session_id": "session", "turn_id": "turn", "message": "Say hello."}
        if timing != "legacy_abort":
            payload["cancel_id"] = cancel_id
        params = {"agent_id": "agent", "session_id": "session"}
        cancel_path = f"/api/chat/streams/request-{cancel_id}/cancel"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            if timing == "before_submit":
                assert (await client.post(cancel_path, params=params)).is_success
            task = asyncio.create_task(_post_chat(app, payload, disconnected, delivered))
            if timing != "before_submit":
                await asyncio.wait_for(entered.wait(), 5)
                assert not frames
                if timing in {"during_setup", "wrong_vault"}:
                    headers = {"X-Vault-Id": "other"} if timing == "wrong_vault" else {}
                    assert (await client.post(cancel_path, params=params, headers=headers)).is_success
                if timing == "legacy_abort":
                    disconnected.set()
            finish.set()
            if timing == "after_open_cancel":
                await asyncio.wait_for(opened.wait(), 5)
                opening = next(json.loads(frame["body"]) for frame in frames if frame.get("body"))
                assert (await client.post(f"/api/chat/streams/{opening['stream_id']}/cancel", params=params)).is_success
                lock.release()
            await asyncio.wait_for(task, 5)
            if _ACTIVE_PRODUCERS:
                await asyncio.wait_for(asyncio.gather(*list(_ACTIVE_PRODUCERS)), 5)
            if timing in {"after_open", "wrong_vault"}:
                assert calls == ["invoked"]
                events = [json.loads(frame["body"]) for frame in frames if frame.get("body")]
                stream_id = events[0]["stream_id"]
                path = f"/api/chat/streams/{stream_id}"
                replay = [json.loads(line) for line in (await client.get(path, params=params)).text.splitlines()]
                assert replay[-1]["type"] == "done" and replay[-1]["has_response"]
                assert any(event.get("content") == "Synthetic answer" for event in replay)
                metrics = next(event for event in replay if event["type"] == "turn_metrics")
                stages = metrics["setup_breakdown_ms"]
                assert {"configuration", "vault_context", "session", "workflow", "worker_queue"} <= stages.keys()
                assert all(isinstance(value, int) and value >= 0 for value in stages.values())
                assert sum(stages.values()) == metrics["setup_ms"]
                assert (await client.get(path, params=params, headers={"X-Vault-Id": "other"})).text == ""
            else:
                assert not calls
                assert agent_execution_store.list_runs(scope) == []
                if timing in {"before_submit", "during_setup"}:
                    assert frames[0]["status"] == 409
                if timing != "before_submit":
                    with sqlite3.connect(tmp_path / "data" / "agent_turns.sqlite3") as db:
                        assert db.execute("select state from turn_claims").fetchall() == [("cancelled",)]
    with execution_scope(scope, origin="chat"):
        asyncio.run(exercise())
