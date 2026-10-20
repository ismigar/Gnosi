"""Durable checkpoints around side effects, including the uncertain crash gap."""

from contextlib import closing
from functools import wraps
import inspect
import json
import os
import sqlite3
from collections.abc import Callable
from typing import overload

from fastapi import BackgroundTasks, HTTPException
from backend.domains.vault.pages.creation_inputs import CreationInputs
from backend.domains.vault.pages.creation_callbacks import CreationCallbacks


class CreationSteps:
    def __init__(self, connect: Callable[[], sqlite3.Connection], scope: str, key: str) -> None:
        self.connect, self.scope, self.key = connect, scope, key

    def plan(self, names: list[str]) -> None:
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM creation_requests WHERE scope=? AND key=?", (self.scope, self.key)).fetchone():
                raise HTTPException(404, "Creation request not found")
            for name in names:
                db.execute("""INSERT OR IGNORE INTO creation_steps VALUES (?, ?, ?, 'pending',
                    (SELECT COALESCE(MAX(position), -1) + 1 FROM creation_steps WHERE scope=? AND key=?))""",
                    (self.scope, self.key, name, self.scope, self.key))

    def begin(self, name: str) -> bool:
        self.plan([name])
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            state = db.execute("SELECT state FROM creation_steps WHERE scope=? AND key=? AND step=?",
                               (self.scope, self.key, name)).fetchone()[0]
            if state == "completed":
                return False
            if state == "started":
                raise HTTPException(409, "Creation step has an uncertain outcome and cannot be repeated")
            db.execute("UPDATE creation_steps SET state='started' WHERE scope=? AND key=? AND step=?",
                       (self.scope, self.key, name))
        return True

    def complete(self, name: str) -> None:
        with closing(self.connect()) as db, db:
            changed = db.execute("UPDATE creation_steps SET state='completed' WHERE scope=? AND key=? AND step=? AND state='started'",
                                 (self.scope, self.key, name)).rowcount
            if changed != 1:
                raise HTTPException(409, "Creation step was not started")

    def reconcile_index(self, proof: dict[str, object]) -> None:
        """Record a verified cache postcondition under the recovery ownership."""
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            owner = db.execute("SELECT status,owner_pid FROM creation_requests WHERE scope=? AND key=?",
                               (self.scope, self.key)).fetchone()
            if owner is None or owner["status"] != "pending" or owner["owner_pid"] != os.getpid():
                raise HTTPException(409, "Creation recovery ownership changed")
            changed = db.execute("UPDATE creation_steps SET state='completed' WHERE scope=? AND key=? AND step='index' AND state='started'",
                                 (self.scope, self.key)).rowcount
            if changed != 1:
                raise HTTPException(409, "The index checkpoint is no longer uncertain")
            db.execute("INSERT INTO creation_reconciliations VALUES (?,?,?,?)",
                       (self.scope, self.key, "index", json.dumps(proof, sort_keys=True, allow_nan=False)))

    @overload
    def wrap(self, name: str, callback: Callable[..., None], *, planned: bool = True, capture: bool = True) -> Callable[..., None]: ...

    @overload
    def wrap(self, name: str, callback: Callable[..., object], *, planned: bool = True, capture: bool = True) -> Callable[..., object]: ...

    def wrap(self, name: str, callback: Callable[..., object], *, planned: bool = True, capture: bool = True) -> Callable[..., object]:
        if planned:
            self.plan([name])
        def freeze(args: tuple[object, ...], kwargs: dict[str, object]) -> None:
            self.plan([name])
            if capture:
                CreationInputs(self.connect, self.scope, self.key).capture(name, args, kwargs)
        if inspect.iscoroutinefunction(callback):
            @wraps(callback)
            async def asynchronous(*args: object, **kwargs: object) -> object:
                freeze(args, kwargs)
                if not self.begin(name):
                    return None
                result: object = await callback(*args, **kwargs)
                self.complete(name)
                return result
            setattr(asynchronous, "creation_step_name", name)
            setattr(asynchronous, "creation_capture", freeze)
            return asynchronous

        @wraps(callback)
        def synchronous(*args: object, **kwargs: object) -> object:
            freeze(args, kwargs)
            if not self.begin(name):
                return None
            result = callback(*args, **kwargs)
            self.complete(name)
            return result
        setattr(synchronous, "creation_step_name", name)
        setattr(synchronous, "creation_capture", freeze)
        return synchronous


class OperationTasks(BackgroundTasks):
    """Record conditional work only when it is actually queued."""

    def __init__(self, steps: CreationSteps) -> None:
        super().__init__()
        self.steps = steps

    def add_task(self, func: Callable[..., object], *args: object, **kwargs: object) -> None:
        name = getattr(func, "creation_step_name", None)
        if isinstance(name, str):
            self.steps.plan([name])
        freeze = getattr(func, "creation_capture", None)
        if callable(freeze):
            freeze(args, kwargs)
        super().add_task(func, *args, **kwargs)


class PlanningTasks(BackgroundTasks):
    """Journal scheduler callbacks before attaching them to the operation."""

    def __init__(self, target: BackgroundTasks, steps: CreationSteps) -> None:
        super().__init__()
        self.target, self.steps = target, steps
        self.sequence = 0

    def add_task(self, func: Callable[..., object], *args: object, **kwargs: object) -> None:
        name = f"planning:{self.sequence}"
        self.sequence += 1
        self.steps.plan([name])
        CreationCallbacks(self.steps.connect, self.steps.scope, self.steps.key).capture(name, func)
        self.target.add_task(self.steps.wrap(name, func), *args, **kwargs)
