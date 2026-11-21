"""Let the configured director answer an isolated greeting before discovering specialists."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_team_context import planning_input
from backend.services.agent_team_contracts import is_greeting
from backend.services.agent_team_models import TeamPlan
from backend.services.agent_team_policy import team_for


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
    from backend.services.agent_team_runtime import _config, _phase, _profile

    config = await asyncio.to_thread(_config)
    team = team_for(owner)
    director = _profile(team.director_id, config=config)
    member_ids = {m.agent_id for m in team.members} | {team.director_id}
    roster = [{"id": p["id"], "name": p.get("name") or "", "assigned_skill_ids": p.get("skill_ids") or []}
              for p in config.get("agents", []) if p.get("id") in member_ids
              and p.get("enabled", True) and not p.get("plugin_suspended")]
    # A profile that explicitly names a configured skill deserves a verified catalog
    # on the first call. A configured assignment alone does not prove availability.
    instructions = (str(director.get("persona") or "") + "\n" + str(director.get("context") or "")).casefold()
    if any(str(skill).casefold() in instructions for member in roster for skill in member["assigned_skill_ids"] if skill):
        return None

    data, _ = planning_input(owner, state, original, [], refs, operation_mode=False)
    del data["members"], data["capabilities"]
    data["team_discovery"] = {"status": "deferred", "configured_members": roster}
    schema = {"type": "object", "required": ["response"], "additionalProperties": False,
              "properties": {"response": {"type": ["string", "null"],
                  "description": "Reply in the user's language only if a greeting suffices independently of the team's capabilities. Specialist availability is unknown. Return null to check the team whenever the answer or your instructions depend on who can help, a skill, a source, or an action."}}}
    raw = await _phase(owner, root_id, scope, json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                       schema, "team.greeting")
    reply = json.loads(raw)["response"]
    if not isinstance(reply, str) or not reply.strip() or len(reply) > 12000 or reply.lstrip().startswith(("{", "[", "```")):
        return None
    return TeamPlan(response=reply, response_kind="greeting")
