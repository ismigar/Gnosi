from fastapi import Header, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.data.management_db import get_mgmt_db
from backend.models.management import Workspace, Membership, User, Vault, VaultAccess
from typing import Optional
from pathlib import Path
from backend.config.app_config import load_params
import uuid

from backend.services.context_vars import active_vault_path

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
    Retorna una dependència que valida si l'usuari té el rol mínim necessari.
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
    Valida si l'usuari té una capacitat específica al JSON de permisos.
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
    """Assegura que existeixi un workspace personal per a l'usuari."""
    # 1. Trobar o crear usuari
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        user = User(id=user_id, name="User", email="user@example.com")
        db.add(user)
        db.commit()

    # 2. Cercar membresia 'Personal'
    membership = db.query(Membership).filter(
        Membership.user_id == user_id,
        Membership.role == "owner"
    ).first()

    if not membership:
        # Crear workspace
        ws_id = "personal"
        ws = db.query(Workspace).filter(Workspace.id == ws_id).first()
        if not ws:
            ws = Workspace(id=ws_id, name="Personal Workspace")
            db.add(ws)
        
        # Crear Vault
        rel_vault = str(vault_path)
        v = Vault(id=str(uuid.uuid4()), workspace_id=ws_id, name="Main Vault", path_override=rel_vault)
        db.add(v)
        
        # Crear Membresia
        membership = Membership(user_id=user_id, workspace_id=ws_id, role="owner")
        db.add(membership)
        
        db.commit()
        return ws_id
    
    return membership.workspace_id

def get_workspace_context(
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header("ismael-legacy"), 
    db: Session = Depends(get_mgmt_db)
) -> WorkspaceContext:
    
    params = load_params(strict_env=False)
    project_root = params.paths.get("PROJECT_DIR")
    default_vault_path = params.paths.get("VAULT")

    # MODE PERSONAL: Simplificació total
    if params.gnosi_mode == "personal":
        ws_id = _ensure_personal_exists(db, x_user_id, default_vault_path)
        active_vault_path.set(default_vault_path)
        return WorkspaceContext(
            workspace_id=ws_id,
            user_id=x_user_id,
            role="owner",
            vault_path=default_vault_path
        )

    # MODE ORGANITZACIÓ: Lògica Multi-tenant
    if not x_workspace_id:
        membership = db.query(Membership).filter(Membership.user_id == x_user_id).first()
        if not membership:
            # Si no hi ha res, creem el personal per defecte per evitar bloquejos
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

    # Comprovar si hi ha restriccions de VaultAccess
    vault_access = db.query(VaultAccess).filter(
        VaultAccess.workspace_id == x_workspace_id,
        VaultAccess.user_id == x_user_id
    ).all()
    
    allowed_vault_ids = [va.vault_id for va in vault_access]
    
    # Si no hi ha restriccions explícites, i es owner/admin, pot veure tots? 
    # Per ara, si n'hi ha, filtrem. Si no n'hi ha, permetem el primer (comportament original).
    
    query = db.query(Vault).filter(Vault.workspace_id == x_workspace_id)
    if allowed_vault_ids:
        query = query.filter(Vault.id.in_(allowed_vault_ids))
    
    vault = query.first()
    
    if not vault:
        # Si hi havia restriccions i no n'ha trobat cap de vàlid
        if allowed_vault_ids:
             raise HTTPException(status_code=403, detail="No tens accés a cap Vault en aquest workspace")
        # Altrament, si no hi ha cap vault al workspace
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
        except:
            pass
    
    # Si és admin o owner, té totes per defecte si no s'especifica
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
