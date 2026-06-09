from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Any
from sqlalchemy.orm import Session
import asyncio
import json
import os
import unicodedata
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


_HOST_SEARCH_HELPER_URL = os.getenv(
    "GNOSI_HOST_SEARCH_HELPER_URL",
    "http://host.docker.internal:5099/search",
)


def _search_via_host_helper(query: str, limit: int, roots: list, timeout: float = 10.0):
    """Delega la cerca a Spotlight (`mdfind`) via el helper del host.

    El backend corre dins de Docker i no té `mdfind`; el `host_open_helper`
    (pipeline/skills/host_open_helper/) escolta a 127.0.0.1:5099 al host i
    exposa `/search`. Spotlight té un índex viu del disc i torna en
    mil·lisegons, mentre que el `os.walk` del contenidor sobre OneDrive
    triga segons.

    Retorna el dict de resposta del helper (claus `results`/`truncated`), o
    `None` si el helper no està disponible o falla — perquè el caller faci
    fallback al walk local.
    """
    import urllib.request

    try:
        req = urllib.request.Request(
            _HOST_SEARCH_HELPER_URL,
            data=json.dumps({"query": query, "limit": limit, "roots": roots}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if not (200 <= resp.status < 300):
                return None
            data = json.loads(resp.read() or b"{}")
    except Exception:
        # Helper apagat, timeout, o 5xx (Spotlight ha fallat) → fallback.
        return None

    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        return None
    return data


def _dedup_by_path(primary: list, secondary: list, limit: int) -> list:
    """Fusiona dues llistes de resultats {name,path,is_dir} sense duplicats per
    `path`, mantenint l'ordre (primary primer). Talla a `limit`."""
    seen: set = set()
    out: list = []
    for item in list(primary) + list(secondary):
        p = item.get("path")
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(item)
        if len(out) >= limit:
            break
    return out


@router.post("/search", dependencies=[Depends(require_role("admin"))])
async def search_filesystem(body: SearchRequest = Body(...)):
    """Cerca per nom a tot el sistema (Vault + Biblioteca + home host).

    Estratègia:
      1. Índex de fitxers del Vault (`services/vault_file_index`) — en memòria,
         ràpid i FIABLE (no depèn del helper ni de l'estat d'OneDrive). Cobreix
         Vault + Biblioteca, les arrels CloudStorage que el helper sovint no veu.
      2. host_open_helper (Spotlight) — afegeix la resta de HOME (Documents,
         Downloads…) on el helper sí funciona. Es fusiona amb (1), dedup per ruta.
      3. Fallback (NOMÉS si l'índex encara no està llest, p.ex. just a
         l'arrencada): `os.walk` dins del contenidor, amb caps per root.
    """
    q = (body.query or "").strip().lower()
    if len(q) < 2:
        return {"results": [], "truncated": False}

    limit = max(1, min(500, body.limit or 100))

    # Helper (Spotlight) — ràpid, per a HOME/no-CloudStorage. Pot ser None (helper
    # caigut) o tornar buit per al Vault (File Provider d'OneDrive ranci): per
    # això NO ens hi refiem sols per al Vault; l'índex (sota) el cobreix.
    helper_roots = [
        p for p in (os.getenv("VAULT_HOST_PATH"), os.getenv("HOME_HOST_PATH"))
        if p
    ]
    helper_data = await asyncio.to_thread(
        _search_via_host_helper, q, limit, helper_roots
    )
    helper_results = helper_data.get("results", []) if helper_data else []

    # ── Capa 1+2: índex del Vault (fiable) fusionat amb el helper (resta de HOME) ──
    from backend.services import vault_file_index
    if vault_file_index.is_ready():
        index_results = await asyncio.to_thread(
            vault_file_index.query, body.query or "", limit
        )
        merged = _dedup_by_path(index_results, helper_results, limit)
        return {
            "results": merged,
            "truncated": bool(helper_data and helper_data.get("truncated")) or len(merged) >= limit,
            "engine": "index+spotlight",
        }

    # Índex encara no llest (finestra curta a l'arrencada): comportament previ.
    if helper_data is not None:
        return {
            "results": helper_results,
            "truncated": bool(helper_data.get("truncated")),
            "engine": "spotlight",
        }

    # ── Capa 3: fallback walk dins del contenidor ──
    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")
    vault_host = os.getenv("VAULT_HOST_PATH") or ""

    # Caminem en passades prioritàries: primer el Vault, després les
    # carpetes d'usuari habituals (Documents, Desktop, Downloads, …) i
    # finalment la resta de la HOME. Així garantim que els fitxers
    # rellevants apareguin encara que la HOME contingui molts fitxers
    # poc interessants (Library està a la skip-list però altres carpetes
    # com Movies grans poden esgotar el límit).
    #
    # Library normalment es salta perquè conté caches, plists i app data
    # que no aporten res al search. Però les carpetes de sync cloud
    # (OneDrive, Dropbox, Google Drive, Box → Library/CloudStorage; iCloud
    # Drive → Library/Mobile Documents) sí que contenen fitxers reals de
    # l'usuari i s'han de cobrir. Les afegim com a roots prioritaris
    # explícits: el skip de "Library" només es comprova durant els walks,
    # no als roots inicials, així que entrar-hi directament està permès.
    priority_subdirs = [
        "Documents", "Desktop", "Downloads", "Pictures", "Movies", "Music",
        "Library/CloudStorage", "Library/Mobile Documents",
    ]
    priority_roots: list[Path] = []
    seen_resolved: set[str] = set()

    def _add_root(raw: str) -> None:
        if not raw:
            return
        try:
            p = Path(raw).resolve()
            key = str(p)
            if key in seen_resolved:
                return
            if p.exists() and p.is_dir():
                priority_roots.append(p)
                seen_resolved.add(key)
        except Exception:
            return

    _add_root(vault_internal)
    if home_internal:
        for name in priority_subdirs:
            _add_root(os.path.join(home_internal, name))
    _add_root(home_internal)

    if not priority_roots:
        return {"results": [], "truncated": False}

    def to_host(internal: str) -> str:
        if vault_host and vault_internal and internal.startswith(vault_internal):
            return internal.replace(vault_internal, vault_host, 1)
        return internal

    import os as native_os

    # Pressupost de nodes PER root: cap carpeta pot acaparar tota la cerca.
    # Abans hi havia un únic `max_visited` global de 250k; com que el Vault
    # i, sobretot, Library/CloudStorage (OneDrive) són enormes, una sola
    # passada s'hi encallava i la crida trigava molts segons sense arribar
    # mai a Documents/Downloads. Amb un cap per root, cada carpeta rellevant
    # es visita encara que les anteriors siguin immenses.
    per_root_max_visited = 30000
    # Cap de resultats PER root: sense això el Vault (tot .md) omplia els
    # `limit` resultats abans que cap altre root hi aportés res, i la cerca
    # semblava trobar "només .md". Repartint el límit, els resultats són
    # una barreja de tots els orígens.
    per_root_result_cap = max(15, limit // max(1, len(priority_roots)))

    results: list = []
    truncated = False
    # Deduplicar resultats quan un fitxer es trobi des de més d'un root
    # prioritari (p.ex. Vault + walk genèric de HOME).
    seen_result_paths: set[str] = set()

    def _record_hit(internal: str, name: str, is_dir: bool) -> bool:
        """Afegeix un match si encara no s'havia trobat. Retorna True si
        s'ha arribat al límit GLOBAL de resultats."""
        if internal in seen_result_paths:
            return False
        seen_result_paths.add(internal)
        results.append({
            "name": name,
            "path": to_host(internal),
            "is_dir": is_dir,
        })
        return len(results) >= limit

    # Normalitza la query a NFC un cop: macOS desa noms en NFD, així una query
    # "ética" (NFC, 1 codepoint) casa amb el nom de disc descompost (e + accent).
    q_norm = unicodedata.normalize("NFC", q)

    def _walk_all() -> None:
        """Recorre els roots prioritaris omplint `results`.

        És síncron i bloquejant — un `os.walk` sobre muntatges lents com
        OneDrive pot trigar segons —, així que el handler el crida dins
        d'un thread a part per no congelar l'event loop de FastAPI.
        """
        nonlocal truncated
        for root in priority_roots:
            if len(results) >= limit:
                break
            root_visited = 0
            root_hits = 0
            stop_root = False
            for current_dir, dirs, files in native_os.walk(str(root), followlinks=False):
                # Pruna in-place. A més del soroll habitual, saltem els
                # roots prioritaris que ja caminem per separat: així el
                # walk genèric de HOME no torna a recórrer Documents,
                # Desktop, Downloads… (abans es visitaven dos cops).
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith(".")
                    and d not in _SEARCH_SKIP_DIR_NAMES
                    and not d.endswith((".app", ".photoslibrary", ".musiclibrary"))
                    and native_os.path.join(current_dir, d) not in seen_resolved
                ]

                entries = [(True, d) for d in dirs] + [(False, f) for f in files]
                for is_dir, name in entries:
                    if not is_dir and name.startswith("."):
                        continue
                    root_visited += 1
                    if root_visited > per_root_max_visited:
                        truncated = True
                        stop_root = True
                        break
                    if q_norm in unicodedata.normalize("NFC", name).lower():
                        internal = native_os.path.join(current_dir, name)
                        if _record_hit(internal, name, is_dir):
                            truncated = True
                            return
                        root_hits += 1
                        if root_hits >= per_root_result_cap:
                            truncated = True
                            stop_root = True
                            break

                if stop_root:
                    break

    try:
        await asyncio.to_thread(_walk_all)
    except Exception as e:
        return {
            "results": results,
            "truncated": truncated,
            "error": safe_error_detail(e, "POST /search filesystem"),
        }

    return {"results": results, "truncated": truncated}
