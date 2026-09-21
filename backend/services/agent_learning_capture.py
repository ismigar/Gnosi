"""Capture only explicit first-person memory requests in the current user message."""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from backend.services.agent_personal_memory import _now, create_memory, list_memories
from backend.services.workspace_service import WorkspaceContext


_REMEMBER = re.compile(
    r"^(?:recorda(?:'m)?(?: que)?|recuerda(?: que)?|remember(?: that)?|"
    r"souviens-toi(?: que)?|retiens(?: que)?|"
    r"a partir d['’]ara|a partir de ahora|from now on|dorénavant)"
    r"\s*[:,]?\s+(.+)$", re.I | re.S,
)
_ALWAYS = re.compile(
    r"^(?:(?:fes|utilitza|respon|inclou|organitza|separa|mantén|escriu)\s+sempre\b|"
    r"(?:haz|utiliza|responde|incluye|organiza|separa|escribe)\s+siempre\b|"
    r"always\s+(?:use|respond|include|organize|separate|write)\b|"
    r"(?:utilise|réponds|inclus|organise|écris)\s+toujours\b)", re.I,
)
_PROJECT = re.compile(
    r"\b(?:en aquest projecte|en este proyecto|in this project|pour ce projet)\b", re.I,
)
_AMBIGUOUS = re.compile(
    r"^(?:això|així|esto|así|this|that|it|like this|ça|cela|comme ça)[.!]?$", re.I,
)


def explicit_memory(message: str) -> str:
    text = message.strip()
    if len(text) > 4_000 or any(marker in text for marker in ("?", "```", "\n>", "<system")):
        return ""
    match = _REMEMBER.match(text)
    candidate = match.group(1).strip() if match else (text if _ALWAYS.match(text) else "")
    if len(candidate) < 8 or _AMBIGUOUS.fullmatch(candidate):
        return ""
    return candidate


def capture_memory(
    context: WorkspaceContext, agent_id: str, session_id: str, turn_id: str,
    message: str, project_id: str = "",
) -> dict[str, Any] | None:
    text = explicit_memory(message)
    if not text or context.role not in {"editor", "admin", "owner"}:
        return None
    if _PROJECT.search(text) and not project_id:
        return None
    existing = list_memories(context.vault_path, agent_id, user_id=context.user_id)
    for item in existing:
        if ((turn_id and item.get("source_session_id") == session_id
             and item.get("source_turn_id") == turn_id)
                or (item["text"] == text and item["scope_id"] == project_id
                    and item["enabled"]
                    and (not item["expires_at"] or item["expires_at"] > _now()))):
            return item
    try:
        return create_memory(
            context.vault_path, agent_id, text, user_id=context.user_id,
            category="decision" if project_id else "preference",
            provenance="conversation", scope_kind="project" if project_id else "personal",
            scope_id=project_id, source_session_id=session_id, source_turn_id=turn_id,
        )
    except sqlite3.IntegrityError:
        # A replay or concurrent request may already have captured this exact turn.
        return next((
            item for item in list_memories(context.vault_path, agent_id, user_id=context.user_id)
            if item.get("source_session_id") == session_id and item.get("source_turn_id") == turn_id
        ), None)
