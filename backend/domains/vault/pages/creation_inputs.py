"""Typed replay data; never deserialize code or silently accept stale documents."""

from contextlib import closing
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal, DecimalException
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import uuid

from fastapi import HTTPException


def pack(value: object) -> list[object]:
    if value is None or isinstance(value, (str, bool, int)):
        return ["scalar", value]
    if isinstance(value, float) and math.isfinite(value):
        return ["scalar", value]
    if isinstance(value, datetime):
        return ["datetime", value.isoformat()]
    if isinstance(value, date):
        return ["date", value.isoformat()]
    if isinstance(value, Decimal) and value.is_finite():
        return ["decimal", str(value)]
    if isinstance(value, Path):
        return ["path", str(value)]
    if isinstance(value, uuid.UUID):
        return ["uuid", str(value)]
    if isinstance(value, dict):
        return ["dict", [[pack(key), pack(item)] for key, item in value.items()]]
    if isinstance(value, (list, tuple, set, frozenset)):
        items = [pack(item) for item in value]
        if isinstance(value, (set, frozenset)):
            items.sort(key=lambda item: json.dumps(item, ensure_ascii=False, allow_nan=False))
        return [type(value).__name__, items]
    raise TypeError("Unsupported creation replay value")


def _unpack_mapping(data: list[object]) -> dict[object, object]:
    result: dict[object, object] = {}
    for pair in data:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError("Invalid creation replay mapping")
        key, item = pair
        decoded_key = unpack(key)
        if decoded_key in result:
            raise ValueError("Duplicate creation replay mapping key")
        result[decoded_key] = unpack(item)
    return result


def _unpack_sequence(tag: str, data: list[object]) -> object:
    items = [unpack(item) for item in data]
    if tag == "list": return items
    if tag == "tuple": return tuple(items)
    if tag == "set": return set(items)
    return frozenset(items)


def unpack(value: object) -> object:
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], str):
        raise ValueError("Invalid creation replay envelope")
    tag, data = value
    if tag == "scalar":
        if data is None or isinstance(data, (str, bool, int)) or (isinstance(data, float) and math.isfinite(data)):
            return data
    elif tag == "datetime" and isinstance(data, str): return datetime.fromisoformat(data)
    elif tag == "date" and isinstance(data, str): return date.fromisoformat(data)
    elif tag == "decimal" and isinstance(data, str):
        parsed = Decimal(data)
        if parsed.is_finite(): return parsed
    elif tag == "path" and isinstance(data, str): return Path(data)
    elif tag == "uuid" and isinstance(data, str): return uuid.UUID(data)
    elif tag == "dict" and isinstance(data, list):
        return _unpack_mapping(data)
    elif tag in {"list", "tuple", "set", "frozenset"} and isinstance(data, list):
        return _unpack_sequence(tag, data)
    raise ValueError("Invalid creation replay data")


def validate_paths(value: object, vault_path: Path) -> None:
    """Check typed filesystem arguments, including keys and nested containers."""
    if isinstance(value, Path):
        if not value.is_absolute() or not value.resolve().is_relative_to(vault_path):
            raise HTTPException(403, "Creation replay argument is outside the selected vault")
    elif isinstance(value, dict):
        for key, item in value.items():
            validate_paths(key, vault_path)
            validate_paths(item, vault_path)
    elif isinstance(value, (list, tuple, set, frozenset)):
        for item in value:
            validate_paths(item, vault_path)


def revision(path: Path | None) -> str:
    if path is None:
        return "no_document"
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError:
        return "missing"


def context_revisions(vault_path: Path) -> str:
    """Read only the canonical local configuration and registry, without caches."""
    vault = vault_path.resolve()
    files = (".gnosi/params.yaml", ".gnosi/plugins.json", "BD/vault_db_registry.json")
    values = {}
    for relative in files:
        path = (vault / relative).resolve()
        if not path.is_relative_to(vault):
            raise HTTPException(403, "Creation recovery configuration is outside the selected vault")
        try:
            values[relative] = revision(path)
        except OSError as exc:
            raise HTTPException(503, "Creation recovery configuration is unavailable") from exc
    return json.dumps(values, sort_keys=True)


