from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel
from typing import List, Dict, Any
from sqlalchemy.orm import Session
import os
import psutil
from pathlib import Path
from backend.data.management_db import get_mgmt_db
from backend.models.notification import Notification, NotificationResponse
from backend.services.graph_service import GraphService
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail

router = APIRouter()


@router.get("/notifications", response_model=Dict[str, Any])
async def get_notifications(
    limit: int = 50, 
    offset: int = 0,
    db: Session = Depends(get_mgmt_db)
):
    """Returns system notifications with pagination."""
    query = db.query(Notification)
    total = query.count()
    items = query.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
    
    return {
        "items": [NotificationResponse.from_orm(i) for i in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": total > offset + limit
    }


@router.delete("/notifications", dependencies=[Depends(require_role("admin"))])
async def clear_notifications(db: Session = Depends(get_mgmt_db)):
    """Deletes all system notifications."""
    try:
        db.query(Notification).delete()
        db.commit()
        return {"success": True, "message": "All notifications deleted"}
    except Exception as e:
        db.rollback()
        return {
            "success": False,
            "error": safe_error_detail(e, "DELETE /notifications"),
        }


class BrowseRequest(BaseModel):
    path: str = "/"


@router.get("/stats")
async def get_system_stats():
    """Returns real system statistics."""
    try:
        cpu = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory().percent
        
        # Get real node count from GraphService
        service = GraphService()
        memory_items = service.get_node_count()
        
        return {
            "cpu": cpu,
            "ram_percent": ram,
            "memory_items": memory_items,
            "status": "online"
        }
    except Exception as e:
        # Fallback to defaults or partial data if psutil fails
        return {
            "cpu": 0.0,
            "ram_percent": 0.0,
            "memory_items": 0,
            "status": "degraded",
            "error": safe_error_detail(e, "GET /stats"),
        }


@router.get("/suggestions")
async def get_suggestions():
    return {"suggestions": []}


@router.get("/graph/visualization")
async def get_graph_viz():
    return {"nodes": [], "edges": []}


@router.post("/browse", dependencies=[Depends(require_role("admin"))])
async def browse_directory(body: BrowseRequest = Body(...)):
    """Browse directory contents for folder picker.

    Security: this endpoint can list arbitrary directories, which is a
    potential information-disclosure vector if exposed without auth. We
    require admin and constrain navigation to a small allow-list of roots
    (the vault and the home directory mount).
    """
    target_path = body.path

    # Allow-list of roots that can be browsed. Anything outside is rejected.
    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")
    allowed_roots = []
    for raw in (vault_internal, home_internal):
        if raw:
            try:
                allowed_roots.append(Path(raw).resolve())
            except Exception:
                pass
    # Sensible fallback: vault parent (so the picker can step up one level)
    try:
        if vault_internal:
            allowed_roots.append(Path(vault_internal).resolve().parent)
    except Exception:
        pass

    if not target_path:
        # Default to the vault root, not "/"
        target_path = vault_internal or home_internal or "/"

    try:
        target = Path(target_path).resolve()
    except Exception:
        return {"error": "Invalid path"}

    # Containment check — prevents `/etc`, `/root`, traversal, etc.
    # If we couldn't build any allowed roots, deny by default (fail-closed)
    # rather than open the filesystem to arbitrary browsing.
    if not allowed_roots:
        return {"error": "Server misconfigured: no allowed roots resolved"}

    if not any(
        target == root or target.is_relative_to(root) for root in allowed_roots
    ):
        return {"error": "Path is outside of allowed roots"}

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
        return {
            "error": safe_error_detail(e, "POST /browse access path"),
            "current_path": str(target),
            "display_path": display_path,
        }

    directories.sort(key=lambda s: s.lower())

    return {
        "current_path": str(target),
        "display_path": display_path,
        "directories": directories
    }
