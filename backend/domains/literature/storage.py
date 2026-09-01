"""Vault-native files and local SQLite storage for literature workflows."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import cast

from fastapi import HTTPException

from backend.config.app_config import load_params
from backend.services.context_vars import get_primary_vault_path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _scope(vault_path: Path | str) -> str:
    return hashlib.sha256(str(Path(vault_path).expanduser().resolve()).encode("utf-8")).hexdigest()[
        :24
    ]


def _primary_vault(vault_path: Path | str | None = None) -> Path:
    configured = (
        get_primary_vault_path() or vault_path or load_params(strict_env=False).paths["VAULT"]
    )
    return Path(cast(str | Path, configured))


def literature_dir(vault_path: Path | str | None = None) -> Path:
    root = _primary_vault(vault_path) / ".gnosi" / "literature"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _config_path(vault_path: Path | str | None = None) -> Path:
    return literature_dir(vault_path) / "repositories.json"


def _search_path(vault_path: Path | str, search_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", str(search_id)):
        raise HTTPException(status_code=400, detail="Invalid literature search identifier.")
    directory = literature_dir(vault_path) / "searches"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{search_id}.json"


def index_path(vault_path: Path | str) -> Path:
    local_data = cast(str | Path, load_params(strict_env=False).paths["LOCAL_DATA"])
    root = Path(local_data) / "literature" / _scope(_primary_vault(vault_path))
    root.mkdir(parents=True, exist_ok=True)
    return root / "academic_index.sqlite3"


def _connect_index(vault_path: Path | str) -> sqlite3.Connection:
    connection = sqlite3.connect(index_path(vault_path), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS oai_records (
            source_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            duplicate_key TEXT,
            title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            year INTEGER,
            work_json TEXT NOT NULL,
            datestamp TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(source_id, provider_id)
        );
        CREATE INDEX IF NOT EXISTS idx_oai_records_key ON oai_records(duplicate_key);
        CREATE VIRTUAL TABLE IF NOT EXISTS oai_records_fts USING fts5(
            source_id UNINDEXED,
            provider_id UNINDEXED,
            title,
            abstract,
            authors,
            tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TABLE IF NOT EXISTS oai_sync_state (
            source_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            job_id TEXT,
            resumption_token TEXT,
            last_successful_datestamp TEXT,
            received_count INTEGER NOT NULL DEFAULT 0,
            indexed_count INTEGER NOT NULL DEFAULT 0,
            deleted_count INTEGER NOT NULL DEFAULT 0,
            complete_list_size INTEGER,
            cursor_value INTEGER,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            started_at TEXT,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        );
        """
    )
    return connection
