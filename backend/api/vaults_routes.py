"""API de vaults (mode personal multi-vault): llistar, crear i triar vaults.

El frontend tria el vault actiu amb la capçalera `X-Vault-Id` (vegeu `workspace_service.
_resolve_personal_vault`). Sense capçalera → el vault principal (compatibilitat enrere). Útil per
clonar Notion a un vault SEPARAT, validar-lo aïllat i adoptar-lo o descartar-lo.
"""
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

# Estructura estàndard d'un vault (mirall del mapping de get_p a vault_routes): es crea en crear
# un vault nou perquè quedi llest per usar (registre a BD/, adjunts a Assets/, etc.).
_VAULT_SUBFOLDERS = ["Assets", "BD", "Wiki", "Calendar", "Mail", "Templates", "Drawings",
                     "Daily Notes", "Newsletters", ".Dashboards", ".gnosi"]


def _scaffold_vault_structure(base: Path) -> None:
    """Crea les subcarpetes estàndard d'un vault sota `base` (idempotent)."""
    for sub in _VAULT_SUBFOLDERS:
        try:
            (base / sub).mkdir(parents=True, exist_ok=True)
        except Exception:  # noqa: BLE001
            pass


class CreateVaultPayload(BaseModel):
    name: str
    path: Optional[str] = None   # ruta explícita; per defecte, germana del vault principal


def _default_vault_path() -> Path:
    return Path(load_params(strict_env=False).paths.get("VAULT"))


def _prune_container_rows(db: Session, ws_id: str, default_path: Path) -> None:
    """Elimina files ràncies que apunten al CONTENIDOR de vaults (…/Gnosi), no a un vault.

    De l'època pre-multi-vault (o d'un env mal apuntat) pot quedar una fila el path de la
    qual és ANCESTRE del path d'un altre vault registrat (…/Gnosi vs …/Gnosi/Principal).
    Seleccionar-la re-crea tota l'estructura (BD/, Mail/, Assets/…) a l'arrel de vaults.
    Els vaults registrats són sempre germans: un path que conté un altre vault és per
    definició el contenidor. Comparació lexical (`is_relative_to`), sense tocar el FS
    (OneDrive). Mai s'esborra la fila del vault per defecte.
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
        _scaffold_vault_structure(path)   # Assets, BD, Wiki… → vault llest per usar
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
    """Esborra la FILA d'un vault del registre. Amb `delete_files=true` també ESBORRA la carpeta
    del disc (per descartar un clon sencer). No es pot esborrar el vault actiu ni el principal."""
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
        # SEGURETAT: només esborrem si la carpeta viu SOTA l'arrel de vaults (…/Gnosi/) i no és
        # l'arrel ni el vault per defecte. Així un `delete_files` no pot esborrar res arbitrari.
        try:
            root = _default_vault_path().parent.resolve()
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
