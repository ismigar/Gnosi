"""Reviewable Vault-scoped vocabulary associations for agent retrieval."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Iterable

from backend.config.app_config import load_params


MAX_ASSOCIATIONS_PER_VAULT = 500
MAX_TERMS_PER_ASSOCIATION = 24
_LOCK = threading.RLock()
_SCHEMA_READY: set[str] = set()


def _database_path() -> Path:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_semantic_memory.sqlite"


def _connect() -> sqlite3.Connection:
    path = _database_path()
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    key = str(path)
    with _LOCK:
        if key not in _SCHEMA_READY:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS semantic_associations (
                    id TEXT PRIMARY KEY,
                    vault_scope TEXT NOT NULL,
                    trigger_term TEXT NOT NULL,
                    related_term TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    UNIQUE(vault_scope, trigger_term, related_term)
                );
                CREATE INDEX IF NOT EXISTS idx_semantic_associations_scope
                ON semantic_associations(vault_scope, trigger_term, updated_at DESC);
                """
            )
            connection.commit()
            _SCHEMA_READY.add(key)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return connection


def normalize_term(value: Any) -> str:
    """Return a bounded, accent-insensitive non-executable vocabulary term."""
    decomposed = unicodedata.normalize("NFKD", str(value or "").casefold())
    plain = "".join(character for character in decomposed if not unicodedata.combining(character))
    return " ".join(re.findall(r"[a-z0-9]+", plain))[:96]


def vault_scope(vault_path: Any) -> str:
    """Hash an absolute Vault path so the database never stores local paths."""
    try:
        canonical = str(Path(vault_path).resolve())
    except (OSError, TypeError, ValueError):
        canonical = str(vault_path or "")
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def add_association(
    vault_path: Any,
    trigger: Any,
    related_terms: Iterable[Any],
    *,
    created_by: str,
) -> list[dict[str, Any]]:
    """Upsert bounded explicit term mappings and return the resulting rows."""
    scope = vault_scope(vault_path)
    trigger_term = normalize_term(trigger)
    related = list(dict.fromkeys(
        normalize_term(value) for value in related_terms if normalize_term(value)
    ))[:MAX_TERMS_PER_ASSOCIATION]
    related = [value for value in related if value != trigger_term]
    if not trigger_term or not related:
        raise ValueError("A trigger and at least one distinct related term are required.")
    now = time.time()
    author_hash = hashlib.sha256(
        f"{scope}:{created_by}".encode("utf-8")
    ).hexdigest()[:20]
    with _LOCK, _connect() as connection:
        for related_term in related:
            association_id = f"assoc-{uuid.uuid5(uuid.NAMESPACE_URL, f'{scope}:{trigger_term}:{related_term}').hex}"
            connection.execute(
                """
                INSERT INTO semantic_associations (
                    id, vault_scope, trigger_term, related_term,
                    created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(vault_scope, trigger_term, related_term) DO UPDATE SET
                    created_by = excluded.created_by,
                    updated_at = excluded.updated_at
                """,
                (
                    association_id, scope, trigger_term, related_term,
                    author_hash, now, now,
                ),
            )
        connection.execute(
            """
            DELETE FROM semantic_associations WHERE id IN (
                SELECT id FROM semantic_associations
                WHERE vault_scope = ? ORDER BY updated_at DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (scope, MAX_ASSOCIATIONS_PER_VAULT),
        )
    return list_associations(vault_path, trigger=trigger_term)


def list_associations(
    vault_path: Any,
    *,
    trigger: str = "",
    limit: int = 200,
) -> list[dict[str, Any]]:
    """List reviewable mappings without exposing user identities or paths."""
    scope = vault_scope(vault_path)
    normalized_trigger = normalize_term(trigger)
    clause = "AND trigger_term = ?" if normalized_trigger else ""
    params: list[Any] = [scope]
    if normalized_trigger:
        params.append(normalized_trigger)
    params.append(max(1, min(int(limit), 500)))
    with _LOCK, _connect() as connection:
        rows = connection.execute(
            f"""
            SELECT id, trigger_term, related_term, created_at, updated_at
            FROM semantic_associations
            WHERE vault_scope = ? {clause}
            ORDER BY trigger_term, related_term LIMIT ?
            """,
            params,
        ).fetchall()
    return [dict(row) for row in rows]


def delete_association(vault_path: Any, association_id: str) -> bool:
    """Delete one exact mapping inside the active Vault scope."""
    scope = vault_scope(vault_path)
    with _LOCK, _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM semantic_associations WHERE id = ? AND vault_scope = ?",
            (str(association_id or "")[:80], scope),
        )
        return cursor.rowcount > 0


def expand_terms(vault_path: Any, terms: Iterable[Any]) -> list[str]:
    """Return bounded learned terms for exact normalized query tokens."""
    scope = vault_scope(vault_path)
    normalized = list(dict.fromkeys(
        normalize_term(term) for term in terms if normalize_term(term)
    ))[:32]
    if not normalized:
        return []
    placeholders = ",".join("?" for _ in normalized)
    with _LOCK, _connect() as connection:
        rows = connection.execute(
            f"""
            SELECT related_term FROM semantic_associations
            WHERE vault_scope = ? AND trigger_term IN ({placeholders})
            ORDER BY updated_at DESC LIMIT ?
            """,
            [scope, *normalized, MAX_TERMS_PER_ASSOCIATION],
        ).fetchall()
    return list(dict.fromkeys(str(row["related_term"]) for row in rows))
