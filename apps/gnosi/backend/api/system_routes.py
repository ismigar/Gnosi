from fastapi import APIRouter, Body
from pydantic import BaseModel
import os
from pathlib import Path

router = APIRouter()


class BrowseRequest(BaseModel):
    path: str = "/"


@router.get("/stats")
async def get_system_stats():
    """Returns basic system statistics."""
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

    # ── Friendly Routes (Host Mapping) ──
    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    vault_host = os.getenv("VAULT_HOST_PATH") or ""
    home_host = os.getenv("HOME_HOST_PATH")

    display_path = str(target)
    if vault_host and str(target).startswith(vault_internal):
        display_path = str(target).replace(vault_internal, vault_host, 1)
    elif home_host and str(target).startswith(home_host):
        # If the internal path matches the host's (like HOME)
        display_path = str(target)

    directories = []
    try:
        import os as native_os
        # os.scandir is much faster than Path.iterdir() because it already reads the node-type
        with native_os.scandir(target) as it:
            for entry in it:
                try:
                    if entry.is_dir() and not entry.name.startswith("."):
                        directories.append(entry.name)
                except (PermissionError, OSError):
                    continue
                
                # Preventive limit to avoid bloat in the frontend
                if len(directories) > 200:
                    break
    except PermissionError:
        # If the root directory lacks permission
        return {"error": f"Permission denied at {target}. Check macroscopic Mac permissions.", "current_path": str(target), "display_path": display_path}
    except Exception as e:
        return {"error": f"Error accessing path: {str(e)}", "current_path": str(target), "display_path": display_path}

    directories.sort(key=lambda s: s.lower())

    return {
        "current_path": str(target),
        "display_path": display_path,
        "directories": directories
    }
