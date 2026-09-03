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
    path = index_path(vault_path)
    from backend.migrations.runner import ensure_database_schema_once

    local_data = cast(str | Path, load_params(strict_env=False).paths["LOCAL_DATA"])
    ensure_database_schema_once(path, "literature_index", Path(local_data))
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection
