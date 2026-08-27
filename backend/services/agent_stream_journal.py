"""Short-lived encrypted replay journal for accepted agent streams."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Mapping

from cryptography.fernet import Fernet, InvalidToken

from backend.config.app_config import load_params


RETENTION_SECONDS = 3_600
MAX_EVENTS_PER_STREAM = 2_000
_LOCK = threading.RLock()


def scope_digest(scope: Mapping[str, Any]) -> str:
    values = [str(scope.get(key) or "") for key in ("workspace_id", "user_id", "agent_id", "session_id")]
    return hashlib.sha256("\0".join(values).encode("utf-8")).hexdigest()


def _paths() -> tuple[Path, Path]:
    cfg = load_params(strict_env=False)
    local = Path(cfg.paths["LOCAL_DATA"])
    secrets = Path(cfg.paths.get("SECRETS") or (local / "secrets"))
    local.mkdir(parents=True, exist_ok=True)
    secrets.mkdir(parents=True, exist_ok=True)
    return local / "agent_stream_journal.sqlite", secrets / "agent_stream_journal.key"


def _fernet() -> Fernet:
    _db, key_path = _paths()
    with _LOCK:
        if not key_path.exists():
            try:
                with key_path.open("xb") as handle:
                    handle.write(Fernet.generate_key())
            except FileExistsError:
                pass
            try:
                os.chmod(key_path, 0o600)
            except OSError:
                pass
        return Fernet(key_path.read_bytes().strip())


def _connect() -> sqlite3.Connection:
    db_path, _key = _paths()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(
        db_path,
        "stream_journal",
        data_dir_for_database(db_path),
    )
    connection = sqlite3.connect(db_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def append(stream_id: str, scope_hash: str, sequence: int, encoded_event: str) -> None:
    encrypted = _fernet().encrypt(str(encoded_event).encode("utf-8"))
    with _LOCK, _connect() as connection:
        connection.execute(
            "DELETE FROM stream_events WHERE created_at<?",
            (time.time() - RETENTION_SECONDS,),
        )
        count = connection.execute(
            "SELECT COUNT(*) FROM stream_events WHERE stream_id=?", (str(stream_id),)
        ).fetchone()[0]
        if count >= MAX_EVENTS_PER_STREAM:
            raise ValueError("Agent stream event limit reached.")
        connection.execute(
            "INSERT OR IGNORE INTO stream_events VALUES (?, ?, ?, ?, ?)",
            (str(stream_id)[:128], str(scope_hash), int(sequence), encrypted, time.time()),
        )


def replay(stream_id: str, scope_hash: str, after_sequence: int = 0) -> list[str]:
    cleanup()
    with _connect() as connection:
        rows = connection.execute(
            """SELECT payload FROM stream_events
            WHERE stream_id=? AND scope_hash=? AND sequence>?
            ORDER BY sequence ASC LIMIT ?""",
            (str(stream_id), str(scope_hash), max(0, int(after_sequence)), MAX_EVENTS_PER_STREAM),
        ).fetchall()
    cipher = _fernet()
    events = []
    for row in rows:
        try:
            events.append(cipher.decrypt(row["payload"]).decode("utf-8"))
        except (InvalidToken, UnicodeDecodeError):
            continue
    return events


def cleanup() -> int:
    with _LOCK, _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM stream_events WHERE created_at<?",
            (time.time() - RETENTION_SECONDS,),
        )
    return cursor.rowcount
