"""Explicit per-turn agent selection; command text is never an authority grant."""
from __future__ import annotations

import re
from typing import Any

COMMAND = re.compile(r"/[a-z][a-z0-9_-]{0,31}", re.IGNORECASE)


def normalize_command(value: object) -> str:
    if value is None or value == "":
        return ""
    if not isinstance(value, str):
        raise ValueError("agent_command_invalid")
    value = value.strip().lower()
    if not value:
        return ""
    if not COMMAND.fullmatch(value):
        raise ValueError("agent_command_invalid")
    return value


def validate_commands(agents: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for agent in agents:
        command = normalize_command(agent.get("command"))
        if command and command in seen:
            raise ValueError("agent_command_duplicate")
        if command:
            seen.add(command)
        if "command" in agent:
            agent["command"] = command


def resolve_command(message: str, agents: list[dict[str, Any]]) -> tuple[str, str] | None:
    parts = message.lstrip().split(maxsplit=1)
    if not parts or not COMMAND.fullmatch(parts[0]):
        return None
    command = parts[0].lower()
    matches = [a for a in agents if normalize_command(a.get("command")) == command]
    if not matches:
        raise ValueError("agent_command_unknown")
    if len(matches) != 1:
        raise ValueError("agent_command_duplicate")
    agent = matches[0]
    if not agent.get("enabled", True) or agent.get("plugin_suspended") or agent.get("managed_by") == "llm-wiki":
        raise ValueError("agent_command_unavailable")
    if len(parts) < 2 or not parts[1].strip():
        raise ValueError("agent_command_request_required")
    return str(agent["id"]), parts[1].strip()
