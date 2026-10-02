"""Continue only recorded, unstarted work after a terminated page creation."""

import asyncio
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException

from backend.domains.vault.pages.creation_inputs import CreationInputs, revision
from backend.domains.vault.pages.creation_callbacks import CreationCallbacks
from backend.domains.vault.pages.creation_requests import CreationRequests, creation_scope, validate_key
from backend.domains.vault.pages.creation_steps import CreationSteps, OperationTasks, PlanningTasks
from backend.domains.vault.pages.create_service import CreatePageDependencies
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.schemas.pages import PageSaveRequest


class RecoveryContext(Protocol):
    user_id: str
    workspace_id: str
    vault_path: Path


def _checkpoints(ledger: CreationRequests, scope: str, key: str) -> list[dict[str, str]]:
    values = ledger.status(scope, key).get("steps")
    if not isinstance(values, list):
        raise HTTPException(409, "Invalid saved creation checkpoints")
    result = []
    for item in values:
        if not is_record(item):
            raise HTTPException(409, "Invalid saved creation checkpoint")
        step, state = item.get("step"), item.get("state")
        if not isinstance(step, str) or not isinstance(state, str):
            raise HTTPException(409, "Invalid saved creation checkpoint")
        result.append({"step": step, "state": state})
    return result


def recovery_access_guard(context: RecoveryContext) -> Callable[[], None]:
    """Freeze the requested scope but check its current permissions per effect."""
    from backend.services.agent_execution_models import ExecutionScope
    from backend.services.agent_execution_scope import revalidate_scope
    scope = ExecutionScope(user_id=context.user_id, workspace_id=context.workspace_id,
                           vault_path=str(context.vault_path.resolve()), role="editor")
    def guard() -> None:
        try:
            revalidate_scope(scope)
        except PermissionError as exc:
            raise HTTPException(403, "Creation recovery access has been revoked") from exc
    return guard


def _recovery_page(row: dict[str, object], root: Path,
                   dependencies: CreatePageDependencies) -> tuple[Path, str]:
    if not isinstance(row["file_path"], str) or not row["file_path"]:
        raise HTTPException(409, "The saved page path is unavailable")
    path = Path(row["file_path"]).resolve()
    if not path.is_relative_to(root) or path.suffix != ".md":
        raise HTTPException(403, "Creation recovery page is outside the selected vault")
    initial_revision = revision(path)
    try:
        metadata, body = dependencies.parse_frontmatter(path.read_text(encoding="utf-8"), path)
    except (OSError, UnicodeError, ValueError) as exc:
        raise HTTPException(409, "The saved page is unavailable or invalid") from exc
    if dependencies.canonicalize_id(metadata.get("id")) != dependencies.canonicalize_id(row["page_id"]):
        raise HTTPException(409, "The saved page identity changed")
    return path, initial_revision


def _recovery_callbacks(dependencies: CreatePageDependencies, recorded: CreationCallbacks,
                        pending: list[str]) -> tuple[dict[str, Callable[..., object]], list[str]]:
    callbacks: dict[str, Callable[..., object]] = {
        "index": dependencies.index_created_page,
        "page_cache": dependencies.invalidate_page_responses,
        "sidebar_index": dependencies.add_page_index,
        "formulas": dependencies.recompute_formulas,
        "links": dependencies.update_link_index,
        "relations": dependencies.propagate_relations,
        "event_dispatch": dependencies.emit_created,
    }
    planning = [name for name in pending if name.startswith("planning:")]
    if planning and "planning_queue" in pending:
        raise HTTPException(409, "Planning queue registration was not completed")
    for name in planning:
        callbacks[name] = recorded.resolve(name)
    if any(name not in callbacks and name != "planning_queue" for name in pending):
        raise HTTPException(409, "A recorded creation callback cannot yet be recovered")
    return callbacks, planning


