"""HTTP routes for system notifications, status and filesystem access."""

import asyncio
import json
import os
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import psutil
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.config.env_config import default_host_helper_url
from backend.data.management_db import get_mgmt_db
from backend.domains.system.schemas import (
    BrowseRequest,
    ClearNotificationsResponse,
    FilesystemBrowseResponse,
    FilesystemSearchResponse,
    NativePickAvailabilityResponse,
    NativePickRequest,
    NativePickResponse,
    NotificationCreate,
    NotificationPageResponse,
    SearchRequest,
    SystemGraphVisualizationResponse,
    SystemStatsResponse,
)
from backend.models.notification import Notification, NotificationResponse
from backend.services.graph_service import GraphService
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail

router = APIRouter()


@router.get("/notifications", response_model=NotificationPageResponse)
async def get_notifications(
    limit: int = 50, offset: int = 0, db: Session = Depends(get_mgmt_db)
) -> dict[str, Any]:
    """Returns system notifications with pagination."""
    query = db.query(Notification)
    total = query.count()
    items = query.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [NotificationResponse.model_validate(i) for i in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": total > offset + limit,
    }


@router.post("/notifications", response_model=NotificationResponse)
async def create_notification(
    payload: NotificationCreate,
    db: Session = Depends(get_mgmt_db),
) -> NotificationResponse:
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
        return NotificationResponse.model_validate(notif)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /notifications"),
        )


