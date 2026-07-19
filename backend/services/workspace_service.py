from fastapi import Header, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.data.management_db import get_mgmt_db
from backend.models.management import Workspace, Membership, User, Vault, VaultAccess
from typing import Optional
from pathlib import Path
from backend.config.app_config import load_params
import uuid

from backend.services.context_vars import active_vault_path
from backend.services.auth_service import get_current_user_id

class WorkspaceContext:
    def __init__(self, workspace_id: str, user_id: str, role: str, vault_path: Path, capabilities: list = None):
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.role = role
        self.vault_path = vault_path
        self.capabilities = capabilities or ["read"]

ROLE_WEIGHTS = {
    "owner": 3,
    "admin": 2,
    "editor": 1,
    "viewer": 0
}

def require_role(min_role: str):
    """
        Returns a dependency that validates whether the user has the minimum required role.
    
    """
    def role_checker(context: WorkspaceContext = Depends(get_workspace_context)):
        user_weight = ROLE_WEIGHTS.get(context.role.lower(), 0)
        required_weight = ROLE_WEIGHTS.get(min_role.lower(), 0)
        
        if user_weight < required_weight:
            raise HTTPException(
                status_code=403, 
                detail=f"Permís insuficient. Es requereix rol {min_role} (tens {context.role})"
            )
        return context
    
    return role_checker

def require_capability(capability: str):
    """
        Validates whether the user has a specific capability in the permissions JSON.
    
    """
    def capability_checker(context: WorkspaceContext = Depends(get_workspace_context)):
        if capability not in context.capabilities and context.role != "owner":
            raise HTTPException(
                status_code=403,
                detail=f"No tens la capacitat '{capability}' necessària per a aquesta operació."
            )
        return context
    return capability_checker

def _ensure_personal_exists(db: Session, user_id: str, vault_path: Path) -> str:
    """Ensure a personal workspace exists for the user."""
    # 1. Find or create user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        from backend.services.auth_service import PLACEHOLDER_EMAIL, require_auth_enabled

        if require_auth_enabled():
            # Enforcement on: only an authenticated identity gets here, and a
            # real one already has a row. Auto-creating would re-open the door
            # the flag closes — an unknown id would still mint an account that
            # ends up `owner` of the shared personal workspace.
            #
            # This also has to stay shut once the legacy account is migrated to a
            # real address: while it still holds the placeholder, the UNIQUE
            # constraint on `users.email` blocks a second auto-created user by
            # accident. Freeing that address removes the accident, not the risk.
            raise HTTPException(status_code=401, detail="Cal autenticació")

        user = User(id=user_id, name="User", email=PLACEHOLDER_EMAIL)
        db.add(user)
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

    # 2. Look up the 'Personal' membership.
    # Scoped to workspace_id == "personal": the personal workspace ALWAYS has this id
    # (hardcoded in the creation branch below). Without this filter, if the user
    # is also `owner` of an organization workspace, the `.first()` (without order_by)
    # could return that membership and _resolve_personal_vault would end up resolving the
    # vault from ANOTHER workspace in personal mode (data leak between workspaces).
    membership = db.query(Membership).filter(
        Membership.user_id == user_id,
        Membership.workspace_id == "personal",
        Membership.role == "owner"
    ).first()

    if not membership:
        # Create workspace
        ws_id = "personal"
        ws = db.query(Workspace).filter(Workspace.id == ws_id).first()
        if not ws:
            ws = Workspace(id=ws_id, name="Personal Workspace")
            db.add(ws)

        # Create Vault
        rel_vault = str(vault_path)
        v = Vault(id=str(uuid.uuid4()), workspace_id=ws_id, name="Main Vault", path_override=rel_vault)
        db.add(v)

        # Create Membership
        membership = Membership(user_id=user_id, workspace_id=ws_id, role="owner")
        db.add(membership)

        try:
            db.commit()
        except Exception:
            # Without rollback the session stays "dirty" and any further
            # query on this session silently fails. Roll back and re-raise
            # so the caller sees the error instead of a corrupted session.
            db.rollback()
            raise
        return ws_id

    return membership.workspace_id

def _resolve_personal_vault(db: Session, ws_id: str, x_vault_id: Optional[str],
                            default_vault_path: Path) -> Path:
    """Personal multi-vault mode: if `X-Vault-Id` is given and it's a valid Vault of the
    personal workspace, returns its path; otherwise, the default vault (backward compatibility)."""
    if not x_vault_id:
        return default_vault_path
    v = db.query(Vault).filter(Vault.id == x_vault_id, Vault.workspace_id == ws_id).first()
    if not v or not v.path_override:
        return default_vault_path
    p = Path(v.path_override)
    try:
        p.mkdir(parents=True, exist_ok=True)
    except Exception:
        return default_vault_path
    return p


