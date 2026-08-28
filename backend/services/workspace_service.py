import json
import uuid
from pathlib import Path
from typing import Callable, Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.config.app_config import load_params
from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_db
from backend.models.management import Workspace, Membership, User, Vault, VaultAccess
from backend.services.auth_service import get_current_user_id
from backend.services.context_vars import active_vault_path

logger = get_logger(__name__)


class WorkspaceContext:
    def __init__(
        self,
        workspace_id: str,
        user_id: str,
        role: str,
        vault_path: Path,
        capabilities: list[str] | None = None,
    ) -> None:
        self.workspace_id: str = workspace_id
        self.user_id: str = user_id
        self.role: str = role
        self.vault_path: Path = vault_path
        self.capabilities: list[str] = capabilities or ["read"]


ROLE_WEIGHTS = {"owner": 3, "admin": 2, "editor": 1, "viewer": 0}


def require_role(min_role: str) -> Callable[[WorkspaceContext], WorkspaceContext]:
    """
    Returns a dependency that validates whether the user has the minimum required role.

    """

    def role_checker(
        context: WorkspaceContext = Depends(get_workspace_context),
    ) -> WorkspaceContext:
        user_weight = ROLE_WEIGHTS.get(context.role.lower(), 0)
        required_weight = ROLE_WEIGHTS.get(min_role.lower(), 0)

        if user_weight < required_weight:
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permission. Role {min_role} is required (you have {context.role})",
            )
        return context

    return role_checker


def require_capability(capability: str) -> Callable[[WorkspaceContext], WorkspaceContext]:
    """
    Validates whether the user has a specific capability in the permissions JSON.

    """

    def capability_checker(
        context: WorkspaceContext = Depends(get_workspace_context),
    ) -> WorkspaceContext:
        if capability not in context.capabilities and context.role != "owner":
            raise HTTPException(
                status_code=403,
                detail=f"You lack the '{capability}' capability required for this operation.",
            )
        return context

    return capability_checker


def _ensure_personal_exists(db: Session, user_id: str, vault_path: Path) -> str:
    """Ensure a personal workspace exists for the user.

    Safe under concurrency: on a fresh install the first parallel requests all
    race to create the same rows (auto user, 'personal' workspace, membership).
    Losers hit a UNIQUE constraint on commit; instead of bubbling a 500 up to
    the client, they roll back and re-read what the winner committed.
    """
    # 1. Find or create user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        from backend.services.auth_service import PLACEHOLDER_EMAIL, require_auth_enabled

        if require_auth_enabled(db):
            # Enforcement on: only an authenticated identity gets here, and a
            # real one already has a row. Auto-creating would re-open the door
            # the flag closes — an unknown id would still mint an account that
            # ends up `owner` of the shared personal workspace.
            #
            # This also has to stay shut once the legacy account is migrated to a
            # real address: while it still holds the placeholder, the UNIQUE
            # constraint on `users.email` blocks a second auto-created user by
            # accident. Freeing that address removes the accident, not the risk.
            raise HTTPException(status_code=401, detail="Authentication required")

        user = User(id=user_id, name="User", email=PLACEHOLDER_EMAIL, auto_provisioned=True)
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Two possible conflicts: a concurrent request auto-created this
            # same id (reuse the winner's row and move on), or a DIFFERENT id
            # already holds the placeholder email — that one is the guard
            # documented above and must keep failing loudly.
            if not db.query(User).filter(User.id == user_id).first():
                raise
        except Exception:
            db.rollback()
            raise

    # 2. Look up the 'Personal' membership.
    # Scoped to workspace_id == "personal": the personal workspace ALWAYS has this id
    # (hardcoded in the creation branch below). Without this filter, if the user
    # is also `owner` of an organization workspace, the `.first()` (without order_by)
    # could return that membership and _resolve_personal_vault would end up resolving the
    # vault from ANOTHER workspace in personal mode (data leak between workspaces).
    ws_id = "personal"
    last_conflict: IntegrityError | None = None
    for _ in range(3):
        membership = (
            db.query(Membership)
            .filter(
                Membership.user_id == user_id,
                Membership.workspace_id == ws_id,
                Membership.role == "owner",
            )
            .first()
        )
        if membership:
            return str(membership.workspace_id)

        # Create workspace
        ws = db.query(Workspace).filter(Workspace.id == ws_id).first()
        if not ws:
            ws = Workspace(id=ws_id, name="Personal Workspace")
            db.add(ws)

        # Create Vault
        rel_vault = str(vault_path)
        v = Vault(
            id=str(uuid.uuid4()), workspace_id=ws_id, name="Main Vault", path_override=rel_vault
        )
        db.add(v)

        # Create Membership
        membership = Membership(user_id=user_id, workspace_id=ws_id, role="owner")
        db.add(membership)

        try:
            db.commit()
        except IntegrityError as exc:
            # Lost the bootstrap race to a concurrent request. The rollback
            # discards every pending row of this transaction (workspace, vault
            # and membership go together), so the retry re-reads the winner's
            # rows without leaving a duplicate "Main Vault" behind.
            db.rollback()
            last_conflict = exc
            logger.warning("Personal workspace bootstrap lost a concurrent create race; retrying")
        except Exception:
            # Without rollback the session stays "dirty" and any further
            # query on this session silently fails. Roll back and re-raise
            # so the caller sees the error instead of a corrupted session.
            db.rollback()
            raise
        else:
            return ws_id

    # Repeated conflicts without the membership ever becoming readable: not a
    # bootstrap race (e.g. a same-key membership with a non-owner role).
    # Surface the constraint error instead of looping forever.
    if last_conflict is None:
        raise RuntimeError("Personal workspace bootstrap exhausted without a constraint error")
    raise last_conflict


