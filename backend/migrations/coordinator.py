"""Explicit ownership map and startup coordinator for Gnosi SQLite stores."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.migrations.runner import ensure_database_schema_once, verify_database_schema


@dataclass(frozen=True)
class OwnedDatabase:
    """One exact application-owned database location and migration family."""

    relative_path: str
    family: str
    required: bool = False


OWNED_DATABASES = (
    OwnedDatabase("system/management.sqlite", "management", required=True),
    OwnedDatabase("system/notebooks.sqlite3", "notebooks"),
    OwnedDatabase("system/tool_registry.sqlite", "tool_registry"),
    OwnedDatabase("agent_action_confirmations.sqlite", "action_confirmations"),
    OwnedDatabase("agent_model_evaluations.sqlite", "model_evaluations"),
    OwnedDatabase("agent_capability_health.sqlite", "capability_health"),
    OwnedDatabase("agent_jobs.sqlite3", "durable_jobs"),
    OwnedDatabase("agent_personal_memory.sqlite", "personal_memory"),
    OwnedDatabase("agent_quality.sqlite", "quality_telemetry"),
    OwnedDatabase("agent_replays.sqlite3", "agent_replay"),
    OwnedDatabase("agent_semantic_memory.sqlite", "semantic_memory"),
    OwnedDatabase("agent_stream_journal.sqlite", "stream_journal"),
    OwnedDatabase("agent_turns.sqlite3", "turn_claims"),
    OwnedDatabase("capability_audit.sqlite", "capability_audit"),
    OwnedDatabase("capability_automations.sqlite", "capability_automations"),
)

EXTERNAL_DATABASE_ROOTS = ("chroma_db", "system/checkpoints")
DERIVED_DATABASE_ROOTS = ("llm_wiki",)


def _literature_indexes(root: Path) -> list[tuple[Path, str]]:
    """Discover the durable OAI index owned independently by each vault."""
    literature_root = root / "literature"
    if not literature_root.exists():
        return []
    return [
        (path, "literature_index")
        for path in sorted(literature_root.glob("*/academic_index.sqlite3"))
        if path.is_file()
    ]


def existing_owned_databases(data_dir: Path) -> list[tuple[Path, str]]:
    """Resolve exact first-party stores, including every dynamic vault DB."""
    root = data_dir.expanduser().resolve()
    result = [
        (root / item.relative_path, item.family)
        for item in OWNED_DATABASES
        if item.required or (root / item.relative_path).exists()
    ]
    vault_root = root / "system" / "vault_dbs"
    if vault_root.exists():
        result.extend(
            (path, "vault")
            for path in sorted(vault_root.glob("gnosi_vault_*.db"))
            if path.is_file()
        )
    result.extend(_literature_indexes(root))
    return result


def migrate_existing_databases(data_dir: Path) -> list[dict[str, Any]]:
    """Reach the independent head of every existing Gnosi-owned database."""
    root = data_dir.expanduser().resolve()
    return [
        ensure_database_schema_once(path, family, root)
        for path, family in existing_owned_databases(root)
    ]


def verify_existing_databases(data_dir: Path) -> list[dict[str, Any]]:
    """Verify every existing first-party store without changing it."""
    root = data_dir.expanduser().resolve()
    return [
        verify_database_schema(path, family, root)
        for path, family in existing_owned_databases(root)
    ]
