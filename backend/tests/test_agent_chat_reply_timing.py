"""A completed team answer reaches the chat while its usage is still pending."""
import asyncio
import errno
import json
import sqlite3
import threading
from decimal import InvalidOperation
import time

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.domains.agent.routes import chat_stream_updates
from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.services import agent_team_runtime, agent_team_usage
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_team_models import TeamPlan
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401


def observe_model_waits(monkeypatch, synchronize=None):
    from backend.domains.agent import policy

    waits = []
    invoke = policy.invoke_cancellable

    def delayed_model(*args, **kwargs):
        started = time.monotonic()
        try:
            if synchronize is not None:
                synchronize()
            time.sleep(0.025)
            return invoke(*args, **kwargs)
        finally:
            waits.append((started, time.monotonic()))

    monkeypatch.setattr(policy, "invoke_cancellable", delayed_model)
    return waits


@pytest.fixture
def model_waits(monkeypatch):
    return observe_model_waits(monkeypatch)


@pytest.mark.parametrize("usage_fails", [None, sqlite3.OperationalError, InvalidOperation, TimeoutError,
    pytest.param(lambda reason: PermissionError(errno.EACCES, reason), id="ledger-access-denied")])
def test_display_answer_before_collecting_usage(team_runtime, tmp_path, monkeypatch, usage_fails, model_waits):
    scope, snapshot, calls, settings = team_runtime
    answer = "Hola! En què et puc ajudar?"
    settings["_responses"] = {"director": [TeamPlan(response_kind="greeting", response=answer).model_dump_json()]}
    release = threading.Event()
    entered = threading.Event()
    record_usage = agent_team_usage.record_team_usage

    def blocked_usage(*args):
        entered.set()
        assert release.wait(15), "The UI could not receive the answer while usage was pending"
        if usage_fails:
            raise usage_fails("usage unavailable")
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
        async def check_history():
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                    history = await graph.compile(checkpointer=saver).aget_state(config)
                assert [m.content for m in history.values["messages"] if m.type == "ai"] == [answer]
            finally:
                release.set()

        observer = None
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
                    observer = asyncio.create_task(check_history())
        finally:
            release.set()
        assert observer is not None
        await observer
        assert replies == [answer]
        assert state.answer_count == 1 and calls == ["director"]
        metrics = state.metrics_payload()
        assert 0 <= metrics["response_ms"] <= metrics["total_ms"]
        assert len(model_waits) == 1
        start, end = model_waits[0]
        assert metrics["model_ms"] == pytest.approx((end - start) * 1000, abs=3)
        assert metrics["model_ms"] + metrics["routing_ms"] <= metrics["response_ms"]
        assert sum(metrics[key] for key in ("setup_ms", "routing_ms", "model_ms", "tools_ms", "other_ms")) == metrics["total_ms"]
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
        assert saved_timings["model_ms"] == metrics["model_ms"]
        assert saved_timings["routing_ms"] == metrics["routing_ms"]
        assert saved_timings.get("model_calls") == metrics.get("model_calls")
        assert not history.values["pending_team_messages"]

    with execution_scope(scope):
        asyncio.run(exercise())


def chat_details(fixture, db_path, request, *, profile=None, supplied_operation="", active_agent_id=None):
    from backend.agent.factory import create_agent_workflow
    from backend.domains.agent.routes.checkpoints import _public_checkpoint_messages

    scope, snapshot, _, settings = fixture
    settings["active_agent_id"] = active_agent_id or snapshot.agent_id
    profile = profile or snapshot.profile

    async def exercise():
        graph, selection = await create_agent_workflow(
            [], None, agent_id=profile["id"], user_message=request, prepared_ai_cfg=settings,
            prepared_agent_data=profile, runtime_capabilities=agent_team_runtime._runtime(profile, scope),
            vault_path=scope.vault_path,
        )
        config = {"configurable": {"thread_id": "test"}, "recursion_limit": 12}
        started = time.monotonic()
        state = AgentStreamState(started, started, selection, {}, "test-run")
        inputs = {"messages": [HumanMessage(content=request)], "user_request": request, "trace_id": state.trace_id,
                  "active_skill_ids": profile["skill_ids"], "current_user_role": scope.role,
                  "turn_authorized_tool_names": [], "supplied_operation": supplied_operation}
        replies = []
        async for raw in chat_stream_updates.iter_workflow_events(
                state=state, turn_timeout_seconds=30, untrusted_context_flags=[], turn_lock=asyncio.Lock(),
                db_path=db_path, workflow=graph, inputs=inputs, config=config):
            event = json.loads(raw)
            if event["type"] == "message":
                replies.append(event["content"])
        async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
            history = await graph.compile(checkpointer=saver).aget_state(config)
        messages = [m for m in _public_checkpoint_messages(history.values["messages"]) if m["role"] == "assistant"]
        assert replies == [messages[-1]["content"]]
        return state.metrics_payload(), messages[-1]

    with execution_scope(scope):
        return asyncio.run(exercise())


