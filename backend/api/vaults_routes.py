"""API de vaults (mode personal multi-vault): llistar, crear i triar vaults.

El frontend tria el vault actiu amb la capçalera `X-Vault-Id` (vegeu `workspace_service.
_resolve_personal_vault`). Sense capçalera → el vault principal (compatibilitat enrere). Útil per
clonar Notion a un vault SEPARAT, validar-lo aïllat i adoptar-lo o descartar-lo.
"""
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
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


class CreateVaultPayload(BaseModel):
    name: str
    path: Optional[str] = None   # ruta explícita; per defecte, germana del vault principal


def _default_vault_path() -> Path:
    return Path(load_params(strict_env=False).paths.get("VAULT"))


def _ensure_main_vault(db: Session, ws_id: str, default_path: Path):
    """Garanteix una fila 'Main Vault' apuntant al vault per defecte (usuaris antics sense fila)."""
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
    """Vaults del workspace + quin és l'actiu (el resolt per X-Vault-Id o el principal)."""
    _ensure_main_vault(db, ctx.workspace_id, _default_vault_path())
    active = str(get_active_vault_path() or "")
    rows = db.query(Vault).filter(Vault.workspace_id == ctx.workspace_id).all()
    vaults = [{"id": v.id, "name": v.name, "path": v.path_override or "",
               "active": (v.path_override or "") == active} for v in rows]
    return {"vaults": vaults, "active_path": active}


@router.post("", dependencies=[Depends(require_role("editor"))])
def create_vault(payload: CreateVaultPayload,
                 ctx: WorkspaceContext = Depends(get_workspace_context),
                 db: Session = Depends(get_mgmt_db)):
    """Crea un vault nou (carpeta + fila). Per defecte, germà del vault principal."""
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nom del vault és buit")
    if payload.path:
        path = Path(payload.path)
    else:
        safe = re.sub(r"[^\w\s\-À-ÿ]", "", name).strip() or "Vault"
        path = _default_vault_path().parent / safe
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No s'ha pogut crear la carpeta del vault: {e}")
    v = Vault(id=str(uuid.uuid4()), workspace_id=ctx.workspace_id, name=name, path_override=str(path))
    db.add(v)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error desant el vault")
    return {"id": v.id, "name": v.name, "path": str(path)}


@router.delete("/{vault_id}", dependencies=[Depends(require_role("editor"))])
def delete_vault(vault_id: str,
                 ctx: WorkspaceContext = Depends(get_workspace_context),
                 db: Session = Depends(get_mgmt_db)):
    """Esborra la FILA d'un vault del registre (no toca cap fitxer del disc). No es pot esborrar
    el vault actiu ni el principal (el de la ruta per defecte)."""
    v = db.query(Vault).filter(Vault.id == vault_id, Vault.workspace_id == ctx.workspace_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Vault no trobat")
    default = str(_default_vault_path())
    if (v.path_override or "") == str(ctx.vault_path):
        raise HTTPException(status_code=400, detail="No pots esborrar el vault actiu; canvia'n primer")
    if (v.path_override or "") == default:
        raise HTTPException(status_code=400, detail="No pots esborrar el vault principal")
    db.delete(v)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error esborrant el vault")
    return {"status": "success", "deleted": vault_id}
