"""A completed team answer reaches the chat while its usage is still pending."""
import asyncio
import json
import sqlite3
import threading
import time

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.domains.agent.routes import chat_stream_updates
from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.services import agent_team_runtime, agent_team_usage
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_team_models import TeamPlan
from backend.tests.test_agent_team import team_runtime  # noqa: F401


@pytest.mark.parametrize("usage_fails", [False, True])
def test_display_answer_before_collecting_usage(team_runtime, tmp_path, monkeypatch, usage_fails):
    scope, snapshot, calls, settings = team_runtime
    answer = "Hola! En què et puc ajudar?"
    settings["_responses"] = {"director": [TeamPlan(response_kind="greeting", response=answer).model_dump_json()]}
    release = threading.Event()
    record_usage = agent_team_usage.record_team_usage

    def blocked_usage(*args):
        assert release.wait(15), "The UI could not receive the answer while usage was pending"
        if usage_fails:
            raise sqlite3.OperationalError("usage database unavailable")
        return record_usage(*args)

    monkeypatch.setattr(agent_team_usage, "record_team_usage", blocked_usage)

    async def exercise():
        from backend.agent import factory
        graph, selection = await factory.create_agent_workflow([], None, agent_id=snapshot.agent_id,
            user_message="Hola", prepared_ai_cfg=settings, prepared_agent_data=snapshot.profile,
            runtime_capabilities=agent_team_runtime._runtime(snapshot.profile, scope), vault_path=scope.vault_path)
        config = {"configurable": {"thread_id": "greeting"}, "recursion_limit": 12}
        db_path = tmp_path / "chat.sqlite"
        started = time.monotonic()
        state = AgentStreamState(started, started, selection, {}, "greeting-run")
        inputs = {"messages": [HumanMessage(content="Hola")], "user_request": "Hola",
                  "trace_id": state.trace_id, "active_skill_ids": snapshot.skill_ids,
                  "turn_authorized_tool_names": [], "current_user_role": scope.role}
        replies = []
        try:
            async for raw in chat_stream_updates.iter_workflow_events(state=state, turn_timeout_seconds=30,
                    untrusted_context_flags=[], turn_lock=asyncio.Lock(), db_path=db_path,
                    workflow=graph, inputs=inputs, config=config):
                event = json.loads(raw)
                if event["type"] == "message":
                    assert state.team_usage is None
                    assert event["timings"] == {"response_ms": state.response_ms}
                    replies.append(event["content"])
                    release.set()
        finally:
            release.set()
        assert replies == [answer]
        assert state.answer_count == 1 and calls == ["director"]
        metrics = state.metrics_payload()
        assert 0 <= metrics["response_ms"] <= metrics["total_ms"]
        if usage_fails:
            assert metrics["team_usage"]["usage_complete"] is False
            assert "estimated_cost_usd" not in metrics and "model_calls" not in metrics
        else:
            assert metrics["model_calls"] == 1 and metrics["tool_calls"] == 0
        async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
            history = await graph.compile(checkpointer=saver).aget_state(config)
        messages = [message for message in history.values["messages"] if message.type == "ai"]
        assert [message.content for message in messages] == [answer]
        assert messages[0].additional_kwargs["gnosi_team_usage"] == metrics["team_usage"]
        saved_timings = messages[0].additional_kwargs["gnosi_timings"]
        assert saved_timings["response_ms"] == metrics["response_ms"]
        assert saved_timings.get("model_calls") == metrics.get("model_calls")
        assert not history.values["pending_team_messages"]

    with execution_scope(scope):
        asyncio.run(exercise())