def assert_model_wall_time(metrics, message, expected_ms):
    assert metrics["model_ms"] == pytest.approx(expected_ms, abs=3)
    assert metrics["model_ms"] + metrics["routing_ms"] <= metrics["response_ms"]
    for key in ("model_ms", "routing_ms", "tools_ms", "setup_ms"):
        assert message["timings"][key] == metrics[key]


@pytest.mark.parametrize("repair", [False, True])
def test_direct_specialist_and_format_repair_report_their_model_waits(optional_runtime, monkeypatch, tmp_path, model_waits, repair):
    from backend.tests.test_agent_team_contracts import WORD_FIELD_REQUEST, prepare

    fixture, _ = optional_runtime
    replies = ['{"value":"true"}', '{"value":true}'] if repair else ['{"value":true}']
    prepare(fixture, monkeypatch, replies)
    metrics, answer = chat_details(fixture, tmp_path / "chat.sqlite", WORD_FIELD_REQUEST, supplied_operation="tables")
    assert json.loads(answer["content"]) == {"value": True}
    assert fixture[2] == ["worker"] * len(replies)
    assert metrics["model_calls"] == len(model_waits) == len(replies)
    assert metrics["team_usage"]["phases"]["repair"]["model_calls"] == int(repair)
    assert_model_wall_time(metrics, answer, sum(end - start for start, end in model_waits) * 1000)


def test_director_plan_retry_and_clarification_report_both_waits(optional_runtime, tmp_path, model_waits):
    fixture, _ = optional_runtime
    answer = "Would you like a summary or a translation?"
    clarification = TeamPlan(response_kind="clarification", response=answer)
    fixture[3]["_responses"] = {"director": [AIMessage(content="incomplete"), AIMessage(content=clarification.model_dump_json())]}
    metrics, message = chat_details(fixture, tmp_path / "chat.sqlite", "They asked me to adapt this note. Ask what they need.")
    assert message["content"] == answer
    assert fixture[2] == ["director", "director"]
    assert metrics["team_usage"]["phases"]["planning"]["model_calls"] == len(model_waits) == 2
    assert_model_wall_time(metrics, message, sum(end - start for start, end in model_waits) * 1000)


def test_ordinary_model_without_token_counts_still_reports_its_wait(optional_runtime, tmp_path, model_waits):
    fixture, _ = optional_runtime
    fixture[3]["_responses"] = {"worker": [AIMessage(content="A direct reply")]}
    metrics, message = chat_details(fixture, tmp_path / "chat.sqlite", "Write a short reply", profile=fixture[3]["agents"][1])
    assert message["content"] == "A direct reply" and fixture[2] == ["worker"]
    assert len(model_waits) == 1 and "team_usage" not in metrics
    start, end = model_waits[0]
    assert_model_wall_time(metrics, message, (end - start) * 1000)


def test_optional_team_help_persists_model_time_for_an_ordinary_profile(optional_runtime, tmp_path, model_waits):
    from backend.tests.test_agent_team import help_message

    fixture, _ = optional_runtime
    settings = fixture[3]
    settings["agents"].append({"id": "other", "provider": "local", "model": "cheap", "skill_ids": []})
    answer = "Would you like a translation or a summary?"
    clarification = TeamPlan(response=answer, response_kind="clarification")
    settings["_responses"] = {"director": [help_message()]}
    settings["_phase_responses"] = {"team.plan": [AIMessage(content=clarification.model_dump_json())]}
    metrics, message = chat_details(fixture, tmp_path / "chat.sqlite", "Help adapt this text. Ask what I need.",
                                    active_agent_id="other")
    assert message["content"] == answer and fixture[2] == ["director", "director"]
    assert len(model_waits) == 2
    assert_model_wall_time(metrics, message, sum(end - start for start, end in model_waits) * 1000)


