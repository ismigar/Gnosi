"""Explicit recovery allowlist; persisted names never select importable code."""

from contextlib import closing
from collections.abc import Callable
import hashlib
import inspect
from pathlib import Path
import sqlite3

from fastapi import HTTPException


def callbacks() -> dict[str, Callable[..., None]]:
    from backend.services.planning_scheduler import enqueue_recalculation
    return {"planning.enqueue_recalculation": enqueue_recalculation}


def callback_revision(callback: Callable[..., object]) -> str:
    from backend.services import planning_scheduler, planning_engine, project_planning, builtin_plugins
    try:
        parts = [inspect.getsource(callback).encode()]
        for module in (planning_scheduler, planning_engine, project_planning, builtin_plugins):
            source_file = inspect.getsourcefile(module)
            if source_file is None:
                raise HTTPException(503, "The planning callback revision is unavailable")
            parts.append(Path(source_file).read_bytes())
        return hashlib.sha256(b"\0".join(parts)).hexdigest()
    except (OSError, TypeError) as exc:
        raise HTTPException(503, "The planning callback revision is unavailable") from exc


class CreationCallbacks:
    def __init__(self, connect: Callable[[], sqlite3.Connection], scope: str, key: str) -> None:
        self.connect, self.scope, self.key = connect, scope, key

    def capture(self, step: str, callback: object) -> bool:
        if not callable(callback):
            return False
        kind = next((name for name, trusted in callbacks().items() if callback is trusted), None)
        if kind is None:
            return False  # Ordinary execution is allowed; automatic recovery is not.
        current = callback_revision(callback)
        with closing(self.connect()) as db, db:
            db.execute("INSERT OR IGNORE INTO creation_callbacks VALUES (?,?,?,?,?)",
                       (self.scope, self.key, step, kind, current))
            stored = db.execute("SELECT kind,revision FROM creation_callbacks WHERE scope=? AND key=? AND step=?",
                                (self.scope, self.key, step)).fetchone()
        if stored["kind"] != kind or stored["revision"] != current:
            raise HTTPException(409, "The planned creation callback changed")
        return True

    def resolve(self, step: str) -> Callable[..., None]:
        with closing(self.connect()) as db:
            row = db.execute("SELECT kind,revision FROM creation_callbacks WHERE scope=? AND key=? AND step=?",
                             (self.scope, self.key, step)).fetchone()
        if row is None:
            raise HTTPException(409, "The recorded planning callback is unavailable")
        callback = callbacks().get(row["kind"])
        if callback is None:
            raise HTTPException(409, "The recorded planning callback is unavailable")
        if callback_revision(callback) != row["revision"]:
            raise HTTPException(409, "The planning callback implementation changed")
        return callback
