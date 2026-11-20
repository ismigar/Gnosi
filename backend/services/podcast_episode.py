"""Local daily episode identity and dispatch state, including before a parent run exists."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path, PureWindowsPath
from typing import Any, Iterator, Literal

from backend.services import agent_execution_store as store
from backend.services.agent_execution_models import ExecutionScope
from backend.utils.metadata_io import MetadataUnavailable


@dataclass
class Episode:
    vault_path: str
    run_id: str
    period_end: str
    day: str
    source: Literal["reader", "scheduler", "control"]
    scope: dict[str, Any] | None = None
    status: str = "running"
    attempts: int = 0
    retry_failure: bool = False
    retry_at: str | None = None
    wait_reason: str | None = None
    waiting_file: str | None = None
    waiting_provider: str | None = None
    worker: dict[str, Any] = field(default_factory=dict)

    def due(self, now: datetime) -> bool:
        if self.status not in {"running", "waiting"} or self.worker and store._worker_alive(self.worker):
            return False
        return self.retry_at is None or datetime.fromisoformat(self.retry_at) <= now

    def public_status(self) -> dict[str, str | None]:
        return {key: getattr(self, key) for key in (
            "status", "waiting_file", "waiting_provider", "wait_reason", "retry_at",
        )}


class EpisodeBusy(RuntimeError):
    """Another authorized worker holds the shared output or private occurrence."""


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    with store.connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS podcast_occurrences
            (vault_path TEXT PRIMARY KEY, payload TEXT NOT NULL)""")
        yield db


def _read(db: sqlite3.Connection, vault_path: str) -> Episode | None:
    row = db.execute("SELECT payload FROM podcast_occurrences WHERE vault_path=?", (vault_path,)).fetchone()
    return Episode(**json.loads(row[0])) if row else None


def current(vault_path: str | Path) -> Episode | None:
    with _connection() as db:
        return _read(db, str(Path(vault_path).resolve()))


def _write(db: sqlite3.Connection, episode: Episode) -> None:
    db.execute("INSERT OR REPLACE INTO podcast_occurrences VALUES (?,?)",
               (episode.vault_path, json.dumps(asdict(episode))))


def _legacy_run(db: sqlite3.Connection, vault: str, started_at: datetime) -> Episode | None:
    """Recover the old scheduler's running occurrence without adopting arbitrary past errors."""
    row = db.execute("""SELECT * FROM agent_runs WHERE vault_path=?
        AND json_extract(request,'$.mode')='job' AND json_extract(request,'$.operation')='podcast'
        AND json_extract(payload,'$.origin')='automation'
        AND json_extract(payload,'$.created_at')>=? ORDER BY rowid LIMIT 1""",
        (vault, started_at.timestamp() - 1)).fetchone()
    if row is None:
        return None
    payload = json.loads(row["payload"])
    if row["cancelled"] or payload["status"] in {"failed", "cancelled"}:
        status = "error"
    elif payload["status"] == "completed":
        status = "success"
    else:
        status = "running"
    scope = store._saved_snapshot(db, row)["scope"]
    end = datetime.fromtimestamp(payload["created_at"], timezone.utc)
    return Episode(vault, row["run_id"], end.isoformat(), end.astimezone().date().isoformat(),
                   "scheduler", scope, status=status)


