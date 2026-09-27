"""Bind authenticated application scope before crossing threads or transports."""
from __future__ import annotations

from collections.abc import Callable, AsyncIterator, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from fastapi import Depends

from backend.services.agent_execution_models import ExecutionOrigin, ExecutionScope
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext, get_workspace_context

_origin: ContextVar[ExecutionOrigin] = ContextVar("agent_execution_origin", default="button")
_scope: ContextVar[ExecutionScope | None] = ContextVar("agent_execution_scope", default=None)


def current_scope() -> ExecutionScope:
    value = _scope.get()
    if value is None:
        raise RuntimeError("agent_execution_scope_required")
    return value


def current_origin() -> ExecutionOrigin:
    return _origin.get()


@contextmanager
def execution_scope(scope: ExecutionScope, *, origin: ExecutionOrigin | None = None) -> Iterator[None]:
    token = _scope.set(scope)
    origin_token = _origin.set(origin) if origin is not None else None
    vault_token = active_vault_path.set(Path(scope.vault_path))
    try:
        yield
    finally:
        active_vault_path.reset(vault_token)
        _scope.reset(token)
        if origin_token is not None:
            _origin.reset(origin_token)


async def bind_request_scope(
    context: WorkspaceContext = Depends(get_workspace_context),
) -> AsyncIterator[None]:
    scope = ExecutionScope.model_validate({
        "user_id": context.user_id, "workspace_id": context.workspace_id,
        "role": context.role, "vault_path": str(context.vault_path.resolve()),
    })
    with execution_scope(scope, origin="button"):
        yield


def serialized_scope() -> dict[str, Any]:
    return current_scope().model_dump()


def revalidate_scope(scope: ExecutionScope) -> None:
    """A persisted job is not a permission grant; check current membership."""
    from backend.config.app_config import load_params
    from backend.data.management_db import get_mgmt_db
    from backend.models.management import Membership, Vault, VaultAccess
    from backend.services.workspace_service import ROLE_WEIGHTS

    sessions = get_mgmt_db()
    db = next(sessions)
    try:
        membership = db.query(Membership).filter(
            Membership.user_id == scope.user_id,
            Membership.workspace_id == scope.workspace_id,
        ).first()
        if membership is None or ROLE_WEIGHTS.get(str(membership.role), -1) < ROLE_WEIGHTS[scope.role]:
            raise PermissionError("agent_execution_membership_revoked")
        cfg = load_params(strict_env=False)
        project_root = cfg.paths.get("PROJECT_DIR")
        default_vault = cfg.paths.get("VAULT")
        if project_root is None or default_vault is None:
            raise PermissionError("agent_execution_vault_unavailable")
        access = db.query(VaultAccess).filter(
            VaultAccess.user_id == scope.user_id,
            VaultAccess.workspace_id == scope.workspace_id,
        ).all()
        allowed_ids = {entry.vault_id for entry in access}
        vaults = db.query(Vault).filter(Vault.workspace_id == scope.workspace_id).all()
        for vault in vaults:
            if allowed_ids and vault.id not in allowed_ids:
                continue
            path = vault.path_override
            if path:
                candidate = Path(path)
                if not candidate.is_absolute():
                    candidate = Path(project_root) / candidate
            elif cfg.gnosi_mode == "personal":
                candidate = Path(default_vault)
            else:
                candidate = Path(project_root) / "workspaces" / scope.workspace_id / "vault"
            if candidate.resolve() == Path(scope.vault_path).resolve():
                return
        raise PermissionError("agent_execution_vault_revoked")
    finally:
        sessions.close()


@contextmanager
def personal_scheduler_scope(*, origin: ExecutionOrigin = "automation") -> Iterator[None]:
    """Bind the install's single personal owner for legacy system schedules."""
    if _scope.get() is not None:
        yield
        return
    from backend.config.app_config import load_params
    from backend.data.management_db import get_mgmt_session
    from backend.models.management import Membership

    cfg = load_params(strict_env=False)
    if cfg.gnosi_mode != "personal":
        raise PermissionError("agent_schedule_requires_explicit_owner")
    with get_mgmt_session() as db:
        owners = db.query(Membership).filter(Membership.role == "owner").all()
        if len(owners) != 1:
            raise PermissionError("agent_schedule_requires_explicit_owner")
        owner = owners[0]
        context = get_workspace_context(
            x_workspace_id=str(owner.workspace_id), x_user_id=None, x_vault_id=None,
            db=db, auth_uid=str(owner.user_id),
        )
        scope = ExecutionScope(user_id=context.user_id, workspace_id=context.workspace_id,
            vault_path=str(context.vault_path.resolve()), role="owner")
    with execution_scope(scope, origin=origin):
        yield


def run_personal_schedule(operation: Callable[[], Any]) -> Any:
    """Bind the verified schedule owner before entering a functional service."""
    with personal_scheduler_scope():
        return operation()
