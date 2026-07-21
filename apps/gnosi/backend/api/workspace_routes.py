from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from backend.data.management_db import get_mgmt_db
from backend.models.management import (
    Workspace, Membership, User, Vault, VaultAccess,
    WorkspaceResponse, MemberResponse, RoleUpdateRequest, 
    AddMemberRequest, VaultAccessRequest, VaultAccessResponse,
    WorkspaceBase, UserRole
)
from backend.services.auth_service import (
    get_effective_user_id,
    normalize_email,
    require_auth_enabled,
)
from backend.services.workspace_service import require_role, get_workspace_context, WorkspaceContext, require_capability
from typing import List
import json
import logging

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

@router.post("", response_model=WorkspaceResponse)
async def create_workspace(
    request: WorkspaceBase,
    x_user_id: str = Depends(get_effective_user_id),
    db: Session = Depends(get_mgmt_db)
):
    # 1. Find the creator. This used to read `X-User-ID` straight off the
    # request, which made it the second header-driven account factory (the
    # other was `_ensure_personal_exists`): an unauthenticated caller could
    # mint a User AND a Workspace owned by it, with a predictable
    # `{x_user_id}@example.com` address. The id now comes from a credential or
    # from the sole local account, so there is nothing left to mint from.
    user = db.query(User).filter(User.id == x_user_id).first()
    if not user:
        if require_auth_enabled(db):
            raise HTTPException(status_code=401, detail="Cal autenticació")

        # Bootstrap only: the id is fixed by the resolver, not caller-chosen.
        user = User(id=x_user_id, name="User",
                    email=normalize_email(f"{x_user_id}@example.com"),
                    auto_provisioned=True)
        db.add(user)
        db.flush()

    # 2. Generate slug if not specified
    slug = request.slug
    if not slug:
        import re
        slug = re.sub(r'[^a-z0-9]', '-', request.name.lower()).strip('-')
        # Avoid slug duplicates (simple suffix appending if needed)
        original_slug = slug
        counter = 1
        while db.query(Workspace).filter(Workspace.slug == slug).first():
            slug = f"{original_slug}-{counter}"
            counter += 1

    # 3. Create Workspace
    new_ws = Workspace(
        name=request.name,
        slug=slug
    )
    db.add(new_ws)
    db.flush() # To get the ID

    # 4. Assign creator as OWNER
    membership = Membership(
        user_id=x_user_id,
        workspace_id=new_ws.id,
        role=UserRole.OWNER.value
    )
    db.add(membership)
    
    # 5. Create a default Vault if it doesn't exist? 
    # For now, we create the empty workspace and let the frontend or other flows manage the vault.
    
    db.commit()
    db.refresh(new_ws)
    
    ws_response = WorkspaceResponse.from_orm(new_ws)
    ws_response.role = UserRole.OWNER.value
    return ws_response

@router.get("", response_model=List[WorkspaceResponse])
async def list_workspaces(
    x_user_id: str = Depends(get_effective_user_id),
    db: Session = Depends(get_mgmt_db)
):
    # Get all the user's members along with their workspace
    memberships = (
        db.query(Membership)
        .filter(Membership.user_id == x_user_id)
        .all()
    )
    
    results = []
    for m in memberships:
        ws = m.workspace
        if not ws:
            continue
            
        # Convert to Pydantic model and add the role
        ws_data = WorkspaceResponse(
            id=ws.id,
            name=ws.name,
            slug=ws.slug,
            created_at=ws.created_at,
            role=m.role
        )
        results.append(ws_data)
        
    return results