def get_workspace_context(
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_vault_id: Optional[str] = Header(None),
    db: Session = Depends(get_mgmt_db),
    auth_uid: Optional[str] = Depends(get_current_user_id),
) -> WorkspaceContext:

    params = load_params(strict_env=False)
    project_root = params.paths.get("PROJECT_DIR")
    default_vault_path = params.paths.get("VAULT")

    # Resolve the user: priority JWT > X-User-ID > legacy "ismael-legacy".
    # `auth_uid` ve d'`auth_service.get_current_user_id` (cookie/Bearer).
    from backend.services.auth_service import get_user_id_or_legacy
    resolved_user_id = get_user_id_or_legacy(auth_uid, x_user_id)

    # PERSONAL MODE: one workspace, but optional multi-vault (X-Vault-Id; defaults to the main one)
    if params.gnosi_mode == "personal":
        ws_id = _ensure_personal_exists(db, resolved_user_id, default_vault_path)
        vpath = _resolve_personal_vault(db, ws_id, x_vault_id, default_vault_path)
        active_vault_path.set(vpath)
        return WorkspaceContext(
            workspace_id=ws_id,
            user_id=resolved_user_id,
            role="owner",
            vault_path=vpath
        )

    # ORG MODE: replaces x_user_id with resolved_user_id from here on.
    x_user_id = resolved_user_id

    # ORGANIZATION MODE: Multi-tenant logic
    if not x_workspace_id:
        membership = db.query(Membership).filter(Membership.user_id == x_user_id).first()
        if not membership:
            # If there's nothing, we create the default personal one to avoid blocking
            x_workspace_id = _ensure_personal_exists(db, x_user_id, default_vault_path)
            membership = db.query(Membership).filter(Membership.user_id == x_user_id).first()
        else:
            x_workspace_id = membership.workspace_id
    else:
        membership = db.query(Membership).filter(
            Membership.workspace_id == x_workspace_id,
            Membership.user_id == x_user_id
        ).first()
        if not membership:
            raise HTTPException(status_code=403, detail="Unauthorized access to this workspace")

    # Check whether there are VaultAccess restrictions
    vault_access = db.query(VaultAccess).filter(
        VaultAccess.workspace_id == x_workspace_id,
        VaultAccess.user_id == x_user_id
    ).all()
    
    allowed_vault_ids = [va.vault_id for va in vault_access]
    
    # If there are no explicit restrictions, and is owner/admin, can they see all? 
    # For now, if there are any, we filter. If there aren't, we allow the first one (original behavior).
    
    query = db.query(Vault).filter(Vault.workspace_id == x_workspace_id)
    if allowed_vault_ids:
        query = query.filter(Vault.id.in_(allowed_vault_ids))
    
    vault = query.first()
    
    if not vault:
        # If there were restrictions and none valid were found
        if allowed_vault_ids:
             raise HTTPException(status_code=403, detail="No tens accés a cap Vault en aquest workspace")
        # Otherwise, if there's no vault in the workspace
        raise HTTPException(status_code=404, detail="No s'ha trobat cap Vault per a aquest workspace")

    if vault.path_override:
        v_path = Path(vault.path_override)
        if not v_path.is_absolute():
            v_path = project_root / v_path
    else:
        v_path = project_root / "workspaces" / x_workspace_id / "vault"
        
    v_path.mkdir(parents=True, exist_ok=True)
    active_vault_path.set(v_path)

    import json
    capabilities = ["read"]
    if membership.permissions:
        try:
            perms = json.loads(membership.permissions)
            capabilities = perms.get("capabilities", ["read"])
        except (ValueError, TypeError, AttributeError):
            # Malformed permissions JSON — fall back to read-only.
            pass
    
    # If they're admin or owner, they have all by default if not specified
    if membership.role in ["admin", "owner"] and "admin" not in capabilities:
        capabilities.append("admin")
        if "write" not in capabilities: capabilities.append("write")
        if "delete" not in capabilities: capabilities.append("delete")

    return WorkspaceContext(
        workspace_id=x_workspace_id,
        user_id=x_user_id,
        role=membership.role,
        vault_path=v_path,
        capabilities=capabilities
    )
