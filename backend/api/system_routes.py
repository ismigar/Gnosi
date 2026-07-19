from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import List, Dict, Any
from sqlalchemy.orm import Session
import asyncio
import json
import os
import unicodedata
import psutil
from pathlib import Path
from backend.config.env_config import default_host_helper_url
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
    """Persist a notification to the central log.

    Clients (frontend, scripts) write here so that errors,
    successes, and warnings end up in the Control Center and not only as ephemeral
    toasts. No role protection: any authenticated caller can
    log entries here (it's a log, not a destructive action).
    
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
        # Previously returned 200 with body {success: False}, so the frontend couldn't
        # distinguish it from a success. Now HTTPException(500) so that axios
        # reject the promise so the caller can react.
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /notifications"),
        )


class BrowseRequest(BaseModel):
    path: str = "/"


class SearchRequest(BaseModel):
    query: str
    limit: int = 100


class NativePickRequest(BaseModel):
    mode: str = "any"  # "file" | "folder" | "any"
    prompt: str = ""
    multiple: bool = False  # files only: allow picking several at once


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
    """Browse directory contents for the folder/file picker.

    Security: admin-only. The picker is meant to let the operator pick ANY
    file or folder on the host (see the whole-computer search box and the
    Root shortcut in the UI), so navigation is anchored on three roots — the
    ACTIVE vault, the current user's home, and "/" — with the admin gate as
    the trust boundary. Non-existent / non-directory targets are still rejected.
    """
    from backend.services.context_vars import get_active_vault_path

    target_path = body.path

    # ── Navigable roots ──
    # These three are ALSO returned (in `roots`) so the frontend shortcut
    # buttons point at exactly what this endpoint accepts.
    #   • Vault → the ACTIVE vault, resolved per-request (X-Vault-Id / cookie),
    #     so switching vaults moves the shortcut with it. NOT a static env path
    #     (that would pin the shortcut to Principal regardless of the active vault).
    #   • Home  → the current user's home (host mount in Docker, real $HOME natively).
    #   • Root  → "/", so the picker can reach any file on the machine.
    try:
        _vp = get_active_vault_path()
        vault_internal = str(_vp) if _vp else ""
    except Exception:
        vault_internal = ""
    if not vault_internal:
        # Fallback if there's no active-vault context (e.g. no cookie yet).
        vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")

    # Shortcut targets for the frontend. Internal paths (what `browse` accepts);
    # Docker maps them to host paths for display via the mapping block below.
    # Returned on EVERY response — including errors — so the shortcuts are always
    # available to recover from a bad/stale initial path.
    roots = {
        "vault": vault_internal or None,
        "home": home_internal or None,
        "root": "/",
    }

    allowed_roots = []
    for raw in (vault_internal, home_internal, "/"):
        if raw:
            try:
                allowed_roots.append(Path(raw).resolve())
            except Exception:
                pass

    if not target_path:
        # Default to the active vault root, not "/"
        target_path = vault_internal or home_internal or "/"

    try:
        target = Path(target_path).resolve()
    except Exception:
        return {"error": "Invalid path", "error_code": "invalid_path", "roots": roots}

    # Containment check. "/" is an allowed root (admin-only endpoint, picker is
    # meant to browse the whole host), so in practice this validates that the
    # target is an absolute, existing path rather than caging it — the admin gate
    # is the boundary. Fail-closed if no roots resolved.
    if not allowed_roots:
        return {"error": "Server misconfigured: no allowed roots resolved", "error_code": "no_roots", "roots": roots}

    if not any(
        target == root or target.is_relative_to(root) for root in allowed_roots
    ):
        return {"error": "Path is outside of allowed roots", "error_code": "outside_roots", "roots": roots}

    if not target.exists():
        return {"error": "Path does not exist", "error_code": "not_found", "roots": roots}

    if not target.is_dir():
        return {"error": "Not a directory", "error_code": "not_a_directory", "roots": roots}

    # ── Friendly Routes (Host Mapping) ──
    # In Docker the vault is mounted at an internal path (/vault) that differs
    # from what Finder shows (VAULT_HOST_PATH); map it back for display. Natively
    # internal == host, so this is a no-op.
    vault_host = os.getenv("VAULT_HOST_PATH") or ""
    home_host = os.getenv("HOME_HOST_PATH")

    display_path = str(target)
    if vault_host and vault_internal and str(target).startswith(vault_internal):
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
        # If the directory lacks permission. `error` is an English fallback; the
        # frontend shows the localized `error_code` message (OS-neutral).
        return {"error": f"Permission denied at {target}. Check the folder permissions.", "error_code": "permission_denied", "current_path": str(target), "display_path": display_path, "roots": roots}
    except Exception as e:
        return {
            "error": safe_error_detail(e, "POST /browse access path"),
            "error_code": "access_error",
            "current_path": str(target),
            "display_path": display_path,
            "roots": roots,
        }

    directories.sort(key=lambda s: s.lower())
    files.sort(key=lambda s: s.lower())

    return {
        "current_path": str(target),
        "display_path": display_path,
        "directories": directories,
        "files": files,
        "roots": roots,
    }


# ── Native OS open dialog (progressive enhancement over the in-app picker) ──
# All Finder/GUI interaction is owned by the host_open_helper (loopback :5099,
# runs in the user's Aqua session with Full Disk Access); the backend only
# proxies to it, on loopback (native) or host.docker.internal (Docker) — see
# default_host_helper_url(). Per-endpoint env overrides mirror the search helper.
_HOST_PICK_HELPER_URL = (
    os.getenv("GNOSI_HOST_PICK_HELPER_URL")
    or default_host_helper_url("/pick")
)
_HOST_HEALTH_HELPER_URL = (
    os.getenv("GNOSI_HOST_HEALTH_HELPER_URL")
    or default_host_helper_url("/healthz")
)


def _native_pick_via_helper(mode: str, prompt: str, multiple: bool = False, timeout: float = 3600.0):
    """Ask the host helper to show the native dialog. Returns its response dict
    ({"status": "ok"|"cancelled", ...}), or None if the helper is unavailable.

    The timeout must outlast a HUMAN, not a machine: the request blocks for as
    long as the panel sits open on screen, and someone browsing to the right
    folder can easily take longer than the 5 minutes this used to allow. When it
    expired the pick was lost for good — the backend answered 502 while the user
    was still choosing, and the helper then wrote its reply into a closed socket
    (BrokenPipeError). It matches the helper's own osascript cap (1 h), so
    whichever end gives up first, both give up together. Callers MUST run this
    off the event loop (asyncio.to_thread) so a lingering dialog never freezes
    the backend.
    """
    import urllib.request

    try:
        req = urllib.request.Request(
            _HOST_PICK_HELPER_URL,
            data=json.dumps({"mode": mode, "prompt": prompt, "multiple": multiple}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if not (200 <= resp.status < 300):
                return None
            data = json.loads(resp.read() or b"{}")
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _host_helper_healthy(timeout: float = 1.5) -> bool:
    """Quick reachability probe of the host helper's /healthz (short timeout so
    the availability check never stalls the picker's open)."""
    import urllib.request

    try:
        with urllib.request.urlopen(_HOST_HEALTH_HELPER_URL, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _is_loopback_request(request: Request) -> bool:
    """True when the caller is on the same machine as the backend.

    The native dialog is drawn on the HOST; it's only useful when the browser is
    also on the host. A LAN client (phone/other laptop) arrives with its real IP
    → not loopback → native pick is hidden and the in-app picker is used. Behind
    the native Vite dev proxy the connection is loopback, matching the desktop
    single-machine case this feature targets.
    """
    host = (request.client.host if request and request.client else "") or ""
    return host in ("127.0.0.1", "::1", "localhost")


@router.get("/native-pick/available", dependencies=[Depends(require_role("admin"))])
async def native_pick_available(request: Request):
    """Whether the native OS file/folder dialog can be offered from here.

    Available only when the caller is loopback AND the host_open_helper answers
    /healthz. Either check failing hides the button in the frontend, which then
    keeps using the in-app FilesystemPickerModal — the always-available fallback.
    """
    if not _is_loopback_request(request):
        return {"available": False, "reason": "remote_client"}
    healthy = await asyncio.to_thread(_host_helper_healthy)
    return {"available": bool(healthy), "reason": None if healthy else "helper_unreachable"}


@router.post("/native-pick", dependencies=[Depends(require_role("admin"))])
async def native_pick(request: Request, body: NativePickRequest = Body(...)):
    """Open the host's native file/folder dialog and return the chosen path.

    A browser can never read the absolute host path of a file picked through
    <input type=file>, so the choice is delegated to the host_open_helper, which
    runs macOS's real NSOpenPanel in the user's GUI session.
    Loopback-only. The returned path is a HOST path — the same shape /browse
    hands to the frontend's onSelect — so the caller's flow is unchanged. With
    `multiple` (files only) the response also carries `paths`, the full list;
    `path` stays the first one so single-pick callers need no change.
    Returns {"status": "cancelled"} verbatim when the user dismisses the dialog.
    """
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="Native picker is loopback-only")
    mode = (body.mode or "any").strip().lower()
    if mode not in ("file", "folder", "any"):
        mode = "any"
    # "any" shows files AND folders in one panel; only a folder-only pick is
    # restricted to a single entry (no caller links more than one folder).
    multiple = bool(body.multiple) and mode != "folder"
    result = await asyncio.to_thread(_native_pick_via_helper, mode, body.prompt or "", multiple)
    if result is None:
        raise HTTPException(status_code=502, detail="Host picker helper unavailable")
    return result