def _resolve_personal_vault(
    db: Session, ws_id: str, x_vault_id: Optional[str], default_vault_path: Path
) -> Path:
    """Personal multi-vault mode: if `X-Vault-Id` is given and it's a valid Vault of the
    personal workspace, returns its path; otherwise, the default vault (backward compatibility)."""
    if not x_vault_id:
        return default_vault_path
    v = db.query(Vault).filter(Vault.id == x_vault_id, Vault.workspace_id == ws_id).first()
    if not v or not v.path_override:
        return default_vault_path
    p = Path(v.path_override)
    if p.exists():
        return p
    # Only create the vault dir when its PARENT already exists (the mount /
    # container is present). If the whole chain is missing (e.g. OneDrive signed
    # out), do NOT mkdir(parents=True): that fabricates an empty shadow vault as
    # plain local dirs which the File Provider later collides with (split-brain).
    if p.parent.exists():
        try:
            p.mkdir(exist_ok=True)
            return p
        except Exception:
            return default_vault_path
    logger.warning("Vault path parent missing (mount unavailable?); falling back to default: %s", p)
    return default_vault_path


def _organization_membership(
    db: Session,
    user_id: str,
    workspace_id: Optional[str],
    default_vault_path: Path,
) -> tuple[str, Membership]:
    """Resolve or bootstrap the organization-mode workspace membership."""
    if not workspace_id:
        membership = db.query(Membership).filter(Membership.user_id == user_id).first()
        if not membership:
            workspace_id = _ensure_personal_exists(db, user_id, default_vault_path)
            membership = (
                db.query(Membership)
                .filter(
                    Membership.user_id == user_id,
                    Membership.workspace_id == workspace_id,
                )
                .first()
            )
        else:
            workspace_id = str(membership.workspace_id)
        if membership is None:
            raise RuntimeError("Workspace bootstrap did not create a membership")
        return workspace_id, membership

    membership = (
        db.query(Membership)
        .filter(
            Membership.workspace_id == workspace_id,
            Membership.user_id == user_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Unauthorized access to this workspace")
    return workspace_id, membership


def _organization_vault(
    db: Session,
    workspace_id: str,
    user_id: str,
    requested_vault_id: Optional[str],
) -> Vault:
    """Select one requested and accessible Vault for an organization member."""
    vault_access = (
        db.query(VaultAccess)
        .filter(
            VaultAccess.workspace_id == workspace_id,
            VaultAccess.user_id == user_id,
        )
        .all()
    )
    allowed_vault_ids = [access.vault_id for access in vault_access]

    query = db.query(Vault).filter(Vault.workspace_id == workspace_id)
    if requested_vault_id:
        query = query.filter(Vault.id == requested_vault_id)
    if allowed_vault_ids:
        query = query.filter(Vault.id.in_(allowed_vault_ids))
    vault = query.first()
    if vault:
        return vault
    if allowed_vault_ids or requested_vault_id:
        raise HTTPException(status_code=403, detail="No accessible vault in this workspace")
    raise HTTPException(status_code=404, detail="No vault found for this workspace")


def _organization_vault_path(
    vault: Vault,
    project_root: Path,
    workspace_id: str,
) -> Path:
    """Resolve contained organization storage without fabricating a missing mount."""
    if not vault.path_override:
        vault_path = project_root / "workspaces" / workspace_id / "vault"
        vault_path.mkdir(parents=True, exist_ok=True)
        return vault_path

    vault_path = Path(vault.path_override)
    if not vault_path.is_absolute():
        vault_path = project_root / vault_path
    if vault_path.exists():
        return vault_path
    if not vault_path.parent.exists():
        raise HTTPException(
            status_code=503,
            detail="Vault storage is temporarily unavailable",
        )
    vault_path.mkdir(exist_ok=True)
    return vault_path


def _membership_capabilities(membership: Membership) -> list[str]:
    """Decode explicit capabilities and apply administrative defaults."""
    capabilities = ["read"]
    raw_permissions = membership.permissions
    if isinstance(raw_permissions, str) and raw_permissions:
        try:
            permissions = json.loads(raw_permissions)
            decoded = permissions.get("capabilities", ["read"])
            if isinstance(decoded, list):
                capabilities = [str(item) for item in decoded]
        except (ValueError, TypeError, AttributeError):
            pass
    role = str(membership.role)
    if role in ["admin", "owner"] and "admin" not in capabilities:
        capabilities.append("admin")
        if "write" not in capabilities:
            capabilities.append("write")
        if "delete" not in capabilities:
            capabilities.append("delete")
    return capabilities


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
    if project_root is None:
        raise HTTPException(status_code=500, detail="PROJECT_DIR no configurat")
    if default_vault_path is None:
        raise HTTPException(status_code=500, detail="VAULT_PATH no configurat")

    # Resolve the user: a credential (cookie/Bearer, already in `auth_uid`), or
    # the install's sole local account. `x_user_id` is accepted as a parameter
    # only so FastAPI keeps declaring the header — it is NOT an identity source;
    # see `resolve_effective_user_id`.
    from backend.services.auth_service import resolve_effective_user_id

    resolved_user_id = resolve_effective_user_id(auth_uid, db)

    # PERSONAL MODE: one workspace, but optional multi-vault (X-Vault-Id; defaults to the main one)
    if params.gnosi_mode == "personal":
        ws_id = _ensure_personal_exists(db, resolved_user_id, default_vault_path)
        vpath = _resolve_personal_vault(db, ws_id, x_vault_id, default_vault_path)
        active_vault_path.set(vpath)
        return WorkspaceContext(
            workspace_id=ws_id, user_id=resolved_user_id, role="owner", vault_path=vpath
        )

    x_user_id = resolved_user_id
    x_workspace_id, membership = _organization_membership(
        db,
        x_user_id,
        x_workspace_id,
        default_vault_path,
    )
    vault = _organization_vault(db, x_workspace_id, x_user_id, x_vault_id)
    v_path = _organization_vault_path(vault, project_root, x_workspace_id)

    active_vault_path.set(v_path)

    capabilities = _membership_capabilities(membership)

    return WorkspaceContext(
        workspace_id=x_workspace_id,
        user_id=x_user_id,
        role=str(membership.role),
        vault_path=v_path,
        capabilities=capabilities,
    )