class CreationInputs:
    def __init__(self, connect: Callable[[], sqlite3.Connection], scope: str, key: str) -> None:
        self.connect, self.scope, self.key = connect, scope, key

    def capture_context(self, vault_path: Path) -> None:
        current = context_revisions(vault_path)
        with closing(self.connect()) as db, db:
            db.execute("INSERT OR IGNORE INTO creation_context VALUES (?,?,?)", (self.scope, self.key, current))
            stored = db.execute("SELECT revisions FROM creation_context WHERE scope=? AND key=?", (self.scope, self.key)).fetchone()
        if stored["revisions"] != current:
            raise HTTPException(409, "Creation recovery configuration changed after being planned")

    def validate_context(self, vault_path: Path) -> None:
        with closing(self.connect()) as db:
            stored = db.execute("SELECT revisions FROM creation_context WHERE scope=? AND key=?", (self.scope, self.key)).fetchone()
        if stored is None:
            raise HTTPException(409, "Creation request has no saved recovery configuration")
        if stored["revisions"] != context_revisions(vault_path):
            raise HTTPException(409, "Creation recovery configuration changed after being planned")

    def capture(self, step: str, args: tuple[object, ...], kwargs: dict[str, object]) -> None:
        with closing(self.connect()) as db:
            row = db.execute("SELECT state FROM creation_steps WHERE scope=? AND key=? AND step=?", (self.scope, self.key, step)).fetchone()
            existing = db.execute("SELECT payload FROM creation_step_inputs WHERE scope=? AND key=? AND step=?", (self.scope, self.key, step)).fetchone()
            request = db.execute("SELECT file_path FROM creation_requests WHERE scope=? AND key=?", (self.scope, self.key)).fetchone()
        if row is None or request is None:
            raise HTTPException(404, "Creation step not found")
        if row["state"] != "pending":
            return
        payload = json.dumps(pack((args, kwargs)), ensure_ascii=False, allow_nan=False)
        if existing:
            if existing["payload"] != payload:
                raise HTTPException(409, "Creation step inputs changed after being planned")
            return
        path: Path | None
        if step == "save":
            if not args or not isinstance(args[0], (str, Path)):
                raise HTTPException(409, "Invalid creation save target")
            path = Path(args[0]).resolve()
        else:
            path = Path(request["file_path"]).resolve() if request["file_path"] else None
        current = revision(path)
        with closing(self.connect()) as db, db:
            db.execute("""INSERT OR IGNORE INTO creation_step_inputs (scope,key,step,payload,source_path,revision)
                SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM creation_steps WHERE scope=? AND key=? AND step=? AND state='pending')""",
                (self.scope, self.key, step, payload, str(path) if path else None, current, self.scope, self.key, step))
            frozen = db.execute("SELECT payload FROM creation_step_inputs WHERE scope=? AND key=? AND step=?", (self.scope, self.key, step)).fetchone()
            if frozen is None or frozen["payload"] != payload:
                raise HTTPException(409, "Creation step inputs changed after being planned")

    def load_pending(self, step: str, vault_path: Path) -> tuple[tuple[object, ...], dict[str, object]]:
        return self._load(step, vault_path, "pending")

    def load_for_verification(self, step: str, vault_path: Path) -> tuple[tuple[object, ...], dict[str, object]]:
        return self._load(step, vault_path, "started")

    def _load(self, step: str, vault_path: Path, expected_state: str) -> tuple[tuple[object, ...], dict[str, object]]:
        with closing(self.connect()) as db:
            row = db.execute("""SELECT i.*, s.state FROM creation_step_inputs i JOIN creation_steps s
                ON i.scope=s.scope AND i.key=s.key AND i.step=s.step WHERE i.scope=? AND i.key=? AND i.step=?""",
                (self.scope, self.key, step)).fetchone()
        if row is None:
            raise HTTPException(409, "Creation step has no saved replay inputs")
        if row["state"] != expected_state:
            raise HTTPException(409, "Only an unstarted creation step can be prepared for replay")
        self.validate_context(vault_path)
        path = Path(row["source_path"]).resolve() if row["source_path"] else None
        if path is not None and not path.is_relative_to(vault_path.resolve()):
            raise HTTPException(403, "Creation replay document is outside the selected vault")
        if revision(path) != row["revision"]:
            raise HTTPException(409, "Creation document changed after this step was planned")
        try:
            decoded = unpack(json.loads(row["payload"]))
            if not isinstance(decoded, tuple) or len(decoded) != 2:
                raise ValueError("Invalid argument envelope")
            args, kwargs = decoded
            if not isinstance(args, tuple) or not isinstance(kwargs, dict):
                raise ValueError("Invalid argument container")
            keywords: dict[str, object] = {}
            for key, value in kwargs.items():
                if not isinstance(key, str):
                    raise ValueError("Invalid keyword name")
                keywords[key] = value
            validate_paths((args, kwargs), vault_path.resolve())
            return args, keywords
        except (ValueError, TypeError, KeyError, OverflowError, DecimalException, RecursionError) as exc:
            raise HTTPException(409, "Invalid saved creation replay inputs") from exc