def claim(vault_path: str | Path, *, source: Literal["reader", "scheduler", "control"],
          scope: ExecutionScope | None = None, legacy_started_at: str | None = None,
          now: datetime | None = None, retry_terminal: bool = False,
          recover_only: str | None = None) -> Episode:
    """Serialize Reader, clock and Run now, including cloud-blocked setup before creating a job."""
    vault = str(Path(vault_path).resolve())
    instant = now or datetime.now(timezone.utc)
    day = instant.astimezone().date().isoformat()
    with _connection() as db:
        db.execute("BEGIN IMMEDIATE")
        episode = _read(db, vault)
        if recover_only and (episode is None or episode.run_id != recover_only
                             or not episode.due(instant)):
            raise EpisodeBusy()
        if episode is None and legacy_started_at:
            instant = datetime.fromisoformat(legacy_started_at).astimezone(timezone.utc)
            day = instant.astimezone().date().isoformat()
            episode = _legacy_run(db, vault, instant)
            if episode:
                _write(db, episode)
        if episode and episode.status not in {"running", "waiting"} and episode.day != day:
            episode = None
        if episode and retry_terminal and (scope is None or episode.scope == scope.model_dump()):
            # Legacy parents without frozen procedures cannot resume. On an explicit
            # retry a stopped one can release its slot for a new manual generation.
            row = db.execute("SELECT request, payload FROM agent_runs WHERE run_id=?", (episode.run_id,)).fetchone()
            if row and not json.loads(row["payload"]).get("resumable") and (
                episode.status == "error" or not store._worker_alive(json.loads(row["request"]))
            ):
                episode = None
        if episode is None:
            episode = Episode(vault, uuid.uuid4().hex, instant.isoformat(), day, source,
                              scope.model_dump() if scope else None)
        if scope and episode.scope != scope.model_dump():
            raise EpisodeBusy()
        if episode.status == "success" or (episode.status == "error" and not retry_terminal):
            return episode
        if episode.worker and store._worker_alive(episode.worker):
            raise EpisodeBusy()
        if source == "control" and episode.source == "scheduler":
            episode.source = "control"
        episode.worker = {"_worker_pid": os.getpid(), "_worker_instance": store._WORKER_INSTANCE,
                          "claim": uuid.uuid4().hex}
        episode.retry_failure = episode.status == "error" and retry_terminal
        episode.status = "running"
        episode.retry_at = None
        _write(db, episode)
        return episode


def _update(episode: Episode, **changes: Any) -> None:
    with _connection() as db:
        db.execute("BEGIN IMMEDIATE")
        saved = _read(db, episode.vault_path)
        if saved is None or saved.run_id != episode.run_id or saved.worker != episode.worker:
            raise EpisodeBusy()
        for name, value in changes.items():
            setattr(episode, name, value)
        _write(db, episode)


def bind(episode: Episode, scope: ExecutionScope) -> None:
    if str(Path(scope.vault_path).resolve()) != episode.vault_path or (
        episode.scope is not None and episode.scope != scope.model_dump()
    ):
        raise PermissionError("podcast_resume_scope_mismatch")
    if episode.scope is None:
        _update(episode, scope=scope.model_dump())


def finish(episode: Episode, status: str) -> None:
    _update(episode, status=status, worker={}, waiting_file=None, waiting_provider=None,
            wait_reason=None, retry_at=None)


def _provider(path: Path) -> str | None:
    for part in path.parts:
        value = part.casefold()
        if value == "onedrive" or value.startswith(("onedrive-", "onedrive - ")):
            return "OneDrive"
        if value == "dropbox" or value.startswith(("dropbox-", "dropbox (")):
            return "Dropbox"
        if value == "com~apple~clouddocs" or value == "icloud drive":
            return "iCloud Drive"
        if value == "google drive" or value.startswith("googledrive-"):
            return "Google Drive"
        if value == "nextcloud" or value.startswith("nextcloud-"):
            return "Nextcloud"
    return None


def cloud_failure(episode: Episode, error: MetadataUnavailable) -> None:
    reason = error.reason
    path = error.path
    filename = "".join(c for c in PureWindowsPath(path.name).name if c.isprintable())[:120] if path else None
    retryable = error.retryable
    delay = timedelta(minutes=min(2 ** min(episode.attempts, 4), 15))
    retry = (datetime.now(timezone.utc) + delay).isoformat() if retryable else None
    _update(episode, status="waiting" if retryable else "error", attempts=episode.attempts + 1,
            wait_reason=reason, waiting_file=filename or None, waiting_provider=_provider(path) if path else None,
            retry_at=retry, worker={})


def recoverable_reader_episodes(now: datetime) -> list[Episode]:
    """Only explicitly started Reader work can run outside the configured personal schedule."""
    with _connection() as db:
        rows = db.execute("""SELECT payload FROM podcast_occurrences
            WHERE json_extract(payload, '$.source')='reader'
            AND json_extract(payload, '$.status') IN ('waiting','running')""")
        episodes = (Episode(**json.loads(row[0])) for row in rows)
        return [episode for episode in episodes if episode.scope and episode.due(now)]