# Folders that should never be traversed during the global search. Library and
# CloudStorage have too much content and often contain synced replicas
# of every kind that would blow up the search; caches/git/node_modules are noise.
_SEARCH_SKIP_DIR_NAMES = {
    "node_modules", ".git", "__pycache__", "Library",
    ".cache", ".local", ".npm", ".docker", ".android",
    ".gradle", ".nuget", ".vscode", ".idea", ".Trash",
    "Trash",
}


_HOST_SEARCH_HELPER_URL = (
    os.getenv("GNOSI_HOST_SEARCH_HELPER_URL")
    or default_host_helper_url("/search")
)


def _search_via_host_helper(query: str, limit: int, roots: list, timeout: float = 10.0):
    """Delegate the search to Spotlight (`mdfind`) via the host helper.

    The `host_open_helper` (pipeline/skills/host_open_helper/) listens on
    127.0.0.1:5099 on the host and exposes `/search`; the backend reaches it on
    loopback (native) or via `host.docker.internal` (Docker) — see
    default_host_helper_url(). Spotlight has a live index of the disk and
    returns in milliseconds, while a raw `os.walk` over OneDrive (the only
    option inside a container, which lacks `mdfind`) takes seconds.

    Returns the helper's response dict (`results`/`truncated` keys), or
    `None` if the helper is unavailable or fails — so the caller can
    fall back to the local walk.
    
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
        # Helper down, timeout, or 5xx (Spotlight has failed) → fallback.
        return None

    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        return None
    return data


def _dedup_by_path(primary: list, secondary: list, limit: int) -> list:
    """Merges two result lists {name,path,is_dir} without duplicates by
    `path`, keeping the order (primary first). Cuts off at `limit`."""
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
    """Search by name across the whole system (Vault + Library + host home).

    Strategy:
      1. Vault file index (`services/vault_file_index`) — in memory,
         fast and RELIABLE (doesn't depend on the helper or OneDrive's state). Covers
         Vault + Library, the CloudStorage roots that the helper often doesn't see.
      2. host_open_helper (Spotlight) — adds the rest of HOME (Documents,
         Downloads…) where the helper does work. Merged with (1), deduped by path.
      3. Fallback (ONLY if the index isn't ready yet, e.g. right at
         startup): `os.walk` inside the container, with per-root caps.
    
    """
    q = (body.query or "").strip().lower()
    if len(q) < 2:
        return {"results": [], "truncated": False}

    limit = max(1, min(500, body.limit or 100))

    # Helper (Spotlight) — fast, for HOME/non-CloudStorage. Can be None (helper
    # gone down) or return empty for the Vault (stale OneDrive File Provider): to
    # so we do NOT rely on it alone for the Vault; the index (below) covers it.
    helper_roots = [
        p for p in (os.getenv("VAULT_HOST_PATH"), os.getenv("HOME_HOST_PATH"))
        if p
    ]
    helper_data = await asyncio.to_thread(
        _search_via_host_helper, q, limit, helper_roots
    )
    helper_results = helper_data.get("results", []) if helper_data else []

    # ── Layer 1+2: Vault index (reliable) merged with the helper (rest of HOME) ──
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

    # Index not ready yet (short window at startup): previous behavior.
    if helper_data is not None:
        return {
            "results": helper_results,
            "truncated": bool(helper_data.get("truncated")),
            "engine": "spotlight",
        }

    # ── Layer 3: fallback walk inside the container ──
    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")
    vault_host = os.getenv("VAULT_HOST_PATH") or ""

    # We walk in priority passes: first the Vault, then the
    # common user folders (Documents, Desktop, Downloads, …) and
    # finally the rest of HOME. This way we guarantee that the files
    # relevant ones show up even if HOME contains many files
    # of little interest (Library is on the skip-list but other folders
    # such as large Movies can exhaust the limit).
    #
    # Library is normally skipped because it contains caches, plists, and app data
    # that add nothing to the search. But cloud sync folders
    # (OneDrive, Dropbox, Google Drive, Box → Library/CloudStorage; iCloud
    # Drive → Library/Mobile Documents) do contain real files from
    # the user and must be covered. We add them as priority roots
    # explicit: the skip of "Library" is only checked during the walks,
    # not at the initial roots, so entering it directly is allowed.
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

    # Node budget PER root: no single folder can hog the entire search.
    # Previously there was a single global `max_visited` of 250k; since the Vault
    # and, above all, Library/CloudStorage (OneDrive) are huge, a single
    # previous pass would get stuck there and the call would take many seconds without reaching
    # never got to Documents/Downloads. With a per-root cap, each relevant folder
    # gets visited even if the previous ones are huge.
    per_root_max_visited = 30000
    # A cap on results PER root: without this the Vault (all .md) would fill up the
    # `limit` results before any other root contributed anything, and the search
    # seemed to find "only .md" files. By splitting the limit, the results are
    # a mix of all sources.
    per_root_result_cap = max(15, limit // max(1, len(priority_roots)))

    results: list = []
    truncated = False
    # Deduplicate results when a file is found from more than one
    # priority root (e.g. Vault + generic HOME walk).
    seen_result_paths: set[str] = set()

    def _record_hit(internal: str, name: str, is_dir: bool) -> bool:
        """Add a match if it hasn't been found yet. Returns True if
        the GLOBAL results limit has been reached."""
        if internal in seen_result_paths:
            return False
        seen_result_paths.add(internal)
        results.append({
            "name": name,
            "path": to_host(internal),
            "is_dir": is_dir,
        })
        return len(results) >= limit

    # Normalize the query to NFC once: macOS stores names in NFD, so a query
    # "ética" (NFC, 1 codepoint) matches the decomposed name on disk (e + accent).
    q_norm = unicodedata.normalize("NFC", q)

    def _walk_all() -> None:
        """Walk the priority roots, filling `results`.

        It's synchronous and blocking — an `os.walk` over slow mounts like
        OneDrive can take seconds —, so the handler calls it inside
        a separate thread to avoid freezing FastAPI's event loop.
        
        """
        nonlocal truncated
        for root in priority_roots:
            if len(results) >= limit:
                break
            root_visited = 0
            root_hits = 0
            stop_root = False
            for current_dir, dirs, files in native_os.walk(str(root), followlinks=False):
                # Prune in-place. In addition to the usual noise, we skip the
                # priority roots that we already walk separately: this way the
                # generic HOME walk doesn't traverse Documents again,
                # Desktop, Downloads… (previously visited twice).
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
