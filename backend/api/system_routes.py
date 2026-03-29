from fastapi import APIRouter, Body
from pydantic import BaseModel
import os
from pathlib import Path

router = APIRouter()


class BrowseRequest(BaseModel):
    path: str = "/"


@router.get("/stats")
async def get_system_stats():
    """Retorna estadístiques mímimes del sistema."""
    return {"cpu": 10.0, "ram_percent": 50.0, "memory_items": 42, "status": "online"}


@router.get("/suggestions")
async def get_suggestions():
    return {"suggestions": []}


@router.get("/graph/visualization")
async def get_graph_viz():
    return {"nodes": [], "edges": []}


@router.post("/browse")
async def browse_directory(body: BrowseRequest = Body(...)):
    """Browse directory contents for folder picker."""
    target_path = body.path

    if not target_path:
        target_path = "/"

    try:
        target = Path(target_path).resolve()
    except Exception:
        return {"error": "Invalid path"}

    if not target.exists():
        return {"error": "Path does not exist"}

    if not target.is_dir():
        return {"error": "Not a directory"}

    # ── Rutas amigables (Host Mapping) ──
    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH", "/vault")
    vault_host = os.getenv("VAULT_HOST_PATH")
    home_host = os.getenv("HOME_HOST_PATH")

    display_path = str(target)
    if vault_host and str(target).startswith(vault_internal):
        display_path = str(target).replace(vault_internal, vault_host, 1)
    elif home_host and str(target).startswith(home_host):
        # Si la ruta interna coincideix amb la del host (com la HOME)
        display_path = str(target)

    directories = []
    try:
        # Intentem iterar sobre el directori
        for entry in target.iterdir():
            try:
                # Comprovem individualment si és un directori i tenim permís
                if entry.is_dir() and not entry.name.startswith("."):
                    directories.append(entry.name)
            except (PermissionError, OSError):
                # Ignorem carpetes individuals sense permís
                continue
    except PermissionError:
        # Si el directori arrel és el que no té permís
        return {"error": "Permission denied", "current_path": str(target), "display_path": display_path}

    directories.sort(key=lambda s: s.lower())

    return {
        "current_path": str(target),
        "display_path": display_path,
        "directories": directories
    }
