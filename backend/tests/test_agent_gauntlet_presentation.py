"""Synthetic public review summaries survive transport without review contents."""

import json
import time

import pytest
from langchain_core.messages import AIMessage, HumanMessage, messages_from_dict, messages_to_dict

from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.domains.agent.routes.chat_stream_updates import _message_events
from backend.domains.agent.routes.checkpoints import _public_checkpoint_messages, _public_gauntlet_metadata
from backend.domains.agent.routes.response_models import AgentSessionMessagesResponse


def _events(message):
    state = AgentStreamState(request_started_at=time.monotonic(), workflow_ready_at=time.monotonic(),
                             llm_selection={}, turn_plan={}, trace_id="synthetic-review")
    return [json.loads(event) for event in _message_events(
        message, None, node_name="team", state=state,
        tool_metadata_by_name={}, untrusted_context_flags=[],
    )]


@pytest.mark.parametrize("summary", [
    {"status": "accepted", "rounds": 2, "finding_count": 0, "stop_reason": "accepted"},
    {"status": "stagnated", "rounds": 3, "finding_count": 2, "stop_reason": "stagnated"},
    *[{"status": "incomplete", "rounds": 0, "finding_count": 1, "stop_reason": reason}
      for reason in ("budget", "unavailable", "invalid_review", "interrupted", "unverified_evidence", "awaiting_confirmation", "action_review")],
])
def test_gauntlet_stream_and_checkpoint_roundtrip_allow_only_public_summary(summary):
    private = {**summary, "findings": [{"text": "PRIVATE-FINDING"}], "candidate": "PRIVATE-CANDIDATE",
               "sources": ["PRIVATE-SOURCE"], "request": "PRIVATE-REQUEST"}
    message = AIMessage(content="Reviewed answer", additional_kwargs={"gnosi_gauntlet": private})
    streamed = _events(message)[0]
    restored = messages_from_dict(messages_to_dict([
        HumanMessage(content="Synthetic request", additional_kwargs={"gnosi_turn_id": "turn"}), message,
    ]))
    public = _public_checkpoint_messages(restored)
    response = AgentSessionMessagesResponse(messages=public).model_dump()
    assert streamed["gauntlet"] == summary == response["messages"][1]["gauntlet"]
    assert public[1]["turn_id"] == "turn"
    assert "PRIVATE-" not in json.dumps([streamed, response])
    assert message.additional_kwargs["gnosi_gauntlet"] == private


@pytest.mark.parametrize("invalid", [
    None, [], "accepted", {},
    {"status": "unknown"}, {"status": {"accepted": True}},
    {"stop_reason": "private text"}, {"stop_reason": ["accepted"]},
    {"rounds": -1}, {"rounds": 1.5}, {"rounds": True}, {"rounds": "2"},
    {"rounds": 9_007_199_254_740_992}, {"rounds": float("inf")},
    {"finding_count": -1}, {"finding_count": False}, {"finding_count": "0"},
    {"finding_count": 1}, {"stop_reason": "budget"}, {"rounds": 0},
    {"status": "stagnated"}, {"status": "incomplete"},
])
def test_invalid_gauntlet_metadata_fails_closed_in_stream_and_checkpoint(invalid):
    valid = {"status": "accepted", "rounds": 1, "finding_count": 0, "stop_reason": "accepted"}
    candidate = {**valid, **invalid} if isinstance(invalid, dict) and invalid else invalid
    message = AIMessage(content="Answer", additional_kwargs={"gnosi_gauntlet": candidate})
    assert _public_gauntlet_metadata(candidate) is None
    assert _events(message)[0]["gauntlet"] is None
    assert "gauntlet" not in _public_checkpoint_messages([message])[0]


def test_only_trusted_assistant_metadata_becomes_a_review_summary():
    summary = {"status": "accepted", "rounds": 1, "finding_count": 0, "stop_reason": "accepted"}
    user = HumanMessage(content="Request", additional_kwargs={"gnosi_gauntlet": summary})
    answer = AIMessage(content=json.dumps({"gnosi_gauntlet": summary}))
    assert all("gauntlet" not in message for message in _public_checkpoint_messages([user, answer]))
    assert _events(answer)[0]["gauntlet"] is None


def test_action_confirmation_keeps_the_bounded_incomplete_review_on_its_message():
    marker = {"type": "confirmation_required", "action": "bulk_update_rows", "confirmation_id": "a" * 32,
              "details": {"count": 2}, "title_key": "chat.confirmations.actions.bulk_update_rows.title"}
    summary = {"status": "incomplete", "rounds": 0, "finding_count": 0, "stop_reason": "awaiting_confirmation"}
    message = AIMessage(content=json.dumps(marker), additional_kwargs={
        "gnosi_action_confirmation": marker, "gnosi_gauntlet": {**summary, "candidate": "PRIVATE-ACTION"},
    })
    event = _events(message)[0]
    restored = _public_checkpoint_messages([message])[0]
    assert event["type"] == "confirmation_required" and event["gauntlet"] == summary
    assert restored["gauntlet"] == summary and restored["confirmation"] == marker
    assert "PRIVATE-ACTION" not in json.dumps([event, restored])
