"""Invalid handoffs consume the existing operation repair, without effects."""
import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from backend.tests.test_agent_team import (
    help_message,
    optional_runtime as optional_runtime,
    run_operation,
    team_runtime as team_runtime,
)


def invalid_help(kind):
    if kind == "duplicate":
        message = help_message()
        return AIMessage(content="", tool_calls=[*message.tool_calls,
            {**message.tool_calls[0], "id": "second"}])
    return help_message("" if kind == "empty" else "Need support", extra=kind == "mixed")


@pytest.mark.parametrize("kind", ["duplicate", "mixed", "empty"])
def test_invalid_handoff_returns_full_context_without_delegation(optional_runtime, kind):
    from backend.services import agent_team_store as artifacts
    fixture, bindings = optional_runtime
    invalid = invalid_help(kind)
    fixture[3]["_responses"] = {"director": [invalid, AIMessage(content='{"result":"complete"}')]}
    original = "Original source and global context"
    run = run_operation(fixture, input_text=original, schema={"type": "object"})
    assert json.loads(run.result) == {"result": "complete"}
    assert fixture[2] == ["director", "director"] and run.model_calls == 2
    assert len(bindings) == 1
    first, second = [messages for _, messages in fixture[3]["_model_messages"]]
    assert first[1].content == second[1].content and original in second[1].content
    replies = [message for message in second if message.type == "tool"]
    assert [reply.tool_call_id for reply in replies] == [call["id"] for call in invalid.tool_calls]
    assert not artifacts.list_artifacts(fixture[0], "help", run.run_id)
    assert not artifacts.list_artifacts(fixture[0], "plan", run.run_id)
    assert not artifacts.list_artifacts(fixture[0], "task", run.run_id)


def test_invalid_handoff_cannot_expand_repair_budget(optional_runtime):
    fixture, _ = optional_runtime
    fixture[3]["_responses"] = {"director": [invalid_help("duplicate"), AIMessage(content="invalid JSON")]}
    with pytest.raises(ValueError):
        run_operation(fixture, schema={"type": "object"})
    assert fixture[2] == ["director", "director"]


def test_invalid_conversation_handoff_remains_rejected():
    import asyncio
    from backend.domains.agent.team_help import TeamHelp
    with pytest.raises(ValueError, match="single_call"):
        asyncio.run(TeamHelp({}, False).execute({"messages": [HumanMessage(content="Read"), invalid_help("duplicate")]}))
