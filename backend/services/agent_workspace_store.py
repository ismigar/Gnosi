"""Durable, principal-scoped workbench state. No vault content is executed on the host."""
from __future__ import annotations

from typing import Any, cast

from contextlib import closing
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid

from fastapi import HTTPException

from backend.config.data_dir import resolve_data_dir


@dataclass(frozen=True)
class WorkbenchScope:
    workspace_id: str
    user_id: str
    vault_path: str
    agent_id: str
    session_id: str

    @property
    def key(self) -> str:
        return hashlib.sha256(json.dumps(list(self.__dict__.values())).encode()).hexdigest()


class WorkbenchStore:
    def __init__(self, path: Path | None = None):
        self.path = path or resolve_data_dir(create=True) / 'system' / 'agent_workspace.sqlite'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS workbench (scope TEXT, kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(scope,kind,id))')
        self.path.chmod(0o600)

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def create(self, scope: WorkbenchScope, kind: str, value: dict[str, Any], identity: str | None = None) -> dict[str, Any]:
        identity = identity or uuid.uuid4().hex
        value = dict(value, id=identity)
        with closing(self.connect()) as db, db:
            db.execute('INSERT INTO workbench VALUES (?,?,?,?)', (scope.key, kind, identity, json.dumps(value)))
        return value

    def get(self, scope: WorkbenchScope, kind: str, identity: str) -> dict[str, Any]:
        with closing(self.connect()) as db:
            row = db.execute('SELECT value FROM workbench WHERE scope=? AND kind=? AND id=?', (scope.key, kind, identity)).fetchone()
        if row is None:
            raise HTTPException(404, 'Workbench item not found')
        return cast(dict[str, Any], json.loads(row[0]))

    def list(self, scope: WorkbenchScope, kind: str) -> list[dict[str, Any]]:
        with closing(self.connect()) as db:
            return [json.loads(row[0]) for row in db.execute('SELECT value FROM workbench WHERE scope=? AND kind=? ORDER BY id LIMIT 500', (scope.key, kind))]

    def update(self, scope: WorkbenchScope, kind: str, identity: str, value: dict[str, Any]) -> dict[str, Any]:
        value = dict(value, id=identity)
        with closing(self.connect()) as db, db:
            changed = db.execute('UPDATE workbench SET value=? WHERE scope=? AND kind=? AND id=?', (json.dumps(value), scope.key, kind, identity)).rowcount
        if not changed:
            raise HTTPException(404, 'Workbench item not found')
        return value

    def claim(self, scope: WorkbenchScope, kind: str, key: str, fingerprint: str) -> tuple[bool, dict[str, Any]]:
        """Persist intent before an external effect. An uncertain receipt never repeats it."""
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT value FROM workbench WHERE scope=? AND kind=? AND id=?', (scope.key, kind, key)).fetchone()
            if row:
                value = json.loads(row[0])
                if value['fingerprint'] != fingerprint:
                    raise HTTPException(409, 'Request identity was already used for different content')
                return False, value
            value = dict(id=key, fingerprint=fingerprint, status='unknown')
            db.execute('INSERT INTO workbench VALUES (?,?,?,?)', (scope.key, kind, key, json.dumps(value)))
            return True, value