@router.get("/{workspace_id}/members", response_model=List[MemberResponse])
async def list_workspace_members(
    workspace_id: str,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    # Validate that the ID matches (for context security)
    if context.workspace_id != workspace_id:
         raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    memberships = db.query(Membership).filter(Membership.workspace_id == workspace_id).all()
    
    # Preparar la resposta combinant Membership i User
    results = []
    for m in memberships:
        if not m.user:
            # If there's no linked user (corrupt case), we skip it or return a placeholder
            continue
            
        import json
        permissions_dict = {}
        try:
            if m.permissions:
                permissions_dict = json.loads(m.permissions)
        except (ValueError, TypeError) as _e:
            log = logging.getLogger(__name__)
            log.warning(f"Invalid permissions JSON for membership {m.user_id}: {_e}")

        results.append({
            "user_id": m.user_id,
            "email": m.user.email,
            "name": m.user.name,
            "role": m.role,
            "permissions": permissions_dict,
            "joined_at": m.joined_at
        })
    return results

@router.put("/{workspace_id}/members/{target_user_id}/role")
async def update_member_role(
    workspace_id: str,
    target_user_id: str,
    request: RoleUpdateRequest,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
         raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    membership = db.query(Membership).filter(
        Membership.workspace_id == workspace_id,
        Membership.user_id == target_user_id
    ).first()
    
    if not membership:
        raise HTTPException(status_code=404, detail="Membre no trobat")
    
    # Prevent an admin from removing their own admin role or changing an owner's?
    # For now, we allow the admin to manage everything except perhaps their own role if they're the last admin.
    
    if request.role:
        membership.role = request.role.value
    if request.permissions is not None:
        import json
        membership.permissions = json.dumps(request.permissions)
        
    db.commit()
    return {"status": "ok", "message": "Membre actualitzat"}

@router.post("/{workspace_id}/members")
async def add_workspace_member(
    workspace_id: str,
    request: AddMemberRequest,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
         raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    # 1. Find or create user
    # Same canonical form as auth: the unique index is case-sensitive, so an
    # exact match here would miss an existing `ismael@x.com` when inviting
    # `Ismael@X.com` and create a SECOND, password-less row. The membership would
    # then hang off the duplicate while the real user logs into the other one.
    invited_email = normalize_email(request.email)
    user = db.query(User).filter(func.lower(User.email) == invited_email).first()
    if not user:
        # Create placeholder user
        user_name = invited_email.split('@')[0].capitalize()
        user = User(email=invited_email, name=user_name)
        db.add(user)
        db.flush() # To get the ID
    
    # 2. Check if already a member
    existing = db.query(Membership).filter(
        Membership.workspace_id == workspace_id,
        Membership.user_id == user.id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="L'usuari ja és membre d'aquest workspace")
    
    # 3. Create membership
    import json
    new_member = Membership(
        user_id=user.id,
        workspace_id=workspace_id,
        role=request.role.value,
        permissions=json.dumps(request.permissions) if request.permissions else None
    )
    db.add(new_member)
    db.commit()
    
    return {"status": "ok", "message": f"Usuari {request.email} afegit correctament"}

@router.delete("/{workspace_id}/members/{target_user_id}")
async def remove_workspace_member(
    workspace_id: str,
    target_user_id: str,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
         raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    membership = db.query(Membership).filter(
        Membership.workspace_id == workspace_id,
        Membership.user_id == target_user_id
    ).first()
    
    if not membership:
        raise HTTPException(status_code=404, detail="Membre no trobat")

    # Prevent an admin from removing themselves if they're the last one?
    # For now, direct action.
    db.delete(membership)
    db.commit()
    
    return {"status": "ok", "message": "Membre eliminat"}

@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace_id: str,
    x_user_id: str = Depends(get_effective_user_id),
    db: Session = Depends(get_mgmt_db)
):
    # Validate that the user has access
    membership = db.query(Membership).filter(
        Membership.user_id == x_user_id,
        Membership.workspace_id == workspace_id
    ).first()
    
    if not membership:
        raise HTTPException(status_code=403, detail="No tens permís per accedir a aquest workspace")

    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        # Corrupt case: the membership exists but the workspace has been
        # deleted. `from_orm(None)` would crash with a 500. We return a 404
        # explicitly so the frontend can react (refresh the list, etc.).
        raise HTTPException(status_code=404, detail="Workspace no trobat (membresia òrfena)")
    ws_data = WorkspaceResponse.from_orm(workspace)
    ws_data.role = membership.role
    return ws_data

@router.get("/{workspace_id}/vaults")
async def list_workspace_vaults(
    workspace_id: str,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    vaults = db.query(Vault).filter(Vault.workspace_id == workspace_id).all()
    return [{"id": v.id, "name": v.name} for v in vaults]

# --- VaultAccess Management Endpoints ---

@router.get("/{workspace_id}/members/{user_id}/vaults", response_model=List[VaultAccessResponse])
async def list_member_vault_access(
    workspace_id: str,
    user_id: str,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    access_list = db.query(VaultAccess).filter(
        VaultAccess.workspace_id == workspace_id,
        VaultAccess.user_id == user_id
    ).all()
    
    results = []
    for acc in access_list:
        results.append({
            "vault_id": acc.vault_id,
            "vault_name": acc.vault.name if acc.vault else "Unknown",
            "permissions": json.loads(acc.permissions) if acc.permissions else {"capabilities": ["read"]}
        })
    return results

@router.post("/{workspace_id}/members/{user_id}/vaults")
async def grant_vault_access(
    workspace_id: str,
    user_id: str,
    request: VaultAccessRequest,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    # Validate that the vault exists
    vault = db.query(Vault).filter(Vault.id == request.vault_id, Vault.workspace_id == workspace_id).first()
    if not vault:
        raise HTTPException(status_code=404, detail="Vault no trobat")

    import json
    existing = db.query(VaultAccess).filter(
        VaultAccess.vault_id == request.vault_id,
        VaultAccess.user_id == user_id
    ).first()

    if existing:
        existing.permissions = json.dumps(request.permissions)
    else:
        new_access = VaultAccess(
            vault_id=request.vault_id,
            user_id=user_id,
            workspace_id=workspace_id,
            permissions=json.dumps(request.permissions)
        )
        db.add(new_access)

    db.commit()
    return {"status": "ok", "message": "Accés a Vault actualitzat"}

@router.delete("/{workspace_id}/members/{user_id}/vaults/{vault_id}")
async def revoke_vault_access(
    workspace_id: str,
    user_id: str,
    vault_id: str,
    db: Session = Depends(get_mgmt_db),
    context: WorkspaceContext = Depends(require_role("admin"))
):
    if context.workspace_id != workspace_id:
        raise HTTPException(status_code=403, detail="Workspace ID mismatch")

    access = db.query(VaultAccess).filter(
        VaultAccess.vault_id == vault_id,
        VaultAccess.user_id == user_id
    ).first()
    
    if access:
        db.delete(access)
        db.commit()
        return {"status": "ok", "message": "Accés revocat"}
    
    raise HTTPException(status_code=404, detail="Accés no trobat")
