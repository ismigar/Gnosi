"""Let the configured director answer an isolated greeting before discovering specialists."""
from __future__ import annotations

import json
from typing import Any

from jsonschema import ValidationError

from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_team_context import planning_input
from backend.services.agent_team_contracts import is_greeting
from backend.services.agent_team_models import TeamPlan


def greeting_exchange(original: str, state: dict[str, Any]) -> bool:
    """Only server-marked greeting exchanges qualify, including after checkpoint replay."""
    if not is_greeting(original) or state.get("title_edit") or state.get("turn_authorized_tool_names"):
        return False
    messages = state.get("messages") or []
    if not messages or len(messages) % 2 == 0 or messages[-1].content != original:
        return False
    for index, message in enumerate(messages):
        if index % 2 == 0:
            if (message.type != "human" or message.additional_kwargs.get("gnosi_plain_greeting") is not True
                    or not isinstance(message.content, str) or not is_greeting(message.content)):
                return False
        elif message.type != "ai" or message.additional_kwargs.get("gnosi_greeting_reply") is not True:
            return False
    return True


async def director_greeting(owner: dict[str, Any], scope: ExecutionScope, root_id: str,
                            state: dict[str, Any], original: str, refs: list[dict[str, Any]]) -> TeamPlan | None:
    from backend.services.agent_team_runtime import _phase

    data, _ = planning_input(owner, state, original, [], refs, operation_mode=False)
    schema = {"type": "object", "required": ["response"], "additionalProperties": False,
              "properties": {"response": {"type": ["string", "null"],
                  "description": "Reply to the greeting in the user's language. Return null if the conversation or your instructions require sources, an action, or specialist planning."}}}
    try:
        raw = await _phase(owner, root_id, scope, json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                           schema, "team.greeting")
    except (json.JSONDecodeError, ValidationError):
        return None
    except ValueError as error:
        if str(error) == "agent_empty_result":
            return None
        raise
    reply = json.loads(raw)["response"]
    if not isinstance(reply, str) or not reply.strip() or len(reply) > 12000 or reply.lstrip().startswith(("{", "[", "```")):
        return None
    return TeamPlan(response=reply, response_kind="greeting")