def test_parallel_specialists_contribute_one_wall_time_interval(optional_runtime, tmp_path, monkeypatch):
    from backend.services import agent_execution, agent_execution_store
    from backend.services.agent_team_models import TeamTask

    fixture, _ = optional_runtime
    scope, snapshot, _, settings = fixture
    snapshot.profile["team"]["direct_routes"] = []
    tasks = [TeamTask(id=identifier, agent_id="worker", objective="Read this note independently.",
                      skill_ids=snapshot.skill_ids, read_only=True) for identifier in ("first", "second")]
    plan = TeamPlan(tasks=tasks, result_task="second")
    review = {"checks": [{"criterion_id": "C1", "outcome": "passed", "severity": "none",
                          "evidence": "The answer accurately describes the supplied note.", "issue": ""}]}
    settings["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())],
                                    "gauntlet.review": [AIMessage(content=json.dumps(review))]}
    settings["_responses"] = {"worker": [AIMessage(content="A short note about trains.")]}
    gate = threading.Barrier(2, timeout=8)

    def wait_for_sibling():
        run = agent_execution_store.read(scope, agent_execution._run.get())
        if run.agent_id == "worker" and run.operation == "conversation":
            gate.wait()

    waits = observe_model_waits(monkeypatch, wait_for_sibling)
    metrics, message = chat_details(fixture, tmp_path / "chat.sqlite", "Gather two readings of this note about trains.")
    assert message["content"] == "A short note about trains."
    assert metrics["model_calls"] == len(waits) and fixture[2].count("worker") >= 2
    overlaps = [min(end, other_end) - max(start, other_start)
                for index, (start, end) in enumerate(waits) for other_start, other_end in waits[index + 1:]
                if max(start, other_start) < min(end, other_end)]
    assert len(overlaps) == 1 and overlaps[0] >= 0.02
    assert_model_wall_time(metrics, message, (sum(end - start for start, end in waits) - overlaps[0]) * 1000)


def test_overlapping_tool_and_failed_model_are_disjoint_and_scoped(monkeypatch):
    from backend.services import agent_chat_timing as timing

    now = 0
    monkeypatch.setattr(timing, "monotonic", lambda: now)
    with timing.track_chat("first", 0, 1, 2) as first:
        now = 3
        with timing.chat_wait("tools"):
            now = 4
            with pytest.raises(TimeoutError), timing.chat_wait("model"):
                now = 6
                raise TimeoutError()
            now = 7
        with timing.track_chat("second", 7, 7, 7) as second:
            now = 8
            with timing.chat_wait("model"):
                now = 10
        assert timing.current_chat_timing.get() is first
    assert timing.current_chat_timing.get() is None
    assert first.phases(10000, 12000) == {"setup_ms": 1000, "routing_ms": 4000, "model_ms": 2000,
                                           "tools_ms": 2000, "other_ms": 3000}
    assert second.phases(3000, 3500) == {"setup_ms": 0, "routing_ms": 1000, "model_ms": 2000,
                                        "tools_ms": 0, "other_ms": 500}


@pytest.mark.parametrize("governed", [False, True])
def test_standard_and_governed_tool_nodes_keep_their_own_time(monkeypatch, governed):
    from langchain_core.tools import tool
    from langgraph.graph import END, START, StateGraph
    from backend.domains.agent.policy import AgentState, GovernedToolNode, TimedToolNode
    from backend.services import agent_chat_timing as timing

    now = 0
    monkeypatch.setattr(timing, "monotonic", lambda: now)

    @tool
    def count_items() -> int:
        """Return the number of synthetic entries."""
        nonlocal now
        now = 1
        return 3

    graph = StateGraph(AgentState)
    graph.add_node("tools", (GovernedToolNode if governed else TimedToolNode)([count_items]))
    graph.add_edge(START, "tools")
    graph.add_edge("tools", END)
    request = AIMessage(content="", tool_calls=[{"id": "count", "name": "count_items", "args": {}}])
    with timing.track_chat("test", 0, 0, 0) as clock:
        result = asyncio.run(graph.compile().ainvoke({"messages": [request]}))
    assert result["messages"][-1].content == "3"
    assert clock.waits(0, 1) == {"model": 0, "tools": 1000}