def _checked_callback(wrapped: Callable[..., object], validate: Callable[[], None],
                      accept_revision: Callable[[], None],
                      verify: Callable[[], None] | None = None) -> Callable[..., object]:
    if asyncio.iscoroutinefunction(wrapped):
        @wraps(wrapped)
        async def asynchronous(*args: object, **kwargs: object) -> object:
            validate()
            if verify is not None:
                verify()
            result: object = await wrapped(*args, **kwargs)
            accept_revision()
            return result
        return asynchronous
    @wraps(wrapped)
    def synchronous(*args: object, **kwargs: object) -> object:
        validate()
        if verify is not None:
            verify()
        result = wrapped(*args, **kwargs)
        accept_revision()
        return result
    return synchronous


def _run_recovery_steps(
    dependencies: CreatePageDependencies, steps: CreationSteps, recorded: CreationCallbacks,
    pending: list[str], planning: list[str],
    prepared: dict[str, tuple[tuple[object, ...], dict[str, object]]],
    operation_tasks: OperationTasks, checked: Callable[[str], Callable[..., object]],
    checked_callback: Callable[[Callable[..., object], Callable[[], None] | None], Callable[..., object]],
    validate: Callable[[], None],
) -> None:
    class RecoveryPlanningTasks(PlanningTasks):
        def add_task(self, func: Callable[..., object], *args: object, **kwargs: object) -> None:
            name = f"planning:{self.sequence}"
            self.sequence += 1
            self.steps.plan([name])
            registered = recorded.capture(name, func)
            # Newly registered work needs the same per-effect revision
            # check as work persisted before the interrupted process died.
            def verify() -> None:
                if recorded.resolve(name) is not func:
                    raise HTTPException(409, "The planning callback changed during recovery")
            self.target.add_task(checked_callback(self.steps.wrap(name, func), verify if registered else None), *args, **kwargs)
    for name in ("index", "page_cache", "sidebar_index"):
        if name in prepared:
            args, kwargs = prepared[name]
            checked(name)(*args, **kwargs)
    for name in ("formulas", "links"):
        if name in prepared:
            args, kwargs = prepared[name]
            operation_tasks.add_task(checked(name), *args, **kwargs)
    if "planning_queue" in pending:
        def queue() -> None:
            dependencies.queue_planning(RecoveryPlanningTasks(operation_tasks, steps))
        validate()
        steps.wrap("planning_queue", queue, capture=False)()
    for name in planning:
        args, kwargs = prepared[name]
        operation_tasks.add_task(checked(name), *args, **kwargs)
    if "relations" in prepared:
        args, kwargs = prepared["relations"]
        operation_tasks.add_task(checked("relations"), *args, **kwargs)
    if "event_dispatch" in prepared:
        args, kwargs = prepared["event_dispatch"]
        checked("event_dispatch")(*args, **kwargs)
    asyncio.run(operation_tasks())


def _validate_index_inputs(uncertain_index: bool, inputs: CreationInputs,
                           row: dict[str, object], path: Path, root: Path) -> None:
    if uncertain_index:
        args, kwargs = inputs.load_for_verification("index", root)
        if len(args) != 2 or args[0] != row["page_id"] or not isinstance(args[1], Path) or args[1].resolve() != path or kwargs:
            raise HTTPException(409, "The saved index verification inputs do not match the page")


def _finish_recovery(ledger: CreationRequests, scope: str, key: str, path: Path,
                     row: dict[str, object], request: PageSaveRequest,
                     dependencies: CreatePageDependencies) -> dict[str, object]:
    if any(item["state"] != "completed" for item in _checkpoints(ledger, scope, key)):
        raise HTTPException(409, "Creation recovery has unfinished steps")
    metadata, body = dependencies.parse_frontmatter(path.read_text(encoding="utf-8"), path)
    if dependencies.canonicalize_id(metadata.get("id")) != dependencies.canonicalize_id(row["page_id"]):
        raise HTTPException(409, "The saved page identity changed during recovery")
    folder, table_id = dependencies.resolve_page_context(metadata, path)
    result: dict[str, object] = {"status": "created", "id": row["page_id"], "title": request.title,
              "metadata": metadata, "content": body, "folder": folder,
              "resolved_table_id": table_id, "message": "Page created"}
    ledger.finish(scope, key, result)
    return result


