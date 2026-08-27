"""Explicit, editable long-term memory for Gnosi agents."""

from __future__ import annotations

import hashlib
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from backend.config.app_config import load_params


MAX_MEMORY_TEXT = 4_000
MAX_MEMORIES = 1_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expiry(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Memory expiry must be an ISO 8601 timestamp.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _scope(vault_path: Any, agent_id: str, user_id: str) -> str:
    raw = (
        f"{Path(vault_path).expanduser().absolute()}\0"
        f"{str(agent_id or 'default')}\0{str(user_id or 'personal')}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _path() -> Path:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_personal_memory.sqlite"


def _connect() -> sqlite3.Connection:
    path = _path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "personal_memory", data_dir_for_database(path))
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def _public(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item.pop("scope_hash", None)
    item["enabled"] = bool(item.get("enabled"))
    return item


def list_memories(
    vault_path: Any,
    agent_id: str,
    *,
    user_id: str = "personal",
    include_disabled: bool = True,
) -> list[dict[str, Any]]:
    query = "SELECT * FROM personal_memories WHERE scope_hash=?"
    params: list[Any] = [_scope(vault_path, agent_id, user_id)]
    if not include_disabled:
        query += " AND enabled=1 AND (expires_at IS NULL OR expires_at>?)"
        params.append(_now())
    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(MAX_MEMORIES)
    with _connect() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_public(row) for row in rows]


def create_memory(
    vault_path: Any,
    agent_id: str,
    text: str,
    *,
    category: str = "preference",
    provenance: str = "user",
    expires_at: Optional[str] = None,
    user_id: str = "personal",
) -> dict[str, Any]:
    bounded = " ".join(str(text or "").split())[:MAX_MEMORY_TEXT]
    if not bounded:
        raise ValueError("Memory text cannot be empty.")
    if len(list_memories(vault_path, agent_id, user_id=user_id)) >= MAX_MEMORIES:
        raise ValueError("The agent memory limit has been reached.")
    now = _now()
    memory_id = uuid.uuid4().hex
    with _connect() as connection:
        connection.execute(
            """INSERT INTO personal_memories
            (memory_id, scope_hash, text, category, provenance, enabled,
             expires_at, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)""",
            (
                memory_id, _scope(vault_path, agent_id, user_id), bounded,
                str(category or "preference")[:48], str(provenance or "user")[:96],
                _expiry(expires_at), now, now,
            ),
        )
        row = connection.execute(
            "SELECT * FROM personal_memories WHERE memory_id=?", (memory_id,)
        ).fetchone()
    return _public(row)


def update_memory(
    vault_path: Any,
    agent_id: str,
    memory_id: str,
    *,
    text: str,
    category: str,
    enabled: bool,
    expires_at: Optional[str],
    expected_revision: int,
    user_id: str = "personal",
) -> dict[str, Any]:
    bounded = " ".join(str(text or "").split())[:MAX_MEMORY_TEXT]
    if not bounded:
        raise ValueError("Memory text cannot be empty.")
    with _connect() as connection:
        cursor = connection.execute(
            """UPDATE personal_memories SET text=?, category=?, enabled=?,
            expires_at=?, revision=revision+1, updated_at=?
            WHERE memory_id=? AND scope_hash=? AND revision=?""",
            (
                bounded, str(category or "preference")[:48], int(bool(enabled)),
                _expiry(expires_at), _now(), str(memory_id),
                _scope(vault_path, agent_id, user_id), int(expected_revision),
            ),
        )
        if cursor.rowcount != 1:
            raise ValueError("Memory changed or no longer exists.")
        row = connection.execute(
            "SELECT * FROM personal_memories WHERE memory_id=?", (str(memory_id),)
        ).fetchone()
    return _public(row)


def delete_memory(
    vault_path: Any,
    agent_id: str,
    memory_id: str,
    *,
    user_id: str = "personal",
) -> bool:
    with _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM personal_memories WHERE memory_id=? AND scope_hash=?",
            (str(memory_id), _scope(vault_path, agent_id, user_id)),
        )
    return cursor.rowcount == 1


def search_memories(
    vault_path: Any,
    agent_id: str,
    query: str,
    *,
    user_id: str = "personal",
    limit: int = 5,
) -> list[dict[str, Any]]:
    tokens = {
        token for token in re.findall(r"[\wÀ-ÿ-]+", str(query or "").lower())
        if len(token) >= 2
    }
    ranked = []
    for item in list_memories(
        vault_path, agent_id, user_id=user_id, include_disabled=False,
    ):
        words = set(re.findall(r"[\wÀ-ÿ-]+", item["text"].lower()))
        score = len(tokens & words)
        if score or not tokens:
            ranked.append((score, item))
    ranked.sort(key=lambda pair: (pair[0], pair[1]["updated_at"]), reverse=True)
    return [item for _score, item in ranked[:max(1, min(int(limit), 20))]]