@router.delete(
    "/notifications",
    response_model=ClearNotificationsResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def clear_notifications(db: Session = Depends(get_mgmt_db)) -> Any:
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


def _browser_roots() -> tuple[str, str, dict[str, str | None], list[Path]]:
    """Resolve active-vault, home and root shortcuts for the admin picker."""
    from backend.services.context_vars import get_active_vault_path

    try:
        active_vault = get_active_vault_path()
        vault_internal = str(active_vault) if active_vault else ""
    except Exception:
        vault_internal = ""
    if not vault_internal:
        vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")
    roots = {
        "vault": vault_internal or None,
        "home": home_internal or None,
        "root": "/",
    }
    allowed_roots: list[Path] = []
    for raw_root in (vault_internal, home_internal, "/"):
        if not raw_root:
            continue
        try:
            allowed_roots.append(Path(raw_root).resolve())
        except Exception:
            continue
    return vault_internal, home_internal, roots, allowed_roots


def _browse_target(
    requested_path: str,
    vault_internal: str,
    home_internal: str,
    roots: dict[str, str | None],
    allowed_roots: list[Path],
) -> tuple[Path | None, dict[str, Any] | None]:
    """Resolve and validate one requested picker directory."""
    target_path = requested_path or vault_internal or home_internal or "/"
    try:
        target = Path(target_path).resolve()
    except Exception:
        return None, {"error": "Invalid path", "error_code": "invalid_path", "roots": roots}
    if not allowed_roots:
        return None, {
            "error": "Server misconfigured: no allowed roots resolved",
            "error_code": "no_roots",
            "roots": roots,
        }
    if not any(target == root or target.is_relative_to(root) for root in allowed_roots):
        return None, {
            "error": "Path is outside of allowed roots",
            "error_code": "outside_roots",
            "roots": roots,
        }
    if not target.exists():
        return None, {"error": "Path does not exist", "error_code": "not_found", "roots": roots}
    if not target.is_dir():
        return None, {
            "error": "Not a directory",
            "error_code": "not_a_directory",
            "roots": roots,
        }
    return target, None


def _browse_display_path(target: Path, vault_internal: str) -> str:
    """Map an internal Docker Vault path back to its host display path."""
    vault_host = os.getenv("VAULT_HOST_PATH") or ""
    target_text = str(target)
    if vault_host and vault_internal and target_text.startswith(vault_internal):
        return target_text.replace(vault_internal, vault_host, 1)
    return target_text


def _scan_browse_directory(
    target: Path,
    display_path: str,
    roots: dict[str, str | None],
) -> dict[str, Any]:
    """Read one bounded directory listing without following entries."""
    directories: list[str] = []
    files: list[str] = []
    try:
        with os.scandir(target) as entries:
            for entry in entries:
                try:
                    if entry.name.startswith("."):
                        continue
                    if entry.is_dir():
                        directories.append(entry.name)
                    elif entry.is_file():
                        files.append(entry.name)
                except (PermissionError, OSError):
                    continue
                if len(directories) + len(files) >= 400:
                    break
    except PermissionError:
        return {
            "error": f"Permission denied at {target}. Check the folder permissions.",
            "error_code": "permission_denied",
            "current_path": str(target),
            "display_path": display_path,
            "roots": roots,
        }
    except Exception as exc:
        return {
            "error": safe_error_detail(exc, "POST /browse access path"),
            "error_code": "access_error",
            "current_path": str(target),
            "display_path": display_path,
            "roots": roots,
        }
    directories.sort(key=str.lower)
    files.sort(key=str.lower)
    return {
        "current_path": str(target),
        "display_path": display_path,
        "directories": directories,
        "files": files,
        "roots": roots,
    }


@router.get(
    "/stats",
    response_model=SystemStatsResponse,
    response_model_exclude_unset=True,
)
async def get_system_stats() -> Any:
    """Returns real system statistics."""
    try:
        cpu = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory().percent

        # Get real node count from GraphService
        service = GraphService()
        memory_items = service.get_node_count()

        return {"cpu": cpu, "ram_percent": ram, "memory_items": memory_items, "status": "online"}
    except Exception as e:
        # Fallback to defaults or partial data if psutil fails
        return {
            "cpu": 0.0,
            "ram_percent": 0.0,
            "memory_items": 0,
            "status": "degraded",
            "error": safe_error_detail(e, "GET /stats"),
        }


@router.get(
    "/graph/visualization",
    response_model=SystemGraphVisualizationResponse,
)
async def get_graph_viz() -> Any:
    return {"nodes": [], "edges": []}


def _browse_directory(body: BrowseRequest) -> Any:
    """Resolve and scan one picker location outside the event-loop thread."""
    vault_internal, home_internal, roots, allowed_roots = _browser_roots()
    target, error = _browse_target(
        body.path,
        vault_internal,
        home_internal,
        roots,
        allowed_roots,
    )
    if error is not None:
        return error
    if target is None:
        raise RuntimeError("Validated browse target is missing")
    return _scan_browse_directory(
        target,
        _browse_display_path(target, vault_internal),
        roots,
    )


@router.post(
    "/browse",
    response_model=FilesystemBrowseResponse,
    response_model_exclude_unset=True,
    dependencies=[Depends(require_role("admin"))],
)
async def browse_directory(body: BrowseRequest = Body(...)) -> Any:
    """Browse an admin-selected host directory without blocking the API loop."""
    return await asyncio.to_thread(_browse_directory, body)


# ── Native OS open dialog (progressive enhancement over the in-app picker) ──
# All Finder/GUI interaction is owned by the host_open_helper (loopback :5099,
# runs in the user's Aqua session with Full Disk Access); the backend only
# proxies to it, on loopback (native) or host.docker.internal (Docker) — see
# default_host_helper_url(). Per-endpoint env overrides mirror the search helper.
_HOST_PICK_HELPER_URL = os.getenv("GNOSI_HOST_PICK_HELPER_URL") or default_host_helper_url("/pick")
_HOST_HEALTH_HELPER_URL = os.getenv("GNOSI_HOST_HEALTH_HELPER_URL") or default_host_helper_url(
    "/healthz"
)


def _native_pick_via_helper(
    mode: str, prompt: str, multiple: bool = False, timeout: float = 3600.0
) -> dict[str, Any] | None:
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
    return cast(dict[str, Any], data) if isinstance(data, dict) else None


def _host_helper_healthy(timeout: float = 1.5) -> bool:
    """Quick reachability probe of the host helper's /healthz (short timeout so
    the availability check never stalls the picker's open)."""
    import urllib.request

    try:
        with urllib.request.urlopen(_HOST_HEALTH_HELPER_URL, timeout=timeout) as resp:
            return bool(200 <= resp.status < 300)
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


@router.get(
    "/native-pick/available",
    response_model=NativePickAvailabilityResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def native_pick_available(request: Request) -> Any:
    """Whether the native OS file/folder dialog can be offered from here.

    Available only when the caller is loopback AND the host_open_helper answers
    /healthz. Either check failing hides the button in the frontend, which then
    keeps using the in-app FilesystemPickerModal — the always-available fallback.
    """
    if not _is_loopback_request(request):
        return {"available": False, "reason": "remote_client"}
    healthy = await asyncio.to_thread(_host_helper_healthy)
    return {"available": bool(healthy), "reason": None if healthy else "helper_unreachable"}


@router.post(
    "/native-pick",
    response_model=NativePickResponse,
    response_model_exclude_unset=True,
    dependencies=[Depends(require_role("admin"))],
)
async def native_pick(request: Request, body: NativePickRequest = Body(...)) -> Any:
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
    "node_modules",
    ".git",
    "__pycache__",
    "Library",
    ".cache",
    ".local",
    ".npm",
    ".docker",
    ".android",
    ".gradle",
    ".nuget",
    ".vscode",
    ".idea",
    ".Trash",
    "Trash",
}


_HOST_SEARCH_HELPER_URL = os.getenv("GNOSI_HOST_SEARCH_HELPER_URL") or default_host_helper_url(
    "/search"
)


def _search_via_host_helper(
    query: str,
    limit: int,
    roots: list[str],
    timeout: float = 10.0,
) -> dict[str, Any] | None:
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
    return cast(dict[str, Any], data)


def _dedup_by_path(
    primary: list[dict[str, Any]],
    secondary: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Merges two result lists {name,path,is_dir} without duplicates by
    `path`, keeping the order (primary first). Cuts off at `limit`."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in list(primary) + list(secondary):
        p = item.get("path")
        if not p or p in seen:
            continue
        seen.add(p)
        out.append(item)
        if len(out) >= limit:
            break
    return out


_SEARCH_PRIORITY_SUBDIRS = (
    "Documents",
    "Desktop",
    "Downloads",
    "Pictures",
    "Movies",
    "Music",
    "Library/CloudStorage",
    "Library/Mobile Documents",
)


@dataclass
class _FilesystemSearchState:
    """Mutable state shared by the bounded fallback walk."""

    limit: int
    vault_internal: str
    vault_host: str
    results: list[dict[str, Any]] = field(default_factory=list)
    seen_paths: set[str] = field(default_factory=set)
    truncated: bool = False
    error: str | None = None

    def record(self, internal: str, name: str, is_dir: bool) -> bool:
        """Record one unique match and report whether the global cap was met."""
        if internal in self.seen_paths:
            return False
        self.seen_paths.add(internal)
        path = internal
        if self.vault_host and self.vault_internal and path.startswith(self.vault_internal):
            path = path.replace(self.vault_internal, self.vault_host, 1)
        self.results.append({"name": name, "path": path, "is_dir": is_dir})
        return len(self.results) >= self.limit


def _add_search_root(raw: str, roots: list[Path], seen: set[str]) -> None:
    """Add one existing directory to the fallback search roots."""
    if not raw:
        return
    try:
        path = Path(raw).resolve()
        key = str(path)
        if key not in seen and path.exists() and path.is_dir():
            roots.append(path)
            seen.add(key)
    except Exception:
        return


def _priority_search_roots(vault_internal: str, home_internal: str) -> tuple[list[Path], set[str]]:
    """Build ordered, unique roots covering local and cloud-synced files."""
    roots: list[Path] = []
    seen: set[str] = set()
    _add_search_root(vault_internal, roots, seen)
    for name in _SEARCH_PRIORITY_SUBDIRS:
        _add_search_root(os.path.join(home_internal, name), roots, seen)
    _add_search_root(home_internal, roots, seen)
    return roots, seen


def _prune_search_dirs(current_dir: str, dirs: list[str], seen_roots: set[str]) -> None:
    """Prune noise and roots already scheduled as independent passes."""
    dirs[:] = [
        name
        for name in dirs
        if not name.startswith(".")
        and name not in _SEARCH_SKIP_DIR_NAMES
        and not name.endswith((".app", ".photoslibrary", ".musiclibrary"))
        and os.path.join(current_dir, name) not in seen_roots
    ]


def _walk_search_root(
    root: Path,
    query: str,
    result_cap: int,
    seen_roots: set[str],
    state: _FilesystemSearchState,
) -> bool:
    """Walk one bounded root and report whether all further walking should stop."""
    visited = 0
    hits = 0
    for current_dir, dirs, files in os.walk(str(root), followlinks=False):
        _prune_search_dirs(current_dir, dirs, seen_roots)
        entries = [(True, name) for name in dirs]
        entries.extend((False, name) for name in files)
        for is_dir, name in entries:
            if not is_dir and name.startswith("."):
                continue
            visited += 1
            if visited > 30_000:
                state.truncated = True
                return False
            if query not in unicodedata.normalize("NFC", name).lower():
                continue
            internal = os.path.join(current_dir, name)
            if state.record(internal, name, is_dir):
                state.truncated = True
                return True
            hits += 1
            if hits >= result_cap:
                state.truncated = True
                return False
    return False


def _walk_filesystem(query: str, limit: int) -> _FilesystemSearchState:
    """Run the provider-neutral local fallback search synchronously."""
    vault_internal = os.getenv("DIGITAL_BRAIN_VAULT_PATH") or ""
    home_internal = os.getenv("HOME_HOST_PATH") or os.path.expanduser("~")
    roots, seen_roots = _priority_search_roots(vault_internal, home_internal)
    state = _FilesystemSearchState(
        limit=limit,
        vault_internal=vault_internal,
        vault_host=os.getenv("VAULT_HOST_PATH") or "",
    )
    result_cap = max(15, limit // max(1, len(roots)))
    normalized_query = unicodedata.normalize("NFC", query)
    try:
        for root in roots:
            if _walk_search_root(root, normalized_query, result_cap, seen_roots, state):
                break
    except Exception as exc:
        state.error = safe_error_detail(exc, "POST /search filesystem")
    return state


@router.post(
    "/search",
    response_model=FilesystemSearchResponse,
    response_model_exclude_unset=True,
    dependencies=[Depends(require_role("admin"))],
)
async def search_filesystem(body: SearchRequest = Body(...)) -> dict[str, Any]:
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
    query = (body.query or "").strip().lower()
    if len(query) < 2:
        return {"results": [], "truncated": False}

    limit = max(1, min(500, body.limit or 100))
    helper_roots = [
        path for path in (os.getenv("VAULT_HOST_PATH"), os.getenv("HOME_HOST_PATH")) if path
    ]
    helper_data = await asyncio.to_thread(_search_via_host_helper, query, limit, helper_roots)
    helper_results = helper_data.get("results", []) if helper_data else []

    from backend.services import vault_file_index

    if vault_file_index.is_ready():
        index_results = await asyncio.to_thread(vault_file_index.query, body.query or "", limit)
        merged = _dedup_by_path(index_results, helper_results, limit)
        return {
            "results": merged,
            "truncated": bool(helper_data and helper_data.get("truncated")) or len(merged) >= limit,
            "engine": "index+spotlight",
        }
    if helper_data is not None:
        return {
            "results": helper_results,
            "truncated": bool(helper_data.get("truncated")),
            "engine": "spotlight",
        }

    state = await asyncio.to_thread(_walk_filesystem, query, limit)
    response: dict[str, Any] = {
        "results": state.results,
        "truncated": state.truncated,
    }
    if state.error is not None:
        response["error"] = state.error
    return response