def recover_creation(ledger: CreationRequests, scope: str, key: str, vault_path: Path,
                     dependencies: CreatePageDependencies, *, guard: Callable[[], None]) -> dict[str, object]:
    """Run on a worker thread with the original scoped application ports.

    No callback is selected from persisted code or a client request. Unknown
    scheduler callbacks and effects whose outcome is uncertain fail closed.
    """
    guard()
    row, request, receipt = ledger.claim_recovery(scope, key,
        allow_uncertain_index=dependencies.verify_index_created is not None)
    if receipt is not None:
        return receipt
    try:
        page_id = row.get("page_id")
        if not isinstance(page_id, str) or not page_id or request is None:
            raise HTTPException(409, "Invalid saved creation request")
        root = vault_path.resolve()
        path, initial_revision = _recovery_page(row, root, dependencies)
        steps = CreationSteps(ledger._connect, scope, key)
        inputs = CreationInputs(ledger._connect, scope, key)
        inputs.validate_context(root)
        checkpoints = _checkpoints(ledger, scope, key)
        pending = [item["step"] for item in checkpoints if item["state"] == "pending"]
        uncertain_index = any(item["step"] == "index" and item["state"] == "running" for item in checkpoints)
        _validate_index_inputs(uncertain_index, inputs, row, path, root)
        recorded = CreationCallbacks(ledger._connect, scope, key)
        callbacks, planning = _recovery_callbacks(dependencies, recorded, pending)
        # Validate every frozen input before invoking the first callback. Later
        # callbacks may legitimately change the document (for example formulas).
        prepared = {name: inputs.load_pending(name, root) for name in pending if name in callbacks}
        operation_tasks = OperationTasks(steps)
        accepted_revision = initial_revision
        def validate() -> None:
            guard()
            inputs.validate_context(root)
            if revision(path) != accepted_revision:
                raise HTTPException(409, "The saved page changed during creation recovery")
        validate()
        if uncertain_index:
            verifier = dependencies.verify_index_created
            if verifier is None or verifier(page_id, path) is not True:
                raise HTTPException(409, "The page index postcondition is not verified")
            validate()
            steps.reconcile_index({"kind": "page-index-v1", "page_id": row["page_id"],
                                   "path": str(path), "source_revision": accepted_revision})
        def accept_revision() -> None:
            nonlocal accepted_revision
            accepted_revision = revision(path)
        def checked_callback(wrapped: Callable[..., object], verify: Callable[[], None] | None = None) -> Callable[..., object]:
            return _checked_callback(wrapped, validate, accept_revision, verify)
        def checked(name: str) -> Callable[..., object]:
            def verify() -> None:
                if recorded.resolve(name) is not callbacks[name]:
                    raise HTTPException(409, "The planning callback changed during recovery")
            return checked_callback(steps.wrap(name, callbacks[name]), verify if name in planning else None)
        _run_recovery_steps(dependencies, steps, recorded, pending, planning, prepared,
                            operation_tasks, checked, checked_callback, validate)
        validate()
        return _finish_recovery(ledger, scope, key, path, row, request, dependencies)
    except (OSError, UnicodeError) as exc:
        ledger.finish(scope, key, None)
        raise HTTPException(503, "Creation recovery storage is unavailable") from exc
    except BaseException:
        ledger.finish(scope, key, None)
        raise


async def recover_page_creation(user_id: str, workspace_id: str, vault_path: Path, key: str,
                                dependencies: CreatePageDependencies, *, guard: Callable[[], None]) -> dict[str, object]:
    """Keep cloud reads and durable recovery independent of the HTTP waiter."""
    validate_key(key)
    return await asyncio.to_thread(lambda: recover_creation(
        CreationRequests(), creation_scope(user_id, workspace_id, vault_path), key,
        vault_path, dependencies, guard=guard,
    ))
