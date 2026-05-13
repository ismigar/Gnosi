from fastapi import APIRouter, Body, Depends, HTTPException, Query
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


class NotificationCreate(BaseModel):
    title: str
    message: str = ""
    level: str = "INFO"  # INFO | SUCCESS | WARNING | ERROR
    workspace_id: str = "default"


@router.post("/notifications", response_model=NotificationResponse)
async def create_notification(
    payload: NotificationCreate,
    db: Session = Depends(get_mgmt_db),
):
    """Persisteix una notificació al log central.

    Els clients (frontend, scripts) escriuen aquí perquè els errors,
    successos i avisos quedin al Control Center i no només com a toasts
    efímers. Sense protecció de role: qualsevol caller autenticat pot
    registrar-hi entries (és un log, no una acció destructiva).
    """
    try:
        level = (payload.level or "INFO").strip().upper()
        if level not in {"INFO", "SUCCESS", "WARNING", "ERROR"}:
            level = "INFO"
        notif = Notification(
            workspace_id=payload.workspace_id or "default",
            title=(payload.title or "").strip()[:200] or "(sense títol)",
            message=(payload.message or "")[:4000],
            level=level,
        )
        db.add(notif)
        db.commit()
        db.refresh(notif)
        return NotificationResponse.from_orm(notif)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /notifications"),
        )


@router.delete("/notifications", dependencies=[Depends(require_role("admin"))])
async def clear_notifications(db: Session = Depends(get_mgmt_db)):
    """Deletes all system notifications."""
    try:
        db.query(Notification).delete()
        db.commit()
        return {"success": True, "message": "All notifications deleted"}
    except Exception as e:
        db.rollback()
        # Abans retornava 200 amb body {success: False}, així el frontend no
        # podia distingir-ho d'un èxit. Ara HTTPException(500) perquè axios
        # rebuig la promesa i el caller pot reaccionar.
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /notifications"),
        )


class BrowseRequest(BaseModel):
    path: str = "/"


class SearchRequest(BaseModel):
    query: str
    limit: int = 100


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

    directories: list = []
    files: list = []
    try:
        import os as native_os
        # os.scandir is much faster than Path.iterdir() because it already reads the node-type
        with native_os.scandir(target) as it:
            for entry in it:
                try:
                    if entry.name.startswith("."):
                        continue
                    if entry.is_dir():
                        directories.append(entry.name)
                    elif entry.is_file():
                        files.append(entry.name)
                except (PermissionError, OSError):
                    continue

                # Preventive limit to avoid bloat in the frontend
                if len(directories) + len(files) >= 400:
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
    files.sort(key=lambda s: s.lower())

    return {
        "current_path": str(target),
        "display_path": display_path,
        "directories": directories,
        "files": files,
    }


# Carpetes que mai s'haurien de recórrer durant la cerca global. Library i
# CloudStorage tenen massa contingut i sovint contenen rèpliques sincronitzades
# de tota mena que esclatarien la cerca; les caches/git/node_modules són soroll.
_SEARCH_SKIP_DIR_NAMES = {
    "node_modules", ".git", "__pycache__", "Library",
    ".cache", ".local", ".npm", ".docker", ".android",
    ".gradle", ".nuget", ".vscode", ".idea", ".Trash",
    "Trash",
}


@router.post("/search", dependencies=[Depends(require_role("admin"))])
async def search_filesystem(body: SearchRequest = Body(...)):
    """Cerca substring case-insensitive a tot el sistema (vault + home host).

    Salta carpetes molt grans/sorolloses (Library, .cache, node_modules, …) i
    pàra com a màxim a 50000 entrades visitades o `limit` matches per evitar
    bloquejos llargs sobre Spotlight-like.
    """
    q = (body.query or "").strip().lower()
    if len(q) < 2:
        return {"results": [], "truncated": False}

    limit = max(1, min(500, body.limit or 100))

    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")
    vault_host = os.getenv("VAULT_HOST_PATH") or ""

    roots: list[Path] = []
    for raw in (vault_internal, home_internal):
        if not raw:
            continue
        try:
            p = Path(raw).resolve()
            if p.exists() and p.is_dir():
                roots.append(p)
        except Exception:
            continue
    if not roots:
        return {"results": [], "truncated": False}

    def to_host(internal: str) -> str:
        if vault_host and vault_internal and internal.startswith(vault_internal):
            return internal.replace(vault_internal, vault_host, 1)
        return internal

    import os as native_os
    results: list = []
    visited = 0
    max_visited = 50000
    truncated = False

    try:
        for root in roots:
            for current_dir, dirs, files in native_os.walk(str(root), followlinks=False):
                # Pruna in-place per a no descendir on no toca.
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith(".")
                    and d not in _SEARCH_SKIP_DIR_NAMES
                    and not d.endswith(".app")
                    and not d.endswith(".photoslibrary")
                    and not d.endswith(".musiclibrary")
                ]

                for name in dirs:
                    visited += 1
                    if visited > max_visited:
                        truncated = True
                        break
                    if q in name.lower():
                        internal = native_os.path.join(current_dir, name)
                        results.append({
                            "name": name,
                            "path": to_host(internal),
                            "is_dir": True,
                        })
                        if len(results) >= limit:
                            truncated = True
                            return {"results": results, "truncated": truncated}

                if truncated:
                    break

                for name in files:
                    if name.startswith("."):
                        continue
                    visited += 1
                    if visited > max_visited:
                        truncated = True
                        break
                    if q in name.lower():
                        internal = native_os.path.join(current_dir, name)
                        results.append({
                            "name": name,
                            "path": to_host(internal),
                            "is_dir": False,
                        })
                        if len(results) >= limit:
                            truncated = True
                            return {"results": results, "truncated": truncated}

                if truncated:
                    break
            if truncated:
                break
    except Exception as e:
        return {
            "results": results,
            "truncated": truncated,
            "error": safe_error_detail(e, "POST /search filesystem"),
        }

    return {"results": results, "truncated": truncated}
