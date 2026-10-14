"""Resolve public workflows against their stored owner and vault, never headers."""

from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.config.app_config import load_params
from backend.models.management import Membership, User, Vault, VaultAccess
from backend.services.context_vars import active_vault_path, get_primary_vault_path
from backend.services.plugin_access import plugins_enabled_now
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext


def _unavailable() -> HTTPException:
    return HTTPException(status_code=404, detail="This public link is unavailable")


def _vault_directory(vault: Vault) -> Path:
    """Read storage identity without bootstrapping or creating a missing mount."""
    params = load_params(strict_env=False)
    project = params.paths.get("PROJECT_DIR")
    if vault.path_override:
        path = Path(vault.path_override)
        if not path.is_absolute():
            if project is None:
                raise _unavailable()
            path = Path(project) / path
    elif vault.workspace_id == "personal":
        primary = get_primary_vault_path()
        if primary is None:
            raise _unavailable()
        path = primary
    elif project is not None and vault.workspace_id:
        path = Path(project) / "workspaces" / vault.workspace_id / "vault"
    else:
        raise _unavailable()
    path = path.resolve()
    if not path.is_dir():
        raise _unavailable()
    return path


def _owner_membership(db: Session, workspace_id: str, vault_id: str, owner_id: str) -> Membership:
    owner = db.query(User).filter(User.id == owner_id).first()
    membership = db.query(Membership).filter(
        Membership.workspace_id == workspace_id, Membership.user_id == owner_id,
    ).first()
    if owner is None or membership is None or ROLE_WEIGHTS.get(str(membership.role).lower(), -1) < 1:
        raise _unavailable()
    grants = db.query(VaultAccess).filter(
        VaultAccess.workspace_id == workspace_id, VaultAccess.user_id == owner_id,
    ).all()
    if grants:
        grant = next((entry for entry in grants if entry.vault_id == vault_id), None)
        if grant is None:
            raise _unavailable()
        try:
            permissions = json.loads(str(grant.permissions or "{}"))
        except (ValueError, TypeError):
            raise _unavailable() from None
        capabilities = permissions.get("capabilities", []) if isinstance(permissions, dict) else []
        if not isinstance(capabilities, list) or "write" not in capabilities or "read" not in capabilities:
            raise _unavailable()
    return membership


def resolve_private_vault(db: Session, context: WorkspaceContext) -> Vault:
    """Pin an authenticated editor's already resolved storage to its registry ID."""
    selected = Path(context.vault_path).resolve()
    candidates = db.query(Vault).filter(Vault.workspace_id == context.workspace_id).all()
    for vault in candidates:
        try:
            matches = _vault_directory(vault) == selected
        except HTTPException:
            continue
        if matches:
            _owner_membership(db, context.workspace_id, vault.id, context.user_id)
            return vault
    raise HTTPException(status_code=403, detail="The selected vault is unavailable")


@contextmanager
def public_vault_scope(
    db: Session, workspace_id: str, vault_id: str, owner_id: str,
    plugin_ids: tuple[str, ...] = (),
) -> Iterator[WorkspaceContext]:
    """Recheck a link owner's current access and restore context after any failure.

    The caller must resolve and validate its opaque, revocable link first. A
    public request's cookies, headers and query parameters never select storage.
    """
    vault = db.query(Vault).filter(Vault.id == vault_id, Vault.workspace_id == workspace_id).first()
    if vault is None:
        raise _unavailable()
    membership = _owner_membership(db, workspace_id, vault_id, owner_id)
    path = _vault_directory(vault)
    token = active_vault_path.set(path)
    try:
        if plugin_ids and not plugins_enabled_now(*plugin_ids, vault_path=path):
            raise _unavailable()
        yield WorkspaceContext(workspace_id, owner_id, str(membership.role), path, ["read", "write"])
    finally:
        active_vault_path.reset(token)
