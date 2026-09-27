"""Optional, bounded handoff from an assistant to its configured team."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import ToolMessage, messages_to_dict

from backend.domains.agent.policy import AgentState
from backend.services.agent_behavior import resource
from backend.services.agent_team_policy import team_for

HELP_NAME = "request_team_help"
HELP_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": HELP_NAME,
        "description": "Ask the configured team to complete the current request only when another specialty or coordinated work is necessary. Do routine work yourself. This ends your turn; do not combine it with other tool calls.",
        "parameters": {"type": "object", "properties": {
            "reason": {"type": "string", "minLength": 1, "maxLength": 1000},
        }, "required": ["reason"], "additionalProperties": False},
    },
}


def requested_help(state: AgentState) -> bool:
    calls = getattr(state["messages"][-1], "tool_calls", ())
    return any(call.get("name") == HELP_NAME for call in calls)


def can_request_help(state: AgentState) -> bool:
    if state.get("team_help_allowed") is False:
        return False
    for message in reversed(state["messages"]):
        if message.type == "human":
            break
        if message.type == "tool":
            return False
    return True


@dataclass(frozen=True)
class TeamHelp:
    owner: dict[str, Any]
    operation_mode: bool

    @property
    def instructions(self) -> str:
        return resource("system/team-help.md")

    async def execute(self, state: AgentState) -> dict[str, Any]:
        import jsonschema  # type: ignore[import-untyped]
        from backend.services import agent_team_store as artifacts, agent_execution_store as runs
        from backend.services.agent_execution import _run
        from backend.services.agent_execution_scope import current_scope, revalidate_scope
        from backend.services.agent_team_runtime import coordinate

        if not can_request_help(state):
            raise ValueError("agent_team_help_must_precede_execution")
        calls: list[dict[str, Any]] = list(getattr(state["messages"][-1], "tool_calls", ()))
        if len(calls) != 1 or calls[0].get("name") != HELP_NAME:
            raise ValueError("agent_team_help_requires_single_call")
        call = calls[0]
        jsonschema.validate(call["args"], HELP_TOOL["function"]["parameters"])
        if not call["args"]["reason"].strip():
            raise ValueError("agent_team_help_reason_required")
        scope, run_id = current_scope(), _run.get()
        revalidate_scope(scope)
        if not run_id:
            raise RuntimeError("agent_team_execution_required")
        # Workflow instances can outlive a turn. Always take this turn's request.
        original = next((str(m.content) for m in reversed(state["messages"]) if m.type == "human"), "")
        evidence = list(state["messages"][:-1])
        saved = artifacts.list_artifacts(scope, "help", run_id)
        if saved and saved[0]["original"] != original:
            raise RuntimeError("agent_team_help_already_requested")
        if not saved:
            artifacts.put(scope, run_id, "help", "help", {
                "original": original, "operation_mode": self.operation_mode,
                "reason": call["args"]["reason"], "messages": messages_to_dict(evidence),
                "state": {"turn_authorized_tool_names": list(state.get("turn_authorized_tool_names") or []),
                          "current_user_role": scope.role},
            }, create_only=True)
        runs.update(scope, run_id, resumable=True)
        result = await coordinate(self.owner, {**state, "messages": evidence},
                                  operation_mode=self.operation_mode, original=original)
        # Resolve the control call in history, including pending confirmation results.
        return {**result, "messages": [ToolMessage(content="Team handoff completed; the following messages contain its result.",
                                                   name=HELP_NAME, tool_call_id=call["id"]), *result["messages"]]}


def optional_team_help(profile: dict[str, Any], *, operation_mode: bool) -> TeamHelp | None:
    from backend.services.agent_team_runtime import delegating
    if delegating.get() or profile.get("_team_execution") or not team_for(profile).enabled:
        return None
    return TeamHelp(copy.deepcopy(profile), operation_mode)
