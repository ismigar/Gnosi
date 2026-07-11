"""Vaults API (personal multi-vault mode): list, create and choose vaults.

The frontend picks the active vault with the `X-Vault-Id` header (see `workspace_service.
_resolve_personal_vault`). Without a header → the main vault (backward compatibility). Useful for
cloning Notion into a SEPARATE vault, validating it in isolation, and adopting or discarding it.
"""
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.management import Vault
from backend.services.workspace_service import (
    get_workspace_context, WorkspaceContext, require_role,
)
from backend.services.context_vars import get_active_vault_path
from backend.config.app_config import load_params

router = APIRouter(prefix="/vaults", tags=["Vaults"])

# Standard structure of a vault (mirrors the get_p mapping in vault_routes): created when creating
# a new vault so it's ready to use (registry in BD/, attachments in Assets/, etc.).
_VAULT_SUBFOLDERS = ["Assets", "BD", "Wiki", "Calendar", "Mail", "Templates", "Drawings",
                     "Daily Notes", "Newsletters", ".Dashboards", ".gnosi"]


def _scaffold_vault_structure(base: Path) -> None:
    """Creates a vault's standard subfolders under `base` (idempotent)."""
    for sub in _VAULT_SUBFOLDERS:
        try:
            (base / sub).mkdir(parents=True, exist_ok=True)
        except Exception:  # noqa: BLE001
            pass


class CreateVaultPayload(BaseModel):
    name: str
    path: Optional[str] = None   # explicit path; defaults to a sibling of the main vault


def _default_vault_path() -> Path:
    return Path(load_params(strict_env=False).paths.get("VAULT"))


def _vaults_root() -> Path:
    """Root where vaults live (…/Gnosi on the host). In native mode it's the parent of the
    default vault; under Docker the parent of /vault is `/` (the container's root!), so
    compose mounts the vaults container at /vaults and declares it via GNOSI_VAULTS_ROOT."""
    env = os.environ.get("GNOSI_VAULTS_ROOT")
    return Path(env) if env else _default_vault_path().parent


def _prune_container_rows(db: Session, ws_id: str, default_path: Path) -> None:
    """Removes stale rows that point to the vaults CONTAINER (…/Gnosi), not to a vault.

    From the pre-multi-vault era (or a misconfigured env) a row may remain whose path
    is an ANCESTOR of another registered vault's path (…/Gnosi vs …/Gnosi/Principal).
    Selecting it re-creates the whole structure (BD/, Mail/, Assets/…) at the vaults root.
    Registered vaults are always siblings: a path that contains another vault is by
    definition the container. Lexical comparison (`is_relative_to`), without touching the FS
    (OneDrive). The default vault's row is never deleted.
    
    """
    rows = db.query(Vault).filter(Vault.workspace_id == ws_id).all()
    paths = {r.id: Path(r.path_override) for r in rows if r.path_override}
    default = Path(str(default_path))
    stale = [
        r for r in rows
        if r.id in paths and paths[r.id] != default
        and any(p != paths[r.id] and p.is_relative_to(paths[r.id])
                for rid, p in paths.items() if rid != r.id)
    ]
    if not stale:
        return
    for r in stale:
        db.delete(r)
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        return
    try:
        from backend.services.active_vault_middleware import reset_vault_path_cache
        reset_vault_path_cache()
    except Exception:  # noqa: BLE001
        pass


def _ensure_main_vault(db: Session, ws_id: str, default_path: Path):
    """Ensures a 'Main Vault' row pointing to the default vault (for legacy users without a row)."""
    dp = str(default_path)
    exists = db.query(Vault).filter(Vault.workspace_id == ws_id, Vault.path_override == dp).first()
    if exists:
        return exists
    v = Vault(id=str(uuid.uuid4()), workspace_id=ws_id, name="Vault principal", path_override=dp)
    db.add(v)
    try:
        db.commit()
    except Exception:
        db.rollback()
        return db.query(Vault).filter(Vault.workspace_id == ws_id, Vault.path_override == dp).first()
    return v


@router.get("")
def list_vaults(ctx: WorkspaceContext = Depends(get_workspace_context),
                db: Session = Depends(get_mgmt_db)):
    """Workspace vaults + which one is active (the one resolved by X-Vault-Id or the main one)."""
    _ensure_main_vault(db, ctx.workspace_id, _default_vault_path())
    _prune_container_rows(db, ctx.workspace_id, _default_vault_path())
    active = str(get_active_vault_path() or "")
    rows = db.query(Vault).filter(Vault.workspace_id == ctx.workspace_id).all()
    vaults = [{"id": v.id, "name": v.name, "path": v.path_override or "",
               "active": (v.path_override or "") == active} for v in rows]
    return {"vaults": vaults, "active_path": active}


@router.post("", dependencies=[Depends(require_role("editor"))])
def create_vault(payload: CreateVaultPayload,
                 ctx: WorkspaceContext = Depends(get_workspace_context),
                 db: Session = Depends(get_mgmt_db)):
    """Creates a new vault (folder + row). Defaults to a sibling of the main vault."""
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nom del vault és buit")
    if payload.path:
        path = Path(payload.path)
    else:
        safe = re.sub(r"[^\w\s\-À-ÿ]", "", name).strip() or "Vault"
        path = _vaults_root() / safe
    try:
        path.mkdir(parents=True, exist_ok=True)
        _scaffold_vault_structure(path)   # Assets, DB, Wiki… → vault ready to use
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No s'ha pogut crear la carpeta del vault: {e}")
    v = Vault(id=str(uuid.uuid4()), workspace_id=ctx.workspace_id, name=name, path_override=str(path))
    db.add(v)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error desant el vault")
    try:
        from backend.services.active_vault_middleware import reset_vault_path_cache
        reset_vault_path_cache()
    except Exception:
        pass
    return {"id": v.id, "name": v.name, "path": str(path)}


@router.delete("/{vault_id}", dependencies=[Depends(require_role("editor"))])
def delete_vault(vault_id: str,
                 delete_files: bool = Query(default=False),
                 ctx: WorkspaceContext = Depends(get_workspace_context),
                 db: Session = Depends(get_mgmt_db)):
    """Deletes a vault's ROW from the registry. With `delete_files=true` it also DELETES the
    folder from disk (to discard a whole clone). The active vault and the main vault can't be deleted."""
    v = db.query(Vault).filter(Vault.id == vault_id, Vault.workspace_id == ctx.workspace_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Vault no trobat")
    default = str(_default_vault_path())
    if (v.path_override or "") == str(ctx.vault_path):
        raise HTTPException(status_code=400, detail="No pots esborrar el vault actiu; canvia'n primer")
    if (v.path_override or "") == default:
        raise HTTPException(status_code=400, detail="No pots esborrar el vault principal")
    vpath = Path(v.path_override) if v.path_override else None
    db.delete(v)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error esborrant el vault")
    if delete_files and vpath:
        # SECURITY: we only delete if the folder lives UNDER the vaults root (…/Gnosi/) and isn't
        # the root or the default vault. This way a `delete_files` can't delete anything arbitrary.
        # Under Docker the root must come from GNOSI_VAULTS_ROOT: the parent of /vault is `/` and the
        # `root in p.parents` check would become true for ANY absolute path.
        try:
            root = _vaults_root().resolve()
            p = vpath.resolve()
            if p.exists() and p != root and str(p) != default and root in p.parents:
                shutil.rmtree(p)
        except Exception:  # noqa: BLE001
            pass
    try:
        from backend.services.active_vault_middleware import reset_vault_path_cache
        reset_vault_path_cache()
    except Exception:
        pass
    return {"status": "success", "deleted": vault_id}
