"""Local durable receipts for page creation, independent of cloud storage.

An uncertain operation is never run a second time. A cancelled HTTP waiter does
not cancel the worker that writes the page and commits its receipt.
"""

from __future__ import annotations

import asyncio
from contextlib import closing
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

from fastapi import BackgroundTasks, HTTPException
from fastapi.encoders import jsonable_encoder

from backend.config.data_dir import resolve_data_dir
from backend.domains.vault.pages.create_service import CreatePageDependencies, _create_page_sync
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.domains.vault.pages.creation_steps import CreationSteps, OperationTasks, PlanningTasks
from backend.domains.vault.pages.creation_inputs import CreationInputs
from backend.domains.vault.registry.state import RegistryData


def validate_key(key: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", key):
        raise HTTPException(422, "Invalid creation request key")


def creation_scope(user_id: str, workspace_id: str, vault_path: Path) -> str:
    raw = json.dumps([user_id, workspace_id, str(vault_path.resolve())], ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


class CreationRequests:
    def __init__(self, path: Path | None = None):
        self.path = path or resolve_data_dir(create=True) / "system" / "page_creation_requests.sqlite"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as db, db:
            db.execute("""CREATE TABLE IF NOT EXISTS creation_requests (
                scope TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL,
                page_id TEXT NOT NULL, status TEXT NOT NULL, owner_pid INTEGER NOT NULL,
                created_at REAL NOT NULL, file_path TEXT, result TEXT,
                PRIMARY KEY(scope, key))""")
            db.execute("""CREATE TABLE IF NOT EXISTS creation_steps (
                scope TEXT NOT NULL, key TEXT NOT NULL, step TEXT NOT NULL,
                state TEXT NOT NULL, position INTEGER NOT NULL,
                PRIMARY KEY(scope, key, step),
                FOREIGN KEY(scope, key) REFERENCES creation_requests(scope, key))""")
            db.execute("""CREATE TABLE IF NOT EXISTS creation_step_inputs (
                scope TEXT NOT NULL, key TEXT NOT NULL, step TEXT NOT NULL, payload TEXT NOT NULL,
                source_path TEXT, revision TEXT NOT NULL, PRIMARY KEY(scope,key,step),
                FOREIGN KEY(scope,key,step) REFERENCES creation_steps(scope,key,step))""")
            db.execute("""CREATE TABLE IF NOT EXISTS creation_context (
                scope TEXT NOT NULL, key TEXT NOT NULL, revisions TEXT NOT NULL,
                PRIMARY KEY(scope,key),
                FOREIGN KEY(scope,key) REFERENCES creation_requests(scope,key))""")
            db.execute("""CREATE TABLE IF NOT EXISTS creation_payloads (
                scope TEXT NOT NULL, key TEXT NOT NULL, request TEXT NOT NULL,
                PRIMARY KEY(scope,key),
                FOREIGN KEY(scope,key) REFERENCES creation_requests(scope,key))""")
            db.execute("""CREATE TABLE IF NOT EXISTS creation_callbacks (
                scope TEXT NOT NULL, key TEXT NOT NULL, step TEXT NOT NULL, kind TEXT NOT NULL, revision TEXT NOT NULL,
                PRIMARY KEY(scope,key,step),
                FOREIGN KEY(scope,key,step) REFERENCES creation_steps(scope,key,step))""")
            db.execute("""CREATE TABLE IF NOT EXISTS creation_reconciliations (
                scope TEXT NOT NULL, key TEXT NOT NULL, step TEXT NOT NULL, proof TEXT NOT NULL,
                PRIMARY KEY(scope,key,step),
                FOREIGN KEY(scope,key,step) REFERENCES creation_steps(scope,key,step))""")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def claim(self, scope: str, key: str, request: PageSaveRequest) -> tuple[str, dict[str, object] | None]:
        validate_key(key)
        try:
            raw = json.dumps(request.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, allow_nan=False)
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "Invalid creation request data") from exc
        fingerprint = hashlib.sha256(raw.encode()).hexdigest()
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM creation_requests WHERE scope=? AND key=?", (scope, key)).fetchone()
            if existing:
                if existing["fingerprint"] != fingerprint:
                    raise HTTPException(409, "Creation request key already belongs to different data")
                if existing["status"] == "completed":
                    return existing["page_id"], json.loads(existing["result"])
                raise HTTPException(409, {
                    "message": "Creation already started; check its status before creating another page",
                    "page_id": existing["page_id"], "status": self._status(existing),
                })
            page_id = str(uuid.uuid4())
            db.execute("INSERT INTO creation_requests VALUES (?,?,?,?,?,?,?,?,?)", (
                scope, key, fingerprint, page_id, "pending", os.getpid(), time.time(), None, None,
            ))
            db.execute("INSERT INTO creation_payloads VALUES (?,?,?)", (scope, key, raw))
            return page_id, None

    def claim_recovery(self, scope: str, key: str, *, allow_uncertain_index: bool = False) -> tuple[dict[str, object], PageSaveRequest | None, dict[str, object] | None]:
        """Transfer a terminated creator's work atomically, never a live worker's."""
        validate_key(key)
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM creation_requests WHERE scope=? AND key=?", (scope, key)).fetchone()
            if row is None:
                raise HTTPException(404, "Creation request not found")
            if row["status"] == "completed":
                return dict(row), None, json.loads(row["result"])
            if row["status"] not in {"pending", "unknown"}:
                raise HTTPException(409, "Invalid creation recovery state")
            if row["status"] == "pending":
                try:
                    os.kill(row["owner_pid"], 0)
                except ProcessLookupError:
                    pass
                except PermissionError as exc:
                    raise HTTPException(409, "The creation worker cannot be verified as stopped") from exc
                else:
                    raise HTTPException(409, "The creation worker is still running")
            steps = db.execute("SELECT step,state FROM creation_steps WHERE scope=? AND key=?", (scope, key)).fetchall()
            if any(item["state"] not in {"pending", "started", "completed"} for item in steps):
                raise HTTPException(409, "Invalid saved creation checkpoint")
            if not any(item["step"] == "save" and item["state"] == "completed" for item in steps):
                raise HTTPException(409, "Page storage has not been confirmed")
            if any(item["state"] == "started" and not (allow_uncertain_index and item["step"] == "index") for item in steps):
                raise HTTPException(409, "An uncertain creation step must be reconciled before continuing")
            payload = db.execute("SELECT request FROM creation_payloads WHERE scope=? AND key=?", (scope, key)).fetchone()
            if payload is None:
                raise HTTPException(409, "This creation has no saved recovery request")
            if not isinstance(payload["request"], str) or hashlib.sha256(payload["request"].encode()).hexdigest() != row["fingerprint"]:
                raise HTTPException(409, "The saved creation request changed")
            try:
                request = PageSaveRequest.model_validate_json(payload["request"])
            except ValueError as exc:
                raise HTTPException(409, "Invalid saved creation request") from exc
            db.execute("UPDATE creation_requests SET status='pending',owner_pid=?,created_at=? WHERE scope=? AND key=?",
                       (os.getpid(), time.time(), scope, key))
            return dict(row), request, None

    @staticmethod
    def _status(row: sqlite3.Row) -> str:
        if row["status"] != "pending":
            status: object = row["status"]
            if not isinstance(status, str):
                raise HTTPException(409, "Invalid saved creation state")
            return status
        try:
            os.kill(row["owner_pid"], 0)
        except ProcessLookupError:
            return "unknown"
        except PermissionError:
            pass
        # Expiry only changes the reported uncertainty; it never permits a retry.
        return "pending" if time.time() - row["created_at"] < 300 else "unknown"

    def status(
        self, scope: str, key: str, *, vault_path: Path | None = None,
        dependencies: CreatePageDependencies | None = None,
    ) -> dict[str, object]:
        validate_key(key)
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM creation_requests WHERE scope=? AND key=?", (scope, key)).fetchone()
            steps = db.execute("SELECT step, state FROM creation_steps WHERE scope=? AND key=? ORDER BY position", (scope, key)).fetchall()
            payload = db.execute("SELECT request FROM creation_payloads WHERE scope=? AND key=?", (scope, key)).fetchone()
        if row is None:
            raise HTTPException(404, "Creation request not found")
        status = self._status(row)
        available = False
        if status == "unknown" and vault_path is not None and dependencies is not None:
            available = self._saved_page_exists(row, vault_path, dependencies)
        stopped = row["status"] == "unknown"
        if status == "unknown" and not stopped:
            try:
                os.kill(row["owner_pid"], 0)
            except ProcessLookupError:
                stopped = True
            except PermissionError:
                pass
        allowed = {"index", "page_cache", "sidebar_index", "formulas", "links", "relations", "event_dispatch", "planning_queue"}
        from backend.domains.vault.pages.creation_callbacks import CreationCallbacks
        callbacks = CreationCallbacks(self._connect, scope, key)
        for item in steps:
            if item["state"] == "pending" and item["step"].startswith("planning:"):
                try:
                    callbacks.resolve(item["step"])
                except HTTPException:
                    continue
                allowed.add(item["step"])
        index_verified = False
        if (available and vault_path is not None and dependencies is not None and dependencies.verify_index_created is not None
                and any(item["step"] == "index" and item["state"] == "started" for item in steps)):
            try:
                args, kwargs = CreationInputs(self._connect, scope, key).load_for_verification("index", vault_path)
                expected = Path(row["file_path"]).resolve()
                index_verified = (len(args) == 2 and args[0] == row["page_id"] and isinstance(args[1], Path)
                                  and args[1].resolve() == expected and not kwargs
                                  and dependencies.verify_index_created(row["page_id"], expected) is True)
            except (HTTPException, OSError, ValueError, TypeError):
                pass
        can_resume = bool(status == "unknown" and stopped and available and payload
                          and any(item["step"] == "save" and item["state"] == "completed" for item in steps)
                          and all(item["state"] == "completed" or (item["state"] == "pending" and item["step"] in allowed)
                                  or (item["state"] == "started" and item["step"] == "index" and index_verified) for item in steps))
        checkpoints = [{"step": step["step"], "state":
                        ("running" if status == "pending" else "uncertain") if step["state"] == "started" else step["state"]}
                       for step in steps]
        return {"status": status, "page_id": row["page_id"], "page_available": available, "can_resume": can_resume, "steps": checkpoints,
                "result": json.loads(row["result"]) if row["result"] else None}

    @staticmethod
    def _saved_page_exists(row: sqlite3.Row, vault_path: Path, dependencies: CreatePageDependencies) -> bool:
        # Probe only the recorded file, never hydrate every cloud neighbor. Its
        # presence proves storage, not successful formulas, relations or events.
        if not row["file_path"]:
            return False
        try:
            path = Path(row["file_path"]).resolve()
            if not path.is_relative_to(vault_path.resolve()) or path.suffix != ".md":
                return False
            metadata, _ = dependencies.parse_frontmatter(path.read_text(encoding="utf-8"), path)
            if dependencies.canonicalize_id(metadata.get("id")) != dependencies.canonicalize_id(row["page_id"]):
                return False
            # The creator may have died before registering its saved document.
            # Repair only the exact verified path so opening by ID does not need
            # a whole-vault scan. This does not replay any creation callbacks.
            indexed = dependencies.find_page_by_id(row["page_id"]) if dependencies.find_page_by_id else None
            if (indexed is None or indexed.resolve() != path
                    or (dependencies.verify_index_created is not None and not dependencies.verify_index_created(row["page_id"], path))):
                dependencies.index_created_page(row["page_id"], path)
            return True
        except Exception:
            return False

    def record_path(self, scope: str, key: str, path: Path) -> None:
        with closing(self._connect()) as db, db:
            db.execute("UPDATE creation_requests SET file_path=? WHERE scope=? AND key=?", (str(path), scope, key))

    def finish(self, scope: str, key: str, result: dict[str, object] | None) -> None:
        encoded = json.dumps(jsonable_encoder(result), ensure_ascii=False, allow_nan=False) if result is not None else None
        with closing(self._connect()) as db, db:
            db.execute("UPDATE creation_requests SET status=?, result=? WHERE scope=? AND key=?", (
                "completed" if result is not None else "unknown", encoded, scope, key,
            ))


def _create_with_receipt(
    ledger: CreationRequests, scope: str, key: str, vault_path: Path,
    request: PageSaveRequest, tasks: BackgroundTasks, user_id: str,
    dependencies: CreatePageDependencies,
) -> dict[str, object]:
    page_id, receipt = ledger.claim(scope, key, request)
    if receipt is not None:
        return receipt

    def save(path: Path, metadata: RegistryData, body: str) -> None:
        resolved = path.resolve()
        if not resolved.is_relative_to(vault_path.resolve()):
            raise HTTPException(403, "Creation path is outside the selected vault")
        ledger.record_path(scope, key, resolved)
        dependencies.save_page(path, metadata, body)

    try:
        # These callbacks belong to the durable operation, not the HTTP response.
        # A disconnected waiter may never send a response or run its tasks.
        steps = CreationSteps(ledger._connect, scope, key)
        operation_tasks = OperationTasks(steps)
        def checkpoint_post_save(path: Path, metadata: RegistryData, title: str) -> None:
            CreationInputs(ledger._connect, scope, key).capture_context(vault_path)
            table_id = dependencies.get_table_id(metadata)
            planned: dict[str, tuple[object, ...]] = {
                "index": (page_id, path), "page_cache": (), "sidebar_index": (path,),
                "links": (path,), "relations": (page_id, table_id, {}, dict(metadata)),
                "event_dispatch": (page_id, title),
            }
            if table_id:
                planned["formulas"] = (table_id, page_id)
            steps.plan(list(planned))
            inputs = CreationInputs(ledger._connect, scope, key)
            for name, arguments in planned.items():
                inputs.capture(name, arguments, {})
            if dependencies.checkpoint_post_save is not None:
                dependencies.checkpoint_post_save(path, metadata, title)
        ports = replace(dependencies, new_id=lambda: page_id,
            checkpoint_post_save=checkpoint_post_save,
            save_page=steps.wrap("save", save),
            index_created_page=steps.wrap("index", dependencies.index_created_page),
            invalidate_page_responses=steps.wrap("page_cache", dependencies.invalidate_page_responses),
            add_page_index=steps.wrap("sidebar_index", dependencies.add_page_index),
            recompute_formulas=steps.wrap("formulas", dependencies.recompute_formulas, planned=False),
            update_link_index=steps.wrap("links", dependencies.update_link_index),
            propagate_relations=steps.wrap("relations", dependencies.propagate_relations),
            queue_planning=steps.wrap("planning_queue", lambda tasks: dependencies.queue_planning(PlanningTasks(tasks, steps)), capture=False),
            emit_created=steps.wrap("event_dispatch", dependencies.emit_created),
        )
        result = _create_page_sync(request, operation_tasks, user_id, ports)
        asyncio.run(operation_tasks())
        ledger.finish(scope, key, result)
        return result
    except BaseException:
        ledger.finish(scope, key, None)
        raise


async def create_page_with_receipt(
    request: PageSaveRequest, tasks: BackgroundTasks, user_id: str,
    workspace_id: str, vault_path: Path, key: str, dependencies: CreatePageDependencies,
) -> dict[str, object]:
    validate_key(key)

    def run() -> dict[str, object]:
        ledger = CreationRequests()
        return _create_with_receipt(ledger, creation_scope(user_id, workspace_id, vault_path),
                                    key, vault_path, request, tasks, user_id, dependencies)

    return await asyncio.to_thread(run)


async def get_creation_status(
    user_id: str, workspace_id: str, vault_path: Path, key: str,
    dependencies: CreatePageDependencies | None = None,
) -> dict[str, object]:
    validate_key(key)
    return await asyncio.to_thread(lambda: CreationRequests().status(
        creation_scope(user_id, workspace_id, vault_path), key, vault_path=vault_path, dependencies=dependencies,
    ))
