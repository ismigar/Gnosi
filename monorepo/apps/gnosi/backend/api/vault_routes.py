import os
import time
import logging
import unicodedata
import shutil
from pathlib import Path
from fastapi import (
    APIRouter,
    HTTPException,
    Body,
    BackgroundTasks,
    File,
    UploadFile,
    Query,
    Depends,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta
import logging
import urllib.parse
import mimetypes
import base64
import hashlib
import yaml
import re
import json
import requests
import uuid
import shutil
import threading
import time
import sys
import subprocess
try:
    from PIL import Image
except Exception:
    Image = None
from backend.config.app_config import load_params
from backend.services.rule_engine import RuleEngine
log = logging.getLogger(__name__)

from backend.services.path_resolver import path_resolver
from backend.services.page_sidecar import (
    apply_sidecar_to,
    persist_sidecar_from,
    delete_sidecar as delete_sidecar_for_page,
    vault_root_for,
    split_metadata as split_sidecar_metadata,
)
from backend.utils.safe_io import (
    safe_write_text,
    safe_write_json,
    safe_write_bytes,
    file_etag,
    file_mtime_ns,
)
from backend.utils.errors import safe_error_detail
import asyncio

from backend.services.workspace_service import get_workspace_context, require_role
router = APIRouter(dependencies=[Depends(get_workspace_context)])

from backend.services.context_vars import get_active_vault_path
from backend.services.workspace_service import get_workspace_context, WorkspaceContext
from backend.services.media_service import media_service
from backend.services.files_provider import get_files_provider
from backend.api.virtual_fields import (
    inject_for_table as _vf_inject_for_table,
    inject_for_single_page as _vf_inject_for_single_page,
    list_virtual_field_specs as _vf_list_specs,
)
from backend.services.field_resolver import (
    to_response_names,
    to_storage_names,
)


def _table_by_id(table_id: str) -> Optional[dict]:
    """Helper for virtual_fields injection — looks up the table dict in registry."""
    if not table_id:
        return None
    try:
        reg = load_registry()
        for t in reg.get("tables", []):
            if t.get("id") == table_id:
                return t
    except Exception:
        return None
    return None

# Helper function to get active paths
def get_p(key: str) -> Path:
    from backend.services.context_vars import get_active_vault_path
    base = get_active_vault_path()

    # Local-only data root (Docker volume, never on cloud-synced storage).
    # Resolved from env to match paths_config.py.
    local_env = os.environ.get("GNOSI_LOCAL_DATA")
    local_data = Path(local_env) if local_env else Path("/app/data")

    # Mapping of standard sub-folders
    mapping = {
        "VAULT": base,
        "ASSETS": base / "Assets",
        # Biblioteca és germana del vault (fora de Gnosi). Dins Docker, `base` és
        # `/vault` i `base.parent` seria `/` → `/Biblioteca` (un dir efímer del
        # contenidor, no la Biblioteca real del host). Per això, quan corre en
        # contenidor (VAULT_HOST_PATH definit), resolem a la ruta del HOST, que
        # es munta en rw a la mateixa ruta (veure docker-compose). Fora de Docker
        # mantenim el càlcul relatiu al vault actiu.
        "BIBLIOTECA": (
            Path(os.environ["VAULT_HOST_PATH"]).parent / "Biblioteca"
            if os.environ.get("VAULT_HOST_PATH")
            else base.parent / "Biblioteca"
        ),
        "DATABASES": base / "BD",
        # The REGISTRY is now a file inside BD
        "REGISTRY": base / "BD" / "vault_db_registry.json",
        "CALENDAR": base / "Calendar",
        "MAIL": base / "Mail",
        "PLANTILLES": base / "Templates",
        "DIBUIXOS": base / "Drawings",
        "WIKI": base / "Wiki",
        "DASHBOARDS": base / ".Dashboards",
        "NEWSLETTERS": base / "Newsletters",
        # Configs sincronitzats vault-first viuen a `.gnosi/`. La carpeta
        # llegacy `data/` al vault ja no s'utilitza.
        "GNOSI_CONFIG": base / ".gnosi",
        "CUSTOM_ICONS": base / ".gnosi" / "vault_custom_icons.json",
        # Local-only paths — caches, indices, system DBs. Mirror paths_config.py
        "LOCAL_DATA": local_data,
        "LOCAL_CACHE": local_data / "cache",
        "PAGE_INDEX_CACHE": local_data / "cache" / "vault_page_index.json",
        "LINK_INDEX_CACHE": local_data / "cache" / "vault_link_index.json",
        "INDEX_STATUS": local_data / "cache" / "indexer_status.json",
    }
    return mapping.get(key, base / key.lower())

def __getattr__(name: str):
    path_keys = {
        "VAULT_PATH": "VAULT",
        "ASSETS_PATH": "ASSETS",
        "BD_PATH": "DATABASES",
        "REGISTRY_PATH": "REGISTRY",
        "CALENDAR_PATH": "CALENDAR",
        "MAIL_PATH": "MAIL",
        "PLANTILLES_PATH": "PLANTILLES",
        "DIBUIXOS_PATH": "DIBUIXOS",
        "WIKI_PATH": "WIKI",
        "DASHBOARDS_PATH": "DASHBOARDS",
        "NEWSLETTERS_PATH": "NEWSLETTERS",
        "GNOSI_CONFIG_PATH": "GNOSI_CONFIG",
    }
    if name in path_keys:
        return get_p(path_keys[name])
    raise AttributeError(f"module {__name__} has no attribute {name}")


def _clear_page_index_cache():
    """Clears the internal page index cache and unmarks initialization so the
    next access rebuilds it.

    Sense reset del flag `_page_index_initialized`, els callers (`list_pages`,
    `find_page_path`) creien que el cache estava poblat i no disparaven cap
    rescan. Símptoma: una pàgina recent-creada apareixia al disc però donava
    404 a `GET /api/vault/pages/{id}` fins que un altre `force_refresh`
    repoblava el cache.
    """
    with _page_index_lock:
        affected_vaults = list(_page_index_entries.keys())
        _page_index_entries.clear()
        for v_str in affected_vaults:
            _bump_page_index_version(v_str)
        _page_id_to_path.clear()
        _page_index_initialized.clear()
        global _last_vault_sync_time
        _last_vault_sync_time = 0.0
        log.info("♻️ Page index cache cleared (forçant rebuild al següent accés).")
        # Sense això, `_page_index_initialized[v_str]` queda True i la propera
        # crida a `_get_cached_page_entries` retornaria [] silenciosament
        # (entrava al fast path amb el dict buit). Resetejant la flag, el
        # següent get torna a carregar del disc cache — que continua sent
        # vàlid perquè aquí no l'hem tocat.
        _page_index_initialized.clear()
        log.info("♻️ Page index cache cleared.")


def sync_to_google_calendar_if_needed(
    metadata: dict, background_tasks: BackgroundTasks
):
    source = metadata.get("source", "")
    if "Google Calendar" in source and metadata.get("uid"):
        match = re.search(r"\((.*?)\)", source)
        if match:
            email = match.group(1)
            event_uid = metadata.get("uid")
            patch_data = {"summary": metadata.get("title")}
            if metadata.get("date"):
                patch_data["start"] = metadata.get("date")
            if metadata.get("end_date"):
                patch_data["end"] = metadata.get("end_date")

            from backend.services.google_calendar_service import update_google_event

            background_tasks.add_task(update_google_event, email, event_uid, patch_data)


# Base folders and files are now created during workspace activation (WorkspaceService)
# or initialized on demand in each route via get_p().


class PageSaveRequest(BaseModel):
    title: str
    content: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict = {}
    # Optimistic concurrency: client sends the etag it last received from GET.
    # If the file changed in the meantime (sync from another device, external
    # editor, etc.), the server rejects the write with 409 unless `force=True`.
    expected_etag: Optional[str] = None
    force: bool = False


class DrawingSaveRequest(BaseModel):
    title: str
    data: dict
    metadata: dict = {}


class PageInfo(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict = {}
    last_modified: str
    size: int
    folder: str = (
        ""  # relative folder path inside the vault (e.g. "Databases/Gnosi/Resources")
    )
    path: Optional[str] = None  # Absolute file path
    resolved_table_id: Optional[str] = None


class PagePatchRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[dict] = None
    parent_id: Optional[str] = None
    is_database: Optional[bool] = None
    # Optimistic concurrency (same semantics as PageSaveRequest)
    expected_etag: Optional[str] = None
    force: bool = False


class OpenResourceRequest(BaseModel):
    zotero_uri: Optional[str] = None
    file_path: Optional[str] = None
    attachments: Optional[object] = None


class SidebarPageInfo(BaseModel):
    id: str
    title: str
    parent_id: Optional[str] = None
    is_database: bool = False
    metadata: dict = {}
    last_modified: str
    folder: str = ""
    resolved_table_id: Optional[str] = None


class TablePagesSnapshot(BaseModel):
    table_id: str
    raw_count: int
    visible_count: int
    pages: List[PageInfo]


class CustomIconsRequest(BaseModel):
    icons: List[str] = []


class IconUrlImportRequest(BaseModel):
    url: str


class LinkMentionsRequest(BaseModel):
    target_id: str
    source_id: Optional[str] = None


def _normalize_custom_icons(values: Any, limit: int = 100) -> List[str]:
    if not isinstance(values, list):
        return []

    seen = set()
    normalized: List[str] = []

    for raw in values:
        if not isinstance(raw, str):
            continue
        icon = raw.strip()
        if not icon or len(icon) > 2048:
            continue
        if icon in seen:
            continue

        seen.add(icon)
        normalized.append(icon)

        if len(normalized) >= limit:
            break

    return normalized


# RuleEngine becomes a dictionary to store an instance for each vault_path (cache)
_rule_engines = {}
_rule_engine_lock = threading.Lock()

def get_rule_engine():
    from backend.services.context_vars import get_active_vault_path
    from backend.services.rule_engine import RuleEngine
    v_path = get_active_vault_path()
    v_str = str(v_path)
    
    with _rule_engine_lock:
        if v_str not in _rule_engines:
            log.info(f"Initializing RuleEngine for vault: {v_str}")
            _rule_engines[v_str] = RuleEngine(v_path)
        return _rule_engines[v_str]

# Instead of a global constant, we use a function
def get_custom_icons_path():
    return get_p("CUSTOM_ICONS")

_table_recalc_lock = threading.Lock()
_table_recalc_state = {}
_TABLE_RECALC_COOLDOWN_SECONDS = 0.5
_page_index_lock = threading.Lock()
# Page index also partitioned per vault
_page_index_entries: Dict[str, Dict[str, Dict[str, Any]]] = {}
_page_index_initialized: Dict[str, bool] = {}
_page_id_to_path: Dict[str, Dict[str, str]] = {} # Cache for fast ID -> Path lookups per vault
# Cooldown del rescan automàtic del cache d'índex del vault. Pujat de
# 60 s a 600 s perquè cada rescan fa stat() de ~4200 fitxers d'OneDrive
# (5-10 ms cada un = 20-40 s d'I/O total) que satura el File Provider i
# bloqueja altres operacions del backend. Els canvis fets via PATCH/PUT
# s'apliquen al cache in-memory directament; aquest rescan només
# detectaria canvis externs (sync OneDrive d'un altre dispositiu, edicions
# fora del backend). 10 min és prou per a aquest cas i deixa el backend
# responsiu la resta del temps.
_VAULT_SYNC_COOLDOWN_SECONDS = 600
_last_vault_sync_time = 0.0

# Version counter bumped at every mutation of `_page_index_entries[v_str]`
# (load-from-disk, full replace, partial update, stale prune, page
# create/delete/save). Derived caches like `_table_index_cache` snapshot
# this number; when their snapshot diverges from the live version, they
# rebuild lazily on the next read. Cheaper than tracking field-level diffs.
_page_index_version: Dict[str, int] = {}

# Secondary index: table_id → list of PageInfo entries, derived from
# `_page_index_entries[v_str]`. Rebuilt lazily when `_page_index_version`
# advances past the snapshot. Without this, `GET /pages/by-table/{id}` had
# to scan all 4000+ entries every call to filter by resolved_table_id —
# fine for a small vault but linear in total page count for the rest.
# TTL is a safety net in case a mutation path forgot to bump version.
_table_index_cache: Dict[str, Dict[str, Any]] = {}
_TABLE_INDEX_TTL = 60.0
# ── Micro-cache de PageInfo (TTL ~1.5s) ──────────────────────────────────
# Els endpoints `/pages`, `/by-table`, `/sidebar/summary`, `/global-index`
# es disparen alhora a cada navegació del frontend. Sense aquest cache,
# cada un construeix els seus PageInfo Pydantic des de zero (~80-140ms el
# fast-path o ~600ms+ per al snapshot complet). Cacheging els resultats
# durant uns segons converteix un burst de 4-6 crides al mateix segon en
# una de sola que paga el cost real; les altres són hits ~O(1).
#
# Invalidació: per write (PATCH/PUT/DELETE/move) que toca una entry. La
# invalidació és total (no surgical) perquè una sola edit pot afectar
# diverses taules (canvis de title, table_id, etc.) i el cost de
# reconstruir és baixíssim un cop el bucle té cache_hit als bytes
# subsegüents.
_pages_resp_cache_lock = threading.Lock()
_pages_resp_cache: Dict[str, tuple[float, List[Any]]] = {}
_PAGES_RESP_CACHE_TTL = 1.5  # segons


def _pages_cache_get(key: str) -> Optional[List[Any]]:
    """Retorna la llista cachejada per `key` si l'entry encara és vàlida.

    No copiem la llista per estalviar memòria/CPU: els consumidors han de
    tractar la sortida com a immutable o fer-ne una còpia abans de mutar.
    El bucle del cache mateix sí compta amb que ningú substitueixi els
    PageInfo individuals — només la lectura del `.metadata` per a
    `expand_metadata_for_response` ho fa al call site (vegeu endpoint).
    """
    now = time.monotonic()
    with _pages_resp_cache_lock:
        item = _pages_resp_cache.get(key)
        if item is None:
            return None
        ts, val = item
        if (now - ts) > _PAGES_RESP_CACHE_TTL:
            # Stale — esborra i fes que el caller refagi
            _pages_resp_cache.pop(key, None)
            return None
        return val


def _pages_cache_set(key: str, value: List[Any]) -> None:
    with _pages_resp_cache_lock:
        _pages_resp_cache[key] = (time.monotonic(), value)


def _pages_cache_invalidate_all() -> None:
    """Crida quan qualsevol PATCH/PUT/DELETE modifica el vault."""
    with _pages_resp_cache_lock:
        _pages_resp_cache.clear()

# Google Calendar sync cooldown (5 minutes)
_GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS = 300
_last_google_calendar_sync_time = 0.0

def get_page_index_cache_path(v_str: Optional[str] = None):
    # Local-only: this cache is per-instance and contains absolute paths that
    # only make sense on the machine that built it. Never on cloud storage.
    p = get_p("PAGE_INDEX_CACHE")
    if not p:
        # Fallback if LOCAL_DATA isn't configured for some reason
        p = Path("/app/data/cache/vault_page_index.json")
    if v_str:
        digest = hashlib.sha256(v_str.encode("utf-8")).hexdigest()[:16]
        return p.with_name(f"{p.stem}_{digest}{p.suffix}")
    if p:
        return p
    return Path("/app/data/cache/vault_page_index.json")


# ── Indexer status (background warmup state) ──────────────────────────────
# When the backend boots, the first request that needs the page index would
# trigger a synchronous full scan of the vault — on cloud-mounted storage
# (OneDrive FUSE) this can take 10-60s and block the asyncio event loop.
# We track status in-memory so the UI can show "indexing…" and so the warmup
# only runs once per vault per process.
_indexer_status_lock = threading.Lock()
_indexer_status_by_vault: Dict[str, Dict[str, Any]] = {}


def _set_indexer_status(v_str: str, **fields):
    with _indexer_status_lock:
        cur = _indexer_status_by_vault.setdefault(
            v_str,
            {"state": "idle", "started_at": None, "finished_at": None,
             "files_indexed": 0, "error": None},
        )
        cur.update(fields)


def get_indexer_status(v_str: str) -> Dict[str, Any]:
    with _indexer_status_lock:
        return dict(_indexer_status_by_vault.get(
            v_str,
            {"state": "idle", "started_at": None, "finished_at": None,
             "files_indexed": 0, "error": None},
        ))


# ── Preview cache (in-memory) ───────────────────────────────────────────────
# `get_page_preview` és O(segons) sobre fitxers online-only d'OneDrive: cada
# crida fa retries amb backoff (~4.55s en el pitjor cas) mentre el File
# Provider materialitza el fitxer. Un feed de 77 entrades = 77 × ~4.5s = més
# de 5 minuts serial. Cache memoria per page_id, invalidat per mtime del
# fitxer: la primera crida fa la feina i deixa la dada calenta; les següents
# són instantànies fins que el .md es modifica. Mida limitada per no créixer
# sense control en vaults grans. LRU real (OrderedDict.move_to_end en cada
# accés), no només FIFO d'inserció.
from collections import OrderedDict as _OrderedDict

_preview_cache_lock = threading.Lock()
_preview_cache: "_OrderedDict[str, Dict[str, Any]]" = _OrderedDict()  # page_id -> {mtime, short, full}
_PREVIEW_CACHE_MAX = 1000


def _preview_cache_get(page_id: str, mtime: float, full: bool) -> Optional[Dict[str, Any]]:
    """Retorna la resposta cachejada si el mtime coincideix; None si miss o
    si demanen `full` però només tenim la versió curta cachejada.

    En cada hit, mou l'entrada al final de l'OrderedDict (LRU): així
    `popitem(last=False)` treu sempre la menys recentment accedida, no la
    més antiga d'inserció.
    """
    with _preview_cache_lock:
        cached = _preview_cache.get(page_id)
        if not cached or cached.get("mtime") != mtime:
            return None
        _preview_cache.move_to_end(page_id)
        return cached.get("full" if full else "short")


def _preview_cache_set(page_id: str, mtime: float, short: Dict[str, Any], full: Dict[str, Any]) -> None:
    """Guarda la resposta i mou al final (LRU). Si supera la mida màxima,
    expulsa la menys recentment accedida."""
    with _preview_cache_lock:
        if page_id in _preview_cache:
            _preview_cache.move_to_end(page_id)
        elif len(_preview_cache) >= _PREVIEW_CACHE_MAX:
            _preview_cache.popitem(last=False)
        _preview_cache[page_id] = {"mtime": mtime, "short": short, "full": full}


def _preview_cache_invalidate(page_id: str) -> None:
    with _preview_cache_lock:
        _preview_cache.pop(page_id, None)


# In-flight dedup: si dues peticions concurrents demanen la mateixa preview i
# totes dues cauen al miss, sense aquest mapping farien la feina alhora. Per
# eficiència i per no estressar OneDrive amb requests duplicades, comparteixen
# la mateixa Future.
_preview_inflight: Dict[str, "asyncio.Future[Tuple[Dict[str, Any], Dict[str, Any], float]]"] = {}
_preview_inflight_lock = threading.Lock()


def kickoff_index_warmup(v_path: Path) -> None:
    """Launch a background thread to populate the page index.

    Safe to call on startup or on settings change. Idempotent: if the indexer
    is already running for this vault, this call is a no-op.

    Why a thread (not asyncio.create_task): the underlying scan is filesystem-
    heavy and cloud-mount-bound — running it in a thread keeps the asyncio
    event loop responsive even if FUSE blocks for tens of seconds.
    """
    if not v_path or not v_path.exists():
        return
    v_str = str(v_path)
    # Inicialitza el timestamp del background sync perquè la propera
    # crida a `_get_pages_snapshot` no dispari un rescan complet
    # immediatament (4243 stats OneDrive ≈ 20-40 s competint amb els PATCH
    # de l'usuari). El warmup d'aquesta funció ja s'encarrega de poblar
    # el cache; el sync periòdic només cal cada `_VAULT_SYNC_COOLDOWN_SECONDS`.
    global _last_vault_sync_time
    _last_vault_sync_time = time.monotonic()
    # Carrega el body cache persistit a disc. Sense això, el primer
    # `_rebuild_link_index` post-restart havia de llegir ~3500 fitxers
    # d'OneDrive (~80-140 s observat). Amb el cache disc carregat, només
    # llegim els fitxers amb mtime canviat des de l'últim flush.
    try:
        _load_body_cache_from_disk()
    except Exception as e:
        log.warning(f"body-cache load skipped: {e}")
    with _indexer_status_lock:
        cur = _indexer_status_by_vault.get(v_str, {})
        if cur.get("state") == "running":
            return
        _indexer_status_by_vault[v_str] = {
            "state": "running",
            "started_at": time.time(),
            "finished_at": None,
            "files_indexed": 0,
            "error": None,
        }

    def _run():
        try:
            # 1. Try to load from local disk cache first (fast path)
            loaded = _load_page_index_from_disk(v_str)
            if loaded:
                with _page_index_lock:
                    n = len(_page_index_entries.get(v_str, {}))
                _set_indexer_status(
                    v_str, state="ready", finished_at=time.time(),
                    files_indexed=n,
                )
                # Disparem el link-index rebuild ABANS del force_refresh.
                # Si el deixéssim al final, un rescan lent d'OneDrive (que pot
                # trigar minuts amb 4000 fitxers) bloquejaria la construcció
                # de l'índex de wikilinks i la reescriptura automàtica al
                # rename no s'aplicaria fins després. kickoff_link_index_rebuild
                # ja allotja la seva pròpia thread, no bloqueja aquest fluxe.
                kickoff_link_index_rebuild()
                # Schedule a refresh in the background so the cache stays
                # warm against external changes — non-blocking.
                try:
                    _get_cached_page_entries(force_refresh=True)
                    with _page_index_lock:
                        n = len(_page_index_entries.get(v_str, {}))
                    _set_indexer_status(v_str, files_indexed=n)
                except Exception as e:
                    log.warning(f"Background index refresh failed: {e}")
                return
            # 2. No cache — full scan
            _get_cached_page_entries(force_refresh=True)
            with _page_index_lock:
                n = len(_page_index_entries.get(v_str, {}))
            _set_indexer_status(
                v_str, state="ready", finished_at=time.time(),
                files_indexed=n,
            )
            kickoff_link_index_rebuild()
        except Exception as e:
            log.error(f"Indexer warmup failed for {v_str}: {e}")
            _set_indexer_status(
                v_str, state="error", finished_at=time.time(), error=str(e),
            )

    t = threading.Thread(target=_run, daemon=True, name=f"indexer-warmup-{v_str}")
    t.start()

def _save_page_index_to_disk(v_str: str):
    """Persists the in-memory cache for a specific vault to disk."""
    try:
        cache_path = get_page_index_cache_path(v_str)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        # CRITICAL: snapshot under the lock. The indexer thread mutates
        # `_page_index_entries[v_str]` while it walks the vault; serializing
        # the live reference can raise `dictionary changed size during
        # iteration` or, worse, write a partially-mutated JSON to disk.
        with _page_index_lock:
            data = dict(_page_index_entries.get(v_str, {}))
        if data:
            # Local cache lives on a Docker volume — atomic write prevents
            # half-written JSON when the container is killed mid-flush.
            safe_write_json(cache_path, data, indent=2, ensure_ascii=False)
            log.info(f"💾 Page index cache saved to disk for {v_str}")
    except Exception as e:
        log.error(f"❌ Error saving page index cache for {v_str}: {e}")

def _load_page_index_from_disk(v_str: str):
    """Loads the persistent cache for a specific vault into memory."""
    try:
        cache_path = get_page_index_cache_path(v_str)
        # Fallback al format llegacy (sense sufix per-vault): abans
        # `get_page_index_cache_path` no acceptava `v_str` i tots els
        # vaults compartien `vault_page_index.json`. Sense aquest fallback,
        # un upgrade en calent que canvia la firma deixava el cache disc
        # invisible i forçava un full rescan (~12k fitxers amb Errno 35
        # massiu en OneDrive lent, ~hora de delay i app buida).
        if not cache_path.exists():
            legacy_path = get_page_index_cache_path()
            if legacy_path.exists() and legacy_path != cache_path:
                log.info(
                    f"📂 Using legacy page index cache (no per-vault file yet): {legacy_path}"
                )
                cache_path = legacy_path
        if cache_path.exists():
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            with _page_index_lock:
                _page_index_entries[v_str] = data
                _page_index_initialized[v_str] = True
                _bump_page_index_version(v_str)
                # Reconstruïm el `_page_id_to_path` i actualitzem el
                # `path_resolver` també a partir del cache. Sense això, el
                # primer cop que algú cridi `path_resolver.list_all_files()`
                # (a `_iter_linkable_page_documents`) farà fallback a rglob
                # lent al OneDrive — perdrem tot el benefici del cache disc.
                id_map = {}
                files_ordered = []
                for p_str, entry in data.items():
                    files_ordered.append(Path(p_str))
                    pid = entry.get("id")
                    if pid:
                        id_map[pid] = p_str
                _page_id_to_path[v_str] = id_map
                try:
                    path_resolver.update_index(Path(v_str), id_map, files_ordered)
                except Exception as e:
                    log.warning(f"PathResolver update from disk cache failed: {e}")
            log.info(f"📂 Page index cache loaded from disk for {v_str} ({len(data)} entries)")
            return True
    except Exception as e:
        log.error(f"❌ Error loading page index cache for {v_str}: {e}")
    return False


def preload_page_index_from_disk(v_path: Path) -> bool:
    """Public startup-safe wrapper to preload one vault's page index cache."""
    if not v_path:
        return False
    return _load_page_index_from_disk(str(v_path))

_custom_icons_lock = threading.Lock()

def _load_custom_icons() -> List[str]:
    with _custom_icons_lock:
        try:
            path = get_custom_icons_path()
            if not path.exists():
                return []

            raw = json.loads(path.read_text(encoding="utf-8"))
            return _normalize_custom_icons(raw, limit=100)
        except Exception:
            return []


def _save_custom_icons(values: List[str]) -> List[str]:
    normalized = _normalize_custom_icons(values, limit=100)

    with _custom_icons_lock:
        try:
            path = get_custom_icons_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            safe_write_json(path, normalized, indent=2, ensure_ascii=False)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not save custom icons: {exc}",
            )

    return normalized


def _is_image_upload(file: UploadFile) -> bool:
    content_type = str(file.content_type or "").strip().lower()
    if content_type.startswith("image/"):
        return True

    guessed_type, _ = mimetypes.guess_type(file.filename or "")
    return bool(guessed_type and guessed_type.startswith("image/"))


def _upload_image_to_assets_subdir(file: UploadFile, subdir: str) -> Dict[str, str]:
    if not _is_image_upload(file):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    target_path = get_p("ASSETS") / subdir
    target_path.mkdir(parents=True, exist_ok=True)

    try:
        relative_path = _save_uploaded_file_to_assets(file, target_path)
    except Exception as e:
        log.error(f"Error uploading image to {subdir}: {e}")
        raise HTTPException(status_code=500, detail="Could not save image")

    url = f"/api/vault/assets/{relative_path[len('Assets/') :]}"
    return {"url": url, "path": relative_path}


def _normalize_icon_extension(filename: str, content_type: str) -> str:
    ext = (Path(filename or "").suffix or "").strip().lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"}:
        return ".jpg" if ext == ".jpeg" else ext

    ctype = str(content_type or "").split(";")[0].strip().lower()
    mapped = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
    }.get(ctype)
    return mapped or ".png"


def _store_icon_bytes(
    payload: bytes, source_name: str, content_type: str
) -> Dict[str, Optional[str]]:
    if not payload:
        raise HTTPException(status_code=400, detail="Empty icon payload")

    icons_dir = get_p("ASSETS") / "Icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(payload).hexdigest()[:12]
    ext = _normalize_icon_extension(source_name, content_type)
    filename = f"icon-{digest}{ext}"
    icon_path = icons_dir / filename

    if not icon_path.exists():
        safe_write_bytes(icon_path, payload)

    # Thumbnail generation moved to background task in the route
    
    icon_rel = str(icon_path.relative_to(get_p("VAULT"))).replace("\\", "/")

    response = {
        "url": f"/api/vault/assets/{icon_rel[len('Assets/') :]}",
        "path": icon_rel,
        "thumbnail_url": None,
        "thumbnail_path": None,
    }

    if thumbnail_rel:
        response["thumbnail_path"] = thumbnail_rel
        response["thumbnail_url"] = (
            f"/api/vault/assets/{thumbnail_rel[len('Assets/') :]}"
        )

    return response


def _maybe_create_icon_thumbnail(icon_path: Path, digest: str) -> Optional[str]:
    if Image is None:
        return None

    # Raster-only thumbnails; skip vectors such as SVG.
    if icon_path.suffix.lower() == ".svg":
        return None

    try:
        with Image.open(icon_path) as img:
            width, height = img.size
            if max(width, height) <= 256:
                return None

            side = min(width, height)
            left = (width - side) // 2
            top = (height - side) // 2
            cropped = img.crop((left, top, left + side, top + side))
            thumb = cropped.resize((128, 128), Image.LANCZOS)

            thumbs_dir = get_p("ASSETS") / "Icons" / "Thumbnails"
            thumbs_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumbs_dir / f"icon-{digest}-thumb.png"

            thumb.save(thumb_path, format="PNG")
            return str(thumb_path.relative_to(get_p("VAULT"))).replace("\\", "/")
    except Exception:
        return None


def _normalize_resource_title(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
    return normalized


def _resource_visible_record(page: PageInfo) -> bool:
    metadata = page.metadata or {}
    if metadata.get("is_template"):
        return False

    # Locate a "type" property regardless of locale/casing. Hardcoding "Type"
    # / "Tipus" was a pre-identity-normalization patch that misses any other
    # localized variant (`Tipo`, `Categoria`, `tipus de recurs`, …). Now that
    # frontmatter keys equal canonical schema names, we just scan all keys
    # whose normalized form is "type"/"tipus"/"tipo".
    tipus = ""
    for k, v in metadata.items():
        norm_k = str(k).strip().lower().replace("_", "").replace(" ", "")
        if norm_k in ("type", "tipus", "tipo"):
            tipus = str(v or "").strip().lower()
            break
    title = str(page.title or "").strip().lower()
    gnosi_id = str(metadata.get("id") or page.id or "").strip()

    if tipus == "annotation":
        return False

    if title in {"new", "untitled", "sense títol", "sense titol"}:
        return False

    if not gnosi_id:
        return False

    return True


def _canonical_visible_table_pages(
    table_id: str, pages: List[PageInfo]
) -> List[PageInfo]:
    # Base rule shared by all tables: templates are not records in table counts.
    filtered = [p for p in pages if not (p.metadata or {}).get("is_template")]

    if table_id != "resources":
        return filtered

    filtered = [p for p in filtered if _resource_visible_record(p)]

    # Recursos may include semantic duplicates (accent/punctuation variants).
    deduped: Dict[str, PageInfo] = {}
    for page in filtered:
        key = _normalize_resource_title(page.title)
        if not key:
            key = f"__{page.id}"

        existing = deduped.get(key)
        if existing is None:
            deduped[key] = page
            continue

        try:
            existing_ts = datetime.fromisoformat(existing.last_modified).timestamp()
        except Exception:
            existing_ts = 0

        try:
            next_ts = datetime.fromisoformat(page.last_modified).timestamp()
        except Exception:
            next_ts = 0

        if next_ts > existing_ts:
            deduped[key] = page

    return list(deduped.values())


def is_calendar_entry(metadata: Optional[dict]) -> bool:
    """Decides if a page should be saved as a calendar appointment."""
    if not metadata:
        return False

    source = (metadata.get("source") or "").strip().lower()
    has_date = bool(metadata.get("date"))
    has_table = bool(get_table_id(metadata))

    # An appointment must always have a date. With date: it's an appointment if it comes from Gnosi
    # (internal calendar) or if it doesn't belong to any DB table.
    return has_date and (source in {"gnosi", "gnosi vault"} or not has_table)


def init_vault():
    """Initializes the basic environment."""
    if not get_p("VAULT"):
        log.info("⚠️ Bunker in 'pending' mode: Starting without structural Vault path.")
        return
        
    paths_to_create = [
        get_p("VAULT"), get_p("ASSETS"), get_p("CALENDAR"), get_p("DIBUIXOS"), get_p("DATABASES"),
        get_p("DEFAULT_DB"), get_p("DEFAULT_TABLE"), get_p("WIKI"), get_p("DASHBOARDS")
    ]
    
    for p in paths_to_create:
        if p:
            try:
                p.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                log.error(f"Error initializing structural directory {p}: {e}")


def ensure_default_registry_structure():
    """Ensures the existence of the default DB and an initial table."""
    registry = load_registry()
    if "databases" not in registry or not isinstance(registry["databases"], list):
        registry["databases"] = []
    if "tables" not in registry or not isinstance(registry["tables"], list):
        registry["tables"] = []
    if "views" not in registry or not isinstance(registry["views"], list):
        registry["views"] = []

    changed = False

    db = next(
        (d for d in registry["databases"] if d.get("id") == "gnosi_vault_db"), None
    )
    if db is None:
        db = {
            "id": "gnosi_vault_db",
            "name": "Gnosi Vault",
            "folder": "Databases/Gnosi",
        }
        registry["databases"].append(db)
        changed = True
    else:
        if db.get("name") != "Gnosi Vault":
            db["name"] = "Gnosi Vault"
            changed = True
        if db.get("folder") != "Databases/Gnosi":
            db["folder"] = "Databases/Gnosi"
            changed = True

    default_table = next(
        (t for t in registry["tables"] if t.get("id") == "table_1"), None
    )
    if default_table is None:
        has_any_table_for_default_db = any(
            t.get("database_id") == "digital_brain_db" for t in registry["tables"]
        )
        # Disabled to avoid unnecessary noise in the Vault per user feedback
        pass

    if changed:
        save_registry(registry)


# init_vault() # Disabled: Now initialized dynamically per workspace via WorkspaceService


def parse_frontmatter(content: str, file_path: Optional[Path] = None):
    """Parses a markdown file to extract the YAML frontmatter and body.

    Si `file_path` permet derivar un vault root i la pàgina té `id`, també
    fusiona el sidecar JSON corresponent (`.gnosi/page_meta/<id>.json`).
    Així les flags internes (`*_manual`, `is_template`) viuen fora del `.md`
    però apareixen al dict de metadata com sempre.
    """
    # Regex to capture frontmatter between --- and --- at the start of the file
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end() :]
        try:
            metadata = yaml.safe_load(yaml_content) or {}
            metadata = apply_sidecar_to(metadata, file_path)
            return metadata, body
        except yaml.YAMLError as e:
            fallback_metadata = _parse_frontmatter_fallback(yaml_content)
            if fallback_metadata:
                location = f" in {file_path}" if file_path else ""
                log.warning(
                    f"Malformed YAML frontmatter{location}; applying rescue parsing"
                )
                fallback_metadata = apply_sidecar_to(fallback_metadata, file_path)
                return fallback_metadata, body
            location = f" in {file_path}" if file_path else ""
            # malformed YAML is annoying but not fatal; debug instead of error
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content


def _parse_frontmatter_fallback(yaml_content: str) -> dict:
    """Fallback tolerant parser for simple top-level `key: value` frontmatter.

    It intentionally ignores nested/object/list blocks and only salvages scalar
    values from top-level keys so listings can still resolve id/title/table_id.
    """
    metadata = {}
    for raw_line in yaml_content.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue

        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue

        # Ignore nested YAML blocks and list members to avoid corrupt parsing.
        if line.startswith((" ", "\t", "- ")):
            continue

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        if not key:
            continue

        parsed_value = value.strip()

        if len(parsed_value) >= 2 and (
            (parsed_value[0] == '"' and parsed_value[-1] == '"')
            or (parsed_value[0] == "'" and parsed_value[-1] == "'")
        ):
            parsed_value = parsed_value[1:-1]

        lowered = parsed_value.lower()
        if lowered == "true":
            metadata[key] = True
        elif lowered == "false":
            metadata[key] = False
        elif re.fullmatch(r"-?\d+", parsed_value):
            metadata[key] = int(parsed_value)
        else:
            metadata[key] = parsed_value

    return metadata


def generate_frontmatter(metadata: dict) -> str:
    """Generates YAML frontmatter string from a dictionary.

    Les claus internes (`*_manual`, `is_template`, …) es filtren d'aquí: no
    han d'aparèixer mai al `.md`. Es persisteixen al sidecar JSON via
    `save_page_md`. Si algú crida `generate_frontmatter` sense després escriure
    el sidecar (no és el patró recomanat), aquestes flags es perdrien — per
    això la regla és **usar sempre `save_page_md` per escriure pàgines**.
    """
    if not metadata:
        return "---\n---\n"
    fm_meta, _sidecar = split_sidecar_metadata(metadata)
    if not fm_meta:
        return "---\n---\n"
    yaml_str = yaml.dump(
        fm_meta, default_flow_style=False, sort_keys=False, allow_unicode=True,
        width=4096,
    )
    return f"---\n{yaml_str}---\n"


def save_page_md(file_path: Path, metadata: dict, body: str) -> None:
    """Escriu una pàgina .md amb separació frontmatter / sidecar.

    1. Persisteix les claus internes (`*_manual`, `is_template`, …) al sidecar
       JSON a `<vault>/.gnosi/page_meta/<id>.json`.
    2. Escriu el `.md` amb només frontmatter "net" + body.

    És el wrapper canònic per escriure pàgines. Substitueix el patró
    `generate_frontmatter(metadata) + safe_write_text`.

    GARANTIA "sense brossa al .md": abans de serialitzar, canonicalitza les
    claus al **nom actual** de la columna (resol `fld_*` i noms antics/àlies).
    Així cap camí d'escriptura pot deixar `fld_*` al frontmatter. Vegeu la
    directiva `vault_persist_by_name.md`.
    """
    try:
        _tid = get_table_id(metadata)
        if _tid:
            _table = _table_by_id(_tid)
            if _table:
                metadata, _ = to_storage_names(metadata, _table)
    except Exception as e:  # defensiu: una fallada de resolució no ha de bloquejar l'escriptura
        log.debug(f"to_storage_names ha fallat per {file_path}: {e}")
    fm_meta = persist_sidecar_from(metadata, file_path)
    if not fm_meta:
        frontmatter = "---\n---\n"
    else:
        yaml_str = yaml.dump(
            fm_meta, default_flow_style=False, sort_keys=False, allow_unicode=True,
            width=4096,
        )
        frontmatter = f"---\n{yaml_str}---\n"
    safe_write_text(file_path, f"{frontmatter}\n{(body or '').lstrip()}")


def normalize_metadata_ids(metadata: dict) -> dict:
    """
    Normalizes identification fields in frontmatter.
    Policy: the canonical field is 'id'. If legacy identifier keys exist,
    they are renamed to 'id' and deleted. If 'id' already exists, it's preserved.
    """
    legacy_fields = ["source_id", "gnosi_id"]
    for key in list(metadata.keys()):
        normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
        if normalized in {"sourceid", "gnosiid"}:
            legacy_fields.append(key)

    for field in set(legacy_fields):
        if field in metadata:
            if "id" not in metadata:
                metadata["id"] = metadata[field]
            del metadata[field]
    return metadata


def normalize_table_context(metadata: dict) -> dict:
    """Keeps table context fields synchronized (canonical + legacy)."""
    table_id = metadata.get("table_id")
    database_table_id = metadata.get("database_table_id")

    # Legacy compatibility: wiki pages must not behave as DB rows.
    if str(table_id or "").strip().lower() == "wiki":
        metadata.pop("table_id", None)
        table_id = None
    if str(database_table_id or "").strip().lower() == "wiki":
        metadata.pop("database_table_id", None)
        database_table_id = None

    if table_id and not database_table_id:
        metadata["database_table_id"] = table_id
    elif database_table_id and not table_id:
        metadata["table_id"] = database_table_id

    return metadata


def ensure_correct_page_location(file_path: Path, metadata: dict) -> Path:
    """Moves notes between Wiki/Templates/Calendar/BD based on metadata."""
    is_template = metadata.get("is_template") is True
    is_calendar = is_calendar_entry(metadata)
    is_dashboard = metadata.get("is_dashboard") is True

    if is_template:
        target_dir = get_p("PLANTILLES")
    elif is_calendar:
        target_dir = get_p("CALENDAR")
    elif is_dashboard:
        target_dir = get_p("DASHBOARDS")
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        if table_folder:
            target_dir = table_folder
        else:
            target_dir = get_p("WIKI")

    # We don't move notes that are already in user subfolders, except
    # Templates/Calendar. Comprovem PRIMER si cal relocate; només llavors
    # paguem el `mkdir(parents=True, exist_ok=True)` que stat'eja cada
    # nivell del path a OneDrive (~30-100 ms × profunditat = 100-900 ms
    # observat al PATCH idempotent on no es mou res).
    can_relocate = (
        file_path.parent == get_p("VAULT")
        or file_path.parent == get_p("PLANTILLES")
        or file_path.parent == get_p("CALENDAR")
        or file_path.parent == get_p("WIKI")
        or file_path.parent == get_p("DASHBOARDS")
    )

    if can_relocate and file_path.parent != target_dir:
        target_dir.mkdir(parents=True, exist_ok=True)
        new_path = target_dir / file_path.name
        if file_path.exists() and file_path.is_file():
            file_path.rename(new_path)
        return new_path

    return file_path


def _process_metadata_paths(metadata: dict):
    """
    Transforms relative paths starting with Assets/
    into paths accessible via API /api/vault/assets/.
    """
    if not metadata:
        return metadata

    for key in ["cover", "icon"]:
        val = metadata.get(key)
        if isinstance(val, str) and val.startswith("Assets/"):
            # Replace Assets/ with the API path
            metadata[key] = val.replace("Assets/", "/api/vault/assets/", 1)

    return metadata


def _normalize_schema_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _sanitize_asset_segment(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[\\/]+", " ", str(value or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\-. ]", "", cleaned, flags=re.UNICODE).strip()
    if not cleaned:
        return fallback
    return cleaned[:120]


def _sanitize_filename_base(title: str) -> str:
    """Sanitize a title into a filesystem-safe filename base (without extension)."""
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(title or "")).strip()
    safe = re.sub(r"\s+", " ", safe)
    if not safe:
        safe = "Untitled"
    if len(safe) > 200:
        safe = safe[:200].strip()
    return safe


def _resolve_unique_filename(
    target_dir: Path,
    base_name: str,
    exclude_path: Optional[Path] = None,
    extension: str = ".md",
) -> str:
    """Returns a unique filename base in target_dir, optionally ignoring exclude_path."""
    candidate = base_name
    counter = 2

    while True:
        candidate_path = target_dir / f"{candidate}{extension}"
        if not candidate_path.exists():
            return candidate

        if exclude_path is not None:
            try:
                if candidate_path.resolve() == exclude_path.resolve():
                    return candidate
            except Exception:
                if candidate_path == exclude_path:
                    return candidate

        candidate = f"{base_name} ({counter})"
        counter += 1


def _rename_page_file_to_match_title(file_path: Path, title: str) -> Path:
    """Renames page file so the filename matches title while preserving uniqueness."""
    target_dir = file_path.parent
    base_name = _sanitize_filename_base(title)
    extension = file_path.suffix or ".md"
    desired_name = _resolve_unique_filename(
        target_dir,
        base_name,
        exclude_path=file_path,
        extension=extension,
    )
    desired_path = target_dir / f"{desired_name}{extension}"

    if desired_path == file_path:
        return file_path

    file_path.rename(desired_path)
    return desired_path


def _safe_filename(title: str, target_dir: Path) -> str:
    """Generate a safe filename from a title, handling collisions.

    Returns the filename WITHOUT extension.
    """
    safe = _sanitize_filename_base(title)
    return _resolve_unique_filename(target_dir, safe)


def _is_dashboard_file_path(file_path: Path) -> bool:
    if not file_path or file_path.suffix.lower() != ".json" or not get_p("DASHBOARDS"):
        return False
    try:
        file_path.resolve().relative_to(get_p("DASHBOARDS").resolve())
        return True
    except Exception:
        return False


def _read_dashboard_file(file_path: Path) -> tuple[dict, str]:
    data = json.loads(file_path.read_text(encoding="utf-8"))
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    metadata = dict(metadata)

    file_id = data.get("id") or metadata.get("id") or file_path.stem
    title = data.get("title") or metadata.get("title") or file_path.stem
    parent_id = data.get("parent_id")

    metadata["id"] = file_id
    metadata["title"] = title
    if parent_id is not None:
        metadata["parent_id"] = parent_id
    metadata["is_dashboard"] = True
    metadata.setdefault("content_format", "json")

    body = data.get("content")
    if body is None:
        body = "{}"
    elif not isinstance(body, str):
        body = json.dumps(body, ensure_ascii=False, indent=2)

    return metadata, body


def _write_dashboard_file(
    file_path: Path,
    page_id: str,
    title: str,
    metadata: dict,
    content: str,
    parent_id: Optional[str] = None,
    is_database: bool = False,
):
    payload = {
        "id": page_id,
        "title": title,
        "parent_id": parent_id,
        "is_database": is_database,
        "metadata": metadata,
        "content": content,
    }
    safe_write_json(file_path, payload, indent=2, ensure_ascii=False)


def _ensure_page_extension(file_path: Path, is_dashboard: bool) -> Path:
    desired_extension = ".json" if is_dashboard else ".md"
    if file_path.suffix.lower() == desired_extension:
        return file_path

    base_name = _sanitize_filename_base(file_path.stem)
    desired_name = _resolve_unique_filename(
        file_path.parent,
        base_name,
        exclude_path=file_path,
        extension=desired_extension,
    )
    desired_path = file_path.parent / f"{desired_name}{desired_extension}"
    file_path.rename(desired_path)
    return desired_path


_ASSET_NAME_RE = re.compile(
    r"(^|[\s_\-])(image|imatge|imagen|foto|cover|thumbnail|thumb)([\s_\-]|$)",
    re.IGNORECASE,
)


def _is_asset_property(prop: Dict[str, Any]) -> bool:
    p_type = str((prop or {}).get("type") or "").strip().lower()
    if p_type in {
        "files",
        "file",
        "image",
        "images",
        "attachment",
        "attachments",
        "media",
    }:
        return True

    # Per camps de tipus `url`, promocionem a asset si el nom suggereix imatge.
    # Coincidència per paraula sencera per evitar falsos positius com
    # "Cobertura" (contenia "cover" com a substring) o noms genèrics que
    # incloguessin els tokens dins d'altres paraules.
    p_name = str((prop or {}).get("name") or "").strip().lower()
    return p_type == "url" and bool(_ASSET_NAME_RE.search(p_name))


def _resolve_table_and_database_for_assets(
    table_id: str, registry: dict
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    table = next(
        (t for t in registry.get("tables", []) if str(t.get("id")) == str(table_id)),
        None,
    )
    if not table:
        return None, None
    database_id = table.get("database_id")
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(database_id)
        ),
        None,
    )
    return table, database


def _property_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], property_name: str
) -> Path:
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    prop_segment = _sanitize_asset_segment(property_name, "Property")
    return get_p("ASSETS") / db_segment / table_segment / prop_segment


def _find_table_property(
    table: Optional[Dict[str, Any]], property_name: str
) -> Optional[Dict[str, Any]]:
    """Retorna la property d'una taula pel seu nom (o àlies), o None."""
    name = str(property_name or "").strip()
    if not table or not name:
        return None
    for prop in table.get("properties", []) or []:
        if str(prop.get("name") or "").strip() == name:
            return prop
        if name in (prop.get("aliases") or []):
            return prop
    return None


def _property_config_value(prop: Optional[Dict[str, Any]], key: str):
    """Llegeix un valor de config d'una property, sigui pla o niat sota `config`."""
    if not prop:
        return None
    if prop.get(key) is not None:
        return prop.get(key)
    cfg = prop.get("config")
    if isinstance(cfg, dict):
        return cfg.get(key)
    return None


def _ensure_asset_dirs_for_table_entry(table: Dict[str, Any], registry: dict):
    """Crea totes les carpetes d'assets associades a una taula:
      • `Assets/<TableName>/` — destí pla per fitxers genèrics (drag&drop a
        notes que no van lligats a cap propietat concreta).
      • `Assets/<DB>/<Table>/<Property>/` — un sub-dir per cada propietat de
        tipus asset (files/file/image/...).

    Idempotent: `mkdir(parents=True, exist_ok=True)` no falla si ja existeix.
    """
    if not table:
        return
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )

    # 1) Carpeta plana Assets/<TableName>/ — sempre, per a qualsevol taula
    table_name = str(table.get("name") or "").strip()
    if table_name:
        try:
            flat_segment = _sanitize_asset_segment(table_name, "Table")
            (get_p("ASSETS") / flat_segment).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning(f"Could not create Assets/{table_name}/: {e}")

    # 2) Sub-dirs per cada propietat de tipus asset
    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue
        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue
        _property_assets_dir(table, database, prop_name).mkdir(
            parents=True, exist_ok=True
        )


def _ensure_table_vault_folder(table: Dict[str, Any], registry_data: Dict[str, Any]):
    """Creates the physical table folder inside BD/DBName/ (ex: Gnosi/BD/Gnosi/Articles/).
    Includes migration logic: if the folder is in root or BD/, it moves it to the DB folder.
    """
    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        log.warning(f"Table {table.get('id')} ({table.get('name')}) does not have a 'folder' property defined.")
        return

    # Seek the folder of the database the table belongs to
    db_id = table.get("database_id")
    db_folder = "BD" # Default if not found
    
    if registry_data and "databases" in registry_data:
        for db in registry_data["databases"]:
            if db.get("id") == db_id:
                db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
                break

    # Correct final path: Gnosi / BD / DB Name / folder_rel
    target_path = get_p("VAULT") / db_folder / folder_rel
    
    # Migration routes (where the folder might be right now)
    legacy_root_path = get_p("VAULT") / folder_rel
    legacy_bd_path = get_p("DATABASES") / folder_rel

    try:
        # 1. MIGRATION from root (Gnosi/Articles)
        if legacy_root_path.exists() and legacy_root_path.is_dir() and legacy_root_path != (get_p("VAULT") / db_folder):
            if not target_path.exists():
                log.info(f"📦 Migrating table folder from ROOT to {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_root_path), str(target_path))
        
        # 2. MIGRATION from BD/ (Gnosi/BD/Articles)
        if legacy_bd_path.exists() and legacy_bd_path.is_dir() and legacy_bd_path != target_path:
            if not target_path.exists():
                log.info(f"📦 Migrating table folder from BD to {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_bd_path), str(target_path))
            else:
                # If it already exists at destination but also in BD/, try to merge or delete the old one if empty
                log.warning(f"⚠️ Legacy folder in BD/ still exists for {folder_rel}. Considering cleanup.")
                if not any(legacy_bd_path.iterdir()):
                    legacy_bd_path.rmdir()

        # 3. CREATION (if not migrated or didn't exist)
        if not target_path.exists():
            target_path.mkdir(parents=True, exist_ok=True)
            log.info(f"✅ Table folder created at {db_folder}/: {target_path}")
        # else:
            # log.info(f"ℹ️ Table folder already exists correctly at {db_folder}/: {target_path}")
            
    except Exception as e:
        log.error(f"❌ Error managing folder for table {folder_rel} at {db_folder}: {e}")


def _table_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]]
) -> Path:
    """Returns the Assets/[DB]/[Table] directory for a table."""
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    return get_p("ASSETS") / db_segment / table_segment


def _delete_asset_files_for_page(
    page_metadata: dict, table: Dict[str, Any], registry: dict
):
    """Deletes asset files referenced in a record's metadata."""
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue
        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue
        value = page_metadata.get(prop_name)
        if not value:
            continue
        # Normalize to list to treat single and multiple values identically
        paths = value if isinstance(value, list) else [value]
        vault_root = get_p("VAULT").resolve()
        assets_root = (vault_root / "Assets").resolve()
        for raw_path in paths:
            if not isinstance(raw_path, str):
                continue
            rel = raw_path.strip()
            if not rel.startswith("Assets/"):
                continue
            # Defensa contra path traversal: si una nota legítima conté
            # frontmatter manipulat (`Assets/../../etc/passwd`), el
            # `startswith("Assets/")` passa però `resolve()` apuntaria fora
            # del Vault. `unlink()` correria com a root al contenidor →
            # podríem esborrar fitxers arbitraris del filesystem del host.
            try:
                abs_path = (vault_root / rel).resolve()
                abs_path.relative_to(assets_root)  # raises ValueError si fora
            except (ValueError, OSError):
                log.warning(
                    f"Asset path traversal bloquejat: {rel!r} no és sota Assets/"
                )
                continue
            if abs_path.is_file():
                try:
                    abs_path.unlink()
                    log.info(f"Asset deleted: {abs_path}")
                except Exception as exc:
                    log.warning(f"Could not delete {abs_path}: {exc}")


def _delete_asset_property_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], prop_name: str
):
    """Recursively deletes the Assets/[DB]/[Table]/[Property] folder if it exists."""
    prop_dir = _property_assets_dir(table, database, prop_name)
    if prop_dir.is_dir():
        try:
            shutil.rmtree(prop_dir)
            log.info(f"Property folder deleted: {prop_dir}")
        except Exception as exc:
            log.warning(f"Could not delete folder {prop_dir}: {exc}")


def _delete_asset_table_dir(table: Dict[str, Any], database: Optional[Dict[str, Any]]):
    """Recursively deletes the table's asset folders.

    Symmetric with `_ensure_asset_dirs_for_table_entry`, which creates two:
      • `Assets/<DB>/<Table>/`         (structured, per-property children)
      • `Assets/<TableName>/`          (flat, for generic drag&drop)

    Both are removed here. Empty-or-not, this is a destructive operation
    consistent with the existing rmtree behaviour. The caller (delete_table
    handler) is the only entry point and it requires admin role.
    """
    # 1) Structured Assets/[DB]/[Table]/
    table_dir = _table_assets_dir(table, database)
    if table_dir.is_dir():
        try:
            shutil.rmtree(table_dir)
            log.info(f"Table folder deleted: {table_dir}")
        except Exception as exc:
            log.warning(f"Could not delete folder {table_dir}: {exc}")

    # 2) Flat Assets/<TableName>/
    table_name = str((table or {}).get("name") or "").strip()
    if table_name:
        try:
            flat_segment = _sanitize_asset_segment(table_name, "Table")
            flat_dir = get_p("ASSETS") / flat_segment
            if flat_dir.is_dir():
                shutil.rmtree(flat_dir)
                log.info(f"Flat assets folder deleted: {flat_dir}")
        except Exception as exc:
            log.warning(f"Could not delete flat assets folder for {table_name}: {exc}")


def _asset_segments_collide(a: str, b: str) -> bool:
    """True si dos segments d'Assets resolen al mateix directori físic.

    En macOS/APFS el filesystem és case-insensitive: "Cervell Digital" i
    "Cervell digital" són la MATEIXA carpeta. Comparem amb casefold per
    detectar-ho de manera portable (vegeu
    `docs/dev_memory/directives/table_rename_flat_folder_collision.md`).
    """
    return str(a or "").strip().casefold() == str(b or "").strip().casefold()


def _move_loose_files(src_dir: Path, dst_dir: Path) -> int:
    """Mou només els FITXERS solts (no subdirectoris) de src_dir a dst_dir.

    S'usa quan la carpeta plana `Assets/<Taula>/` coincideix físicament amb
    l'arrel de nesting `Assets/<DB>/`: els subdirectoris són arbres
    estructurats `<Taula>/<Propietat>/` d'altres taules i NO s'han de moure.
    """
    moved = 0
    dst_dir.mkdir(parents=True, exist_ok=True)
    for entry in src_dir.iterdir():
        if not entry.is_file():
            continue
        dest = dst_dir / entry.name
        if dest.exists():
            log.warning(f"Loose asset move skipped, destination exists: {dest}")
            continue
        try:
            entry.rename(dest)
            moved += 1
        except Exception as e:
            log.warning(f"Could not move loose asset {entry} → {dest}: {e}")
    return moved


def _table_vault_dir(table: Dict[str, Any], registry: dict) -> Optional[Path]:
    """Retorna el directori físic de la taula dins el Vault (BD/<DB>/<Taula>/)."""
    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        return None
    db_id = table.get("database_id")
    db_folder = "BD"
    for db in registry.get("databases", []) or []:
        if db.get("id") == db_id:
            db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
            break
    return get_p("VAULT") / db_folder / folder_rel


def _rewrite_inline_asset_refs(pages_dir: Path, old_seg: str, new_seg: str) -> int:
    """Reescriu les referències inline a la carpeta plana renombrada.

    Els cossos de pàgina referencien els fitxers solts via
    `/api/vault/assets/<seg>/fitxer.png` (el segment sol anar URL-encoded,
    p.ex. `Cervell%20digital`). En renombrar la carpeta plana aquestes URLs
    queden trencades; les reescrivim de <old_seg> a <new_seg>.

    Case-SENSITIVE expressament: en una col·lisió (vegeu
    `docs/dev_memory/directives/table_rename_flat_folder_collision.md`) les refs estructurades
    porten el segment de la DB amb una altra capitalització i NO s'han de
    tocar. La URL nova sempre s'escriu URL-encoded.
    """
    if not pages_dir or not pages_dir.is_dir() or old_seg == new_seg:
        return 0
    new_url = f"/api/vault/assets/{urllib.parse.quote(new_seg)}/"
    old_urls = {
        f"/api/vault/assets/{old_seg}/",
        f"/api/vault/assets/{urllib.parse.quote(old_seg)}/",
    }
    old_urls = {u for u in old_urls if u != new_url}
    if not old_urls:
        return 0
    changed = 0
    for md in pages_dir.rglob("*.md"):
        try:
            text = md.read_text(encoding="utf-8")
        except Exception:
            continue
        new_text = text
        for old_url in old_urls:
            if old_url in new_text:
                new_text = new_text.replace(old_url, new_url)
        if new_text != text:
            try:
                safe_write_text(md, new_text)
                changed += 1
            except Exception as e:
                log.warning(f"Could not rewrite asset refs in {md}: {e}")
    return changed


def _copy_local_file_to_assets(local_path: Path, target_dir: Path) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = _sanitize_asset_segment(local_path.name, f"file-{uuid.uuid4().hex[:8]}")
    destination = target_dir / filename
    if destination.exists():
        stem = _sanitize_asset_segment(local_path.stem, "file")
        ext = local_path.suffix
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    shutil.copy2(local_path, destination)
    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


def _save_uploaded_file_to_assets(
    upload: UploadFile, target_dir: Path, target_name: str = ""
) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    ext = Path(original_name).suffix
    if target_name and target_name.strip():
        stem = _sanitize_filename_base(target_name.strip())
    else:
        stem = _sanitize_asset_segment(Path(original_name).stem, "upload")
    destination = target_dir / f"{stem}{ext}"
    if destination.exists():
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"

    with open(destination, "wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


def _save_data_url_image_to_assets(value: str, target_dir: Path) -> Optional[str]:
    match = re.match(
        r"^data:(image/[^;]+);base64,(.+)$", value.strip(), re.IGNORECASE | re.DOTALL
    )
    if not match:
        return None

    mime_type = match.group(1).lower()
    payload = match.group(2)
    try:
        decoded = base64.b64decode(payload, validate=True)
    except Exception:
        return None

    ext = mimetypes.guess_extension(mime_type) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"

    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"image-{uuid.uuid4().hex[:12]}{ext}"
    destination = target_dir / filename
    # safe_write_bytes (write to .tmp + atomic rename): si el procés crashea
    # mig camí, l'asset queda complet o no existeix — mai truncat.
    safe_write_bytes(destination, decoded)
    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


def _persist_asset_value(value: Any, target_dir: Path) -> Any:
    if value is None:
        return value

    if isinstance(value, list):
        return [_persist_asset_value(item, target_dir) for item in value]

    if isinstance(value, dict):
        updated = dict(value)
        for key in ["path", "file_path", "url", "src"]:
            if key in updated:
                updated[key] = _persist_asset_value(updated[key], target_dir)
        return updated

    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value

    if text.startswith("/api/vault/assets/"):
        return "Assets/" + text[len("/api/vault/assets/") :]
    if text.startswith("Assets/"):
        return text
    if text.startswith("http://") or text.startswith("https://"):
        return text

    data_url_result = _save_data_url_image_to_assets(text, target_dir)
    if data_url_result:
        return data_url_result

    candidate = text
    if text.startswith("file://"):
        candidate = urllib.parse.unquote(text[7:])

    local_path = Path(candidate).expanduser()
    try:
        if local_path.exists() and local_path.is_file():
            return _copy_local_file_to_assets(local_path, target_dir)
    except Exception:
        return value

    return value


def _persist_metadata_assets(metadata: dict) -> dict:
    if not metadata:
        return metadata

    table_id = get_table_id(metadata)
    if not table_id:
        return metadata

    registry = load_registry()
    table, database = _resolve_table_and_database_for_assets(str(table_id), registry)
    if not table:
        return metadata

    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue

        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue

        # Camps amb destí fora d'Assets (storage_folder 'biblioteca' o 'free') NO
        # s'han d'ingerir a Assets: el fitxer ja viu al seu lloc (p.ex. la
        # Biblioteca) i el valor és una ruta absoluta que cal preservar tal qual.
        # Sense aquest guard, en desar la pàgina es copiava el fitxer a
        # Assets/<BD>/<Taula>/<Prop>/ i es reescrivia el valor — anul·lant la
        # config del camp (per això un camp 'biblioteca' acabava sempre a Assets).
        configured_storage = str(_property_config_value(prop, "storage_folder") or "").strip()
        if configured_storage and configured_storage != "assets":
            continue

        prop_key_norm = _normalize_schema_key(prop_name)
        metadata_key = next(
            (k for k in metadata.keys() if _normalize_schema_key(k) == prop_key_norm),
            None,
        )
        if not metadata_key:
            continue

        target_dir = _property_assets_dir(table, database, prop_name)
        target_dir.mkdir(parents=True, exist_ok=True)
        metadata[metadata_key] = _persist_asset_value(
            metadata.get(metadata_key), target_dir
        )

    return metadata


def _normalize_rel_folder(folder: Optional[str]) -> str:
    """Normalizes the folder path to make it relative to get_p("VAULT").
    THIS VERSION detects if an absolute path from the Mac host is received and cleans it.
    """
    if not folder:
        return ""
    
    f = str(folder).replace("\\", "/")
    
    # Cleanup of redundant prefixes (Gnosi Segment)
    if "Gnosi/" in f:
        f = f.split("Gnosi/", 1)[1]
    elif f.startswith("/vault/"):
        f = f[7:]
    elif f.startswith("/vault"):
        f = f[6:]

    return f.strip().strip("/")


def _build_table_folder_index(registry: dict) -> dict:
    folder_to_table = {}
    
    # Database folder mapping for path prefixing
    db_folders = {db["id"]: _normalize_rel_folder(db.get("folder", "")) 
                  for db in registry.get("databases", [])}

    for table in registry.get("tables", []):
        raw_folder = table.get("folder")
        table_id = table.get("id")
        if not raw_folder or not table_id:
            continue
            
        db_id = table.get("database_id")
        db_prefix = db_folders.get(db_id, "") if db_id else ""
        
        # 1. Carpeta plana (ex: "Arees")
        plain_folder = _normalize_rel_folder(raw_folder)
        if plain_folder:
            folder_to_table[plain_folder.lower()] = table_id
            
        # 2. Full path with DB prefix (e.g., "Gnosi/Areas")
        if db_prefix:
            full_path = _normalize_rel_folder(f"{db_prefix}/{raw_folder}")
            if full_path and full_path.lower() != plain_folder.lower():
                folder_to_table[full_path.lower()] = table_id
                
    return folder_to_table


def _resolve_table_id_from_context(
    metadata: dict, rel_folder: str, folder_to_table: dict, sorted_folders: Optional[List[str]] = None
) -> Optional[str]:
    # Canonical source: table folder from registry.
    folder_key = _normalize_rel_folder(rel_folder).lower()
    if folder_key:
        # Use provided sorted folders if available, otherwise calculate once
        if sorted_folders is None:
            sorted_folders = sorted(folder_to_table.keys(), key=len, reverse=True)
            
        for f in sorted_folders:
            if folder_key == f or folder_key.startswith(f + "/"):
                return folder_to_table[f]


    # Fallback for legacy/template notes outside table folders.
    res_id = metadata.get("table_id") or metadata.get("database_table_id")
    if str(res_id or "").strip().lower() == "wiki":
        return None
    return res_id


def _resolve_table_folder_from_metadata(metadata: dict) -> Optional[Path]:
    table_id = metadata.get("table_id") or metadata.get("database_table_id")
    if not table_id:
        return None

    registry = load_registry()
    table = next(
        (t for t in registry.get("tables", []) if t.get("id") == table_id), None
    )
    if not table:
        return None

    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        return None

    # Trobar la carpeta de la base de dades
    db_id = table.get("database_id")
    db_folder = "BD"
    for db in registry.get("databases", []):
        if db.get("id") == db_id:
            db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
            break

    return get_p("VAULT") / db_folder / folder_rel


def _resolve_page_context_from_path(
    metadata: dict, file_path: Path
) -> tuple[str, Optional[str]]:
    rel_folder = str(file_path.parent.relative_to(get_p("VAULT"))).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    registry = load_registry()
    folder_to_table = _build_table_folder_index(registry)
    resolved_table_id = _resolve_table_id_from_context(
        metadata, rel_folder, folder_to_table
    )
    return rel_folder, resolved_table_id


def _recompute_cross_record_formulas_for_table(
    table_id: str, exclude_page_id: Optional[str] = None
):
    """Recomputes cross-record formulas for a table after changes in a row."""
    if not table_id:
        return

    with _table_recalc_lock:
        state = _table_recalc_state.setdefault(
            table_id, {"running": False, "pending": False, "last_run": 0.0}
        )
        now = time.monotonic()
        if state["running"]:
            state["pending"] = True
            return
        if now - state["last_run"] < _TABLE_RECALC_COOLDOWN_SECONDS:
            state["pending"] = True
            return
        state["running"] = True

    try:
        while True:
            with _table_recalc_lock:
                state = _table_recalc_state.setdefault(
                    table_id, {"running": True, "pending": False, "last_run": 0.0}
                )
                state["pending"] = False

            try:
                if not get_rule_engine().table_has_cross_record_formulas(table_id):
                    break
            except Exception as e:
                log.warning(
                    f"Could not validate cross-record formulas for table {table_id}: {e}"
                )
                break

            for file_path in get_p("VAULT").rglob("*.md"):
                if any(part.startswith('.') for part in file_path.relative_to(get_p("VAULT")).parts):
                    continue

                try:
                    raw = file_path.read_text(encoding="utf-8")
                    metadata, body = parse_frontmatter(raw, file_path)
                except Exception:
                    continue

                page_id = str(metadata.get("id") or file_path.stem)
                if exclude_page_id and page_id == exclude_page_id:
                    continue
                if metadata.get("is_template") is True:
                    continue

                row_table_id = metadata.get("database_table_id") or metadata.get(
                    "table_id"
                )
                if row_table_id != table_id:
                    continue

                original = metadata.copy()
                try:
                    updated = get_rule_engine().process_updates(
                        page_id, original, original.copy()
                    )
                except Exception as e:
                    log.warning(
                        f"Error recomputing row {page_id} from table {table_id}: {e}"
                    )
                    continue

                if updated == original:
                    continue

                try:
                    save_page_md(file_path, updated, body)
                except Exception as e:
                    log.warning(f"Error saving recomputation for {page_id}: {e}")

            with _table_recalc_lock:
                state = _table_recalc_state.setdefault(
                    table_id, {"running": True, "pending": False, "last_run": 0.0}
                )
                state["last_run"] = time.monotonic()
                rerun = state["pending"]

            if not rerun:
                break
    finally:
        with _table_recalc_lock:
            state = _table_recalc_state.setdefault(
                table_id, {"running": False, "pending": False, "last_run": 0.0}
            )
            state["running"] = False


def _read_frontmatter_partial(file_path: Path):
    """Reads only the top part of a markdown file to extract frontmatter.
    Extremely efficient for large vaults on slow drives (OneDrive).
    """
    lines = []
    frontmatter_started = False
    frontmatter_count = 0
    
    # OneDrive sync pot bloquejar el fitxer fins a uns segons. Backoff
    # exponencial fins a 4s — més que el partial read amb 60 línies hauria
    # de necessitar mai en condicions normals.
    retries = 7
    delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.5]
    last_error = None
    for attempt in range(retries + 1):
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    content_line = line.strip()
                    if content_line == '---':
                        frontmatter_count += 1
                        if frontmatter_count == 2:
                            lines.append(line)
                            # Read up to 60 more lines for body snippet (efficient partial read)
                            for _ in range(60):
                                try:
                                    body_line = next(f, None)
                                    if body_line is None: break
                                    lines.append(body_line)
                                except StopIteration:
                                    break
                            break
                        frontmatter_started = True
                    
                    if frontmatter_started:
                        lines.append(line)
                    elif content_line != "":
                        # If we find non-empty text before ---, it's not a valid frontmatter
                        break
                    
                    # Safety break: frontmatter usually at the very top
                    if len(lines) > 200:
                        break
                        
            content = "".join(lines)
            return parse_frontmatter(content, file_path)
        except OSError as e:
            if e.errno == 35: # Resource deadlock
                last_error = e
                if attempt < retries:
                    time.sleep(delays[attempt])
                    continue
            log.warning(f"Error in partial read of {file_path}: {e}")
            return {}, ""
        except Exception as e:
            log.warning(f"Error in partial read of {file_path}: {e}")
            return {}, ""
    
    if last_error:
        log.warning(f"Final error reading {file_path} after retries: {last_error}")
    return {}, ""


def _is_metadata_stub(metadata: Dict[str, Any]) -> bool:
    """Heurística: el cache va ser inicialitzat des d'un índex parcial
    (només id/title/description) i no s'ha rellegit el frontmatter encara.
    Si la metadata té només claus bàsiques, considerem que cal refrescar-la
    del fitxer abans de retornar-la al frontend.
    """
    if not metadata:
        return True
    keys = set(metadata.keys())
    bare = {"id", "title", "parent_id", "description", "is_database"}
    return keys.issubset(bare)


def _build_page_cache_entry(file_path: Path, stat_result) -> Dict[str, Any]:
    # body sempre definit: si la branca dashboard o l'except descarten body,
    # el return de més avall el referencia → NameError → caller buida tot el
    # cache i el GET següent retorna 404 (rglob només cerca *.md).
    body = ""
    parse_failed = False
    try:
        if _is_dashboard_file_path(file_path):
            metadata, body = _read_dashboard_file(file_path)
        else:
            metadata, body = _read_frontmatter_partial(file_path)
            # Si _read_frontmatter_partial retorna ({}, "") és que ha fallat
            # (Errno 35 retries esgotats). Marquem-ho per evitar persistir
            # una entry amb metadata buida que sobreescriuria una de bona.
            if not metadata and not body:
                parse_failed = True
            metadata = _process_metadata_paths(metadata)
            # Support Catalan 'data' as 'date' alias
            if "data" in metadata and "date" not in metadata:
                metadata["date"] = metadata["data"]
    except Exception as e:
        log.warning(f"Error parsing frontmatter for {file_path.name}: {e}")
        metadata = {}
        parse_failed = True

    file_id = str(metadata.get("id") or file_path.stem)
    rel_folder = str(file_path.parent.relative_to(get_p("VAULT"))).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    # Better title handling: metadata > filename stem > "Untitled"
    title = metadata.get("title")
    if not title:
        title = file_path.stem

    entry = {
        "path": str(file_path),
        "mtime_ns": stat_result.st_mtime_ns,
        "mtime": stat_result.st_mtime,
        "size": stat_result.st_size,
        "id": file_id,
        "title": title,
        "parent_id": metadata.get("parent_id"),
        "is_database": metadata.get("is_database", False),
        "metadata": {
            **metadata,
            "description": metadata.get("description") or (body.strip()[:500] if body else None)
        },
        "folder": rel_folder,
    }
    # Marca per al caller: si el parse del frontmatter ha fallat, evita
    # sobreescriure una entry vella amb dades bones (Errno 35 OneDrive).
    if parse_failed:
        entry["_parse_failed"] = True
    return entry


def _build_cache_entry_from_memory(
    file_path: Path, stat_result, metadata: Dict[str, Any], body: str
) -> Dict[str, Any]:
    """Variant ràpida de `_build_page_cache_entry` per quan el caller ja
    té el `metadata` i `body` finals en memòria (típicament després d'un
    PATCH/PUT). Evita la lectura del fitxer recent escrit a OneDrive, que
    costa 100-300 ms i és el coll dominant del PATCH idempotent.

    Forma de l'entry idèntica a la de `_build_page_cache_entry`.
    """
    # Aplica el mateix post-processament que la versió disc ho fa via
    # `_read_frontmatter_partial` + `_process_metadata_paths`. Aquí ja
    # tenim el metadata post `_persist_metadata_assets`; el `_process_*`
    # només afecta cover/icon que ja estan tractats al pipeline del PATCH.
    md = _process_metadata_paths(dict(metadata or {}))
    if "data" in md and "date" not in md:
        md["date"] = md["data"]

    file_id = str(md.get("id") or file_path.stem)
    rel_folder = str(file_path.parent.relative_to(get_p("VAULT"))).replace("\\", "/")
    if rel_folder == ".":
        rel_folder = ""

    title = md.get("title") or file_path.stem

    return {
        "path": str(file_path),
        "mtime_ns": stat_result.st_mtime_ns,
        "mtime": stat_result.st_mtime,
        "size": stat_result.st_size,
        "id": file_id,
        "title": title,
        "parent_id": md.get("parent_id"),
        "is_database": md.get("is_database", False),
        "metadata": {
            **md,
            "description": md.get("description") or (body.strip()[:500] if body else None),
        },
        "folder": rel_folder,
    }


def _refresh_table_pages_metadata(filtered: List[Any]) -> None:
    """Per a cada PageInfo amb metadata stub, rellegeix el frontmatter del
    fitxer i actualitza el cache in-memory. Paralelitzat amb thread pool:
    sense paralelisme una taula de 270 fitxers triga 35-40s en OneDrive;
    amb 16 workers, baixa a 3-5s.
    """
    from backend.services.context_vars import get_active_vault_path
    from concurrent.futures import ThreadPoolExecutor
    v_path = get_active_vault_path()
    if not v_path:
        return
    v_str = str(v_path)

    targets = []
    for p in filtered:
        if not _is_metadata_stub(p.metadata or {}):
            continue
        file_path = Path(p.path) if getattr(p, "path", None) else None
        if not file_path or not file_path.exists():
            continue
        targets.append((p, file_path))

    if not targets:
        return

    def _read_one(item):
        page_obj, file_path = item
        try:
            entry = _build_page_cache_entry(file_path, file_path.stat())
            return page_obj, file_path, entry
        except Exception as e:
            log.debug(f"refresh read fail {file_path.name}: {e}")
            return page_obj, file_path, None

    max_workers = min(16, len(targets))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        results = list(ex.map(_read_one, targets))

    for page_obj, file_path, entry in results:
        if entry is None:
            continue
        if entry.pop("_parse_failed", False):
            continue
        new_meta = entry.get("metadata") or {}
        if _is_metadata_stub(new_meta):
            continue
        page_obj.metadata = new_meta
        if entry.get("title"):
            page_obj.title = entry.get("title")
        with _page_index_lock:
            cached = _page_index_entries.setdefault(v_str, {}).get(str(file_path))
            if cached is not None:
                cached.update(entry)
                _bump_page_index_version(v_str)


def _get_cached_page_entries(
    search_paths: Optional[List[Path]] = None, 
    force_refresh: bool = False
) -> List[Dict[str, Any]]:
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path or not v_path.exists():
        return []
    v_str = str(v_path)

    # 1. Initialize from disk if needed
    if not _page_index_initialized.get(v_str):
        loaded = _load_page_index_from_disk(v_str)
        if not loaded:
            # Disk cache missing: mark as initialized to prevent repeated reads
            # and force a synchronous scan so the first response is never empty.
            with _page_index_lock:
                _page_index_entries.setdefault(v_str, {})
            _page_index_initialized[v_str] = True
            force_refresh = True

    # 2. If it's a read-only request (Fast Path), return immediately
    if not force_refresh:
        with _page_index_lock:
            entries = _page_index_entries.get(v_str, {})
            if search_paths:
                search_paths_strs = [str(p) for p in search_paths]
                return [
                    e for e in entries.values()
                    if any((e.get("path") or "").startswith(s) for s in search_paths_strs)
                ]
            return list(entries.values())

    # 3. Discovery (Slow Path) - Only reached if force_refresh=True
    # 3. Discovery (Slow Path) - Efficient walk skipping known heavy/redundant folders
    candidate_files = []
    
    # Folders to skip entirely
    SKIP_DIRS = {
        'assets', 'drawings', 'mail',
        '.history', '.trash'
    }
    # Carpetes ocultes (`.<nom>`) que SÍ indexem com a contingut. .Dashboards
    # conté els layouts derivats; sense aquesta excepció, l'os.walk filtraria
    # tots els dirnames que comencen per "." i els dashboards mai entrarien
    # al cache → desapareixien al recarregar.
    HIDDEN_ALLOWED = {'.dashboards'}

    # Subarbres exclosos de la indexació de pàgines, per ruta relativa (POSIX).
    # `Calendar/External` són els calendaris Google SUBSCRITS (orto/ocàs per
    # ciutat, fases de la lluna, primary, sunday…): ~2000 fitxers, molts dels
    # quals queden com a placeholders on-demand d'OneDrive que Docker NO pot
    # llegir (`OSError: [Errno 35] Resource deadlock avoided`) ni stat-ar sense
    # bloquejar-se → encallaven l'indexador i deixaven la llista de pàgines
    # buida. No són contingut propi (events subscrits); els podem del walk
    # perquè no se'n toqui cap fitxer. Ruta ASCII → sense problema NFC/NFD.
    EXCLUDED_DIRS_REL = {"Calendar/External"}

    root_paths = search_paths if search_paths else [v_path]
    dashboard_path = get_p("DASHBOARDS")

    for root in root_paths:
        if not root.exists(): continue
        for dirpath, dirnames, filenames in os.walk(root):
            rel_to_vault = Path(dirpath).relative_to(v_path)
            # Skip hidden and excluded folders, excepte les explícitament
            # permeses (p.ex. .Dashboards), i poda els subarbres d'EXCLUDED_DIRS_REL
            # abans de descendir-hi (així no se'n llegeixen els fitxers).
            dirnames[:] = [
                d for d in dirnames
                if (not d.startswith('.') or d.lower() in HIDDEN_ALLOWED)
                and d.lower() not in SKIP_DIRS
                and (rel_to_vault / d).as_posix() not in EXCLUDED_DIRS_REL
            ]

            # Additional nested redundancy check: skipping duplicates like folder/folder
            parts = rel_to_vault.parts
            if len(parts) >= 2:
                p_parent = parts[-2].lower().replace('_', '').replace('.', '')
                p_current = parts[-1].lower().replace('_', '').replace('.', '')
                if p_parent == p_current and len(p_parent) > 3:
                    dirnames[:] = [] # Stop recursion
                    continue

            for f in filenames:
                if f.startswith('.'): continue
                if f.endswith(".md"):
                    candidate_files.append(Path(dirpath) / f)
                elif f.endswith(".json") and dashboard_path and str(dirpath).startswith(str(dashboard_path)):
                    candidate_files.append(Path(dirpath) / f)

    log.info(f"🔍 Indexer found {len(candidate_files)} candidate files.")

    # 4. Prepare updates OUTSIDE lock
    new_entries = {}
    current_paths = set()

    # Get a snapshot of existing entries to avoid constant locking
    with _page_index_lock:
        if v_str not in _page_index_entries:
            _page_index_entries[v_str] = {}
        cached_snapshot = dict(_page_index_entries[v_str])

    for file_path in candidate_files:
        is_dashboard_file = _is_dashboard_file_path(file_path)
        try:
            rel_path = file_path.relative_to(v_path)
            parts = rel_path.parts
            # Ignore hidden folders excepte les permeses explícitament
            # (p.ex. .Dashboards). Sense aquesta excepció, els dashboards
            # entrarien als candidate_files (perquè la primera passada del
            # walk els inclou) però aquí els filtraríem fora.
            if any(part.startswith('.') and part.lower() not in HIDDEN_ALLOWED for part in parts):
                continue
            
            # Detect nested redundancy: [a, b, b, c] -> skip
            # Often caused by sync glitches: ismigar_gmail_com/ismigargmailcom/
            if len(parts) >= 2:
                is_redundant = False
                for i in range(len(parts) - 1):
                    # We only flag redundancy if the directory name matches exactly 
                    # its parent (ignoring case/underscores/dots)
                    p_parent = parts[i].lower().replace('_', '').replace('.', '')
                    p_current = parts[i+1].lower().replace('_', '').replace('.', '')
                    
                    # Safety check: p_current must be a directory (not the final file) to be a sync artifact folder
                    # Since parts includes the filename at the end, the last loop iteration
                    # compares the last folder with the filename. We want to avoid that for Wiki pages.
                    if i < len(parts) - 2: # Stop before the last part (filename)
                        if p_parent == p_current and len(p_parent) > 3:
                            # EXCEPTION: Allow similar names within the Calendar folder
                            # (e.g. ismigar_gmail_com/ismigargmailcom)
                            if "calendar" in [p.lower() for p in parts]:
                                continue
                            is_redundant = True
                            break
                if is_redundant:
                    continue
        except ValueError:
            continue

        path_str = str(file_path)
        current_paths.add(path_str)

        try:
            stat_result = file_path.stat()
        except (FileNotFoundError, PermissionError):
            continue

        cached = cached_snapshot.get(path_str)
        if (
            cached
            and cached.get("mtime_ns") == stat_result.st_mtime_ns
            and cached.get("size") == stat_result.st_size
        ):
            new_entries[path_str] = cached
            continue

        # Heavy part: parsing frontmatter
        built = _build_page_cache_entry(file_path, stat_result)
        # Si el parse ha fallat (Errno 35) i tenim una entry vella amb
        # metadata real, conservem la vella en lloc d'escombrar-la.
        if built.pop("_parse_failed", False) and cached and not _is_metadata_stub(cached.get("metadata") or {}):
            new_entries[path_str] = cached
        else:
            new_entries[path_str] = built

    # 5. Merge and persist inside lock (Briefly)
    with _page_index_lock:
        if not search_paths:
             _page_index_entries[v_str] = new_entries
             # Rebuild reverse ID map
             new_id_map = {}
             all_files_ordered = []
             for p_str, entry in new_entries.items():
                 all_files_ordered.append(Path(p_str))
                 pid = entry.get("id")
                 if pid:
                     # Keep most recent if duplicate ID exists in filesystem
                     existing_path = new_id_map.get(pid)
                     if not existing_path or entry.get("mtime", 0) > new_entries.get(existing_path, {}).get("mtime", 0):
                        new_id_map[pid] = p_str
             _page_id_to_path[v_str] = new_id_map
             # UPDATE GLOBAL RESOLVER
             path_resolver.update_index(v_path, new_id_map, all_files_ordered)
        else:
             _page_index_entries.setdefault(v_str, {}).update(new_entries)
             # Incremental update of ID map
             id_map = _page_id_to_path.setdefault(v_str, {})
             for p_str, entry in new_entries.items():
                 pid = entry.get("id")
                 if pid:
                     id_map[pid] = p_str
             # UPDATE GLOBAL RESOLVER INCREMENTALLY
             path_resolver.update_index(v_path, id_map, [Path(p) for p in _page_index_entries[v_str].keys()])

        _page_index_initialized[v_str] = True
        _bump_page_index_version(v_str)

    _save_page_index_to_disk(v_str)

    if search_paths:
        search_paths_strs = [str(p) for p in search_paths]
        return [
            e for e in new_entries.values()
            if any((e.get("path") or "").startswith(s) for s in search_paths_strs)
        ]

    return list(new_entries.values())


def _bump_page_index_version(v_str: str) -> None:
    """Marks `_page_index_entries[v_str]` as changed so derived caches
    (currently `_table_index_cache`) know to rebuild on the next read.
    Must be called with `_page_index_lock` held (every mutation site of
    `_page_index_entries` is already under that lock).
    """
    _page_index_version[v_str] = _page_index_version.get(v_str, 0) + 1


def _build_pages_by_table_index(v_str: str) -> Dict[str, List["PageInfo"]]:
    """One-shot rebuild of the table_id → [PageInfo] map for a vault.
    Iterates `_page_index_entries[v_str]` once, resolves each entry to a
    table_id, and groups. Returns a dict ready to be served directly by
    `list_pages_by_table` without filtering 4000+ entries on every call.
    """
    registry = load_registry()
    folder_to_table = _build_table_folder_index(registry)
    sorted_folders = sorted(folder_to_table.keys(), key=len, reverse=True)

    from backend.api.calendar_routes import _get_hidden_event_ids
    hidden_ids = _get_hidden_event_ids()

    with _page_index_lock:
        entries = list(_page_index_entries.get(v_str, {}).values())

    out: Dict[str, List["PageInfo"]] = {}
    seen_pages: Dict[str, "PageInfo"] = {}
    for entry in entries:
        if entry.get("id") in hidden_ids:
            continue
        metadata = entry.get("metadata", {}) or {}
        resolved_table_id = _resolve_table_id_from_context(
            metadata, entry.get("folder", ""), folder_to_table,
            sorted_folders=sorted_folders,
        )
        if not resolved_table_id:
            continue

        page_info = PageInfo(
            id=entry["id"],
            title=entry["title"],
            parent_id=entry.get("parent_id"),
            is_database=entry.get("is_database", False),
            metadata=metadata,
            last_modified=datetime.fromtimestamp(entry["mtime"]).isoformat(),
            size=entry.get("size", 0),
            folder=entry.get("folder", ""),
            path=entry.get("path"),
            resolved_table_id=resolved_table_id,
        )

        # Deduplicate by id, keep the newest. Same logic as _get_pages_snapshot.
        existing = seen_pages.get(page_info.id)
        if existing is not None and existing.last_modified >= page_info.last_modified:
            continue
        seen_pages[page_info.id] = page_info

    # Group only after dedup, otherwise the older copy would still leak in.
    for page in seen_pages.values():
        out.setdefault(page.resolved_table_id, []).append(page)
    return out


def _get_pages_by_table_id(v_str: str, table_id: str) -> List["PageInfo"]:
    """O(1) lookup of pages by table_id after the first build per vault.
    Rebuilds when `_page_index_version[v_str]` has advanced or the TTL has
    elapsed since the last build. Fallback to a full scan via
    `_get_pages_snapshot` only on registry errors during build.
    """
    cur_version = _page_index_version.get(v_str, 0)
    cached = _table_index_cache.get(v_str)
    now = time.monotonic()
    if (
        cached is not None
        and cached.get("version") == cur_version
        and now - cached.get("built_at", 0.0) <= _TABLE_INDEX_TTL
    ):
        return list(cached["by_table_id"].get(table_id, []))

    try:
        by_table = _build_pages_by_table_index(v_str)
    except Exception as e:
        log.warning(f"_build_pages_by_table_index failed for {v_str}: {e}")
        return []

    _table_index_cache[v_str] = {
        "version": cur_version,
        "built_at": now,
        "by_table_id": by_table,
    }
    return list(by_table.get(table_id, []))


def _get_pages_snapshot(
    only_calendar: bool = False,
    background_tasks: Optional[BackgroundTasks] = None
) -> List[PageInfo]:
    # TTL micro-cache. Les rutes `/pages`, `/sidebar/summary` i les seves
    # invocacions paral·leles al primer load del frontend (4-6 alhora) van
    # poder unir-se a un sol càlcul real.
    cache_key = f"snapshot:{'cal' if only_calendar else 'all'}"
    cached = _pages_cache_get(cache_key)
    if cached is not None:
        return cached

    global _last_vault_sync_time, _last_google_calendar_sync_time
    search_paths = None
    enabled_calendar_tables = []
    registry = load_registry()

    if only_calendar:
        try:
            from backend.services.integration_manager import integration_manager
            integrations = integration_manager.get_all_safe()
            enabled_calendar_tables = integrations.get("vault_calendar", {}).get("enabled_tables", [])
            
            search_paths = [get_p("CALENDAR")]
            # Find folders for enabled tables
            for table in registry.get("tables", []):
                if table.get("id") in enabled_calendar_tables:
                    folder_rel = table.get("folder")
                    if folder_rel:
                        search_paths.append(get_p("VAULT") / folder_rel)
        except Exception as e:
            log.warning(f"Could not prepare selective search paths for calendar: {e}")

    # Trigger background sync if background_tasks provided AND cooldown passed
    if background_tasks:
        now = time.monotonic()
        
        # 1. Disk Index Sync (Vault)
        if now - _last_vault_sync_time > _VAULT_SYNC_COOLDOWN_SECONDS:
            _last_vault_sync_time = now
            background_tasks.add_task(_get_cached_page_entries, search_paths, True)
            log.info("📡 Background sync triggered for page index.")
        
        # 2. Google Calendar Sync (Remote)
        # Triggered ONLY if specifically looking at calendar and cooldown passed
        if only_calendar and (now - _last_google_calendar_sync_time > _GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS):
            _last_google_calendar_sync_time = now
            try:
                from backend.services.vault_calendar_sync_service import calendar_sync_service
                background_tasks.add_task(calendar_sync_service.sync_all_calendars)
                log.info("📅 Background Google Calendar sync triggered.")
            except Exception as e:
                log.error(f"Could not trigger background Google Calendar sync: {e}")

    raw_entries = _get_cached_page_entries(search_paths=search_paths, force_refresh=False)
    if not raw_entries:
        return []

    # Filter out entries whose files no longer exist (deleted externally).
    # ATENCIÓ: Path.exists() per cada entry són 3988 stat() al OneDrive cada
    # cop que es crida /pages — això eleva el temps a 15+ segons. Amb cache
    # de mtime al `_iter_docs_cache`, només validem stale_paths un cop per
    # `_STALE_CHECK_TTL` segons. Si un fitxer es borra externament, queda
    # visible a la sidebar fins el següent stat — acceptable.
    now_mono = time.monotonic()
    do_stale_check = (now_mono - _last_stale_check["ts"]) > _STALE_CHECK_TTL
    entries = []
    stale_paths = []
    if do_stale_check:
        for e in raw_entries:
            p_str = e.get("path")
            if p_str and not Path(p_str).exists():
                stale_paths.append(p_str)
            else:
                entries.append(e)
        _last_stale_check["ts"] = now_mono
    else:
        entries = list(raw_entries)

    if stale_paths:
        from backend.services.context_vars import get_active_vault_path
        v_str = str(get_active_vault_path())
        with _page_index_lock:
            idx = _page_index_entries.get(v_str, {})
            id_map = _page_id_to_path.get(v_str, {})
            pruned_any = False
            for p_str in stale_paths:
                entry = idx.pop(p_str, None)
                if entry:
                    id_map.pop(entry.get("id", ""), None)
                    pruned_any = True
            if pruned_any:
                _bump_page_index_version(v_str)
        _last_vault_sync_time = 0.0
        log.info(f"🗑️ Pruned {len(stale_paths)} stale page entries from cache.")

    folder_to_table = _build_table_folder_index(registry)
    sorted_folders = sorted(folder_to_table.keys(), key=len, reverse=True)

    pages_by_id: Dict[str, PageInfo] = {}
    duplicate_ids = set()

    # If we did a selective scan, we should only process the entries relevant to those paths
    if search_paths:
        search_paths_strs = [str(p) for p in search_paths]
        relevant_entries = []
        for entry in entries:
            entry_path = entry.get("path") or ""
            # Check if this entry belongs to one of our requested folders
            if any(entry_path.startswith(s) for s in search_paths_strs):
                relevant_entries.append(entry)
        entries = relevant_entries

    # Llista d'IDs amagats. Reaprofitem l'helper de calendar_routes que ja
    # gestiona correctament el cicle de la sessió (open/try/finally close),
    # en lloc de duplicar el patró aquí.
    from backend.api.calendar_routes import _get_hidden_event_ids
    hidden_ids = _get_hidden_event_ids()

    for entry in entries:
        metadata = entry.get("metadata", {})
        
        # 1. Skip if hidden
        if entry["id"] in hidden_ids:
            continue
            
        # 2. Resolve table context efficiently
        resolved_table_id = _resolve_table_id_from_context(
            metadata, entry["folder"], folder_to_table, sorted_folders=sorted_folders
        )
        
        # 2. Filter if requested (Server-side filtering for calendar performance)
        if only_calendar:
            table_id = resolved_table_id or metadata.get("table_id") or metadata.get("database_table_id")
            
            is_relevant = False
            # a) Is it in an enabled calendar table?
            if table_id and table_id in enabled_calendar_tables:
                is_relevant = True
            # b) Does it have an explicit date?
            elif metadata.get("date"):
                is_relevant = True
            # c) Is it an external source that isn't 'Gnosi'?
            else:
                source = (metadata.get("source") or "").strip().lower()
                if source and source not in {"gnosi", "gnosi vault"}:
                    is_relevant = True
            
            if not is_relevant:
                continue

        # `model_construct` salta la validació Pydantic; les dades del
        # cache mtime-validated ja són ben tipades. Estalvi ~80µs × 4200
        # entries = ~300 ms al snapshot global.
        page_info = PageInfo.model_construct(
            id=entry["id"],
            title=entry["title"],
            parent_id=entry["parent_id"],
            is_database=entry["is_database"],
            metadata=metadata,
            last_modified=datetime.fromtimestamp(entry["mtime"]).isoformat(),
            size=entry["size"],
            folder=entry["folder"],
            path=entry.get("path"),
            resolved_table_id=resolved_table_id,
        )

        existing = pages_by_id.get(entry["id"])
        if existing is None:
            pages_by_id[entry["id"]] = page_info
        else:
            duplicate_ids.add(entry["id"])
            if page_info.last_modified > existing.last_modified:
                pages_by_id[entry["id"]] = page_info

    if duplicate_ids:
        # Soroll cosmètic: la deduplicació in-memory és O(n) i passa cada
        # crida; els duplicats reals (events Sunrise i similars) són una
        # constant del filesystem, no un error nou. Mantenim el senyal a
        # nivell debug per quan calgui inspeccionar incidències.
        log.debug(
            f"Deduplicated {len(duplicate_ids)} pages with repeated ID in the Vault"
        )

    pages = list(pages_by_id.values())
    pages.sort(key=lambda x: x.last_modified, reverse=True)

    # Lazy refresh metadata centralitzat: el cache disc pot tenir entries amb
    # metadata stub (només id/title) si va ser reconstruïda parcialment.
    # Refresh automàtic per pages que el sidebar wiki renderitza (Wiki/,
    # .Dashboards/, root). Per BD pages, els endpoints by-table fan el seu
    # propi refresh perquè és més barat (filtrat pel table_id concret).
    # Ubicar-ho aquí evita haver de recordar afegir refresh a cada nou
    # endpoint que faci servir _get_pages_snapshot.
    INCLUDED_PREFIXES = ("Wiki", ".Dashboards")
    refresh_targets = [
        p for p in pages
        if (not p.folder)  # root
        or (p.folder or "").startswith(INCLUDED_PREFIXES)
    ]
    if refresh_targets:
        try:
            _refresh_table_pages_metadata(refresh_targets)
        except Exception as e:
            log.debug(f"sidebar metadata refresh skipped: {e}")

    _pages_cache_set(cache_key, pages)
    return pages


def _get_pages_for_table(table_id: str) -> List[PageInfo]:
    """Fast-path per a `/pages/by-table/{table_id}`.

    El bucle de `_get_pages_snapshot` construeix ~4200 `PageInfo` Pydantic
    (~1.2s per crida en aquesta màquina) per després descartar-ne el 95%.
    Aquesta funció itera el mateix cache però només construeix `PageInfo`
    per les entries que pertanyen a `table_id`, en dues fases:

    1. Filtre barat (sense Pydantic): pertanyença folder-based — si el
       folder de l'entry comença per un prefix registrat com a "nostra
       taula" l'acceptem; si comença per prefix d'una ALTRA taula la
       descartem; si no toca cap registry folder, caiem al fallback
       metadata-based (`table_id` / `database_table_id`).
    2. Construcció Pydantic només per a les entries que han passat (1).

    Resultat: per a una taula de ~300 pàgines en un vault de 4243,
    estalviem el cost de crear ~3940 `PageInfo` que s'haurien descartat.
    """
    # TTL micro-cache: si una crida idèntica recent ja ha calculat la
    # llista, retornem-la directament. Burst típic /by-table + /snapshot +
    # global-index al mateix segon → un sol càlcul real.
    cache_key = f"by-table:{table_id}"
    cached = _pages_cache_get(cache_key)
    if cached is not None:
        return cached

    raw_entries = _get_cached_page_entries(force_refresh=False)
    if not raw_entries:
        return []

    registry = load_registry()
    folder_to_table = _build_table_folder_index(registry)
    # Prefixos canònics que resolen a la taula demanada i a qualsevol
    # altra taula. Ordenats per llargada decreixent perquè un prefix més
    # específic guanya el match (mateix criteri que
    # `_resolve_table_id_from_context`).
    our_prefixes = sorted(
        (f for f, t in folder_to_table.items() if t == table_id),
        key=len, reverse=True,
    )
    all_prefixes = sorted(folder_to_table.keys(), key=len, reverse=True)

    from backend.api.calendar_routes import _get_hidden_event_ids
    hidden_ids = _get_hidden_event_ids()

    # Fase 1: filtrar entries crues sense construir cap Pydantic.
    matching: List[Dict[str, Any]] = []
    for entry in raw_entries:
        if entry["id"] in hidden_ids:
            continue

        folder_key = _normalize_rel_folder(entry.get("folder") or "").lower()
        belongs = False
        resolved_elsewhere = False

        if folder_key:
            for f in all_prefixes:
                if folder_key == f or folder_key.startswith(f + "/"):
                    if folder_to_table[f] == table_id:
                        belongs = True
                    else:
                        resolved_elsewhere = True
                    break

        if not belongs and not resolved_elsewhere:
            # Fallback metadata-based per a notes legacy fora de carpeta
            # registrada (templates, antigues). Mateix criteri que
            # `_resolve_table_id_from_context` (descarta "wiki").
            metadata = entry.get("metadata") or {}
            md_tid = metadata.get("table_id") or metadata.get("database_table_id")
            if (
                md_tid == table_id
                and str(md_tid).strip().lower() != "wiki"
            ):
                belongs = True

        if belongs:
            matching.append(entry)

    # Fase 2: construir Pydantic + dedup per ID només pels matchings.
    # Usem `model_construct` per saltar la validació Pydantic: les dades
    # vénen del cache mtime-validated, els tipus ja són correctes, i la
    # validació costa ~80µs/instància × 300 entries = 25-50 ms gratuïts.
    pages_by_id: Dict[str, PageInfo] = {}
    duplicate_ids: set = set()
    for entry in matching:
        page_info = PageInfo.model_construct(
            id=entry["id"],
            title=entry["title"],
            parent_id=entry["parent_id"],
            is_database=entry["is_database"],
            metadata=entry.get("metadata") or {},
            last_modified=datetime.fromtimestamp(entry["mtime"]).isoformat(),
            size=entry["size"],
            folder=entry["folder"],
            path=entry.get("path"),
            resolved_table_id=table_id,
        )

        existing = pages_by_id.get(entry["id"])
        if existing is None:
            pages_by_id[entry["id"]] = page_info
        else:
            duplicate_ids.add(entry["id"])
            if page_info.last_modified > existing.last_modified:
                pages_by_id[entry["id"]] = page_info

    if duplicate_ids:
        log.debug(
            f"Deduplicated {len(duplicate_ids)} pages with repeated ID in table {table_id}"
        )

    pages = list(pages_by_id.values())
    pages.sort(key=lambda x: x.last_modified, reverse=True)
    _pages_cache_set(cache_key, pages)
    return pages


@router.get("/pages", response_model=List[PageInfo])
async def list_pages(
    background_tasks: BackgroundTasks,
    only_calendar: bool = Query(False),
    folder: Optional[str] = Query(
        None,
        description="If provided, only pages whose folder starts with this prefix are returned.",
    ),
    limit: Optional[int] = Query(
        None,
        ge=1,
        le=10000,
        description="Maximum number of pages to return. Default: no limit.",
    ),
    offset: int = Query(0, ge=0),
):
    """Lists all pages in the root flatly by iterating through UUID.md files.
    Returns cached data instantly and triggers a background refresh.

    The vault can hold thousands of pages (calendar events, mail metadata,
    test fixtures…). Without `folder`/`limit`/`offset` filters, naive callers
    get the full snapshot — useful for the sidebar tree, expensive otherwise.
    """
    pages = await asyncio.to_thread(
        _get_pages_snapshot,
        only_calendar=only_calendar,
        background_tasks=background_tasks,
    )

    # Safety net: si el snapshot és buit però el disc cache existeix amb
    # entries, vol dir que estem en un moment intermedi (warmup, post-rescan)
    # on `_page_index_entries` encara no està repoblat. Retornem 503 perquè
    # el client reintenti amb backoff, en lloc de mostrar la sidebar buida.
    if not pages and not folder and offset == 0:
        try:
            cache_path = get_page_index_cache_path()
            if cache_path and cache_path.exists() and cache_path.stat().st_size > 2:
                raise HTTPException(
                    status_code=503,
                    detail="Page index is warming up; retry shortly.",
                    headers={"Retry-After": "2"},
                )
        except HTTPException:
            raise
        except Exception:
            pass

    if folder:
        prefix = folder.strip("/")
        pages = [p for p in pages if (p.folder or "").startswith(prefix)]
    if limit is not None:
        pages = pages[offset:offset + limit]
    elif offset:
        pages = pages[offset:]
    return pages


@router.get("/pages/by-table/{table_id}", response_model=List[PageInfo])
async def list_pages_by_table(table_id: str, include_templates: bool = Query(True)):
    """Returns only pages from a specific table to avoid loading the entire Vault.

    Uses the table-id index cache (`_get_pages_by_table_id`): after the
    first build per vault, lookups are O(1) in the table's page count
    instead of O(total vault pages). Critical for vaults with tens of
    thousands of pages — without it, this endpoint scales linearly with
    the whole vault size on every call.
    """
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    v_str = str(v_path) if v_path else ""
    filtered = await asyncio.to_thread(_get_pages_by_table_id, v_str, table_id) if v_str else []
    """Returns only pages from a specific table to avoid loading the entire Vault."""
    # Fast-path: només construïm `PageInfo` per a les entries de la taula
    # demanada, no per a les ~4200 del vault sencer. Estalvi ~1s/crida.
    filtered = await asyncio.to_thread(_get_pages_for_table, table_id)
    if not include_templates:
        filtered = [p for p in filtered if not p.metadata.get("is_template")]
    # Re-fetch metadata lazy per a fitxers amb metadata stub (cache parcial).
    # Cost: només els fitxers d'aquesta taula, no el vault sencer.
    await asyncio.to_thread(_refresh_table_pages_metadata, filtered)
    table_obj = _table_by_id(table_id)
    _vf_inject_for_table(table_obj, filtered, get_p("DATABASES") / "vault_graph.json")
    if table_obj:
        for p in filtered:
            p.metadata = to_response_names(p.metadata or {}, table_obj)
    return filtered


@router.get("/pages/by-table/{table_id}/snapshot", response_model=TablePagesSnapshot)
async def list_pages_by_table_snapshot(table_id: str):
    """Returns canonical snapshot per table: raw + real visible.

    This route avoids divergences between frontend sessions and establishes
     a single source of truth for the count of visible records.
    """
    # Fast-path: només pàgines de la taula demanada (veure
    # `_get_pages_for_table`).
    raw_pages = await asyncio.to_thread(_get_pages_for_table, table_id)
    visible_pages = _canonical_visible_table_pages(table_id, raw_pages)

    # Lazy re-fetch del frontmatter per fitxers amb metadata stub.
    await asyncio.to_thread(_refresh_table_pages_metadata, visible_pages)

    table_obj = _table_by_id(table_id)
    _vf_inject_for_table(table_obj, visible_pages, get_p("DATABASES") / "vault_graph.json")
    if table_obj:
        for p in visible_pages:
            p.metadata = to_response_names(p.metadata or {}, table_obj)

    return TablePagesSnapshot(
        table_id=table_id,
        raw_count=len(raw_pages),
        visible_count=len(visible_pages),
        pages=visible_pages,
    )


@router.get("/virtual-fields")
async def list_virtual_fields():
    """Catalogue of virtual field computers available for the schema config UI."""
    return {"computers": _vf_list_specs()}


@router.get("/indexer-status")
async def get_indexer_status_endpoint():
    """Expose the page-index warmup status so the UI can show 'indexing…'.

    States:
      - idle:    no indexing has been requested yet
      - running: warmup in progress (UI may still receive partial results
                 from the cache; full scan ongoing)
      - ready:   index is complete and serving requests
      - error:   warmup failed (see `error`)
    """
    v_path = get_active_vault_path()
    if not v_path:
        return {"state": "no_vault", "files_indexed": 0}
    status = get_indexer_status(str(v_path))
    # Also surface a count from in-memory cache so the UI can show progress
    with _page_index_lock:
        cached = len(_page_index_entries.get(str(v_path), {}))
    status["cached_entries"] = cached
    return status


@router.get("/sidebar/summary", response_model=List[SidebarPageInfo])
async def list_sidebar_summary():
    """Returns a lightweight summary of pages for the sidebar."""
    pages = _get_pages_snapshot()
    return [
        SidebarPageInfo(
            id=p.id,
            title=p.title,
            parent_id=p.parent_id,
            is_database=p.is_database,
            metadata=p.metadata,
            last_modified=p.last_modified,
            folder=p.folder,
            resolved_table_id=p.resolved_table_id,
        )
        for p in pages
    ]


def _get_unique_filepath(target_dir: Path, name: str, extension: str = ".md") -> Path:
    """Returns a unique filepath by appending (n) if it already exists."""
    safe_name = _safe_filename(str(name), target_dir)
    file_path = target_dir / f"{safe_name}{extension}"
    
    if not file_path.exists():
        return file_path
        
    # Collision! Append (n)
    counter = 1
    while True:
        candidate_name = f"{safe_name} ({counter})"
        file_path = target_dir / f"{candidate_name}{extension}"
        if not file_path.exists():
            return file_path
        counter += 1


@router.post("/pages", dependencies=[Depends(require_role("editor"))])
async def create_page(request: PageSaveRequest, background_tasks: BackgroundTasks):
    """Creates a new page with a UUID ID."""
    page_id = str(uuid.uuid4())

    # Construir metadata inicial
    metadata = request.metadata.copy()
    metadata = normalize_metadata_ids(metadata)
    metadata = normalize_table_context(metadata)
    _table_for_meta = _table_by_id(get_table_id(metadata))
    if _table_for_meta:
        metadata, _ = to_storage_names(metadata, _table_for_meta)
    metadata["id"] = page_id
    metadata["title"] = request.title
    if request.parent_id:
        metadata["parent_id"] = request.parent_id
    if request.is_database:
        metadata["is_database"] = True
    if metadata.get("is_dashboard") is True:
        # Dashboards són markdown; el flag content_format=json era llegacy.
        metadata.pop("content_format", None)

    # Apply automations and formulas during creation as well (old_metadata empty)
    try:
        metadata = get_rule_engine().process_updates(page_id, {}, metadata)
    except Exception as e:
        log.error(f"Error processing automations on create for {page_id}: {e}")

    metadata = _persist_metadata_assets(metadata)

    # Tota alta d'un recurs (taula amb columna 'Citation Key') ha de quedar
    # citable, no només la que ve del lookup de metadades.
    metadata = _ensure_recursos_citation_key(metadata, _table_for_meta)

    is_template = metadata.get("is_template") is True
    is_dashboard = metadata.get("is_dashboard") is True

    # Determinar directori destí
    if is_template:
        target_dir = get_p("PLANTILLES")
    elif is_calendar_entry(metadata):
        target_dir = get_p("CALENDAR")
    elif is_dashboard:
        target_dir = get_p("DASHBOARDS")
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        target_dir = table_folder if table_folder else get_p("WIKI")

    target_dir.mkdir(parents=True, exist_ok=True)

    # Tots els tipus de pàgina (incloses Dashboards) són markdown amb
    # frontmatter. El JSON era un format llegacy ja eliminat.
    file_path = _get_unique_filepath(target_dir, request.title, extension=".md")

    log.info(f"Creating new page at: {file_path.absolute()}")

    try:
        save_page_md(file_path, metadata, request.content)
        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", request.content
        )
        table_id = get_table_id(metadata)
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        
        # Insereix la nova pàgina al cache directament en lloc de buidar-lo.
        # Buidar el cache feia que la següent crida a GET /api/vault/pages
        # retornés [] fins que un force_refresh acabés (~1-2s sobre OneDrive),
        # cosa que feia que el frontend creés la pestanya nova i, just després,
        # l'efecte de neteja `useEffect` la filtrés perquè el seu id encara
        # no era a `pages` → editor en blanc i la taula mostrava 0 registres.
        try:
            v_path = get_active_vault_path()
            if v_path:
                v_str = str(v_path)
                stat_result = file_path.stat()
                new_entry = _build_page_cache_entry(file_path, stat_result)
                with _page_index_lock:
                    _page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
                    _page_id_to_path.setdefault(v_str, {})[page_id] = str(file_path)
                    _bump_page_index_version(v_str)
        except Exception as e:
            # Si no podem inserir, anem al pla B (rebuild segur) per no servir
            # un cache parcialment incoherent.
            log.warning(f"Could not insert new page into index cache, falling back to clear: {e}")
            _clear_page_index_cache()

        background_tasks.add_task(update_link_index_for_page, file_path)

        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "status": "created",
            "id": page_id,
            "title": request.title,
            "metadata": metadata,
            "content": request.content,
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            "message": "Page created",
        }
    except Exception as e:
        log.error(f"Error creating the page: {e}")
        raise HTTPException(
            status_code=500, detail="Error writing the page file"
        )


def get_table_id(metadata: Optional[dict]) -> Optional[str]:
    """Returns the table_id of a record, looking at both alias keys.

    The codebase has historically written both `database_table_id` (newer,
    preferred) and `table_id` (legacy). PATCH writes both; older imports
    only set one. Centralizing the lookup avoids repeating the
    `or`-chain in 10+ call sites and makes future migrations one-line.
    """
    if not metadata:
        return None
    val = metadata.get("database_table_id") or metadata.get("table_id")
    return str(val) if val else None


def _canonicalize_id(page_id: Any) -> str:
    """Returns the canonical form of a UUID-ish id for comparisons.

    Notion exports IDs as 32-char no-dash hex (`df3614865ff34a1490055d9b7b456492`).
    Gnosi/UUID standard form has dashes (`df361486-5ff3-4a14-9005-5d9b7b456492`).
    Some legacy frontmatter, manual edits, parent_id refs, and link resolution
    paths can carry either form. Comparing as raw strings causes silent
    misses ("page not found" when it's there). This helper strips dashes,
    spaces, and case so both forms map to the same canonical key.
    """
    s = str(page_id or "").strip().lower().replace("-", "")
    return s


# Strict allow-list per a IDs que s'utilitzen com a SEGMENT de path al
# filesystem. Bloqueja path traversal (`..`, `/`, `\`, NUL, leading dot).
# Raó: rutes com `/pages/{page_id}/history` construeixen `VAULT / .history /
# {page_id}` i, sense validació, `page_id="..".rmtree()` esborraria tot el
# Vault. Defensa en profunditat encara que les rutes estiguin gated per role.
_PAGE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
# Format de timestamp d'historial: `YYYYMMDD_HHMMSS` (vegeu `_create_page_version`).
_HISTORY_TIMESTAMP_RE = re.compile(r"^\d{8}_\d{6}$")


def _validate_safe_page_id(page_id: str) -> str:
    """Valida que page_id és segur per usar com a segment de path.

    Rebutja:
      - Buit / només whitespace.
      - Conté `..`, `/`, `\\`, NUL byte.
      - Comença per `.` (fitxers ocults) o és exactament `.` o `..`.
      - Caràcters fora de `[A-Za-z0-9_-]`.

    Retorna l'id strippejat. Llança HTTPException(400) si invàlid.
    """
    pid = str(page_id or "").strip()
    if not pid or not _PAGE_ID_RE.match(pid) or pid.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid page_id")
    return pid


def _validate_history_timestamp(timestamp: str) -> str:
    """Valida que un timestamp d'historial té format `YYYYMMDD_HHMMSS`.

    Sense això, `timestamp="../foo"` permetria llegir o sobreescriure
    fitxers .md fora del directori d'historial de la pàgina.
    """
    ts = str(timestamp or "").strip()
    if not ts or not _HISTORY_TIMESTAMP_RE.match(ts):
        raise HTTPException(status_code=400, detail="Invalid timestamp")
    return ts


def find_page_path(page_id: str, *, allow_full_scan: bool = True) -> Optional[Path]:
    """Seeks the path of an .md file by ID recursively using an optimized in-memory index.

    Compares ids canonically (dashes-or-not, case-insensitive) so a frontmatter
    `id: df3614865ff34a1490055d9b7b456492` matches a request for
    `df361486-5ff3-4a14-9005-5d9b7b456492` and vice-versa.

    `allow_full_scan=False` skips the last-resort `rglob` over the entire vault.
    Callers that already know "if not in cache then it doesn't exist" (e.g. PUT
    on a brand-new page id) should pass `allow_full_scan=False` to avoid a
    multi-second OneDrive scan.
    """
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path: return None
    v_str = str(v_path)

    canonical_target = _canonicalize_id(page_id)
    stale_detected = False

    # 1. High Performance Cache Lookup (O(1) when ids match exactly).
    # Try the raw id first (covers the 99% case), then a canonical scan.
    # OPTIM: si el cache d'entries té el path i el stale-check global s'ha
    # fet recentment (TTL `_STALE_CHECK_TTL`), saltem el `p.exists()` aquí
    # — fa un stat() a OneDrive de 5-50 ms que es repeteix a cada
    # `find_page_path`, i el cache global ja s'encarrega de podar entries
    # esborrades externament al següent stale-check periòdic.
    with _page_index_lock:
        id_map = _page_id_to_path.get(v_str, {})
        path_str = id_map.get(page_id)
        if not path_str and canonical_target:
            # Linear scan of the id map only when the exact key missed.
            for k, v in id_map.items():
                if _canonicalize_id(k) == canonical_target:
                    path_str = v
                    break
        if path_str:
            p = Path(path_str)
            # Trust the cache si l'stale-check global és prou recent.
            try:
                stale_age = time.monotonic() - _last_stale_check["ts"]
            except Exception:
                stale_age = float("inf")
            if stale_age < _STALE_CHECK_TTL:
                return p
            if p.exists():
                return p
            # File deleted externally: prune stale entries
            id_map.pop(page_id, None)
            _page_index_entries.get(v_str, {}).pop(path_str, None)
            _bump_page_index_version(v_str)
            stale_detected = True

    # 2. Fallback: Search using the full entries cache (canonical compare)
    with _page_index_lock:
        entries = _page_index_entries.get(v_str, {})
        for p_str, entry in list(entries.items()):
            if _canonicalize_id(entry.get("id")) == canonical_target:
                p = Path(p_str)
                if p.exists():
                    _page_id_to_path.setdefault(v_str, {})[page_id] = p_str
                    return p
                # File deleted externally: prune stale entry
                entries.pop(p_str, None)
                _page_id_to_path.get(v_str, {}).pop(page_id, None)
                _bump_page_index_version(v_str)
                stale_detected = True
                break

    if stale_detected:
        # Force immediate rescan on next list_pages call
        global _last_vault_sync_time
        _last_vault_sync_time = 0.0
        log.info(f"🗑️ Stale cache entry detected for page {page_id}. Rescan scheduled.")

    # 3. Last Resort Fallback: Direct file lookups (Avoid if possible)
    vault_root = get_p("VAULT")
    direct_path = vault_root / f"{page_id}.md"
    if direct_path.exists():
        return direct_path

    dashboard_direct_path = get_p("DASHBOARDS") / f"{page_id}.json" if get_p("DASHBOARDS") else None
    if dashboard_direct_path and dashboard_direct_path.exists():
        return dashboard_direct_path

    # 4. Title-based lookup (resilient fallback). Si el `page_id` no és un
    # UUID però coincideix amb el títol d'una pàgina indexada, retornem
    # aquella. Cobreix el cas de wikilinks amb títol literal (`[[Foo]]`) que
    # arriben aquí sense ser resolts pel frontend (idToTitle stale o pendent
    # de refrescar després d'un move). Sense aquesta passada, els wikilinks
    # per títol fallen amb 404 silenciosament. Cost: scan linear sobre dict
    # in-memory (~3000 entries) → barat.
    title_lower = str(page_id or "").strip().lower()
    is_uuid_like = bool(
        title_lower and re.fullmatch(
            r"[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}",
            title_lower,
        )
    )
    if title_lower and not is_uuid_like:
        with _page_index_lock:
            entries = _page_index_entries.get(v_str, {})
            for p_str, entry in list(entries.items()):
                entry_title = str(entry.get("title") or "").strip().lower()
                if entry_title and entry_title == title_lower:
                    p = Path(p_str)
                    if p.exists():
                        entry_id = entry.get("id")
                        if entry_id:
                            _page_id_to_path.setdefault(v_str, {})[entry_id] = p_str
                        return p

    # 5. Full scan (cache fred o buit — costós però correcte). Canonical
    # compare so dash/no-dash and case differences don't cause false negatives.
    # Skipped when the caller knows the page can't exist yet (PUT to a fresh
    # id) — saves a multi-second OneDrive rglob.
    if not allow_full_scan:
        return None
    # Si la cache ja està inicialitzada **i té entrades** i no hem trobat la
    # pàgina, és un "fantasma": està cachejat al frontend però el fitxer s'ha
    # eliminat externament. Fer un rglob complet de 3981 fitxers a OneDrive
    # triga 30s+ i bloqueja DELETE/GET indefinidament. Confiem al cache.
    # Però si el cache acaba d'estar netejat (entries buides), sí cal fer
    # rglob — altrament una pàgina recent-creada que ha provocat un clear
    # quedaria invisible fins que algú forcés un refresh complet.
    with _page_index_lock:
        cache_has_entries = bool(_page_index_entries.get(v_str))
    if _page_index_initialized.get(v_str) and cache_has_entries:
        log.info(
            f"🔍 Page {page_id} not in cache (initialized) — skipping rglob fallback "
            f"(probably a deleted/renamed file).")
        return None
    if vault_root and vault_root.exists():
        for md_file in vault_root.rglob("*.md"):
            try:
                raw = md_file.read_text(encoding="utf-8")
                fm, _ = parse_frontmatter(raw, md_file)
                if _canonicalize_id(fm.get("id", "")) == canonical_target:
                    with _page_index_lock:
                        _page_id_to_path.setdefault(v_str, {})[page_id] = str(md_file)
                    return md_file
            except Exception:
                continue

    return None


@router.get("/pages/{page_id}")
async def get_page(page_id: str):
    """Returns the full content of a page by ID."""
    # Page lookup walks the FS — push it off the asyncio event loop so a slow
    # OneDrive stat() can't block other concurrent requests.
    file_path = await asyncio.to_thread(find_page_path, page_id)

    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Page not found (ID: {page_id})"
        )

    def _read_and_parse():
        if _is_dashboard_file_path(file_path):
            return _read_dashboard_file(file_path)
        # OneDrive sync pot retornar Errno 35 (Resource deadlock avoided)
        # durant fins a 5 segons quan està estabilitzant un fitxer. Reintenta
        # fins a 8 cops amb backoff exponencial: 0.05, 0.1, 0.2, 0.4, 0.8,
        # 1.0, 1.0, 1.0 (4.55s total). Si fins i tot així falla, és que
        # OneDrive té un problema seriós i ho retornem com a 500.
        last_error = None
        delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.0, 1.0]
        for attempt in range(len(delays) + 1):
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                return parse_frontmatter(raw_content, file_path)
            except OSError as e:
                last_error = e
                if e.errno == 35 and attempt < len(delays):
                    time.sleep(delays[attempt])
                    continue
                raise
        if last_error:
            raise last_error
        return {}, ""

    try:
        metadata, body = await asyncio.to_thread(_read_and_parse)
        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        _table_obj = _table_by_id(resolved_table_id)
        _vf_inject_for_single_page(
            _table_obj,
            str(metadata.get("id") or page_id),
            metadata,
            get_p("DATABASES") / "vault_graph.json",
        )
        # Compatibilitat enrere: el frontend antic llegeix metadata per nom de
        # camp; expandim id-keys amb el nom corresponent (sense esborrar id).
        if _table_obj:
            metadata = to_response_names(metadata, _table_obj)
        return {
            "id": str(metadata.get("id") or page_id),
            "title": metadata.get("title", ""),
            "metadata": metadata,
            "content": body.strip(),
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            # Etag for optimistic concurrency. Client should echo this in the
            # next PUT — if the file moved/changed (cloud sync, external edit)
            # the server returns 409 instead of overwriting.
            "etag": file_etag(file_path),
        }
    except Exception as e:
        log.error(f"Error reading page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading target file")


def _build_preview_excerpt(body: str, max_chars: int = 320) -> str:
    """Extreu el primer paràgraf significatiu del markdown, sanititzat per a tooltips."""
    if not body:
        return ""

    text = str(body)
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(
        r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]",
        lambda m: (m.group(2) or m.group(1)).strip(),
        text,
    )
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"(\*|_)(.+?)\1", r"\2", text)
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"`([^`]+)`", r"\1", text)

    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln and not re.fullmatch(r"[-=_*]{3,}", ln)]
    text = "\n".join(lines)

    paragraphs = [p.strip() for p in re.split(r"\n{2,}|\n", text) if p.strip()]
    if not paragraphs:
        return ""

    excerpt = paragraphs[0]
    idx = 1
    while len(excerpt) < max_chars * 0.6 and idx < len(paragraphs):
        candidate = excerpt + " " + paragraphs[idx]
        if len(candidate) > max_chars * 1.2:
            break
        excerpt = candidate
        idx += 1

    excerpt = re.sub(r"\s+", " ", excerpt).strip()

    if len(excerpt) > max_chars:
        cut = excerpt[:max_chars]
        last_space = cut.rfind(" ")
        if last_space > max_chars * 0.7:
            cut = cut[:last_space]
        excerpt = cut.rstrip(".,;:") + "…"

    return excerpt


# -----------------------------------------------------------------------------
# Pandoc export amb cites resoltes
# -----------------------------------------------------------------------------
#
# Workflow acadèmic Fase 5: exporta una pàgina del Vault a .docx/.odt/.html/.pdf
# amb les cites `[@key]` resoltes contra Recursos i bibliografia generada via
# CSL. Pandoc 3+ porta citeproc integrat, així que una sola invocació basta:
#
#     pandoc input.md \
#         --citeproc \
#         --bibliography refs.json   (CSL-JSON generat per nosaltres)
#         --csl apa.csl              (style triat per l'usuari)
#         -o output.docx
#
# refs.json es genera al vol a partir de les pàgines Recursos referenciades
# al document. Així Pandoc rep només el subset rellevant (no totes 4198
# entries) i el processament és ràpid.

import tempfile as _ext_tempfile
import subprocess as _ext_subprocess

from backend.services.csl_type_resolver import resolve_csl_type as _resolve_csl_type


def _parse_authors_to_csl(authors_str: str) -> list:
    """Mateixa heurística que cslEngine.js — parse Authors string a CSL author array."""
    if not authors_str or not isinstance(authors_str, str):
        return []
    parts = (
        [s.strip() for s in authors_str.split(';') if s.strip()]
        if ';' in authors_str else [authors_str.strip()]
    )
    out = []
    for p in parts:
        if ', ' in p and len(p.split(',')) == 2:
            family, given = [s.strip() for s in p.split(',', 1)]
            if family:
                out.append({'family': family, 'given': given})
        elif ',' in p:
            for sub in [s.strip() for s in p.split(',') if s.strip()]:
                tokens = sub.split()
                if len(tokens) == 1:
                    out.append({'family': tokens[0]})
                else:
                    out.append({'family': tokens[-1], 'given': ' '.join(tokens[:-1])})
        else:
            tokens = p.split()
            if len(tokens) == 1:
                out.append({'family': tokens[0]})
            else:
                out.append({'family': tokens[-1], 'given': ' '.join(tokens[:-1])})
    return out


def _recursos_metadata_to_csl(title: str, m: dict) -> Optional[dict]:
    """Construeix CSL-JSON d'una pàgina de Recursos. Equivalent backend del
    `recursosPageToCsl` del frontend (mateix mapeig)."""
    ck = m.get('Citation Key')
    if not ck:
        return None
    item = {
        'id': ck,
        'type': _resolve_csl_type(m.get('Item Type', '')),
        'title': title or m.get('Title') or '',
    }
    authors = _parse_authors_to_csl(m.get('Authors') or '')
    if authors:
        item['author'] = authors
    if m.get('Any'):
        try:
            item['issued'] = {'date-parts': [[int(m['Any'])]]}
        except (TypeError, ValueError):
            pass
    if m.get('Llibre/Revista'): item['container-title'] = m['Llibre/Revista']
    if m.get('Editorial'): item['publisher'] = m['Editorial']
    if m.get('Lloc'): item['publisher-place'] = m['Lloc']
    if m.get('Volum'): item['volume'] = str(m['Volum'])
    if m.get('Número'): item['issue'] = str(m['Número'])
    if m.get('Pàgines'): item['page'] = str(m['Pàgines'])
    if m.get('Edició'): item['edition'] = str(m['Edició'])
    if m.get('DOI'): item['DOI'] = m['DOI']
    if m.get('ISBN'): item['ISBN'] = m['ISBN']
    if m.get('ISSN'): item['ISSN'] = m['ISSN']
    if m.get('URL'): item['URL'] = m['URL']
    if m.get('Idioma'): item['language'] = m['Idioma']
    return item


def _resolve_csl_path(style: str) -> Optional[Path]:
    """Localitza el fitxer `.csl` per a un estil donat. Compartit per
    `/export/`, `/format-citation` i `/format-bibliography`."""
    style_map = {
        'apa': 'apa.csl',
        'chicago-author-date': 'chicago-author-date.csl',
        'mla': 'modern-language-association.csl',
        'modern-language-association': 'modern-language-association.csl',
        'ieee': 'ieee.csl',
    }
    style_file = style_map.get(style, 'apa.csl')
    candidates = [
        Path('/app/frontend/public/csl/styles') / style_file,
        Path('/app/monorepo/apps/gnosi/frontend/public/csl/styles') / style_file,
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def _build_csl_items_for_keys(keys: List[str]) -> List[dict]:
    """Construeix la llista de CSL-JSON items per als citation keys donats.
    Ignora els que no resolen al Vault. Reutilitzable per
    `/format-citation`, `/format-bibliography` i `/export/`."""
    if not keys:
        return []
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        return []
    idx = _ensure_cite_key_index(str(v_path))
    out = []
    for k in keys:
        entry = idx.get(k)
        if not entry:
            continue
        try:
            page_path = find_page_path(entry['id'])
            if not page_path:
                continue
            raw_page = page_path.read_text(encoding='utf-8')
            meta, _ = parse_frontmatter(raw_page, page_path)
            csl_item = _recursos_metadata_to_csl(entry.get('title') or '', meta)
            if csl_item:
                out.append(csl_item)
        except OSError:
            continue
    return out


@router.get("/format-citation")
async def format_citation(
    key: str,
    style: str = Query('apa'),
    locale: str = Query('ca-AD'),
):
    """Renderitza una cita inline (un sol citation key) com a text plain.

    Pensat per al Office Add-in (Gnosi Cite): el add-in vol inserir un
    text formatat al document de Word. El backend invoca pandoc-citeproc
    amb el subset mínim (un sol element) i retorna el text inline.

    Resposta: `{ formatted: "(Smith, 2020)", key: "smith2020" }`. Si no
    es resol, retorna el citation key entre parèntesis com a fallback
    perquè l'usuari pugui veure el problema al document.
    """
    key_norm = str(key or '').strip()
    if not key_norm:
        raise HTTPException(status_code=400, detail="key is required")

    csl_items = await asyncio.to_thread(_build_csl_items_for_keys, [key_norm])
    if not csl_items:
        return {"key": key_norm, "formatted": f"(@{key_norm})", "resolved": False}

    csl_path = _resolve_csl_path(style)
    # Marcador únic per extreure'n l'inline citation de l'output pandoc.
    marker_a = "<<<GNOSI_CITE_START>>>"
    marker_b = "<<<GNOSI_CITE_END>>>"
    md = f"{marker_a}[@{key_norm}]{marker_b}\n"

    with _ext_tempfile.TemporaryDirectory(prefix='gnosi_fmt_') as tmpdir:
        tmp = Path(tmpdir)
        (tmp / 'input.md').write_text(md, encoding='utf-8')
        (tmp / 'refs.json').write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')
        cmd = [
            'pandoc', 'input.md', '-t', 'plain',
            '--citeproc', '--bibliography', 'refs.json',
            '--metadata', f'lang={locale}',
        ]
        if csl_path:
            cmd += ['--csl', str(csl_path)]
        try:
            r = _ext_subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=20)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="pandoc not available")
        except _ext_subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="pandoc timeout")
        if r.returncode != 0:
            raise HTTPException(status_code=500, detail=f"pandoc failed: {r.stderr[:300]}")
        out = r.stdout

    m = re.search(re.escape(marker_a) + r'(.*?)' + re.escape(marker_b), out, re.DOTALL)
    formatted = m.group(1).strip() if m else out.strip()
    # El pandoc-citeproc afegeix la bibliografia al final per defecte; la
    # ignorem perquè aquí només volem la cita inline.
    return {"key": key_norm, "formatted": formatted, "resolved": True}


@router.post("/format-citations")
async def format_citations(payload: dict = Body(...)):
    """Renderitza un conjunt de cites inline EN CONJUNT — necessari per
    complir APA i altres estils sensibles a context.

    Per què cal aquesta variant batch (no `format-citation` singular):
      - APA desambigua autors homònims dins un document (Smith, J. vs
        Smith, A.) afegint inicials a la primera aparició
      - Mateix autor + mateix any → sufixos `2020a`, `2020b` automàtics
      - Primera aparició d'un grup amb molts autors → noms complets;
        següents → `et al.`
      - Citeproc només pot fer aquestes decisions si rep TOT el subset
        que apareix al document en una sola crida

    Cos: `{ keys: ["smith2020", "lee2021", "smith2020"], style, locale }`
    (els duplicats es permeten — citeproc-js i pandoc-citeproc compten
    ocurrències per decidir el format apropiat).

    Resposta: `{ items: [{key, formatted, ordinal}, ...], style, locale }`
    `ordinal` és l'ordre d'aparició (1, 2, 3…) — útil per saber a quina
    Content Control del document correspon cada text formatat.
    """
    raw_keys = payload.get('keys') or []
    if not isinstance(raw_keys, list):
        raise HTTPException(status_code=400, detail="keys must be a list")
    keys: List[str] = [str(k).strip().lstrip('@') for k in raw_keys if str(k).strip()]
    if not keys:
        return {"items": [], "style": str(payload.get('style') or 'apa'), "locale": str(payload.get('locale') or 'ca-AD')}
    style = str(payload.get('style') or 'apa').strip()
    locale = str(payload.get('locale') or 'ca-AD').strip()

    # CSL items: deduplicats per key (citeproc rep cada item un cop, però
    # les cites poden repetir-se al text — vegis més avall).
    unique_keys = list(dict.fromkeys(keys))  # preserva ordre, elimina dups
    csl_items = await asyncio.to_thread(_build_csl_items_for_keys, unique_keys)
    resolved_keys = {it.get('id') for it in csl_items}

    csl_path = _resolve_csl_path(style)
    # Markdown: una línia per cada cita en l'ordre original (amb duplicats!),
    # cada una embolcallada amb marcadors únics que identifiquen l'ordinal.
    # Així el parser sap quin text correspon a quina ocurrència.
    lines = []
    for idx, k in enumerate(keys, start=1):
        if k in resolved_keys:
            lines.append(f"<<<GC_{idx}_S>>>[@{k}]<<<GC_{idx}_E>>>")
        else:
            # Key no resolt: deixem un placeholder amb el text cru perquè
            # el client el detecti i pugui mostrar un error.
            lines.append(f"<<<GC_{idx}_S>>>(@{k})<<<GC_{idx}_E>>>")
    md = "\n\n".join(lines) + "\n"

    with _ext_tempfile.TemporaryDirectory(prefix='gnosi_fmts_') as tmpdir:
        tmp = Path(tmpdir)
        (tmp / 'input.md').write_text(md, encoding='utf-8')
        if csl_items:
            (tmp / 'refs.json').write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')
        cmd = ['pandoc', 'input.md', '-t', 'plain', '--wrap=none', '--metadata', f'lang={locale}']
        if csl_items:
            cmd += ['--citeproc', '--bibliography', 'refs.json']
        if csl_path:
            cmd += ['--csl', str(csl_path)]
        try:
            r = _ext_subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="pandoc not available")
        except _ext_subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="pandoc timeout")
        if r.returncode != 0:
            raise HTTPException(status_code=500, detail=f"pandoc failed: {r.stderr[:300]}")
        out = r.stdout

    items: List[dict] = []
    for idx, k in enumerate(keys, start=1):
        pattern = re.compile(re.escape(f"<<<GC_{idx}_S>>>") + r'(.*?)' + re.escape(f"<<<GC_{idx}_E>>>"), re.DOTALL)
        m = pattern.search(out)
        formatted = m.group(1).strip() if m else f"(@{k})"
        items.append({
            "key": k,
            "ordinal": idx,
            "formatted": formatted,
            "resolved": k in resolved_keys,
        })
    return {"items": items, "style": style, "locale": locale}


@router.post("/format-bibliography")
async def format_bibliography(payload: dict = Body(...)):
    """Renderitza la bibliografia (llista d'entries) per als citation
    keys donats. Pensat per al Office Add-in.

    Cos: `{ keys: ["smith2020", "lee2021"], style: "apa", locale: "ca-AD" }`
    Resposta: `{ entries: ["Smith, J. (2020). ...", "Lee, A. (2021). ..."], style, locale }`

    Pandoc invocat amb `--nocite` perquè generi la bibliografia sense
    necessitat de citar al cos. Cada entrada de la llista es separa per
    una línia buida (output `plain`), que parsegem.
    """
    keys = payload.get('keys') or []
    if not isinstance(keys, list):
        raise HTTPException(status_code=400, detail="keys must be a list")
    keys = [str(k).strip().lstrip('@') for k in keys if str(k).strip()]
    style = str(payload.get('style') or 'apa').strip()
    locale = str(payload.get('locale') or 'ca-AD').strip()

    csl_items = await asyncio.to_thread(_build_csl_items_for_keys, keys)
    if not csl_items:
        return {"entries": [], "style": style, "locale": locale, "resolved": 0, "missing": keys}
    resolved_keys = {it.get('id') for it in csl_items}
    missing = [k for k in keys if k not in resolved_keys]

    csl_path = _resolve_csl_path(style)
    nocite = ' '.join(f'@{it["id"]}' for it in csl_items)
    md = f"---\nnocite: |\n  {nocite}\n---\n\n::: {{#refs}}\n:::\n"

    with _ext_tempfile.TemporaryDirectory(prefix='gnosi_bib_') as tmpdir:
        tmp = Path(tmpdir)
        (tmp / 'input.md').write_text(md, encoding='utf-8')
        (tmp / 'refs.json').write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')
        cmd = [
            'pandoc', 'input.md', '-t', 'plain',
            '--citeproc', '--bibliography', 'refs.json',
            '--metadata', f'lang={locale}',
            '--wrap=none',
        ]
        if csl_path:
            cmd += ['--csl', str(csl_path)]
        try:
            r = _ext_subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="pandoc not available")
        except _ext_subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="pandoc timeout")
        if r.returncode != 0:
            raise HTTPException(status_code=500, detail=f"pandoc failed: {r.stderr[:300]}")
        out = r.stdout.strip()

    # Cada entrada de la bibliografia és un paràgraf separat per línia buida.
    entries = [e.strip() for e in re.split(r'\n\s*\n', out) if e.strip()]
    return {
        "entries": entries,
        "style": style,
        "locale": locale,
        "resolved": len(csl_items),
        "missing": missing,
    }


@router.get("/export/{page_id}")
async def export_page(
    page_id: str,
    format: str = Query('docx', regex=r'^(docx|odt|html|pdf|tex|markdown)$'),
    csl: str = Query('apa'),
    locale: str = Query('ca-AD'),
):
    """Exporta una pàgina del Vault al format demanat amb cites resoltes.

    Workflow:
      1. Carrega el Markdown de la pàgina (frontmatter + body).
      2. Identifica tots els `[@key]` referenciats al body.
      3. Resol cada key a una entrada de Recursos. Genera un CSL-JSON
         només amb el subset usat (no totes 4198 entries).
      4. Localitza el `.csl` style al frontend/public/csl/styles/.
      5. Invoca pandoc amb --citeproc --csl --bibliography i retorna
         el binari resultant com a download.

    Si pandoc no és disponible o falla, 500 amb stderr.
    """
    file_path = await asyncio.to_thread(find_page_path, page_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Page not found")
    raw = file_path.read_text(encoding='utf-8')
    # Strip frontmatter; pandoc l'entendria però sol contenir camps que no
    # volem al docx final.
    body = raw
    if body.startswith('---'):
        m = re.match(r'^---\n.*?\n---\n', body, re.DOTALL)
        if m:
            body = body[m.end():]

    # Identifica citation keys al body (tant [@key] bracketed com naked @key)
    keys = set()
    for m in re.finditer(r'\[@([a-z][a-z0-9_:-]*(?:\s*;\s*@[a-z][a-z0-9_:-]*)*)\]', body, re.IGNORECASE):
        for k in m.group(1).split(';'):
            kk = k.strip().lstrip('@').strip()
            if kk:
                keys.add(kk)

    # Construeix CSL-JSON del subset
    csl_items = []
    if keys:
        v_path = get_active_vault_path()
        if v_path:
            idx = _ensure_cite_key_index(str(v_path))
            for k in keys:
                entry = idx.get(k)
                if not entry:
                    continue
                # Llegir la pàgina sencera per agafar la metadata
                try:
                    page_path = await asyncio.to_thread(find_page_path, entry['id'])
                    if not page_path:
                        continue
                    raw_page = page_path.read_text(encoding='utf-8')
                    meta, _ = parse_frontmatter(raw_page, page_path)
                    csl_item = _recursos_metadata_to_csl(entry.get('title') or '', meta)
                    if csl_item:
                        csl_items.append(csl_item)
                except OSError:
                    continue

    # Localitza el .csl style. Vivien al public/ del frontend, també accesible
    # via filesystem si el backend i el frontend comparteixen el repo.
    csl_path = None
    style_map = {
        'apa': 'apa.csl',
        'chicago-author-date': 'chicago-author-date.csl',
        'mla': 'modern-language-association.csl',
        'ieee': 'ieee.csl',
    }
    style_file = style_map.get(csl, 'apa.csl')
    candidates = [
        Path('/app/frontend/public/csl/styles') / style_file,
        Path('/app/monorepo/apps/gnosi/frontend/public/csl/styles') / style_file,
    ]
    for c in candidates:
        if c.exists():
            csl_path = c
            break

    # Invocar pandoc en un directori temporal
    with _ext_tempfile.TemporaryDirectory(prefix='gnosi_export_') as tmpdir:
        tmp = Path(tmpdir)
        (tmp / 'input.md').write_text(body, encoding='utf-8')
        if csl_items:
            (tmp / 'refs.json').write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')
        # Substituïm el `{{bibliography}}` marcador propi per la sintaxi
        # nadiua de pandoc-citeproc — que injecta la bibliografia al lloc.
        # També una secció final si no hi era.
        content = (tmp / 'input.md').read_text(encoding='utf-8')
        if '{{bibliography}}' in content or re.search(r'\{\{bibliography(?::[a-z-]+)?(?::[a-zA-Z-]+)?\}\}', content):
            # Pandoc usa `# References` o `:::refs` o el final del document
            # com a lloc de la bibliografia. Substituïm la nostra sintaxi per
            # un heading + ref div.
            content = re.sub(r'\{\{bibliography(?::[a-z-]+)?(?::[a-zA-Z-]+)?\}\}',
                             '## Bibliografia\n\n::: {#refs}\n:::', content)
            (tmp / 'input.md').write_text(content, encoding='utf-8')
        ext_map = {'docx':'docx','odt':'odt','html':'html','pdf':'pdf','tex':'tex','markdown':'md'}
        out_name = f'output.{ext_map[format]}'
        cmd = ['pandoc', 'input.md', '-o', out_name]
        if csl_items:
            cmd += ['--citeproc', '--bibliography', 'refs.json']
            if csl_path:
                cmd += ['--csl', str(csl_path)]
        if format in ('docx', 'odt', 'pdf'):
            cmd += ['--standalone']
        cmd += ['--metadata', f'lang={locale}']
        try:
            result = _ext_subprocess.run(
                cmd, cwd=tmp, capture_output=True, text=True, timeout=60,
            )
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="pandoc not available al contenidor")
        except _ext_subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="pandoc timeout after 60s")
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"pandoc failed: {result.stderr[:500]}",
            )
        out_path = tmp / out_name
        if not out_path.exists():
            raise HTTPException(status_code=500, detail="pandoc no ha generat sortida")
        # Llegim els bytes (el TemporaryDirectory s'esborrarà al sortir)
        data = out_path.read_bytes()

    # Genera un nom de download net
    safe_title = re.sub(r'[^A-Za-z0-9._-]+', '_', file_path.stem)[:80] or 'document'
    download_name = f'{safe_title}.{ext_map[format]}'
    media = {
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'odt': 'application/vnd.oasis.opendocument.text',
        'html': 'text/html',
        'pdf': 'application/pdf',
        'tex': 'application/x-latex',
        'markdown': 'text/markdown',
    }[format]
    from fastapi.responses import Response
    return Response(
        content=data,
        media_type=media,
        headers={'Content-Disposition': f'attachment; filename="{download_name}"'},
    )


# ---------------------------------------------------------------------------
# Metadata lookup per identificador (DOI / ISBN / arXiv / URL)
# ---------------------------------------------------------------------------
#
# Endpoint per omplir camps de Recursos a partir d'identificadors externs.
# Cobreix els tres serveis més habituals per a treball acadèmic:
#
#   - CrossRef (DOI)         — ~140M articles, JSON, no requereix API key
#   - Open Library (ISBN)    — llibres, JSON, no API key
#   - arXiv (arxiv id)       — preprints científics, XML (parsejat stdlib)
#   - HTML meta tags (URL)   — fallback per a pàgines web genèriques
#                              (Open Graph + Dublin Core + Schema.org)
#
# La resposta NO escriu res al Vault: només suggereix valors. El frontend
# mostra un modal i l'usuari tria explícitament quins camps acceptar.
# ---------------------------------------------------------------------------

_DOI_RE = re.compile(r'10\.\d{4,9}/[-._;()/:A-Z0-9]+', re.IGNORECASE)
_ARXIV_RE = re.compile(r'(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+/\d{7}(?:v\d+)?)', re.IGNORECASE)


def _normalize_doi(raw: str) -> Optional[str]:
    """Extreu un DOI vàlid d'una cadena (pot venir amb prefix `doi:` o `https://doi.org/`)."""
    if not raw:
        return None
    m = _DOI_RE.search(raw)
    return m.group(0) if m else None


def _normalize_isbn(raw: str) -> Optional[str]:
    """Extreu un ISBN-10 o ISBN-13 d'una cadena."""
    if not raw:
        return None
    cleaned = re.sub(r'[-\s]', '', raw)
    m = re.search(r'97[89]\d{10}|\d{9}[\dX]', cleaned)
    return m.group(0) if m else None


def _normalize_arxiv(raw: str) -> Optional[str]:
    """Extreu un arXiv id (nou format YYMM.NNNNN o antic categoria/YYMMNNN)."""
    if not raw:
        return None
    m = _ARXIV_RE.search(raw)
    return m.group(1) if m else None


def _crossref_to_recursos(work: dict) -> dict:
    """Mapeig CrossRef → camps de Recursos.

    Wrapper prim al voltant del pipeline L3:
        crossref_to_zotero_item  →  zotero_item_to_recursos
    (vegis `backend/services/lookup_normalizers.py` i
    `backend/services/zotero_to_recursos_mapper.py`).
    """
    from backend.services.lookup_normalizers import crossref_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(crossref_to_zotero_item(work))


def _openlibrary_to_recursos(book: dict) -> dict:
    """Open Library → Recursos. Pipeline L3: normalitzador + mapper central."""
    from backend.services.lookup_normalizers import openlibrary_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(openlibrary_to_zotero_item(book))


def _arxiv_to_recursos(entry_xml: str) -> dict:
    """arXiv Atom XML → Recursos. Pipeline L3: normalitzador + mapper central."""
    from backend.services.lookup_normalizers import arxiv_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(arxiv_to_zotero_item(entry_xml))


def _html_meta_to_recursos(html: str, url: str) -> dict:
    """HTML meta tags → Recursos. Pipeline L3: normalitzador + mapper central."""
    from backend.services.lookup_normalizers import html_meta_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(html_meta_to_zotero_item(html, url))


def _http_get(url: str, headers: Optional[dict] = None, timeout: float = 8.0) -> Optional[str]:
    """GET HTTP simple amb timeout via urllib stdlib. Retorna text o None en error."""
    import urllib.request
    import urllib.error
    req_headers = headers or {
        'User-Agent': 'Gnosi/0.1 (https://github.com/ismigar/Gnosi; mailto:ismigar@gmail.com)',
        'Accept': 'application/json, text/html, application/xml; q=0.9, */*; q=0.8',
    }
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        log.warning(f'HTTP GET {url[:80]}... failed: {e}')
        return None


# ---------------------------------------------------------------------------
# Citation Key generation (P0).
#
# Sense `Citation Key` una pàgina de Recursos no és citable
# (`recursosPageToCsl`/`_recursos_metadata_to_csl` tornen None). Tota via d'alta
# (lookup, import, PDF, web) ha de generar-ne una. Format estil Better BibTeX:
# `<cognom><any>[<sufix>]`, p.ex. `murphy2017`, `murphy2017a` si col·lisiona.
# ---------------------------------------------------------------------------

def _ck_norm(s: str) -> str:
    """Lowercase, sense diacrítics, només lletres/dígits ASCII."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _first_author_family(authors: Any) -> str:
    """Cognom del primer autor. Accepta llista estructurada
    (`[{nom,cognom1,cognom2}]`) o string lliure (`"Cognom, Nom; ..."`)."""
    if isinstance(authors, list):
        for a in authors:
            if isinstance(a, dict):
                fam = (a.get("cognom1") or a.get("family") or "").strip()
                if fam:
                    return fam
                nom = (a.get("nom") or a.get("literal") or "").strip()
                if nom:
                    return nom.split()[-1]
        return ""
    if isinstance(authors, str) and authors.strip():
        parsed = _parse_authors_to_csl(authors)
        if parsed:
            return (parsed[0].get("family") or parsed[0].get("given") or "").strip()
    return ""


def _title_token(title: str) -> str:
    """Primera paraula significativa del títol (per a refs sense autor)."""
    stop = {"the", "a", "an", "el", "la", "els", "les", "un", "una", "uns",
            "unes", "le", "de", "del", "of", "on", "in", "to", "and", "i", "y"}
    for tok in re.findall(r"[a-zA-ZÀ-ÿ0-9]+", title or ""):
        if _ck_norm(tok) and _ck_norm(tok) not in stop:
            return tok
    return ""


def _alpha_suffix(i: int) -> str:
    """0→a, 1→b, …, 25→z, 26→aa, … (estil columnes Excel)."""
    s = ""
    i += 1
    while i > 0:
        i, rem = divmod(i - 1, 26)
        s = chr(ord('a') + rem) + s
    return s


def generate_citation_key(authors: Any, year: Any, title: str = "",
                          existing: Optional[set] = None) -> str:
    """Genera una Citation Key única estil Better BibTeX.

    base = <cognom | primera-paraula-títol | 'ref'> + <any | 'nd'>.
    Col·lisió contra `existing` → sufix alfabètic incremental.
    """
    fam = _ck_norm(_first_author_family(authors))
    if not fam:
        fam = _ck_norm(_title_token(title)) or "ref"
    yr = ""
    try:
        yr = str(int(str(year))) if year not in (None, "", "null") else ""
    except (TypeError, ValueError):
        yr = _ck_norm(str(year)) if year else ""
    base = f"{fam}{yr or 'nd'}"
    existing = existing or set()
    if base not in existing:
        return base
    i = 0
    while True:
        cand = f"{base}{_alpha_suffix(i)}"
        if cand not in existing:
            return cand
        i += 1


def _existing_citation_keys() -> set:
    """Claus ja usades al vault actiu (per a unicitat). Best-effort."""
    try:
        from backend.services.context_vars import get_active_vault_path
        v_path = get_active_vault_path()
        if not v_path:
            return set()
        return set(_ensure_cite_key_index(str(v_path)).keys())
    except Exception:
        return set()


def _inject_citation_key(suggested: dict) -> dict:
    """Afegeix `Citation Key` al dict suggerit si falta, garantint unicitat."""
    if not suggested or suggested.get('Citation Key'):
        return suggested
    ck = generate_citation_key(
        suggested.get('Authors'), suggested.get('Any'),
        suggested.get('Title') or '', _existing_citation_keys(),
    )
    if ck:
        suggested['Citation Key'] = ck
    return suggested


def _citation_key_prop_name(table: Optional[dict]) -> Optional[str]:
    """Nom real de la columna 'Citation Key' d'una taula citable, o None.

    Mirall backend del `tableHasCitationKey` del frontend (VaultDashboard.jsx):
    una taula és «de Recursos» (citable) si té una columna el nom de la qual,
    normalitzat (minúscules, sense espais), és `citationkey`. Tornem el nom
    real (p.ex. 'Citation Key') per poder-hi escriure amb la clau exacta que
    llegeixen `_recursos_metadata_to_csl` i l'índex de cites."""
    for p in (table or {}).get("properties", []) or []:
        if str(p.get("name") or "").lower().replace(" ", "") == "citationkey":
            return p.get("name")
    return None


def get_reference_table_id() -> Optional[str]:
    """Id de la taula de referències designada — l'ÚNICA font de veritat.

    La funcionalitat de referències (Citation Key automàtica, import/export
    BibTeX, «Crear des d'una font», resolució de cites) no pertany a una taula
    pel seu nom, sinó a la que l'usuari designa a Settings. Si canvia la
    designació, tota la funcionalitat es mou amb ella.

    Prioritat:
      1. `target_table` del config de referències (Settings; reusa
         `zotero_db_config.json`).
      2. Auto-migració (vaults anteriors a la designació, com els que ja tenien
         «Recursos»): adopta la primera taula amb columna 'Citation Key' i la
         persisteix com a `target_table`. A partir d'aleshores la funcionalitat
         segueix la designació, no cap heurística.

    Retorna None si no hi ha designació ni cap taula citable (Referències no
    activades encara)."""
    try:
        from backend.services.reference_table_config import (
            CONFIG_PATH, DEFAULT_CONFIG, load_json, save_json,
        )
    except Exception:
        return None
    cfg = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
    tid = str(cfg.get("target_table") or "").strip()
    if tid:
        return tid
    # Si l'usuari ja ha tocat Referències a Settings (encara que sigui per
    # DESACTIVAR-les, deixant target_table=''), respectem la decisió i NO
    # auto-migrem. L'auto-adopció és només per a vaults que mai han passat per
    # Settings (p.ex. els que ja tenien «Recursos» abans d'aquesta feature).
    if cfg.get("references_configured"):
        return None
    # Auto-migració one-shot: adopta una taula citable existent i persisteix.
    try:
        reg = load_registry()
        for t in reg.get("tables", []) or []:
            if _citation_key_prop_name(t):
                adopted = str(t.get("id") or "").strip()
                if adopted:
                    cfg["target_table"] = adopted
                    try:
                        save_json(CONFIG_PATH, cfg)
                    except Exception:
                        pass
                    log.info(
                        f"📚 Taula de referències auto-designada: {adopted} "
                        f"({t.get('name')})"
                    )
                    return adopted
    except Exception:
        pass
    return None


# Columnes que fan una taula CITABLE — les que llegeixen
# `_recursos_metadata_to_csl` (backend) i `recursosPageToCsl` (frontend).
# 'Citation Key' és imprescindible; la resta enriqueixen la cita. (nom, tipus).
_REFERENCE_SCHEMA: list = [
    ("Citation Key", "text"), ("Title", "text"), ("Authors", "text"),
    ("Any", "text"), ("Item Type", "select"), ("Llibre/Revista", "text"),
    ("Editorial", "text"), ("Lloc", "text"), ("Volum", "text"),
    ("Número", "text"), ("Pàgines", "text"), ("Edició", "text"),
    ("DOI", "text"), ("ISBN", "text"), ("ISSN", "text"),
    ("URL", "url"), ("Idioma", "text"),
]


def ensure_reference_table_schema(table_id: str) -> int:
    """Afegeix a la taula les columnes citables que li faltin (idempotent).

    Així l'usuari no ha de saber que «cal un camp Citation Key»: en
    designar/crear la taula de referències, el sistema li garanteix l'esquema.
    Retorna el nombre de columnes afegides."""
    if not table_id:
        return 0
    reg = load_registry()
    table = next(
        (t for t in reg.get("tables", []) or [] if t.get("id") == table_id), None
    )
    if not table:
        return 0
    props = table.setdefault("properties", [])
    existing = {str(p.get("name") or "").lower().replace(" ", "") for p in props}
    added = 0
    for name, ptype in _REFERENCE_SCHEMA:
        norm = name.lower().replace(" ", "")
        if norm not in existing:
            props.append({"id": str(uuid.uuid4()), "name": name, "type": ptype})
            existing.add(norm)
            added += 1
    if added:
        save_registry(reg)
        log.info(f"📚 Esquema de referències: +{added} columnes a {table_id}")
    return added


def _set_reference_table_id(table_id: Optional[str]) -> None:
    """Persisteix la designació de taula de referències (Settings → `target_table`)."""
    from backend.services.reference_table_config import (
        CONFIG_PATH, DEFAULT_CONFIG, load_json, save_json,
    )
    cfg = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
    cfg["target_table"] = (table_id or "").strip()
    # Marca que la designació és deliberada (Settings) → desactiva l'auto-migració.
    cfg["references_configured"] = True
    save_json(CONFIG_PATH, cfg)


@router.get("/reference-table")
async def get_reference_table():
    """Estat de la taula de referències designada (per a Settings i el gating
    del frontend)."""
    tid = get_reference_table_id()
    t = _table_by_id(tid) if tid else None
    return {"table_id": tid, "configured": bool(tid),
            "name": t.get("name") if t else None}


@router.post("/reference-table", dependencies=[Depends(require_role("editor"))])
async def set_reference_table(payload: dict = Body(...)):
    """Designa una taula existent com a taula de referències i li garanteix
    l'esquema citable. L'usuari no ha de saber res de 'Citation Key'."""
    table_id = str((payload or {}).get("table_id") or "").strip()
    if not table_id:
        raise HTTPException(status_code=400, detail="table_id és obligatori")
    if not _table_by_id(table_id):
        raise HTTPException(status_code=404, detail=f"Taula {table_id} no trobada")
    added = ensure_reference_table_schema(table_id)
    _set_reference_table_id(table_id)
    _invalidate_cite_key_index()
    t = _table_by_id(table_id)
    return {"table_id": table_id, "configured": True,
            "name": t.get("name") if t else None, "columns_added": added}


@router.post("/reference-table/create", dependencies=[Depends(require_role("editor"))])
async def create_reference_table(payload: dict = Body(default=None)):
    """Crea una taula nova ja citable i la designa com a taula de referències."""
    name = str((payload or {}).get("name") or "").strip() or "Referències"
    table = {
        "name": name,
        "database_id": "gnosi_vault_db",
        "properties": [
            {"id": str(uuid.uuid4()), "name": n, "type": tp}
            for n, tp in _REFERENCE_SCHEMA
        ],
    }
    created = await create_table(table)
    _set_reference_table_id(created["id"])
    _invalidate_cite_key_index()
    return {"table_id": created["id"], "configured": True,
            "name": created.get("name"), "created": True}


@router.delete("/reference-table", dependencies=[Depends(require_role("editor"))])
async def clear_reference_table():
    """Desactiva les referències (treu la designació). No esborra cap taula."""
    _set_reference_table_id("")
    _invalidate_cite_key_index()
    return {"table_id": None, "configured": False}


def _ensure_recursos_citation_key(
    metadata: dict, table: Optional[dict] = None, *, regenerate: bool = False
) -> dict:
    """Garanteix que una pàgina de la TAULA DE REFERÈNCIES porti `Citation Key`.

    Abans la clau només es generava al lookup de metadades; una alta o un
    desat normal des del navegador deixava el recurs sense clau i, per tant,
    no citable (`recursosPageToCsl`/`_recursos_metadata_to_csl` tornen None).
    Cridada des de create/save/patch/duplicate, aquesta funció tanca el forat:
    qualsevol via de persistència deixa el recurs citable.

    Gate EXCLUSIU per designació: només actua si la pàgina pertany a la taula
    de referències designada a Settings (`get_reference_table_id`), no per cap
    heurística de nom/columna. Si l'usuari canvia la tabla a Settings, la
    generació segueix la nova.

    Genera només quan (1) és la taula de referències, (2) la cel·la és buida
    —o `regenerate=True`, p.ex. en duplicar perquè la còpia no col·lisioni— i
    (3) hi ha alguna dada bibliogràfica (Authors/Any/Title), per no estampar
    claus escombraria a files completament buides. La clau és única contra les
    ja existents al vault. Muta i retorna `metadata`."""
    ref_id = get_reference_table_id()
    if not ref_id or get_table_id(metadata) != ref_id:
        return metadata
    if table is None:
        table = _table_by_id(ref_id)
    # La taula de referències hauria de tenir columna 'Citation Key' (Settings
    # la garanteix); si encara no, escrivim igualment al camp literal que
    # llegeixen els lectors de CSL i l'índex de cites.
    ck_name = _citation_key_prop_name(table) or "Citation Key"
    if not regenerate and str(metadata.get(ck_name) or "").strip():
        return metadata
    authors, year, title = (
        metadata.get("Authors"), metadata.get("Any"), metadata.get("Title"),
    )
    if not (str(authors or "").strip() or str(year or "").strip()
            or str(title or "").strip()):
        return metadata
    ck = generate_citation_key(authors, year, title or "", _existing_citation_keys())
    if ck:
        metadata[ck_name] = ck
    return metadata


# ---------------------------------------------------------------------------
# PubMed / PMID lookup (P3) — NCBI E-utilities (esummary JSON, sense API key).
# ---------------------------------------------------------------------------

def _normalize_pmid(raw: str) -> Optional[str]:
    """Extreu un PMID (1-8 dígits) d'una cadena. Match estricte per no
    confondre amb ISBN/altres números: el camp arriba ja etiquetat com a PMID."""
    if not raw:
        return None
    m = re.match(r'^\s*(?:pmid:?\s*)?(\d{1,8})\s*$', str(raw), re.IGNORECASE)
    return m.group(1) if m else None


def _pubmed_author_to_canonical(name: str) -> str:
    """`"Murphy SA"` (format PubMed: cognom + inicials) → `"Murphy, SA"` perquè
    el parser tracti el cognom correctament."""
    name = (name or '').strip()
    if not name or ',' in name:
        return name
    toks = name.split()
    if len(toks) >= 2 and re.fullmatch(r'[A-Za-z]{1,4}', toks[-1]):
        return f"{' '.join(toks[:-1])}, {toks[-1]}"
    return name


def _pubmed_to_recursos(doc: dict) -> dict:
    """PubMed esummary → Recursos. Pipeline L3: normalitzador + mapper central."""
    from backend.services.lookup_normalizers import pubmed_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(pubmed_to_zotero_item(doc))


@router.post("/lookup-metadata")
async def lookup_metadata(payload: dict = Body(...)):
    """Resol metadades externes per a un identificador donat.

    Body (accepta tots i tria el millor; prioritat DOI > arXiv > PMID > ISBN > URL):
      { doi?: str, isbn?: str, arxiv?: str, pmid?: str, url?: str }

    Resposta:
      {
        "source": "crossref" | "arxiv" | "pubmed" | "openlibrary" | "url" | null,
        "identifier": str | null,
        "suggested": { "Title": ..., "Authors": ..., "Any": ..., "Citation Key": ... },
        "error": null | str
      }

    El `suggested` inclou una `Citation Key` generada automàticament (única al
    vault) perquè la referència sigui citable des del primer moment. Mai
    modifica el Vault: només suggereix; el frontend accepta camps individualment.
    """
    doi = _normalize_doi(payload.get('doi') or '') or _normalize_doi(payload.get('url') or '')
    arxiv_id = _normalize_arxiv(payload.get('arxiv') or '') or _normalize_arxiv(payload.get('url') or '')
    pmid = _normalize_pmid(payload.get('pmid') or '')
    isbn = _normalize_isbn(payload.get('isbn') or '')
    url = (payload.get('url') or '').strip()

    if doi:
        body = await asyncio.to_thread(_http_get, f'https://api.crossref.org/works/{doi}')
        if body:
            try:
                data = json.loads(body)
                work = data.get('message') or {}
                if work:
                    return {
                        'source': 'crossref',
                        'identifier': doi,
                        'suggested': _inject_citation_key(_crossref_to_recursos(work)),
                        'error': None,
                    }
            except json.JSONDecodeError:
                pass
        return {'source': 'crossref', 'identifier': doi, 'suggested': {}, 'error': 'CrossRef no ha retornat dades vàlides'}

    if arxiv_id:
        body = await asyncio.to_thread(_http_get, f'http://export.arxiv.org/api/query?id_list={arxiv_id}')
        if body:
            sug = _inject_citation_key(_arxiv_to_recursos(body))
            if sug:
                return {
                    'source': 'arxiv',
                    'identifier': arxiv_id,
                    'suggested': sug,
                    'error': None,
                }
        return {'source': 'arxiv', 'identifier': arxiv_id, 'suggested': {}, 'error': 'arXiv no ha retornat dades'}

    if pmid:
        body = await asyncio.to_thread(
            _http_get,
            f'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={pmid}&retmode=json&version=2.0',
        )
        if body:
            try:
                data = json.loads(body)
                doc = (data.get('result') or {}).get(pmid) or {}
                if doc and not doc.get('error'):
                    return {
                        'source': 'pubmed',
                        'identifier': pmid,
                        'suggested': _inject_citation_key(_pubmed_to_recursos(doc)),
                        'error': None,
                    }
            except json.JSONDecodeError:
                pass
        return {'source': 'pubmed', 'identifier': pmid, 'suggested': {}, 'error': 'PubMed no ha retornat dades'}

    if isbn:
        body = await asyncio.to_thread(
            _http_get,
            f'https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data',
        )
        if body:
            try:
                data = json.loads(body)
                book = data.get(f'ISBN:{isbn}') or {}
                if book:
                    return {
                        'source': 'openlibrary',
                        'identifier': isbn,
                        'suggested': _inject_citation_key(_openlibrary_to_recursos(book)),
                        'error': None,
                    }
            except json.JSONDecodeError:
                pass
        return {'source': 'openlibrary', 'identifier': isbn, 'suggested': {}, 'error': "Open Library no té dades per a aquest ISBN"}

    if url and url.startswith(('http://', 'https://')):
        body = await asyncio.to_thread(_http_get, url)
        if body:
            return {
                'source': 'url',
                'identifier': url,
                'suggested': _inject_citation_key(_html_meta_to_recursos(body, url)),
                'error': None,
            }
        return {'source': 'url', 'identifier': url, 'suggested': {}, 'error': "No s'ha pogut descarregar la pàgina"}

    return {'source': None, 'identifier': None, 'suggested': {}, 'error': 'Cap identificador vàlid (DOI/arXiv/PMID/ISBN/URL)'}


@router.post("/generate-citation-key")
async def generate_citation_key_endpoint(payload: dict = Body(...)):
    """Genera una Citation Key única per a una alta manual a Recursos.

    Body: { authors?: str | list, year?: int | str, title?: str }
    Resposta: { "citation_key": str }
    """
    ck = generate_citation_key(
        payload.get('authors'), payload.get('year'),
        payload.get('title') or '', _existing_citation_keys(),
    )
    return {"citation_key": ck}


# ---------------------------------------------------------------------------
# Reconeixement de PDF (P4) — extreu DOI/arXiv del text i reaprofita el lookup.
# ---------------------------------------------------------------------------

def _extract_text_from_pdf(data: bytes, max_pages: int = 5) -> str:
    """Text de les primeres `max_pages` pàgines d'un PDF. Buit si pypdf no està
    disponible o el PDF és escanejat (sense capa de text)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        log.warning("pypdf no instal·lat: reconeixement de PDF desactivat")
        return ""
    import io
    try:
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages[:max_pages]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(parts)
    except Exception as e:
        log.warning(f"PDF il·legible: {e}")
        return ""


def _identifiers_from_text(text: str) -> dict:
    """Primer DOI (i arXiv si hi ha prefix explícit) trobat al text d'un PDF."""
    found: dict = {}
    doi = _normalize_doi(text or "")
    if doi:
        found['doi'] = doi
    # arXiv només si apareix el prefix explícit: el patró YYMM.NNNNN casaria amb
    # qualsevol número similar del cos del document (falsos positius).
    if re.search(r'arxiv\s*[:.]', text or "", re.IGNORECASE):
        arx = _normalize_arxiv(text)
        if arx:
            found['arxiv'] = arx
    return found


@router.post("/recognize-pdf", dependencies=[Depends(require_role("editor"))])
async def recognize_pdf(file: UploadFile = File(...)):
    """Detecta la referència d'un PDF: extreu text → DOI/arXiv → lookup extern.

    Resposta: { identifiers, source, suggested, error }. El `suggested` ja porta
    `Citation Key` (via `lookup_metadata`). No escriu res al Vault.
    """
    data = await file.read()
    text = await asyncio.to_thread(_extract_text_from_pdf, data)
    if not text.strip():
        return {"identifiers": {}, "source": None, "suggested": {},
                "error": "No s'ha pogut extreure text del PDF (escanejat o pypdf absent)"}
    ids = _identifiers_from_text(text)
    if not ids:
        return {"identifiers": {}, "source": None, "suggested": {},
                "error": "No s'ha trobat cap DOI/arXiv al PDF"}
    result = await lookup_metadata(ids)
    return {
        "identifiers": ids,
        "source": result.get("source"),
        "suggested": result.get("suggested", {}),
        "error": result.get("error"),
    }


# ---------------------------------------------------------------------------
# Captura web (P2) — Zotero translation-server (sidecar Docker).
# ---------------------------------------------------------------------------

def _zotero_creators_to_authors(creators) -> str:
    """Creators (format Zotero) → string `"Cognom, Nom; …"` de Recursos."""
    parts = []
    for c in creators or []:
        if not isinstance(c, dict) or (c.get('creatorType') or 'author') != 'author':
            continue
        last = (c.get('lastName') or '').strip()
        first = (c.get('firstName') or '').strip()
        name = (c.get('name') or '').strip()  # creators d'un sol camp
        if last and first:
            parts.append(f"{last}, {first}")
        elif last:
            parts.append(last)
        elif name:
            parts.append(name)
    return '; '.join(parts)


def _zotero_item_to_recursos(item: dict) -> dict:
    """Ítem Zotero (sortida de translation-server) → camps de Recursos.

    Wrapper prim al voltant del mapper declaratiu central
    (`zotero_to_recursos_mapper.zotero_item_to_recursos`, L3.1). Es
    manté com a alias per minimitzar el diff dels callers; en una neteja
    posterior es pot substituir directament l'import.
    """
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(item)


@router.post("/translate-url", dependencies=[Depends(require_role("editor"))])
async def translate_url(payload: dict = Body(...)):
    """Captura una referència des d'una URL via Zotero translation-server.

    Body: { url }. Resposta amb la mateixa forma que `/lookup-metadata`:
    { source:'web', identifier, suggested (amb Citation Key), count, error }.
    """
    url = (payload.get('url') or '').strip()
    if not url.startswith(('http://', 'https://')):
        return {'source': 'web', 'identifier': url, 'suggested': {}, 'error': 'URL no vàlida'}
    ts = os.environ.get('TRANSLATION_SERVER_URL', 'http://translation-server:1969').rstrip('/')

    def _post_web(body: str, content_type: str):
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            f'{ts}/web', data=body.encode('utf-8'),
            headers={'Content-Type': content_type}, method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8', errors='replace')
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning(f'translation-server inaccessible: {e}')
            return None, None

    status, body = await asyncio.to_thread(_post_web, url, 'text/plain')
    if status is None:
        return {'source': 'web', 'identifier': url, 'suggested': {},
                'error': "El servei de captura web (translation-server) no està disponible"}

    # 300 Multiple Choices: la pàgina conté diverses referències. Selecciona-les
    # totes (cap a 50) i reenvia per resoldre-les.
    if status == 300 and body:
        try:
            data = json.loads(body)
            sel = dict(list((data.get('items') or {}).items())[:50])
            if sel:
                back = json.dumps({'items': sel, 'session': data.get('session')})
                status, body = await asyncio.to_thread(_post_web, back, 'application/json')
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    items = []
    if status == 200 and body:
        try:
            arr = json.loads(body)
            if isinstance(arr, list):
                items = [_zotero_item_to_recursos(it) for it in arr if isinstance(it, dict)]
        except json.JSONDecodeError:
            pass
    items = [it for it in items if it]
    if not items:
        return {'source': 'web', 'identifier': url, 'suggested': {},
                'error': "No s'ha pogut extreure cap referència de la URL"}

    suggested = _inject_citation_key(items[0])
    if not suggested.get('URL'):
        suggested['URL'] = url
    return {'source': 'web', 'identifier': url, 'suggested': suggested,
            'count': len(items), 'error': None}


# ---------------------------------------------------------------------------
# Import / Export BibTeX i RIS (P1).
# ---------------------------------------------------------------------------

def _build_dedup_indexes(v_str: str) -> dict:
    """Índexs auxiliars per a deduplicació al moment de l'import.

    Retorna `{'doi': {doi_normalitzat: citation_key}, 'isbn': {...}, 'title': {...}}`.
    Recorre el cite_key_index ja existent i, per a cada pàgina amb Citation
    Key, llegeix les seves metadades i extreu DOI/ISBN/Title. Best-effort:
    una pàgina inllegible no aborta la construcció (només queda fora dels
    índexs aux).

    No es cacheja: es construeix per cada `/import-references` perquè
    aquest endpoint és poc freqüent i la cota és O(n) sobre el vault.
    """
    from backend.services.import_dedup import normalize_title_for_dedup
    idx = _ensure_cite_key_index(v_str)
    doi_idx: dict = {}
    isbn_idx: dict = {}
    title_idx: dict = {}
    for ck, entry in idx.items():
        try:
            page_path = find_page_path(entry.get('id') or '')
            if not page_path:
                continue
            meta, _ = parse_frontmatter(page_path.read_text(encoding='utf-8'), page_path)
            doi = (meta.get('DOI') or '').strip()
            if doi:
                norm = _normalize_doi(doi)
                if norm:
                    doi_idx.setdefault(norm.lower(), ck)
            isbn = (meta.get('ISBN') or '').strip()
            if isbn:
                norm = _normalize_isbn(isbn)
                if norm:
                    isbn_idx.setdefault(norm, ck)
            title = meta.get('Title') or entry.get('title') or ''
            tnorm = normalize_title_for_dedup(title)
            if tnorm:
                title_idx.setdefault(tnorm, ck)
        except (OSError, AttributeError):
            continue
    return {'doi': doi_idx, 'isbn': isbn_idx, 'title': title_idx}


@router.post("/import-references", dependencies=[Depends(require_role("editor"))])
async def import_references(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    table_id: str = Query(...),
    fmt: str = Query('auto'),
):
    """Importa un fitxer .bib/.ris creant pàgines a la taula `table_id`.

    Genera `Citation Key` quan falta. Salta entrades duplicades comparant
    contra el vault per quatre criteris (per ordre de prioritat):
      1. Citation Key idèntic
      2. DOI normalitzat
      3. ISBN normalitzat
      4. Títol normalitzat (minúscules, sense accents/puntuació)

    Resposta:
        {
          "created": N, "skipped": M,
          "items": [{id, citation_key, title}, ...],
          "skipped_details": [
              {"key": "smith2020", "reason": "doi", "existing_key": "smith2020a"},
              {"key": "...", "reason": "title", "existing_key": "..."},
              ...
          ],
          "skipped_keys": [...],          # compat: només les keys (deprecated)
          "skip_summary": {"citation_key": N1, "doi": N2, "isbn": N3, "title": N4},
          "errors": [...],
          "format": "bibtex" | "ris"
        }

    No toca pàgines existents en cap cas.
    """
    from backend.services import references_io
    from backend.services.context_vars import get_active_vault_path
    from backend.services.import_dedup import find_existing_match, add_to_indexes

    raw = (await file.read()).decode('utf-8', errors='replace')
    detected = references_io.detect_format(raw) if fmt == 'auto' else fmt
    entries = references_io.parse_references(raw, fmt)
    if not entries:
        return {"created": 0, "skipped": 0, "items": [], "skipped_details": [],
                "skipped_keys": [], "skip_summary": {},
                "errors": [], "format": detected,
                "message": "No s'ha trobat cap referència al fitxer"}

    registry = load_registry()
    table = next((t for t in registry.get('tables', []) if t.get('id') == table_id), None)
    if not table:
        raise HTTPException(status_code=404, detail=f"Taula {table_id} no trobada")

    vault_keys = _existing_citation_keys()
    v_path = get_active_vault_path()
    dedup = _build_dedup_indexes(str(v_path)) if v_path else {'doi': {}, 'isbn': {}, 'title': {}}

    used = set(vault_keys)
    created, skipped_details, errors = [], [], []
    skip_summary: dict = {'citation_key': 0, 'doi': 0, 'isbn': 0, 'title': 0}

    for e in entries:
        try:
            match = find_existing_match(e, dedup, vault_keys)
            if match is not None:
                reason, existing_key = match
                ck_in_file = (e.get('Citation Key') or '').strip()
                skipped_details.append({
                    "key": ck_in_file or existing_key,
                    "reason": reason,
                    "existing_key": existing_key,
                    "title": e.get('Title'),
                })
                skip_summary[reason] = skip_summary.get(reason, 0) + 1
                continue
            ck = (e.get('Citation Key') or '').strip()
            if not ck or ck in used:
                ck = generate_citation_key(e.get('Authors'), e.get('Any'), e.get('Title') or '', used)
            e['Citation Key'] = ck
            used.add(ck)
            title = e.get('Title') or ck
            meta = dict(e)
            meta['database_table_id'] = table_id
            meta['table_id'] = table_id
            req = PageSaveRequest(title=title, content='', metadata=meta)
            res = await create_page(req, background_tasks)
            created.append({"id": res.get('id'), "citation_key": ck, "title": title})
            # Actualitzar índexs en memòria perquè la mateixa importació no
            # crei duplicats interns (dues entrades del fitxer amb el mateix DOI).
            add_to_indexes(e, ck, dedup)
            vault_keys.add(ck)
        except Exception as ex:
            log.warning(f"import-references: entrada fallida ({e.get('Title')}): {ex}")
            errors.append({"title": e.get('Title'), "error": str(ex)})

    _invalidate_cite_key_index()
    return {
        "created": len(created),
        "skipped": len(skipped_details),
        "items": created,
        "skipped_details": skipped_details,
        # Compat amb clients antics (la propietat existeix però nomes té
        # les claus, sense motiu):
        "skipped_keys": [d["key"] for d in skipped_details],
        "skip_summary": skip_summary,
        "errors": errors,
        "format": detected,
    }


def _collect_table_reference_metas(table_id: str, wanted: Optional[set]) -> List[dict]:
    """Metadata (frontmatter) de les pàgines d'una taula que tenen `Citation
    Key`. Sync (snapshot + lectura de fitxers) — cridar via `asyncio.to_thread`."""
    pages = _get_pages_snapshot()
    out: List[dict] = []
    for p in pages:
        if getattr(p, 'resolved_table_id', None) != table_id:
            continue
        m = getattr(p, 'metadata', {}) or {}
        if not m.get('Citation Key'):
            pp = find_page_path(getattr(p, 'id', '') or '')
            if not pp:
                continue
            try:
                m, _ = parse_frontmatter(pp.read_text(encoding='utf-8'), pp)
            except OSError:
                continue
        ck = m.get('Citation Key')
        if not ck:
            continue
        if wanted is not None and ck not in wanted:
            continue
        out.append(m)
    return out


@router.get("/csl/styles")
async def list_csl_styles():
    """Llistat dels estils CSL disponibles al catàleg (frontend/public/csl/styles).

    Cada entrada: `{id, file, title}`. `title` és el `<title>` extret del XML
    (la denominació oficial CSL, p.ex. "American Psychological Association 7th edition").

    El frontend usa aquest endpoint per omplir el `CslStylePicker`; cau a la
    llista hardcoded de `cslEngine.AVAILABLE_STYLES` si la crida falla.
    """
    from backend.services.csl_styles import list_styles
    return {"styles": list_styles()}


@router.post("/csl/styles", dependencies=[Depends(require_role("editor"))])
async def upload_csl_style(file: UploadFile = File(...)):
    """Puja un fitxer CSL (`.csl`) al catàleg.

    Valida que sigui XML CSL ben format (root `<style>`, mida raonable),
    el desa amb el nom (sanititzat) i retorna la metadata extreta. L'usuari
    pot fer servir l'estil immediatament després de la propera càrrega
    del frontend (els estils es serveixen via HTTP estàtic de Vite).
    """
    from backend.services.csl_styles import save_uploaded_style
    raw = await file.read()
    try:
        meta = save_uploaded_style(raw, file.filename or 'unnamed.csl')
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return meta


@router.get("/export-references", dependencies=[Depends(require_role("editor"))])
async def export_references(
    table_id: str = Query(...),
    fmt: str = Query('bibtex'),
    keys: str = Query(''),
):
    """Exporta les referències d'una taula a BibTeX o RIS (download).

    `keys` opcional: CSV de citation keys per exportar només un subconjunt.
    """
    from backend.services import references_io
    from backend.services.context_vars import get_active_vault_path
    if fmt not in ('bibtex', 'ris'):
        raise HTTPException(status_code=400, detail="format ha de ser 'bibtex' o 'ris'")
    if not get_active_vault_path():
        raise HTTPException(status_code=400, detail="Cap vault actiu")
    wanted = {k.strip() for k in keys.split(',') if k.strip()} or None
    metas = await asyncio.to_thread(_collect_table_reference_metas, table_id, wanted)
    text = references_io.serialize_references(metas, fmt)
    ext = 'bib' if fmt == 'bibtex' else 'ris'
    from fastapi.responses import Response
    return Response(
        content=text,
        media_type='application/x-bibtex' if fmt == 'bibtex' else 'application/x-research-info-systems',
        headers={'Content-Disposition': f'attachment; filename="recursos.{ext}"'},
    )


@router.get("/search-citations")
async def search_citations(q: str = "", limit: int = 30):
    """Cerca pàgines de Recursos per al CitePicker (Cmd+Shift+I).

    Filtre lliure que cerca a `Citation Key`, `Títol` (`title`), i `Autor`
    del frontmatter. Retorna `limit` (per defecte 30) resultats ordenats
    per millor coincidència (prefix > infix > altres camps).

    Resposta: `[{ id, title, citation_key, author, year, folder }, ...]`
    Pensat per a un picker amb autocompletar — no és un endpoint d'index
    complet del catàleg.
    """
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        raise HTTPException(status_code=503, detail="No active vault")
    v_str = str(v_path)
    idx = _ensure_cite_key_index(v_str)

    query = str(q or "").strip().lower()
    if not query:
        # Sense filtre, retornem els primers `limit` per popularitat (per
        # ara, ordre alfabètic per citation_key).
        items = sorted(idx.values(), key=lambda x: str(x.get("citation_key") or "").lower())[:limit]
        # Enriquim amb autor/any llegits del frontmatter (cau a I/O però són
        # només `limit` arxius — acceptable).
        return [_enrich_cite_entry(item) for item in items]

    # Cerca per citation_key (prefix), després per títol (infix), després
    # per autor (infix). Limitem a `limit*5` candidats per al ranking i
    # tornem `limit`.
    candidates = []
    for entry in idx.values():
        ck = str(entry.get("citation_key") or "").lower()
        title = str(entry.get("title") or "").lower()
        score = -1
        if ck.startswith(query):
            score = 100 - len(ck)  # prefer curtes
        elif query in ck:
            score = 50 - len(ck)
        elif query in title:
            score = 30 - len(title) // 10
        if score >= 0:
            candidates.append((score, entry))

    candidates.sort(key=lambda x: -x[0])
    top = [entry for _, entry in candidates[:limit]]
    enriched = [_enrich_cite_entry(item) for item in top]

    # Si encara hi ha lloc, cerquem també per autor llegint els
    # frontmatters dels que no han fet match (cost més alt).
    if len(enriched) < limit:
        seen_ids = {e.get("id") for e in enriched}
        with _page_index_lock:
            entries = list(_page_index_entries.get(v_str, {}).values())
        for entry in entries:
            if entry.get("id") in seen_ids:
                continue
            path = entry.get("path")
            if not path or not Path(path).exists():
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    head = f.read(4096)
                if not head.startswith("---"):
                    continue
                m_author = re.search(r"^Autor:\s*['\"]?([^'\"\n\r]+)", head, re.MULTILINE)
                if not m_author:
                    continue
                author_low = m_author.group(1).strip().lower()
                if query not in author_low:
                    continue
                m_ck = re.search(r"^Citation Key:\s*['\"]?([^'\"\n\r]+)", head, re.MULTILINE)
                ck = m_ck.group(1).strip() if m_ck else None
                if not ck:
                    continue
                m_year = re.search(r"^(?:Any|Year|Data):\s*['\"]?(\d{4})", head, re.MULTILINE)
                year = m_year.group(1).strip() if m_year else None
                enriched.append({
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "citation_key": ck,
                    "author": m_author.group(1).strip(),
                    "year": year,
                    "folder": entry.get("folder"),
                })
                if len(enriched) >= limit:
                    break
            except OSError:
                continue

    return enriched


def _enrich_cite_entry(entry: dict) -> dict:
    """Llegeix Autor i Any del frontmatter per enriquir una entrada del
    cite_key_index. Falla silenciosament si no hi ha frontmatter."""
    out = {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "citation_key": entry.get("citation_key"),
        "folder": entry.get("folder"),
        "author": None,
        "year": None,
    }
    page_id = entry.get("id")
    if not page_id:
        return out
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        return out
    with _page_index_lock:
        idx = _page_index_entries.get(str(v_path), {})
    page_entry = idx.get(page_id)
    if not page_entry:
        return out
    path = page_entry.get("path")
    if not path or not Path(path).exists():
        return out
    try:
        with open(path, "r", encoding="utf-8") as f:
            head = f.read(4096)
        if not head.startswith("---"):
            return out
        m_author = re.search(r"^Autor:\s*['\"]?([^'\"\n\r]+)", head, re.MULTILINE)
        if m_author:
            out["author"] = m_author.group(1).strip()
        m_year = re.search(r"^(?:Any|Year|Data):\s*['\"]?(\d{4})", head, re.MULTILINE)
        if m_year:
            out["year"] = m_year.group(1).strip()
    except OSError:
        pass
    return out


@router.get("/resolve-by-citation-key")
async def resolve_by_citation_key(key: str):
    """Resol un citation key (com `smith2020`) a UUID + títol consultant
    les pàgines de la taula Recursos.

    Pensat per al sistema de citations `[@key]` al BlockEditor: el frontend
    cerca una sola key i rep el dest perquè el chip clicable obri la
    pàgina de referència. Implementació: itera el `_page_index_entries`
    i, per a les pàgines de la taula configurada com a "Recursos" (o
    qualsevol amb un camp `Citation Key`), llegeix el frontmatter per
    fer match exacte (case-sensitive — els citation keys són ASCII low).

    Optimització: si l'usuari té milers de pàgines, escanejar és lent.
    Mantenim un cache `_cite_key_index` al mòdul amb (citation_key →
    {page_id, title}) que es renova quan canvien els fitxers. Vegis
    `_invalidate_cite_key_index` per a la invalidació.
    """
    key_norm = str(key or "").strip()
    if not key_norm:
        raise HTTPException(status_code=400, detail="key is required")
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        raise HTTPException(status_code=503, detail="No active vault")
    v_str = str(v_path)
    idx = _ensure_cite_key_index(v_str)
    entry = idx.get(key_norm)
    if entry:
        return entry
    return {"id": None, "title": None, "folder": None, "citation_key": key_norm}


# Cache citation_key → {id, title, folder, citation_key}. Es reconstrueix
# (o invalida) quan canvia el page_index o quan algun PATCH toca el camp
# `Citation Key`. Per simplicitat, ara fem rebuild perezós al primer ús
# i quan el `_page_index_entries` ha canviat de mida (heurística — no
# perfecta però suficient per al cas comú).
_cite_key_index: dict[str, dict] = {}  # v_str → { citation_key: entry }
_cite_key_index_size_at_build: dict[str, int] = {}  # v_str → size del page_index
_cite_key_index_lock = threading.Lock()


def _ensure_cite_key_index(v_str: str) -> dict:
    """Construeix (o reusa) l'índex de citation keys per al vault donat.

    Estratègia perezosa: si el page_index ha canviat de mida des de l'últim
    build, refem. Si no, retornem el cache. Aquesta heurística no detecta
    edicions del mateix nombre d'entrades (un Citation Key que canvia
    sense afegir/eliminar pàgines), però el cost de tenir-ho stale durant
    una sessió de l'usuari és baix — només significa que un canvi de
    citation key triga 5 minuts a propagar-se als chips inline. Per a
    canvis crítics, vegis `_invalidate_cite_key_index`.
    """
    with _cite_key_index_lock:
        with _page_index_lock:
            current_size = len(_page_index_entries.get(v_str, {}))
        prev_size = _cite_key_index_size_at_build.get(v_str)
        if v_str in _cite_key_index and prev_size == current_size:
            return _cite_key_index[v_str]
        # Rebuild
        log.info(f"🔎 Rebuilding cite_key_index for {v_str}")
        idx: dict[str, dict] = {}
        # Acotem l'índex a la TAULA DE REFERÈNCIES designada (exclusiu): només
        # les seves pàgines són cites. Si no hi ha designació (Referències no
        # activades), indexem qualsevol pàgina amb 'Citation Key' (compat.).
        ref_id = get_reference_table_id()
        ref_canon = _canonicalize_id(ref_id) if ref_id else None
        with _page_index_lock:
            entries = list(_page_index_entries.get(v_str, {}).values())
        for entry in entries:
            path = entry.get("path")
            if not path or not Path(path).exists():
                continue
            try:
                # Llegim només la capçalera del fitxer per minimitzar I/O:
                # els frontmatters Markdown solen tenir <2KB.
                with open(path, "r", encoding="utf-8") as f:
                    head = f.read(4096)
                if not head.startswith("---"):
                    continue
                # Cerca "Citation Key:" al frontmatter
                m = re.search(r"^Citation Key:\s*['\"]?([^'\"\n\r]+)", head, re.MULTILINE)
                if not m:
                    continue
                # Scope: només pàgines de la taula de referències designada.
                if ref_canon:
                    tm = re.search(
                        r"^(?:database_table_id|table_id):\s*['\"]?([^'\"\n\r]+)",
                        head, re.MULTILINE,
                    )
                    page_tid = _canonicalize_id(tm.group(1).strip()) if tm else ""
                    if page_tid != ref_canon:
                        continue
                ck = m.group(1).strip()
                if ck and ck not in idx:
                    idx[ck] = {
                        "id": entry.get("id"),
                        "title": entry.get("title"),
                        "folder": entry.get("folder"),
                        "citation_key": ck,
                    }
            except OSError:
                continue
        _cite_key_index[v_str] = idx
        _cite_key_index_size_at_build[v_str] = current_size
        log.info(f"🔎 Built cite_key_index: {len(idx)} keys")
        return idx


def _invalidate_cite_key_index(v_str: str = None) -> None:
    """Buida el cache del cite_key_index (tot o per vault)."""
    with _cite_key_index_lock:
        if v_str is None:
            _cite_key_index.clear()
            _cite_key_index_size_at_build.clear()
        else:
            _cite_key_index.pop(v_str, None)
            _cite_key_index_size_at_build.pop(v_str, None)


@router.get("/resolve-by-title")
async def resolve_by_title(title: str):
    """Resol un títol literal a UUID consultant el _page_index_entries.

    Cas d'ús: el frontend ha rebut un wikilink `[[Foo]]` però el seu
    `idToTitle` està buit o desactualitzat (just després d'una mutació de
    parent_id, una neteja de cache, o navegació directa per URL). En lloc
    de fer GET /pages/<title> i deixar al backend el match (que ara té
    fallback per títol gràcies a `find_page_path`), el frontend pot
    consultar aquí i obtenir l'UUID directament — ràpid i sense sorolls.
    """
    title_lower = str(title or "").strip().lower()
    if not title_lower:
        raise HTTPException(status_code=400, detail="title is required")
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        raise HTTPException(status_code=503, detail="No active vault")
    v_str = str(v_path)
    with _page_index_lock:
        entries = _page_index_entries.get(v_str, {})
        for entry in list(entries.values()):
            entry_title = str(entry.get("title") or "").strip().lower()
            if entry_title and entry_title == title_lower:
                return {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "folder": entry.get("folder"),
                }
    return {"id": None, "title": None, "folder": None}


def _extract_images_from_body(body: str, max_images: int = 6) -> list[str]:
    """Extreu les URLs d'imatges referenciades al markdown (sintaxi ![alt](url))."""
    if not body:
        return []
    seen = set()
    out: list[str] = []
    for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", body):
        raw = m.group(1).strip()
        # CommonMark accepta `<url>` per envoltar URLs amb espais.
        if raw.startswith("<") and raw.endswith(">"):
            raw = raw[1:-1]
        # Algun parser pot deixar `"alt text"` al final: `url "alt"`.
        if " " in raw:
            raw = raw.split(" ", 1)[0]
        if not raw or raw in seen:
            continue
        seen.add(raw)
        out.append(raw)
        if len(out) >= max_images:
            break
    return out


async def _compute_preview(file_path: Path, page_id: str) -> Tuple[Dict[str, Any], Dict[str, Any], float]:
    """Llegeix el fitxer i construeix les dues respostes (short + full) per al
    preview, juntament amb el mtime per a invalidació de cache.

    Aquesta funció és reutilitzable per:
      - `get_page_preview` (un sol id, possible cache hit).
      - `bulk_warm_previews` (warmup proactiu d'una llista d'ids).

    Materialitza el fitxer si està online-only ABANS d'intentar llegir-lo,
    així evitem la cua de retries de 4.55s; només cauen al retry si el File
    Provider tarda més del que pensem.
    """
    # Mtime (cau silenciosament a 0 si st() falla — la cache ja gestiona el cas).
    try:
        mtime = file_path.stat().st_mtime
    except OSError:
        mtime = 0.0

    # Warmup proactiu: si el fitxer és online-only, el File Provider d'OneDrive
    # ha de descarregar-lo abans que `read_text` no peti amb errno 35. Aquest
    # mateix patró el segueix _serve_file_with_containment per a Assets/Images.
    try:
        provider = get_files_provider()
        st = file_path.stat()
        if provider.is_online_only(file_path, st):
            await provider.materialize(file_path)
    except OSError:
        pass  # cap mal: el retry loop de _read_and_parse ja ho gestiona.
    except Exception as e:
        log.debug(f"Warmup proactiu falla per {page_id}: {e}")

    def _read_and_parse():
        if _is_dashboard_file_path(file_path):
            return _read_dashboard_file(file_path)
        # Mateixos reintents que get_page (~4.55s total) com a xarxa de seguretat
        # per si el warmup proactiu d'amunt no ha estat suficient.
        last_error = None
        delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.0, 1.0]
        for attempt in range(len(delays) + 1):
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                return parse_frontmatter(raw_content, file_path)
            except OSError as e:
                last_error = e
                if e.errno == 35 and attempt < len(delays):
                    time.sleep(delays[attempt])
                    continue
                raise
        if last_error:
            raise last_error
        return {}, ""

    metadata, body = await asyncio.to_thread(_read_and_parse)
    excerpt = _build_preview_excerpt(body)
    short = {
        "id": str(metadata.get("id") or page_id),
        "title": metadata.get("title", "") or "",
        "excerpt": excerpt,
        "icon": metadata.get("icon"),
        "cover": metadata.get("cover"),
    }
    full_resp = {
        **short,
        "body_md": body or "",
        "images": _extract_images_from_body(body or ""),
    }
    return short, full_resp, mtime


async def _fetch_preview_with_cache(
    file_path: Path, page_id: str
) -> Tuple[Dict[str, Any], Dict[str, Any], float]:
    """Wrapper amb cache + dedup d'in-flight sobre `_compute_preview`.

    Lògica robusta única per a `get_page_preview` i `bulk_warm_previews`:

      1. Llegeix mtime del fitxer.
      2. Cache hit (mtime coincideix) → retorna immediatament.
      3. Cache miss però hi ha una future en marxa per aquest id → la
         comparteix (await; ningú repeteix la feina).
      4. Cache miss i no hi ha future → crea una nova future, computa,
         guarda al cache, signala la future. Sempre buida el mapa
         d'in-flight al final, tant si triomfa com si falla.
    """
    try:
        mtime = await asyncio.to_thread(lambda: file_path.stat().st_mtime)
    except OSError:
        mtime = 0.0

    cached_short = _preview_cache_get(page_id, mtime, full=False)
    cached_full = _preview_cache_get(page_id, mtime, full=True)
    if cached_short is not None and cached_full is not None:
        return cached_short, cached_full, mtime

    loop = asyncio.get_running_loop()
    with _preview_inflight_lock:
        existing = _preview_inflight.get(page_id)
        if existing is None:
            future: "asyncio.Future[Tuple[Dict[str, Any], Dict[str, Any], float]]" = loop.create_future()
            _preview_inflight[page_id] = future
            owner = True
        else:
            future = existing
            owner = False

    if not owner:
        # Una altra coroutine ja està computant aquest id. Esperem el seu
        # resultat per no duplicar feina ni estressar OneDrive.
        return await future

    try:
        short, full_resp, real_mtime = await _compute_preview(file_path, page_id)
        _preview_cache_set(page_id, real_mtime, short, full_resp)
        result = (short, full_resp, real_mtime)
        future.set_result(result)
        return result
    except Exception as e:
        if not future.done():
            future.set_exception(e)
        raise
    finally:
        with _preview_inflight_lock:
            _preview_inflight.pop(page_id, None)


@router.get("/pages/{page_id}/preview")
async def get_page_preview(page_id: str, full: bool = False):
    """Preview d'una pàgina (títol + extracte/cos + icon/cover + imatges).

    Per defecte retorna només `excerpt` (per a tooltips de wikilinks).
    Amb `?full=true`, retorna també `body_md` (markdown sencer per render
    al feed) i `images` (llista d'URLs d'imatges del cos).

    Cache en memòria invalidat per mtime + dedup d'in-flight per id:
      - La primera crida paga el cost real (warmup + read + parse, ~ms si
        ja és local, ~segons si encara és online-only).
      - Les següents són instantànies fins que el .md es modifica.
      - Si dues peticions concurrents demanen el mateix id, comparteixen
        la mateixa feina (no es duplica).

    Errno 35 d'OneDrive es degrada a buit (preview no és crític).
    """
    file_path = await asyncio.to_thread(find_page_path, page_id)

    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Page not found (ID: {page_id})"
        )

    try:
        short, full_resp, _ = await _fetch_preview_with_cache(file_path, page_id)
        return full_resp if full else short
    except OSError as e:
        if e.errno == 35:
            base = {
                "id": page_id,
                "title": "",
                "excerpt": "",
                "icon": None,
                "cover": None,
            }
            if full:
                base["body_md"] = ""
                base["images"] = []
            return base
        log.error(f"Error reading preview for page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading preview")
    except Exception as e:
        log.error(f"Error generating preview for {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error generating page preview")


class _BulkWarmPayload(BaseModel):
    ids: List[str]


# Per-item timeout dins del bulk warmup. Cobreix casos patològics on
# `materialize` o `read_text` es queden penjats (OneDrive lock, FUSE hang,
# etc.) sense aturar tot el batch. El daemon ja té el seu propi timeout
# (ONEDRIVE_WARMUP_TIMEOUT, default 90s); aquest n'és el límit superior a
# nivell de coordinació backend.
_PREVIEW_WARM_PER_ITEM_TIMEOUT_S = 30.0
# Concurrència del bulk: prou alt per paral·lelitzar, prou baix perquè no
# saturi el File Provider d'OneDrive. Coincideix amb el límit que abans
# imposava el frontend.
_PREVIEW_WARM_CONCURRENCY = 8


async def _bulk_warm_one(pid: str) -> str:
    """Warmupeja un sol id i retorna l'estat: 'cached' | 'warmed' | 'failed'.

    Mai propaga excepcions: una fallida individual NO ha de tombar el batch.

    Robust contra:
      - **Ids orfes** (pàgines stale a una vista de base de dades que ja
        s'han eliminat del disc): `find_page_path(allow_full_scan=False)`
        evita un `rglob` ple del vault quan l'id no és a l'índex de
        pàgines.
      - **Race de cache hit + miss**: tota la lògica de cache i dedup
        d'in-flight viu a `_fetch_preview_with_cache` — compartida amb
        `get_page_preview`.
    """
    try:
        # allow_full_scan=False: ids stale → fail fast sense rglob ple.
        file_path = await asyncio.to_thread(find_page_path, pid, allow_full_scan=False)
        if not file_path or not file_path.exists():
            return "failed"

        try:
            mtime = await asyncio.to_thread(lambda: file_path.stat().st_mtime)
        except OSError:
            mtime = 0.0

        # Cache hit ràpid abans d'entrar a `_fetch_preview_with_cache`
        # (estalvia el cost de configurar la future dedup quan no cal).
        if _preview_cache_get(pid, mtime, full=True) is not None:
            return "cached"

        await _fetch_preview_with_cache(file_path, pid)
        return "warmed"
    except Exception as e:
        log.debug(f"bulk warmup falla per {pid}: {e}")
        return "failed"


@router.post("/pages/preview/warm")
async def bulk_warm_previews(payload: _BulkWarmPayload):
    """Pre-warmup paral·lel de previews per a una llista d'ids.

    Cas d'ús: el frontend, en muntar una vista (feed/taula/galeria) amb
    desenes d'items, crida aquest endpoint una vegada amb tots els ids. El
    backend dispara warmup d'OneDrive + read + parse + cache de cada item
    en paral·lel (concurrència limitada). Les peticions individuals
    `/preview` que el frontend faci a continuació seran instantànies (cache
    hit) en lloc d'esperar ~5s cadascuna.

    Robust contra:
      - **Ids orfes/stale** (apunten a fitxers ja eliminats):
        `allow_full_scan=False` evita un rglob de tot el vault per a cada un
        — un sol id eliminat no bloca el batch sencer.
      - **Materialitzacions lentes/penjades**: timeout per item
        (`_PREVIEW_WARM_PER_ITEM_TIMEOUT_S`). El daemon té el seu propi
        timeout però aquest n'és el límit superior al backend.
      - **Errors individuals**: cada warmup falla en silenci (`failed += 1`);
        mai propaga al batch ni canvia l'estat HTTP.
      - **Crides concurrents**: dedup d'in-flight per id (vegeu
        `_bulk_warm_one`).

    Retorna comptadors: total demanats, en cache (skip), warmupejats amb
    èxit, fallits.
    """
    ids = list(dict.fromkeys(payload.ids or []))  # dedup mantenint ordre
    if not ids:
        return {"requested": 0, "cached": 0, "warmed": 0, "failed": 0}

    sem = asyncio.Semaphore(_PREVIEW_WARM_CONCURRENCY)

    async def _bounded(pid: str) -> str:
        async with sem:
            try:
                return await asyncio.wait_for(
                    _bulk_warm_one(pid),
                    timeout=_PREVIEW_WARM_PER_ITEM_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                log.warning(
                    "bulk warmup timeout per %s (>%ss)",
                    pid, _PREVIEW_WARM_PER_ITEM_TIMEOUT_S,
                )
                return "failed"
            except Exception as e:
                log.debug(f"bulk warmup outer falla per {pid}: {e}")
                return "failed"

    results = await asyncio.gather(*[_bounded(pid) for pid in ids])
    cached_n = sum(1 for r in results if r == "cached")
    warmed_n = sum(1 for r in results if r == "warmed")
    failed_n = sum(1 for r in results if r == "failed")
    return {
        "requested": len(ids),
        "cached": cached_n,
        "warmed": warmed_n,
        "failed": failed_n,
    }


@router.put("/pages/{page_id}", dependencies=[Depends(require_role("editor"))])
async def save_page(
    page_id: str, request: PageSaveRequest, background_tasks: BackgroundTasks
):
    """Saves or updates a page existing or re-adapting its UUID."""
    # FS lookup off the asyncio loop — slow stat()/rglob() on OneDrive should
    # never paralyze other concurrent requests. Skip the full-vault rglob
    # fallback: if the page id isn't in the cache, treat it as "new note" and
    # let the create branch run (much faster). Existing notes are always
    # cached after the indexer warmup.
    file_path = await asyncio.to_thread(
        find_page_path, page_id, allow_full_scan=False
    )

    # Optimistic concurrency check: if the client submitted an expected_etag,
    # confirm the on-disk file hasn't changed since they GET'd it. This
    # protects against the "edit on laptop + edit on phone" personal-mode
    # case without needing real locks. Pass `force=True` to override.
    if file_path and file_path.exists() and request.expected_etag and not request.force:
        current = file_etag(file_path)
        if current and current != request.expected_etag:
            log.info(
                f"⚠️ etag mismatch for {page_id}: expected={request.expected_etag} "
                f"current={current}. Refusing to overwrite."
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "etag_mismatch",
                    "message": (
                        "El fitxer s'ha modificat des que el vas obrir "
                        "(probablement sincronització des d'un altre dispositiu). "
                        "Recarrega o reenvia amb force=true per sobreescriure."
                    ),
                    "current_etag": current,
                    "expected_etag": request.expected_etag,
                },
            )

    metadata = request.metadata.copy()
    metadata = normalize_metadata_ids(metadata)
    metadata = normalize_table_context(metadata)
    _table_for_meta = _table_by_id(get_table_id(metadata))
    if _table_for_meta:
        metadata, _ = to_storage_names(metadata, _table_for_meta)
    metadata["id"] = page_id
    metadata["title"] = request.title
    if request.parent_id is not None:
        metadata["parent_id"] = request.parent_id

    if request.is_database:
        metadata["is_database"] = True
    if metadata.get("is_dashboard") is True:
        # Dashboards són markdown; el flag content_format=json era llegacy.
        metadata.pop("content_format", None)

    is_template = metadata.get("is_template") is True
    is_dashboard = metadata.get("is_dashboard") is True
    if not file_path:
        # If it doesn't exist, we create it in the correct folder according to metadata.
        if is_template:
            target_dir = get_p("PLANTILLES")
        elif is_calendar_entry(metadata):
            target_dir = get_p("CALENDAR")
        elif is_dashboard:
            target_dir = get_p("DASHBOARDS")
        else:
            table_folder = _resolve_table_folder_from_metadata(metadata)
            target_dir = table_folder if table_folder else get_p("WIKI")

        target_dir.mkdir(parents=True, exist_ok=True)
        # Defensa contra duplicats: si el cache d'index no tenia la pàgina
        # però el fitxer SÍ existeix al directori target (índex incomplet
        # per Errno 35 'Resource deadlock' en OneDrive, etc.), reutilitzem
        # aquell fitxer en lloc de crear "{title} (2).md". Sense això, cada
        # PUT consecutiu generaria un fitxer nou i la pàgina apareixeria
        # duplicada al sidebar amb estats incongruents.
        canonical = _canonicalize_id(page_id)
        existing_local = None
        try:
            for candidate in target_dir.iterdir():
                if not candidate.is_file() or candidate.suffix != ".md":
                    continue
                try:
                    raw_existing = candidate.read_text(encoding="utf-8")
                    fm_existing, _ = parse_frontmatter(raw_existing, candidate)
                    if _canonicalize_id(str(fm_existing.get("id", ""))) == canonical:
                        existing_local = candidate
                        break
                except Exception:
                    continue
        except Exception:
            existing_local = None

        if existing_local is not None:
            file_path = existing_local
            # Repobla el cache perquè futures crides no tornin a fer
            # aquesta exploració.
            with _page_index_lock:
                from backend.services.context_vars import get_active_vault_path
                v_root = get_active_vault_path()
                if v_root:
                    _page_id_to_path.setdefault(str(v_root), {})[page_id] = str(file_path)
            log.info(f"♻️ Reusing existing file for {page_id}: {file_path}")
        else:
            safe_name = _safe_filename(request.title, target_dir)
            file_path = target_dir / f"{safe_name}.md"
    else:
        # Ensure it's in the correct folder. Tots els tipus són markdown ara.
        file_path = ensure_correct_page_location(file_path, metadata)
        file_path = _rename_page_file_to_match_title(file_path, request.title)

    # Read previous metadata to detect manual overrides — off the event loop
    # so a slow OneDrive read doesn't block other concurrent requests.
    def _read_old_meta():
        if not file_path or not file_path.exists():
            return {}
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            md, _ = parse_frontmatter(raw_content, file_path)
            return md
        except Exception:
            return {}
    old_metadata = await asyncio.to_thread(_read_old_meta)
    # Capturem el títol previ per detectar canvis al final i reescriure
    # els wikilinks `[[Old Title]]` → `[[New Title]]`. PUT pot rebre tant
    # `request.title` com `metadata.title` (consolidats en `metadata`).
    previous_title = str(old_metadata.get("title") or "").strip() if old_metadata else ""

    # Aplicar automatitzacions i fòrmules
    try:
        metadata = get_rule_engine().process_updates(page_id, old_metadata, metadata)
    except Exception as e:
        log.error(f"Error processing automations for {page_id}: {e}")

    metadata = _persist_metadata_assets(metadata)

    # Desar un recurs des del navegador també ha de garantir-ne la Citation Key.
    metadata = _ensure_recursos_citation_key(metadata, _table_for_meta)

    def _write_now():
        # Both the version backup and the actual file write are real I/O on
        # OneDrive — pushed onto a worker thread together so the request
        # path stays unblocked. Tots els tipus de pàgina (incloses Dashboards)
        # s'escriuen com a markdown amb frontmatter.
        if file_path and file_path.exists():
            _create_page_version(page_id, file_path)
        save_page_md(file_path, metadata, request.content)

    try:
        await asyncio.to_thread(_write_now)

        # CRITICAL: update the page-id → path cache immediately so the next
        # GET/PATCH for this id can hit the O(1) lookup instead of falling
        # through to a multi-second `vault.rglob("*.md")`. The indexer warmup
        # would eventually pick it up on the next periodic refresh, but the
        # write→read race is tight enough to matter (especially in tests).
        try:
            from backend.services.context_vars import get_active_vault_path
            v_path = get_active_vault_path()
            if v_path:
                v_str = str(v_path)
                with _page_index_lock:
                    _page_id_to_path.setdefault(v_str, {})[page_id] = str(file_path)
        except Exception:
            pass

        # Invalida el TTL micro-cache de PageInfo (vegeu PATCH per la justificació).
        _pages_cache_invalidate_all()

        background_tasks.add_task(update_link_index_for_page, file_path)

        # Si el títol ha canviat, reescriu els wikilinks per títol literal a
        # les pàgines que referencien aquesta. Veure rewrite_wikilinks_on_title_change.
        new_title = str(metadata.get("title") or request.title or "").strip()
        if previous_title and new_title and previous_title != new_title:
            background_tasks.add_task(
                rewrite_wikilinks_on_title_change,
                page_id,
                previous_title,
                new_title,
            )

        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", request.content
        )
        table_id = get_table_id(metadata)
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        sync_to_google_calendar_if_needed(metadata, background_tasks)
        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "status": "success",
            "id": page_id,
            "title": metadata.get("title", request.title),
            "metadata": metadata,
            "content": request.content,
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            "etag": file_etag(file_path),  # New etag for next save's optimistic check
            "message": "Page saved successfully",
        }
    except Exception as e:
        log.error(f"Error saving page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error writing file to disk")


@router.patch("/pages/{page_id}", dependencies=[Depends(require_role("editor"))])
async def patch_page(
    page_id: str, request: PagePatchRequest, background_tasks: BackgroundTasks
):
    """Partial update of a page (e.g., metadata only)."""
    # Combinem find_page_path + (etag check) + read_file en un sol
    # `asyncio.to_thread`. Abans en feien 2 (o 3 amb etag), cadascun amb
    # ~10-30 ms d'overhead de dispatch al pool. Sense canviar la
    # semàntica, agrupar-los estalvia ~30-60 ms per PATCH.
    expected_etag = request.expected_etag
    force = request.force

    def _find_and_read():
        fp = find_page_path(page_id)
        if not fp:
            return None, None, None, None, None
        # Concurrency check abans del read (igual que abans).
        current = None
        if expected_etag and not force:
            current = file_etag(fp)
            if current and current != expected_etag:
                # Retornem el current_etag al caller perquè generi el 409.
                return fp, None, None, None, current
        if _is_dashboard_file_path(fp):
            md, bd = _read_dashboard_file(fp)
            return fp, md, bd, None, current
        raw_content = fp.read_text(encoding="utf-8")
        md, bd = parse_frontmatter(raw_content, fp)
        return fp, md, bd, raw_content, current

    file_path, metadata, body, original_raw_content, current_etag = (
        await asyncio.to_thread(_find_and_read)
    )
    if not file_path:
        raise HTTPException(status_code=404, detail="Page not found")
    if expected_etag and not force and current_etag and current_etag != expected_etag:
        log.info(
            f"⚠️ etag mismatch (PATCH) for {page_id}: "
            f"expected={expected_etag} current={current_etag}"
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "etag_mismatch",
                "message": (
                    "El fitxer s'ha modificat des que el vas obrir. "
                    "Recarrega o reenvia amb force=true per sobreescriure."
                ),
                "current_etag": current_etag,
                "expected_etag": expected_etag,
            },
        )

    try:

        # Snapshot del frontmatter original ABANS de mutar res. El RuleEngine
        # necessita comparar "què hi havia al fitxer" amb "què s'ha demanat
        # canviar"; abans aquest snapshot s'aconseguia rellegint el fitxer
        # per segona vegada (`_read_original`), cosa que pagava un read
        # extra a OneDrive (~100-300 ms) per cada PATCH. El contingut del
        # fitxer no canvia entre el primer read i el rule engine — només
        # potencialment el seu path (rename/move) — així que un `dict()`
        # és equivalent i molt més barat.
        original_metadata_snapshot = dict(metadata)

        # Capturem el títol previ ABANS de mutar `metadata`. Si canvia, al
        # final del PATCH llançarem un background task que reescriu els
        # wikilinks `[[Old Title]]` → `[[New Title]]` a totes les pàgines
        # que la referencien.
        previous_title = str(metadata.get("title") or "").strip()

        if request.title is not None:
            metadata["title"] = request.title
        if request.parent_id is not None:
            metadata["parent_id"] = request.parent_id
        if request.is_database is not None:
            metadata["is_database"] = request.is_database
        if request.metadata is not None:
            # Merge metadata
            metadata.update(request.metadata)

        content = request.content if request.content is not None else body

        # Normalitzar IDs legacy
        metadata = normalize_metadata_ids(metadata)
        metadata = normalize_table_context(metadata)
        if metadata.get("is_dashboard") is True:
            # Els dashboards són markdown amb frontmatter, com qualsevol altra
            # pàgina; `content_format=json` era una etiqueta legacy. Si el
            # frontmatter actual encara la porta, la treiem perquè no s'escrigui
            # al disc. La inversa que hi havia aquí (posar `content_format=json`
            # i convertir el fitxer a `.json`) provocava corrupció: el PATCH
            # renomenava `Bitàcora.md` → `Bitàcora.json`, hi escrivia un body
            # buit per algun camí d'error, i la pàgina passava a fer 500.
            metadata.pop("content_format", None)

        # Move if type changes (template / non-template)
        file_path = ensure_correct_page_location(file_path, metadata)
        # NOTA: NO cridem `_ensure_page_extension` per a dashboards. La regla
        # del projecte és "pàgines (incloses dashboards) sempre són Markdown";
        # canviar l'extensió a `.json` quan `is_dashboard=True` és el bug que
        # va trencar Bitàcora. La funció es manté al codi per llegir encara
        # `.json` legacy, però aquí no es força la renomenació.
        if request.title is not None:
            file_path = _rename_page_file_to_match_title(file_path, request.title)

        # Rule engine + persist assets + escriptura. `original_metadata_snapshot`
        # capturat al principi ja estalvia un read del fitxer; el
        # `process_updates` corre al thread pool perquè podria invocar
        # fórmules CPU-pesades a taules amb regles.
        try:
            metadata = await asyncio.to_thread(
                get_rule_engine().process_updates,
                page_id, original_metadata_snapshot, metadata,
            )
        except Exception as e:
            log.error(f"Error processing automations for {page_id}: {e}")

        metadata = _persist_metadata_assets(metadata)

        # Edicions parcials (p.ex. omplir cel·les a la graella) també han de
        # deixar el recurs citable si encara no en tenia clau.
        metadata = _ensure_recursos_citation_key(metadata)

        def _write_now():
            save_page_md(file_path, metadata, content)
        await asyncio.to_thread(_write_now)

        # Actualitza el cache `_page_index_entries` IMMEDIATAMENT amb el nou
        # metadata. Sense això, el següent GET /api/vault/pages retorna el
        # metadata cachejat (vell) i el frontend reverteix els canvis recents
        # — bug visible quan canvies una icona/cover i la sidebar la perd
        # després d'un fetchPages. També invalidem els bodies cache i els
        # iter_docs cache perquè /backlinks reflecteixi els canvis.
        try:
            from backend.services.context_vars import get_active_vault_path
            v_path = get_active_vault_path()
            if v_path:
                v_str = str(v_path)
                try:
                    stat_result = file_path.stat()
                    # Construïm l'entry des de les dades en memòria sense
                    # tornar a llegir el fitxer (`_build_page_cache_entry`
                    # llegia frontmatter del disc — ~100-300 ms a OneDrive
                    # per cada PATCH).
                    new_entry = _build_cache_entry_from_memory(
                        file_path, stat_result, metadata, content or ""
                    )
                    with _page_index_lock:
                        _page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
                        new_id = new_entry.get("id")
                        if new_id:
                            _page_id_to_path.setdefault(v_str, {})[new_id] = str(file_path)
                        _bump_page_index_version(v_str)
                except Exception as e:
                    log.debug(f"Cache update after PATCH failed for {page_id}: {e}")
            with _body_cache_lock:
                _body_cache.pop(str(file_path), None)
            # Invalida el TTL micro-cache de PageInfo perquè el proper
            # `/by-table` o `/pages` no torni la versió pre-PATCH (~1.5 s
            # d'estat obsolet seria visible al frontend en autosave).
            _pages_cache_invalidate_all()
            # Actualització surgical de `_iter_docs_cache`: NO invalidem
            # tota la llista. Invalidar-la (l'antic `docs = None`) feia que
            # la propera crida a `/backlinks`, `/global-index` o
            # `_rebuild_link_index` recorregués 3500+ fitxers d'OneDrive
            # (~138 s observat). Aquí substituïm l'entry concreta in-place
            # amb el contingut nou que ja tenim en memòria.
            with _iter_docs_lock:
                docs = _iter_docs_cache.get("docs")
                if docs is not None:
                    path_str = str(file_path)
                    new_doc = (
                        Path(path_str),
                        dict(metadata),
                        content if content is not None else "",
                        _is_dashboard_file_path(file_path),
                    )
                    for i, doc in enumerate(docs):
                        if str(doc[0]) == path_str:
                            docs[i] = new_doc
                            break
                    else:
                        docs.append(new_doc)
        except Exception as e:
            log.debug(f"Cache invalidation after PATCH failed: {e}")

        # Backup en background: el versionat a `.history/` ja no bloqueja
        # la resposta. Si tenim el `raw_content` original (cas markdown),
        # l'escrivim directament amb el helper "from_content"; per
        # dashboards usem la versió clàssica que fa `shutil.copy2` (ràpid
        # perquè .json de dashboards són petits).
        if original_raw_content is not None:
            background_tasks.add_task(
                _create_page_version_from_content, page_id, original_raw_content
            )
        else:
            background_tasks.add_task(_create_page_version, page_id, file_path)

        background_tasks.add_task(update_link_index_for_page, file_path)

        # Si el títol ha canviat, reescriu els wikilinks per títol literal
        # a les pàgines que referencien aquesta. update_link_index_for_page
        # del background task anterior actualitzarà les fonts modificades.
        new_title = str(metadata.get("title") or "").strip()
        if previous_title and new_title and previous_title != new_title:
            background_tasks.add_task(
                rewrite_wikilinks_on_title_change,
                page_id,
                previous_title,
                new_title,
            )

        background_tasks.add_task(
            trigger_n8n_webhook, file_path.name, "Universal", content
        )
        table_id = get_table_id(metadata)
        if table_id:
            background_tasks.add_task(
                _recompute_cross_record_formulas_for_table, table_id, page_id
            )
        sync_to_google_calendar_if_needed(metadata, background_tasks)

        rel_folder, resolved_table_id = _resolve_page_context_from_path(
            metadata, file_path
        )
        return {
            "status": "success",
            "id": page_id,
            "title": metadata.get("title", ""),
            "metadata": metadata,
            "content": content,
            "folder": rel_folder,
            "resolved_table_id": resolved_table_id,
            "etag": file_etag(file_path),  # Echo back for next save
            "message": "Page partially updated",
        }
    except Exception as e:
        log.error(f"Error patching page {page_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, f"PATCH /pages/{page_id}"),
        )


# ---------------------------------------------------------------------------
# Paperera (soft-delete) — vegeu docs/dev_memory/directives/vault_trash.md
# ---------------------------------------------------------------------------

TRASH_RETENTION_DAYS = 90


def _trash_root() -> Path:
    """Arrel de la paperera del Vault. Crida-la només des de threads workers
    (toca el filesystem). Crea el directori si no existeix."""
    root = get_p("VAULT") / ".trash"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _trash_entry_dir(page_id: str) -> Path:
    return _trash_root() / page_id


def _move_page_to_trash(page_id: str, file_path: Path) -> Dict[str, Any]:
    """Mou un fitxer .md a `.trash/{page_id}/page.md` i escriu el sidecar.

    Retorna les metadades de la paperera (id, deleted_at, original_path, ...).
    No invoca cap helper async: està pensat per executar-se dins
    `asyncio.to_thread` des del handler HTTP.
    """
    vault_root = get_p("VAULT")
    entry_dir = _trash_entry_dir(page_id)

    # Idempotent: si la carpeta ja existeix amb un sidecar vàlid, retornem-lo.
    existing_sidecar = entry_dir / "_trash.json"
    if existing_sidecar.exists():
        try:
            return json.loads(existing_sidecar.read_text(encoding="utf-8"))
        except Exception:
            # Sidecar corromput: el sobreescriurem.
            pass

    entry_dir.mkdir(parents=True, exist_ok=True)

    # Llegir frontmatter abans de moure (per al title i el table_id).
    title = ""
    table_id: Optional[str] = None
    original_parent_id: Optional[str] = None
    try:
        raw_content = file_path.read_text(encoding="utf-8")
        page_meta, _ = parse_frontmatter(raw_content, file_path)
        title = str(page_meta.get("title") or "")
        table_id = page_meta.get("table_id") or page_meta.get("database_table_id")
        original_parent_id = page_meta.get("parent_id")
    except Exception as meta_exc:
        log.warning(f"No s'ha pogut llegir frontmatter per {page_id}: {meta_exc}")

    # `original_path` és relatiu a l'arrel del Vault perquè el path absolut
    # canvia entre màquines (OneDrive a /Users/x vs /Users/y).
    try:
        relative_original_path = str(file_path.relative_to(vault_root))
    except ValueError:
        # El fitxer no és dins del Vault; tractem-ho com a 500 al handler.
        raise RuntimeError(
            f"Page file {file_path} is outside the Vault root {vault_root}"
        )

    size_bytes = 0
    try:
        size_bytes = file_path.stat().st_size
    except Exception:
        pass

    target_md = entry_dir / "page.md"
    shutil.move(str(file_path), str(target_md))

    sidecar = {
        "id": page_id,
        "title": title,
        "deleted_at": datetime.now(tz=timezone.utc).isoformat(),
        "original_path": relative_original_path,
        "original_parent_id": original_parent_id,
        "table_id": table_id,
        "size_bytes": size_bytes,
        "extension": file_path.suffix or ".md",
    }
    safe_write_json(existing_sidecar, sidecar, indent=2)
    return sidecar


def _restore_page_from_trash(page_id: str) -> Dict[str, Any]:
    """Inversa de `_move_page_to_trash`. Restaura el fitxer al `original_path`.

    Llança `FileNotFoundError` si la paperera no conté l'entrada,
    `FileExistsError` si ja hi ha un fitxer al destí, i `PermissionError`
    si el path del sidecar s'escapa del Vault (defensa anti-path-traversal).
    """
    vault_root = get_p("VAULT")
    # Resoldre el vault_root abans de comparar evita falsos positius en
    # filesystems amb symlinks (p.ex. macOS /var → /private/var) on
    # `target.resolve()` torna el path canònic però `vault_root` no.
    vault_root_resolved = vault_root.resolve()
    entry_dir = _trash_entry_dir(page_id)
    sidecar_path = entry_dir / "_trash.json"
    if not sidecar_path.exists():
        raise FileNotFoundError(f"No trash entry for {page_id}")

    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    original_rel = sidecar.get("original_path") or f"{page_id}.md"
    target = (vault_root / original_rel).resolve()
    # `Path.is_relative_to` (Python 3.9+) evita el bug clàssic del
    # `startswith` amb prefixos compartits (p.ex. `/vault` és prefix de
    # `/vault2` però no n'és pare).
    if not target.is_relative_to(vault_root_resolved):
        raise PermissionError(f"original_path escapes Vault: {original_rel}")
    if target.exists():
        raise FileExistsError(str(target))

    target.parent.mkdir(parents=True, exist_ok=True)
    source_md = entry_dir / "page.md"
    if not source_md.exists():
        # Algunes restauracions antigues podrien haver guardat el fitxer amb
        # el nom original; busquem qualsevol .md/.json dins l'entry_dir.
        candidates = [
            p for p in entry_dir.iterdir()
            if p.is_file() and p.suffix in {".md", ".json"} and p.name != "_trash.json"
        ]
        if not candidates:
            raise FileNotFoundError(f"page.md missing in {entry_dir}")
        source_md = candidates[0]

    shutil.move(str(source_md), str(target))
    shutil.rmtree(entry_dir, ignore_errors=True)
    return {**sidecar, "restored_path": str(target.relative_to(vault_root_resolved))}


def _read_trash_entries() -> List[Dict[str, Any]]:
    """Llegeix tots els sidecars `.trash/*/_trash.json`. Tolera entrades sense
    sidecar (es retornen amb `deleted_at=None` i title de fallback)."""
    root = _trash_root()
    entries: List[Dict[str, Any]] = []
    now_utc = datetime.now(tz=timezone.utc)
    for entry_dir in root.iterdir():
        if not entry_dir.is_dir():
            continue
        sidecar_path = entry_dir / "_trash.json"
        if sidecar_path.exists():
            try:
                data = json.loads(sidecar_path.read_text(encoding="utf-8"))
            except Exception as exc:
                log.warning(f"Sidecar corrupt a {entry_dir}: {exc}")
                data = {"id": entry_dir.name, "title": "(corrupt)", "deleted_at": None}
        else:
            data = {"id": entry_dir.name, "title": "(sense metadades)", "deleted_at": None}
        # Càlcul de `days_remaining`. Si no hi ha `deleted_at`, queda None.
        days_remaining = None
        if data.get("deleted_at"):
            try:
                deleted_dt = datetime.fromisoformat(str(data["deleted_at"]))
                days_elapsed = (now_utc - deleted_dt).days
                days_remaining = max(0, TRASH_RETENTION_DAYS - days_elapsed)
            except Exception:
                pass
        data["days_remaining"] = days_remaining
        entries.append(data)
    # Ordre: més recent primer; les corruptes (deleted_at=None) al final.
    entries.sort(
        key=lambda e: (e.get("deleted_at") or ""),
        reverse=True,
    )
    return entries


def _purge_trash_entry(page_id: str) -> Dict[str, Any]:
    """Elimina permanentment una entrada de la paperera."""
    entry_dir = _trash_entry_dir(page_id)
    if not entry_dir.exists():
        raise FileNotFoundError(f"No trash entry for {page_id}")
    # Mida abans de purgar (telemetria).
    freed_bytes = 0
    for f in entry_dir.rglob("*"):
        try:
            if f.is_file():
                freed_bytes += f.stat().st_size
        except Exception:
            pass
    shutil.rmtree(entry_dir)
    # Net el sidecar de metadata intern: si quedés orfe, no fa mal, però val
    # més purgar-lo per consistència. La pàgina ja no és recuperable.
    try:
        vault_root = get_p("VAULT")
        if vault_root:
            delete_sidecar_for_page(vault_root, page_id)
    except Exception as exc:
        log.debug(f"No s'ha pogut purgar el page_meta sidecar de {page_id}: {exc}")
    return {"id": page_id, "freed_bytes": freed_bytes}


def _force_index_rescan() -> None:
    """Invalida el cache d'índex per forçar un rescan a la pròxima llista."""
    global _last_vault_sync_time
    _last_vault_sync_time = 0.0
    _clear_page_index_cache()


def _remove_page_from_index_cache(page_id: str, old_path: Optional[Path] = None) -> None:
    """Treu UNA entrada del cache d'índex sense buidar-lo sencer.

    Alternativa surgical a `_force_index_rescan()` per a operacions que
    només afecten una pàgina (delete/soft-delete). El wipe global feia
    que `/pages/by-table/{id}` retornés [] fins el següent rescan i
    deixava la taula parpellejant buida després d'eliminar un registre.
    """
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        return
    v_str = str(v_path)
    with _page_index_lock:
        id_map = _page_id_to_path.get(v_str, {})
        entries = _page_index_entries.get(v_str, {})
        path_str = id_map.pop(page_id, None)
        if path_str:
            entries.pop(path_str, None)
        if old_path:
            entries.pop(str(old_path), None)
    # Cualquier delete/restore canvia la composició de pàgines visibles;
    # invalida el micro-cache de respostes per evitar `/by-table` stale.
    _pages_cache_invalidate_all()


def _add_page_to_index_cache(file_path: Path) -> None:
    """Insereix UNA entrada al cache d'índex sense rescanejar tot el vault.

    Simètric a `_remove_page_from_index_cache`. Útil quan acabem de crear
    o restaurar un fitxer i volem que aparegui ja al pròxim GET sense
    haver de buidar i refer tot l'índex (el wipe + repoblat feia
    parpellejar la taula buida després d'un restore des del toast Desfer).
    """
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        return
    v_str = str(v_path)
    try:
        stat_result = file_path.stat()
        new_entry = _build_page_cache_entry(file_path, stat_result)
    except Exception as e:
        log.debug(f"_add_page_to_index_cache failed for {file_path}: {e}")
        return
    with _page_index_lock:
        _page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
        new_id = new_entry.get("id")
        if new_id:
            _page_id_to_path.setdefault(v_str, {})[new_id] = str(file_path)
    _pages_cache_invalidate_all()


@router.delete("/pages/{page_id}", dependencies=[Depends(require_role("admin"))])
async def delete_page(page_id: str):
    """Soft-delete: mou la pàgina a `.trash/{page_id}/`.

    Substitueix l'eliminació destructiva anterior. La purga real només ocorre
    via `DELETE /trash/{id}` o via el cron `purge_trash` als 90 dies.
    Vegeu `docs/dev_memory/directives/vault_trash.md`.
    """
    file_path = await asyncio.to_thread(find_page_path, page_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Page not found")

    try:
        sidecar = await asyncio.to_thread(_move_page_to_trash, page_id, file_path)
        await asyncio.to_thread(remove_from_link_index, page_id)
        _remove_page_from_index_cache(page_id, file_path)
        deleted_at_iso = sidecar.get("deleted_at")
        restorable_until = None
        if deleted_at_iso:
            try:
                restorable_until = (
                    datetime.fromisoformat(deleted_at_iso)
                    + timedelta(days=TRASH_RETENTION_DAYS)
                ).isoformat()
            except Exception:
                pass
        return {
            "status": "soft_deleted",
            "id": page_id,
            "deleted_at": deleted_at_iso,
            "title": sidecar.get("title"),
            "original_path": sidecar.get("original_path"),
            "retention_days": TRASH_RETENTION_DAYS,
            "restorable_until": restorable_until,
        }
    except Exception as e:
        log.error(f"Error soft-deleting page {page_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /pages/{page_id}"),
        )


@router.post(
    "/pages/{page_id}/restore",
    dependencies=[Depends(require_role("admin"))],
)
async def restore_page(page_id: str):
    """Restaura una pàgina de la paperera al seu `original_path`."""
    try:
        result = await asyncio.to_thread(_restore_page_from_trash, page_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Trash entry not found")
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"A file already exists at the target path: {exc}",
        )
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        log.error(f"Error restoring page {page_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /pages/{page_id}/restore"),
        )

    # Insereix l'entrada al cache d'índex enlloc de buidar-lo sencer (que
    # deixava la taula parpellejant buida després del toast "Desfer").
    vault_root = get_p("VAULT")
    restored_rel = result.get("restored_path")
    if vault_root and restored_rel:
        _add_page_to_index_cache((vault_root.resolve() / restored_rel))
    return {
        "status": "restored",
        "id": page_id,
        "restored_path": restored_rel,
        "title": result.get("title"),
    }


@router.get("/trash", dependencies=[Depends(require_role("admin"))])
async def list_trash(q: Optional[str] = Query(None)):
    """Llista les entrades de la paperera, ordenades per `deleted_at` desc.

    Suport opcional de filtre `?q=` sobre el títol (case-insensitive).
    """
    try:
        entries = await asyncio.to_thread(_read_trash_entries)
    except Exception as e:
        log.error(f"Error reading trash: {e}")
        raise HTTPException(
            status_code=500, detail=safe_error_detail(e, "GET /trash")
        )

    if q:
        needle = q.lower().strip()
        entries = [
            e for e in entries
            if needle in str(e.get("title") or "").lower()
        ]
    return {"items": entries, "retention_days": TRASH_RETENTION_DAYS}


@router.delete(
    "/trash/{page_id}",
    dependencies=[Depends(require_role("admin"))],
)
async def purge_trash_entry(page_id: str):
    """Purga immediatament una entrada de la paperera (irreversible)."""
    try:
        result = await asyncio.to_thread(_purge_trash_entry, page_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Trash entry not found")
    except Exception as e:
        log.error(f"Error purging trash entry {page_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /trash/{page_id}"),
        )
    return {"status": "purged", **result}


def purge_expired_trash(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Funció pública invocada pel cron `purge_trash` del SchedulerManager.

    Itera totes les entrades de `.trash/` i purga les que tinguin
    `deleted_at` més antic que `TRASH_RETENTION_DAYS`. Tolera sidecars
    corruptes (els salta sense purgar — purga manual requerida).
    """
    now_utc = now or datetime.now(tz=timezone.utc)
    root = _trash_root()
    purged = 0
    freed = 0
    skipped = 0
    for entry_dir in root.iterdir():
        if not entry_dir.is_dir():
            continue
        sidecar_path = entry_dir / "_trash.json"
        if not sidecar_path.exists():
            skipped += 1
            continue
        try:
            data = json.loads(sidecar_path.read_text(encoding="utf-8"))
            deleted_dt = datetime.fromisoformat(str(data["deleted_at"]))
        except Exception:
            skipped += 1
            continue
        if (now_utc - deleted_dt).days < TRASH_RETENTION_DAYS:
            continue
        try:
            res = _purge_trash_entry(entry_dir.name)
            purged += 1
            freed += int(res.get("freed_bytes") or 0)
        except Exception as exc:
            log.warning(f"Purga fallida per {entry_dir.name}: {exc}")
            skipped += 1
    return {"purged_count": purged, "freed_bytes": freed, "skipped": skipped}


@router.post("/upload-cover", dependencies=[Depends(require_role("editor"))])
async def upload_cover(file: UploadFile = File(...)):
    """Uploads an image to the Assets/Covers folder and returns the URL."""
    return _upload_image_to_assets_subdir(file, "Covers")


@router.post("/upload-icon", dependencies=[Depends(require_role("editor"))])
async def upload_icon(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """Uploads an image to the Assets/Icons folder and returns the URL."""
    if not _is_image_upload(file):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    log.debug(f"upload_icon: START {file.filename} ({file.content_type})")
    try:
        payload = await file.read()
        log.debug(f"upload_icon: READ {len(payload)} bytes")

        if len(payload) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Icon is too large (max 10MB)")

        icons_dir = get_p("ASSETS") / "Icons"
        icons_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(payload).hexdigest()[:12]
        ext = _normalize_icon_extension(file.filename or "", file.content_type or "")
        filename = f"icon-{digest}{ext}"
        icon_path = icons_dir / filename
        
        if not icon_path.exists():
            safe_write_bytes(icon_path, payload)
            log.debug(f"upload_icon: SAVED {icon_path}")
        else:
            log.debug(f"upload_icon: EXISTS {icon_path}")

        # Schedule thumbnail creation in the background
        background_tasks.add_task(_maybe_create_icon_thumbnail, icon_path, digest)

        icon_rel = str(icon_path.relative_to(get_p("VAULT"))).replace("\\", "/")
        result = {
            "url": f"/api/vault/assets/{icon_rel[len('Assets/') :]}",
            "path": icon_rel,
            "thumbnail_url": None,
            "thumbnail_path": None,
        }

        log.debug(f"upload_icon: FINISH URL {result.get('url')}")
        return result
    except Exception as e:
        log.error(f"upload_icon: FATAL {str(e)}")
        raise


def _is_safe_external_url(url: str) -> tuple[bool, str]:
    """Reject URLs that would let the server fetch internal resources (SSRF).

    Blocks: loopback, private IP ranges (RFC1918), link-local (169.254/16,
    cloud metadata), multicast, reserved. Resolves the hostname to verify
    — a hostname like "metadata.google.internal" maps to 169.254.169.254.
    """
    import ipaddress
    import socket
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "Invalid URL"
    if parsed.scheme.lower() not in ("http", "https"):
        return False, "URL must be http(s)"
    host = parsed.hostname
    if not host:
        return False, "URL has no host"
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False, "Could not resolve host"
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False, f"Host resolves to a non-public address ({ip})"
    return True, ""


@router.post("/import-icon-url", dependencies=[Depends(require_role("editor"))])
async def import_icon_from_url(request: IconUrlImportRequest):
    """Downloads an external icon URL and stores it in Assets/Icons."""
    url = str(request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="URL must be http(s)")

    # SSRF guard — block loopback, RFC1918 private ranges, cloud metadata
    # (169.254.169.254), n8n/redis on the docker network, etc.
    ok, reason = _is_safe_external_url(url)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Refusing to fetch URL: {reason}")

    try:
        # Wrap blocking requests.get in a thread to avoid stalling the loop
        response = await asyncio.to_thread(
            requests.get, url, timeout=12, stream=True
        )
        response.raise_for_status()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch icon URL: {exc}")

    content_type = str(response.headers.get("Content-Type") or "").split(";")[0].lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="URL does not point to an image")

    max_size = 10 * 1024 * 1024
    chunks = []
    total = 0
    try:
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_size:
                raise HTTPException(status_code=413, detail="Icon is too large (max 10MB)")
            chunks.append(chunk)
    finally:
        response.close()

    payload = b"".join(chunks)
    source_name = Path(urllib.parse.urlparse(url).path).name or "remote-icon"
    return _store_icon_bytes(payload, source_name, content_type)


@router.post("/assets/upload", dependencies=[Depends(require_role("editor"))])
async def upload_asset(
    file: UploadFile = File(...),
    table_id: Optional[str] = Query(None),
    target_name: Optional[str] = Query(None),
):
    """Puja una imatge o PDF a Assets/Inline o Assets/Files i retorna la URL.
    Si s'indica table_id, desa a Assets/<DB>/<Taula>/Inline/ o .../Files/.
    `target_name` (opcional): nom base ja interpolat (p. ex. "{títol} {índex}")
    amb què reanomenar el fitxer al disc; si falta, s'usa el nom original.
    """
    is_image = _is_image_upload(file)
    subdir = "Inline" if is_image else "Files"

    if table_id:
        registry = load_registry()
        table, database = _resolve_table_and_database_for_assets(table_id, registry)
        if table:
            target_dir = _table_assets_dir(table, database) / subdir
        else:
            target_dir = get_p("ASSETS") / subdir
    else:
        target_dir = get_p("ASSETS") / subdir

    try:
        relative_path = _save_uploaded_file_to_assets(file, target_dir, target_name or "")
    except Exception as e:
        log.error(f"Error uploading asset: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")
    url = f"/api/vault/assets/{relative_path[len('Assets/'):]}"
    return {"url": url, "path": relative_path, "is_image": is_image}


@router.get("/assets/{asset_path:path}")
async def get_asset(asset_path: str):
    """Serves files from the Vault Assets directory.

    Delega a `_serve_file_with_containment` per heretar el patró de warmup
    OneDrive — sense això, els fitxers online-only sota `Assets/` (p.ex. les
    icones personalitzades a `Assets/Icons/`) es servien amb HTTP 200 i body
    de 0 bytes la primera vegada que es demanaven, i les `<img>` quedaven
    trencades al frontend.
    """
    if not get_p("ASSETS"):
        raise HTTPException(status_code=500, detail="Assets path is not configured")
    return await _serve_file_with_containment(get_p("ASSETS"), asset_path)


# --- Media Manager (ARXIU AVANÇAT) ---

# Roots vàlids: la UI envia ?root=images|assets|biblioteca|vault. La
# resposta de /media/roots indica quins tenen carpeta al disc.
_VALID_MEDIA_ROOTS = {"images", "assets", "biblioteca", "vault"}


def _validate_root(root: str) -> str:
    if root not in _VALID_MEDIA_ROOTS:
        raise HTTPException(status_code=400, detail=f"Root invàlid: {root!r}")
    return root


@router.get("/media/roots")
async def get_media_roots():
    """Retorna els roots disponibles per la cerca de mitjans (Images, Assets,
    Biblioteca, Vault). Cada element indica `available` segons si la carpeta
    existeix actualment al disc."""
    return media_service.get_roots()


@router.get("/media")
async def get_all_media(
    album: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    root: str = Query("images"),
    # Filtres (tots opcionals — sense cap, manté el comportament històric)
    kinds: Optional[str] = Query(None, description="csv: image,video,audio,pdf,other"),
    extensions: Optional[str] = Query(None, description="csv sense punt: jpg,png,..."),
    q: Optional[str] = Query(None, description="substring sobre filename"),
    desc_contains: Optional[str] = Query(None, description="substring sobre descripció"),
    tags_any: Optional[str] = Query(None, description="csv de tags (OR)"),
    tags_all: Optional[str] = Query(None, description="csv de tags (AND)"),
    tags_none: Optional[str] = Query(None, description="csv de tags (NOT)"),
    size_min: Optional[int] = Query(None, ge=0, description="KB"),
    size_max: Optional[int] = Query(None, ge=0, description="KB"),
    mtime_from: Optional[str] = Query(None, description="ISO date"),
    mtime_to: Optional[str] = Query(None, description="ISO date"),
    sort: str = Query("mtime", description="mtime|filename|size|kind"),
    dir: str = Query("desc", description="asc|desc"),
):
    """Llista mitjans, opcionalment filtrats per àlbum i carpeta arrel.
    El root per defecte és `images` per back-compat amb la galeria històrica.

    Filtres EXIF (date_taken, has_gps) NO estan disponibles en aquesta fase
    (F1). Queden per F2 amb un índex EXIF persistit. Sort per `date_taken`
    tampoc és viable encara — `sort=mtime` és el fallback raonable.
    """
    _validate_root(root)
    if sort not in {"mtime", "filename", "size", "kind"}:
        raise HTTPException(status_code=400, detail=f"sort invàlid: {sort!r}")
    if dir not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail=f"dir invàlid: {dir!r}")
    return media_service.get_all_media(
        album,
        limit=limit,
        offset=offset,
        root=root,
        kinds=kinds,
        extensions=extensions,
        q=q,
        desc_contains=desc_contains,
        tags_any=tags_any,
        tags_all=tags_all,
        tags_none=tags_none,
        size_min=size_min,
        size_max=size_max,
        mtime_from=mtime_from,
        mtime_to=mtime_to,
        sort=sort,
        dir_=dir,
    )


@router.get("/media/albums")
async def get_albums():
    """Retorna la llista d'àlbums de primer nivell. Compat: el front nou
    fa servir /media/tree per a la navegació jeràrquica."""
    return media_service.get_albums()


@router.get("/media/tree")
async def get_media_tree(
    path: Optional[str] = Query(None),
    root: str = Query("images"),
):
    """Retorna les subcarpetes immediates de `<root>/path` (lazy). Cada node
    inclou `has_children` perquè la UI dibuixi el chevron sense haver de
    carregar tot l'arbre (l'arxiu té ~33k directoris).
    Per al root="vault" exclou carpetes de sistema (.git, BD, .gnosi, etc.).
    """
    _validate_root(root)
    return media_service.get_tree_node(path, root=root)


@router.post("/media/upload", dependencies=[Depends(require_role("editor"))])
async def upload_media(
    file: UploadFile = File(...),
    album: str = Query("General"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Puja un fitxer de mitjans a un àlbum."""
    result = media_service.upload_media(file, album)
    return result


@router.patch("/media/metadata", dependencies=[Depends(require_role("editor"))])
async def update_media_metadata(
    metadata: Dict[str, Any] = Body(..., description="{tags?: string[], description?: string}"),
    path_in_root: Optional[str] = Body(None, description="Path relatiu al root (preferent)"),
    root: str = Body("images"),
    # Compat amb crides antigues (filename + album); reconstrueix el path.
    filename: Optional[str] = Body(None),
    album: Optional[str] = Body(None),
):
    """Actualitza tags i/o descripció d'un fitxer del MediaCenter.

    El payload prefer és `{root, path_in_root, metadata}`. Es manté la forma
    antiga `{filename, album, metadata}` per compatibilitat amb clients que
    encara no envien `path_in_root`; en aquest cas el path es reconstrueix
    com a `{album}/{filename}`.
    """
    _validate_root(root)
    resolved = path_in_root
    if not resolved:
        if not filename:
            raise HTTPException(status_code=400, detail="Cal `path_in_root` o `filename`")
        resolved = f"{album}/{filename}" if album else filename
    success = media_service.update_metadata(resolved, metadata, root=root)
    if not success:
        raise HTTPException(status_code=500, detail="Error de persistència")
    return {"status": "ok"}


# --- Vistes desades (filtres + sort + scope amb nom) ---

@router.get("/media/views")
async def list_media_views():
    """Retorna les vistes desades de l'usuari (sidecar JSON al vault)."""
    return media_service.list_views()


@router.post("/media/views", dependencies=[Depends(require_role("editor"))])
async def create_media_view(payload: Dict[str, Any] = Body(...)):
    """Crea una vista nova. Payload: {label, scope, filters, sort}."""
    try:
        return media_service.create_view(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/media/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def update_media_view(view_id: str, payload: Dict[str, Any] = Body(...)):
    """Actualitza una vista existent."""
    updated = media_service.update_view(view_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    return updated


@router.delete("/media/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def delete_media_view(view_id: str):
    """Esborra una vista."""
    if not media_service.delete_view(view_id):
        raise HTTPException(status_code=404, detail="Vista no trobada")
    return {"status": "ok"}

# Limita el nombre de lectures concurrents sobre el bind-mount del vault:
# `grpcfuse` (Docker Desktop) pot retornar Errno 35 (Resource deadlock
# avoided) sota pressió, especialment quan el filesystem subjacent és
# cloud-on-demand (OneDrive/iCloud File Provider) i cada fitxer es
# materialitza per separat. Amb HTTP/1.1 el navegador ja en limita ~6
# per host, però cal serialitzar més per no encadenar errors.
_VAULT_IMAGE_SEMAPHORE = asyncio.Semaphore(3)

# La detecció + materialització de fitxers cloud-on-demand viu a
# `backend.services.files_provider`. La instància (OneDriveProvider o
# LocalProvider) la decideix la factory segons env vars; aquí només la
# consumim. Vegeu docs/dev_memory/directives/files_provider_abstraction.md.


_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}


def _image_error(status: int, detail: str) -> HTTPException:
    """Retorna HTTPException amb headers `no-store` per evitar que el navegador
    persistisi errors transitoris (warmup en curs, timeouts) i deixi de
    redemanar la imatge. Sense això, els 410/503 quedaven al disk cache de
    Chrome i les fotos apareixien com 'No descarregat' indefinidament.
    """
    return HTTPException(status_code=status, detail=detail, headers=_NO_STORE_HEADERS)


@router.get("/images/{image_path:path}")
async def serve_vault_image(image_path: str):
    """Serveix imatges directament des de VAULT/Images."""
    v_path = get_p("VAULT")
    if not v_path:
        raise _image_error(500, "Vault not configured")

    img_root = (v_path / "Images").resolve()

    # Decodificar el path per si ve amb caràcters escapats extra
    from urllib.parse import unquote
    decoded_path = unquote(image_path)

    requested = (img_root / decoded_path).resolve()

    # Validació de seguretat robusta
    try:
        # is_relative_to està disponible a Python 3.9+
        if not requested.is_relative_to(img_root):
            log.warning(f"⛔ Intent d'accés fora del root de media: {requested} (root: {img_root})")
            raise _image_error(403, "Access denied")
    except (ValueError, AttributeError):
        # Fallback per a versions anteriors o errors de resolució
        if not str(requested).startswith(str(img_root)):
            log.warning(f"⛔ Fallback startswith: Accés denegat per a {requested}")
            raise _image_error(403, "Access denied")

    if not requested.exists() or not requested.is_file():
        log.error(f"❌ Imatge no trobada al disc: {requested}")
        raise _image_error(404, "Image not found")

    # Detecció de fitxers OneDrive online-only: mida lògica > 0 però st_blocks == 0
    # → no estan materialitzats al disc local. Llegir-los via bind-mount Docker
    # provoca Errno 35 (Resource deadlock avoided). No té sentit fer retry: cal
    # que l'usuari els marqui "Always keep on this device" a OneDrive.
    try:
        st = requested.stat()
    except OSError as e:
        log.warning(f"stat() ha fallat per {requested}: {e}")
        raise _image_error(503, "Image temporarily unavailable")

    if st.st_size == 0:
        log.warning(f"☁️ Fitxer placeholder detectat (0 bytes): {requested}. Cal descarregar-lo de OneDrive.")
        raise _image_error(404, "Image is an empty placeholder (OneDrive)")

    provider = get_files_provider()
    if provider.is_online_only(requested, st):
        # Online-only: demanem al proveïdor (típicament OneDrive) que
        # dispari la baixada. Si funciona, refrequem el stat i continuem.
        await provider.materialize(requested)
        try:
            st = requested.stat()
        except OSError as e:
            log.warning(f"stat() post-warmup ha fallat per {requested}: {e}")
            raise _image_error(503, "Image temporarily unavailable")
        if provider.is_online_only(requested, st):
            log.warning(f"☁️ Fitxer online-only encara no descarregat: {requested}")
            raise _image_error(503, "Image temporarily unavailable; warmup pending")

    async with _VAULT_IMAGE_SEMAPHORE:
        # Warm-up: open(1 byte) per estabilitzar la lectura abans del
        # FileResponse. Reintents per Errno 35 (Resource deadlock avoided) amb
        # backoff exponencial. Patró usat a _read_frontmatter_partial.
        last_error: Optional[OSError] = None
        for attempt in range(5):
            try:
                with open(requested, "rb") as f:
                    f.read(1)
                last_error = None
                break
            except OSError as e:
                last_error = e
                if e.errno == 35 and attempt < 4:
                    await asyncio.sleep(0.2 * (2 ** attempt))
                    continue
                break

        if last_error is not None:
            log.warning(f"☁️ Lectura fallida després de retries per {requested}: {last_error}")
            raise _image_error(503, "Image temporarily unavailable")

        media_type, _ = mimetypes.guess_type(str(requested))
        if not media_type:
            ext = requested.suffix.lower()
            media_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
                ".gif": "image/gif",
                ".svg": "image/svg+xml"
            }.get(ext, "application/octet-stream")

        # Cache curt al navegador per a fitxers servits OK; els errors mai es
        # caché-en (vegeu _image_error) per evitar que un fitxer cloud-only
        # quedi marcat com 'No descarregat' permanentment.
        return FileResponse(
            path=str(requested),
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=300"},
        )


# --- Servidors de fitxers per als roots multi-arrel ---
#
# `/images/...` ja existia (galeria històrica amb warmup OneDrive). Per fer que
# la cerca multi-root pugui retornar URLs servibles per Assets/Biblioteca/Vault,
# afegim:
#   - /biblioteca/{path}   → serveix Biblioteca/ (germana del vault)
#   - /raw/{path}          → serveix qualsevol path dins de VAULT/
# Validen containment estricte (`is_relative_to`) per evitar escapatòries
# tipus `../` o noms semblants (ex. `Assets-secret/`). Sense Cache-Control
# llarg perquè els PDFs i vídeos poden actualitzar-se en lloc.

async def _serve_file_with_containment(root_dir: Path, rel_path: str) -> FileResponse:
    if not root_dir or not root_dir.exists():
        raise HTTPException(status_code=404, detail="Root directory not available")
    try:
        root_resolved = root_dir.resolve()
        requested = (root_dir / rel_path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    try:
        if not requested.is_relative_to(root_resolved):
            raise HTTPException(status_code=403, detail="Access denied")
    except AttributeError:
        if not str(requested).startswith(str(root_resolved) + os.sep) and requested != root_resolved:
            raise HTTPException(status_code=403, detail="Access denied")

    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Mateixa protecció OneDrive online-only que `/images/`: sense això,
    # FileResponse cau amb Errno 35 (Resource deadlock avoided) per qualsevol
    # fitxer del vault no materialitzat al disc local. Afecta principalment
    # `/raw/` (root=vault) on la majoria de fitxers vénen de OneDrive.
    try:
        st = requested.stat()
    except OSError as e:
        log.warning(f"stat() ha fallat per {requested}: {e}")
        raise HTTPException(status_code=503, detail="File temporarily unavailable")

    if st.st_size == 0:
        raise HTTPException(status_code=404, detail="File is an empty placeholder (OneDrive)")

    provider = get_files_provider()
    if provider.is_online_only(requested, st):
        await provider.materialize(requested)
        try:
            st = requested.stat()
        except OSError as e:
            log.warning(f"stat() post-warmup ha fallat per {requested}: {e}")
            raise HTTPException(status_code=503, detail="File temporarily unavailable")
        if provider.is_online_only(requested, st):
            log.warning(f"☁️ Fitxer online-only encara no descarregat: {requested}")
            raise HTTPException(status_code=503, detail="File temporarily unavailable; warmup pending")

    async with _VAULT_IMAGE_SEMAPHORE:
        last_error: Optional[OSError] = None
        for attempt in range(5):
            try:
                with open(requested, "rb") as f:
                    f.read(1)
                last_error = None
                break
            except OSError as e:
                last_error = e
                if e.errno == 35 and attempt < 4:
                    await asyncio.sleep(0.2 * (2 ** attempt))
                    continue
                break

        if last_error is not None:
            log.warning(f"☁️ Lectura fallida després de retries per {requested}: {last_error}")
            raise HTTPException(status_code=503, detail="File temporarily unavailable")

        media_type, _ = mimetypes.guess_type(str(requested))
        return FileResponse(
            path=str(requested),
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=300"},
        )


@router.get("/biblioteca/{rel_path:path}")
async def serve_biblioteca_file(rel_path: str):
    """Serves files from the Biblioteca directory (sibling of the vault)."""
    return await _serve_file_with_containment(get_p("BIBLIOTECA"), rel_path)


@router.get("/raw/{rel_path:path}")
async def serve_vault_raw_file(rel_path: str):
    """Serves any file under VAULT/ with containment check.

    Used by the multi-root media picker when `root=vault`. The frontend may
    receive URLs like `/api/vault/raw/Assets/Inline/foo.png` or
    `/api/vault/raw/Wiki/notes/img.jpg`. Containment is checked against
    VAULT, so paths cannot escape the vault.
    """
    return await _serve_file_with_containment(get_p("VAULT"), rel_path)


# --- Thumbnails (QuickLook via host daemon) ---
#
# Per a fitxers que `<img>` no pot renderitzar (vídeos, PDFs, àudio...),
# generem un thumbnail usant `qlmanage` a través del daemon host
# (`sh/onedrive_warmup_daemon.py`, endpoint `/thumb`). El thumb es cacha al
# host a `${HOME}/.cache/gnosi/thumbs/<sha>.png` i el contenidor pot
# llegir-lo directament (la home està bind-mountada per OneDrive).
#
# El frontend transforma `item.url` (p. ex. `/api/vault/raw/foo/bar.mp4`)
# a `/api/vault/thumb/raw/foo/bar.mp4`. Aquí parsegem el primer segment
# per resoldre el root correcte i validem containment.

_THUMB_DAEMON_URL = os.environ.get(
    "THUMB_DAEMON_URL",
    "http://host.docker.internal:5009/thumb",
)
_THUMB_DAEMON_TIMEOUT = float(os.environ.get("THUMB_DAEMON_TIMEOUT", "45"))
# Només els roots que viuen DINS de /vault tenen translation host↔container i
# entren a l'allowlist del daemon (VAULT_HOST_PATH). `biblioteca` queda fora
# perquè és germana del vault i el daemon la rebutjaria com out_of_scope.
# Si en el futur es vol estendre, cal: (a) afegir BIBLIOTECA_HOST_PATH al
# daemon i acceptar múltiples roots a la validació, (b) ampliar
# `_container_to_host_path` per traduir paths de Biblioteca.
_THUMB_ROOTS_MAP = {
    "images": ("IMAGES", "Images"),
    "raw": ("VAULT", None),
    "assets": ("ASSETS", "Assets"),
}


def _resolve_thumb_source(rel_url: str) -> Path:
    """Parseja rel_url tipus `raw/foo/bar.mp4` o `images/a/b.jpg`, valida
    containment dins del root corresponent i retorna el Path absolut dins
    del contenidor. Llença HTTPException en cas d'error."""
    parts = rel_url.split("/", 1)
    if len(parts) != 2 or not parts[1]:
        raise HTTPException(status_code=400, detail="Invalid thumb URL")
    root_key, rel = parts[0], parts[1]
    cfg = _THUMB_ROOTS_MAP.get(root_key)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown root '{root_key}'")
    paths_key, vault_subdir = cfg

    if paths_key == "IMAGES":
        vault = get_p("VAULT")
        if not vault:
            raise HTTPException(status_code=500, detail="VAULT not configured")
        root_dir = vault / vault_subdir
    elif paths_key == "ASSETS":
        vault = get_p("VAULT")
        if not vault:
            raise HTTPException(status_code=500, detail="VAULT not configured")
        root_dir = vault / vault_subdir
    else:
        root_dir = get_p(paths_key)
        if not root_dir:
            raise HTTPException(status_code=500, detail=f"{paths_key} not configured")

    try:
        root_resolved = root_dir.resolve()
        requested = (root_dir / rel).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    try:
        if not requested.is_relative_to(root_resolved):
            raise HTTPException(status_code=403, detail="Access denied")
    except AttributeError:
        if not str(requested).startswith(str(root_resolved) + os.sep) and requested != root_resolved:
            raise HTTPException(status_code=403, detail="Access denied")

    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="Source file not found")
    return requested


def _container_to_host_path(container_path: Path) -> Optional[str]:
    """Tradueix /vault/X → VAULT_HOST_PATH/X. Necessari perquè el daemon
    treballa amb paths del host (qlmanage hi viu)."""
    vault_host = os.environ.get("VAULT_HOST_PATH")
    if not vault_host:
        return None
    try:
        rel = container_path.relative_to("/vault")
    except ValueError:
        return None
    return str(Path(vault_host) / rel)


def _thumb_no_store(status_code: int, detail: str):
    """503/error transitori amb `Cache-Control: no-store` perquè el
    navegador NO cachi l'error (sino, el thumb quedaria trencat fins que
    el cache del browser caduqui)."""
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/thumb/{rel_url:path}")
async def serve_thumb(rel_url: str, size: int = 256, v: Optional[str] = None):
    """Serveix un thumbnail PNG generat per QuickLook (macOS) per a
    fitxers no-imatge (vídeo, PDF, àudio...).

    L'URL `rel_url` segueix el mateix esquema que els endpoints de
    fitxers per als roots que viuen dins de /vault: `raw/...`,
    `images/...`, `assets/...`. Mida clampejada a [64, 1024] al daemon.

    Query param `v` (versió, típicament mtime): si el frontend el passa,
    cachem amb `immutable` perquè la URL canviarà quan canviï el fitxer
    origen. Sense `v`, fem cache curt + must-revalidate perquè el
    navegador no es quedi un thumb obsolet fins l'endemà.
    """
    _ = v  # consumit només per cache-busting a nivell de URL
    requested = _resolve_thumb_source(rel_url)

    # OneDrive warmup si el fitxer no està materialitzat: qlmanage no pot
    # llegir cloud-only des del bind-mount Docker, però sí des del host.
    # Mateix patró que `_serve_file_with_containment`: cridem materialize,
    # comprovem el resultat, re-stat per confirmar i si encara és
    # online-only retornem 503 amb `no-store` perquè el navegador no
    # cachi l'error transitori.
    try:
        st = requested.stat()
    except OSError as e:
        log.warning(f"stat() ha fallat per {requested}: {e}")
        return _thumb_no_store(503, "File temporarily unavailable")

    provider = get_files_provider()
    if provider.is_online_only(requested, st):
        ok = await provider.materialize(requested)
        try:
            st = requested.stat()
        except OSError as e:
            log.warning(f"stat() post-warmup ha fallat per {requested}: {e}")
            return _thumb_no_store(503, "File temporarily unavailable")
        if not ok or provider.is_online_only(requested, st):
            log.warning(
                f"☁️ Thumb: fitxer online-only encara no descarregat: {requested}"
            )
            return _thumb_no_store(
                503, "File temporarily unavailable; warmup pending"
            )

    host_path = _container_to_host_path(requested)
    if not host_path:
        # No hauria de passar amb _THUMB_ROOTS_MAP restringit a /vault, però
        # ho cobrim defensivament.
        raise HTTPException(
            status_code=500,
            detail="VAULT_HOST_PATH not configured or file outside /vault",
        )

    try:
        import httpx
        async with httpx.AsyncClient(timeout=_THUMB_DAEMON_TIMEOUT) as cli:
            r = await cli.get(
                _THUMB_DAEMON_URL,
                params={"path": host_path, "size": size},
            )
    except Exception as e:
        log.warning(f"Thumb daemon no accessible per {requested}: {e!r}")
        return _thumb_no_store(503, "Thumb daemon unavailable")

    if r.status_code != 200:
        try:
            body = r.json()
        except Exception:
            body = {}
        log.warning(
            f"Thumb daemon HTTP {r.status_code} per {requested}: {body}"
        )
        raise HTTPException(status_code=r.status_code, detail=body)

    body = r.json()
    if body.get("status") != "ok":
        raise HTTPException(status_code=500, detail=body)

    host_thumb_path = body.get("thumb_path")
    if not host_thumb_path or not Path(host_thumb_path).is_file():
        raise HTTPException(status_code=500, detail="Thumb path missing or not readable")

    # Cache:
    #  - Amb `?v=<mtime>` el frontend canvia la URL quan canvia el fitxer,
    #    així que podem cachejar agressivament.
    #  - Sense `v`, fem cache curt + ETag perquè el browser revalidi i
    #    rebi un 304 si no ha canviat (ETag = mtime).
    has_version = v is not None and v != ""
    cache_header = (
        "public, max-age=86400, immutable"
        if has_version
        else "public, max-age=300, must-revalidate"
    )
    return FileResponse(
        path=host_thumb_path,
        media_type="image/png",
        headers={
            "Cache-Control": cache_header,
            "ETag": f'W/"{int(st.st_mtime)}-{size}"',
        },
    )


# --- Enllaços a fitxers locals (Variant C: cap còpia, cap upload) ---
#
# Quan l'usuari tria "Enllaçar fitxer local" al MediaInsertDialog, el path
# absolut s'escull via `/pick-file` (osascript) i es registra aquí. Tornem un
# token opac i una URL `/api/vault/local-file/{token}` que el frontend pot
# inserir al BlockEditor com src d'imatge/vídeo.
#
# Per què tokens i no servir el path directament a la URL?
#  1) Els paths poden contenir caràcters problemàtics (apostrofs, espais).
#  2) Sense allowlist explícit, qualsevol GET a /local-file/<path> permetria
#     llegir tota la home de l'usuari. Amb tokens només servim paths que
#     l'usuari ha registrat explícitament a través del picker natiu.
#  3) Si el path original es mou, podem invalidar el token sense canviar la URL
#     guardada al document.

import secrets

_LOCAL_LINKS_LOCK = threading.Lock()


def _local_links_file() -> Path:
    """Resol el path del JSON de links de manera lazy. No es pot fer
    `_LOCAL_LINKS_FILE = get_p("LOCAL_DATA") / ...` a top-level perquè
    `get_p` requereix el vault context (només existeix dins una request)."""
    base = os.environ.get("GNOSI_LOCAL_DATA")
    return (Path(base) if base else Path("/app/data")) / "local_file_links.json"


def _load_local_links() -> Dict[str, str]:
    """Carrega el mapping {token: absolute_path}. Ràpid (<1KB típic)."""
    f_path = _local_links_file()
    if not f_path.exists():
        return {}
    try:
        with open(f_path, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, json.JSONDecodeError) as e:
        log.warning(f"No es pot llegir {f_path}: {e}")
        return {}


def _save_local_links(mapping: Dict[str, str]) -> None:
    f_path = _local_links_file()
    try:
        f_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = f_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(mapping, f, indent=2, ensure_ascii=False)
        tmp.replace(f_path)
    except OSError as e:
        log.error(f"No es pot persistir local-links a {f_path}: {e}")


@router.post("/local-file/register", dependencies=[Depends(require_role("editor"))])
async def register_local_file(body: dict):
    """Registra un path absolut i retorna un token + URL servible.

    Body: { "file_path": "/abs/path/to/file" }
    Resposta: { "token": "...", "url": "/api/vault/local-file/<token>",
                "name": "...", "size": N, "kind": "image|video|pdf|..." }

    Si el mateix path ja està registrat, reutilitzem el token: així si
    l'usuari registra dues vegades el mateix fitxer no acumulem entrades.
    """
    file_path = str(body.get("file_path", "")).strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path is mandatory")

    p = Path(file_path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    abs_path = str(p.resolve())
    with _LOCAL_LINKS_LOCK:
        mapping = _load_local_links()
        token = next((t for t, v in mapping.items() if v == abs_path), None)
        if token is None:
            token = secrets.token_urlsafe(16)
            mapping[token] = abs_path
            _save_local_links(mapping)

    ext = p.suffix.lower()
    return {
        "token": token,
        # URL auto-descriptiva: el segment final (nom real, codificat) no
        # s'usa per buscar el fitxer (la cerca és pel token), només perquè la
        # URL porti nom + extensió. Així el frontend mostra el nom real i
        # detecta el tipus (PDF→lector integrat) sense haver de resoldre res.
        "url": f"/api/vault/local-file/{token}/{urllib.parse.quote(p.name, safe='')}",
        "name": p.name,
        "size": p.stat().st_size,
        "kind": media_service.classify_kind(ext),
        "extension": ext,
        "path": abs_path,
    }


@router.get("/local-file/{token}")
@router.get("/local-file/{token}/{filename:path}")
async def serve_local_file(token: str, filename: str | None = None):
    """Serveix un fitxer registrat via /local-file/register.

    El segment opcional `{filename}` és decoratiu (la cerca és pel `token`):
    permet que la URL desada porti nom + extensió reals perquè el frontend
    mostri el nom i detecti el tipus. S'accepten ambdues formes per
    compatibilitat amb URLs antigues sense nom.

    Si el token no existeix → 404. Si el path ja no és accessible (l'usuari
    ha mogut/esborrat el fitxer) → 410 Gone perquè la UI ho pugui distingir
    d'un token mai registrat.

    Si el fitxer és online-only a OneDrive (típic per a documents enllaçats
    des de `~/Library/CloudStorage/...`), demanem al provider que el
    materialitzi abans de fer el `FileResponse`. Sense això, FastAPI envia
    els headers (200 OK) i quan intenta streamejar el contingut peta amb
    Errno 35 (Resource deadlock avoided) mid-stream → la UI rep una resposta
    truncada i el navegador no obre el fitxer.
    """
    with _LOCAL_LINKS_LOCK:
        mapping = _load_local_links()
        abs_path = mapping.get(token)
    if not abs_path:
        raise HTTPException(status_code=404, detail="Local file token not found")
    p = Path(abs_path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=410, detail=f"Local file no longer available: {p.name}")

    # Warmup proactiu si el fitxer és online-only (mateix patró que
    # _serve_file_with_containment per a Assets/Images).
    try:
        provider = get_files_provider()
        st = p.stat()
        if provider.is_online_only(p, st):
            await provider.materialize(p)
            try:
                st = p.stat()
            except OSError as e:
                log.warning(f"stat() post-warmup ha fallat per {p}: {e}")
                raise HTTPException(
                    status_code=503,
                    detail="Local file temporarily unavailable",
                    headers={"Cache-Control": "no-store, must-revalidate"},
                )
            if provider.is_online_only(p, st):
                log.warning(f"☁️ Local file encara online-only després del warmup: {p}")
                raise HTTPException(
                    status_code=503,
                    detail="Local file warmup pending; try again",
                    headers={"Cache-Control": "no-store, must-revalidate"},
                )
    except HTTPException:
        raise
    except Exception as e:
        log.debug(f"Warmup proactiu per {p} ha fallat: {e}")
        # Continuem igualment: el següent step (1-byte probe) gestionarà
        # qualsevol error de lectura amb backoff.

    # 1-byte probe amb backoff per estabilitzar la lectura abans del stream.
    # Mateix patró que _serve_file_with_containment línies ~4584.
    last_error: Optional[OSError] = None
    for attempt in range(5):
        try:
            with open(p, "rb") as f:
                f.read(1)
            last_error = None
            break
        except OSError as e:
            last_error = e
            if e.errno == 35 and attempt < 4:
                await asyncio.sleep(0.2 * (2 ** attempt))
                continue
            break
    if last_error is not None:
        log.warning(f"☁️ Local file no llegible després del warmup: {p} ({last_error})")
        raise HTTPException(
            status_code=503,
            detail="Local file temporarily unavailable; try again",
            headers={"Cache-Control": "no-store, must-revalidate"},
        )

    media_type, _ = mimetypes.guess_type(str(p))
    return FileResponse(path=str(p), media_type=media_type)


@router.get("/custom-icons")
async def get_custom_icons():
    """Returns the shared custom icon library for Vault icon picker."""
    return {"icons": _load_custom_icons()}


@router.put("/custom-icons", dependencies=[Depends(require_role("editor"))])
async def save_custom_icons(request: CustomIconsRequest):
    """Persists the shared custom icon library for Vault icon picker."""
    saved = _save_custom_icons(request.icons)
    return {"icons": saved}


def _resolve_storage_dir(storage_folder: str, table, database, property_name: str) -> tuple[Path, str]:
    """Resolve the target directory and URL prefix based on storage_folder config.

    Returns (target_dir, url_prefix_type) where url_prefix_type is 'assets' or 'absolute'.
    """
    if storage_folder == "biblioteca":
        biblioteca = get_p("BIBLIOTECA")
        biblioteca.mkdir(parents=True, exist_ok=True)
        return biblioteca, "absolute"
    # Default: assets (nested per DB/Table/Property)
    return _property_assets_dir(table, database, property_name), "assets"


def _file_response_payload(dest_path: Path, url_prefix_type: str) -> dict:
    """Build the API response dict for a saved/linked file."""
    if url_prefix_type == "assets":
        vault = get_p("VAULT")
        try:
            rel = str(dest_path.relative_to(vault)).replace("\\", "/")
        except ValueError:
            rel = str(dest_path)
        # Strip leading "Assets/" to build the /api/vault/assets/ URL
        if rel.startswith("Assets/"):
            url = f"/api/vault/assets/{rel[len('Assets/'):]}"
        else:
            url = f"/api/vault/assets/{rel}"
        return {"path": rel, "url": url, "storage": "assets"}
    else:
        # Absolute path — returned as-is so the frontend can display the filename
        return {"path": str(dest_path), "url": None, "storage": "absolute"}


@router.post("/upload-property-file", dependencies=[Depends(require_role("editor"))])
async def upload_property_file(
    table_id: str = Query(...),
    property_name: str = Query(...),
    storage_folder: str = Query(default="assets"),
    target_name: str = Query(default=""),
    file: UploadFile = File(...),
):
    """Upload a file for a property. Routes to Assets/, Biblioteca/ or a free path
    depending on the storage_folder parameter (assets | biblioteca | free).

    `target_name` (opcional): nom base ja interpolat des del patró del camp
    (p. ex. "Autors - Any - Títol"). Si ve informat, el fitxer es desa amb
    aquest nom (sanititzat) + l'extensió original."""
    registry = load_registry()
    table, database = _resolve_table_and_database_for_assets(table_id, registry)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    property_clean = str(property_name or "").strip()
    if not property_clean:
        raise HTTPException(status_code=400, detail="property_name is mandatory")

    # El destí (storage_folder) és autoritatiu des de la config de la property al
    # registry, no del query param: el frontend pot enviar-lo desfasat (sessió amb
    # esquema en memòria antic, camins d'upload divergents...) i això feia que un
    # camp configurat a 'biblioteca' acabés desant a Assets. Si la property no en
    # té cap de configurat, caiem al valor del query param.
    target_prop = _find_table_property(table, property_clean)
    configured_storage = str(_property_config_value(target_prop, "storage_folder") or "").strip()
    effective_storage = configured_storage or storage_folder

    target_dir, url_type = _resolve_storage_dir(effective_storage, table, database, property_clean)
    try:
        dest_path = Path(_save_uploaded_file_to_dir(file, target_dir, target_name))
    except Exception as e:
        log.error(f"Error uploading property file: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")

    return _file_response_payload(dest_path, url_type)


def _save_uploaded_file_to_dir(upload: UploadFile, target_dir: Path, target_name: str = "") -> Path:
    """Save an UploadFile to target_dir and return the absolute destination path.

    Si `target_name` (patró de nom ja interpolat) ve informat, s'usa com a
    base del nom (sanititzada) en comptes del nom original del fitxer.
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    ext = Path(original_name).suffix
    if target_name and target_name.strip():
        stem = _sanitize_filename_base(target_name.strip())
    else:
        stem = _sanitize_asset_segment(Path(original_name).stem, "upload")
    destination = target_dir / f"{stem}{ext}"
    if destination.exists():
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    with open(destination, "wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)
    return destination


@router.post("/link-existing-file", dependencies=[Depends(require_role("editor"))])
async def link_existing_file(body: dict):
    """Variant B: register an existing local file path without copying it.

    Body: { "file_path": "/absolute/path/to/file.pdf", "target_name": "..." }
    Returns the path and a display name.

    Si `target_name` (patró de nom ja interpolat) ve informat, el fitxer es
    REANOMENA al disc dins la mateixa carpeta (estil Zotero), preservant
    l'extensió i evitant col·lisions. Avís: si el fitxer és un linked
    attachment de Zotero, reanomenar-lo en trencarà l'enllaç a Zotero.
    """
    file_path = str(body.get("file_path", "")).strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path is mandatory")

    p = Path(file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    if not p.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    target_name = str(body.get("target_name", "")).strip()
    if target_name:
        new_stem = _sanitize_filename_base(target_name)
        ext = p.suffix
        desired = p.parent / f"{new_stem}{ext}"
        if desired != p:
            if desired.exists():
                i = 2
                cand = p.parent / f"{new_stem}-{i}{ext}"
                while cand.exists():
                    i += 1
                    cand = p.parent / f"{new_stem}-{i}{ext}"
                desired = cand
            try:
                p.rename(desired)
                p = desired
            except OSError as e:
                raise HTTPException(
                    status_code=500, detail=f"Could not rename file: {e}"
                )

    return {
        "path": str(p),
        "url": None,
        "storage": "absolute",
        "name": p.name,
        "size": p.stat().st_size,
    }


@router.post("/delete-physical-file", dependencies=[Depends(require_role("editor"))])
async def delete_physical_file(body: dict):
    """Elimina el fitxer físic referenciat per `target` (no toca cap pàgina).

    `target` és el valor desat al camp `files`: `file://…`,
    `/api/vault/local-file/<token>[/nom]`, `/api/vault/assets/<rel>` o `Assets/<rel>`.

    - Fitxers sota HOME (OneDrive/Biblioteca, via file:// o token): es deleguen al
      host_open_helper, que els mou a la PAPERERA del Mac (recuperable). El mount
      de HOME al contenidor és read-only, així que el backend no els pot esborrar.
    - Fitxers d'Assets (dins el vault, rw): s'esborren al contenidor (permanent).

    Contenció: només sota HOME del host o sota Assets del vault. Mai fora.
    """
    target = str(body.get("target", "")).strip()
    if not target:
        raise HTTPException(status_code=400, detail="target is mandatory")

    home = Path(os.environ.get("HOME_HOST_PATH") or str(Path.home())).resolve()
    token_to_clear: Optional[str] = None
    host_path: Optional[Path] = None
    vault_path: Optional[Path] = None

    m = re.match(r"^/api/vault/local-file/([^/]+)", target)
    if m:
        token = m.group(1)
        with _LOCAL_LINKS_LOCK:
            abs_path = _load_local_links().get(token)
        if not abs_path:
            raise HTTPException(status_code=404, detail="Local file token not found")
        host_path = Path(abs_path)
        token_to_clear = token
    elif target.lower().startswith("file://"):
        host_path = Path(urllib.parse.unquote(target[7:]))
    elif target.startswith("/api/vault/assets/"):
        vault_path = (get_p("VAULT").resolve() / "Assets" / target[len("/api/vault/assets/"):])
    elif target.startswith("Assets/"):
        vault_path = get_p("VAULT").resolve() / target
    elif target.startswith("/"):
        host_path = Path(target)
    else:
        vault_path = get_p("VAULT").resolve() / target

    # --- Fitxer sota HOME → Paperera del Mac via host helper (recuperable) ---
    if host_path is not None:
        try:
            resolved = host_path.expanduser().resolve()
        except OSError:
            raise HTTPException(status_code=400, detail="Invalid path")
        try:
            resolved.relative_to(home)
        except ValueError:
            raise HTTPException(status_code=403, detail="Refusing to delete a path outside HOME")
        if not resolved.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {resolved.name}")
        ok, detail = _try_host_trash_helper(str(resolved))
        if not ok:
            raise HTTPException(status_code=502, detail=f"No s'ha pogut moure a la Paperera: {detail}")
        if token_to_clear:
            with _LOCAL_LINKS_LOCK:
                mapping = _load_local_links()
                if token_to_clear in mapping:
                    del mapping[token_to_clear]
                    _save_local_links(mapping)
        return {"status": "trashed", "method": "macos_trash", "target": str(resolved)}

    # --- Fitxer d'Assets (vault rw) → esborrat al contenidor (permanent) ---
    assets_root = (get_p("VAULT").resolve() / "Assets").resolve()
    try:
        resolved = vault_path.resolve()
        resolved.relative_to(assets_root)
    except (ValueError, AttributeError, OSError):
        raise HTTPException(status_code=400, detail="Path no és sota Assets ni sota HOME")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        resolved.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not delete: {e}")
    return {"status": "deleted", "method": "vault_unlink", "target": str(resolved)}


def _run_osascript_picker(script: str) -> str:
    """Helper sync per usar amb asyncio.to_thread."""
    import subprocess
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=60,
    )
    return result.stdout.strip()


@router.post("/pick-folder", dependencies=[Depends(require_role("editor"))])
async def pick_folder():
    """Open a native macOS folder-picker dialog and return the chosen path."""
    import asyncio as _asyncio
    import subprocess
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosen to choose folder with prompt "Selecciona la carpeta de destinació"\n'
        'return POSIX path of chosen'
    )
    try:
        # subprocess.run amb timeout=60 dins un endpoint async bloqueja
        # tot l'event loop fins a 1 minut mentre l'usuari pensa al diàleg
        # del Finder. Off-thread per servir altres requests en paral·lel.
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise HTTPException(status_code=204, detail="No folder selected")
        return {"path": chosen}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder picker timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /pick-folder"),
        )


@router.post("/pick-file", dependencies=[Depends(require_role("editor"))])
async def pick_file():
    """Open a native macOS file-picker dialog and return the chosen file path."""
    import asyncio as _asyncio
    import subprocess
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosen to choose file with prompt "Selecciona el fitxer a enllaçar"\n'
        'return POSIX path of chosen'
    )
    try:
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise HTTPException(status_code=204, detail="No file selected")
        p = Path(chosen)
        return {"path": chosen, "name": p.name, "size": p.stat().st_size if p.exists() else 0}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="File picker timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /pick-file"),
        )


@router.get("/unsplash/search")
async def unsplash_search(query: str = Query(...), page: int = Query(1)):
    """Searches images on Unsplash acting as a proxy."""
    unsplash_key = os.getenv("UNSPLASH_ACCESS_KEY")
    if not unsplash_key:
        raise HTTPException(
            status_code=500,
            detail="Unsplash API Key is not configured in .env (UNSPLASH_ACCESS_KEY)",
        )

    url = "https://api.unsplash.com/search/photos"
    headers = {"Authorization": f"Client-ID {unsplash_key}"}
    params = {"query": query, "page": page, "per_page": 21, "orientation": "landscape"}

    try:
        # to_thread + explicit timeout. Without timeout, a stuck Unsplash
        # connection would block this async handler indefinitely (and via
        # the shared event loop, all concurrent requests with it).
        resp = await asyncio.to_thread(
            requests.get, url, headers=headers, params=params, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()

        results = []
        for img in data.get("results", []):
            results.append(
                {
                    "id": img["id"],
                    "url": img["urls"]["regular"],
                    "thumb": img["urls"]["small"],
                    "author": img["user"]["name"],
                    "author_url": img["user"]["links"]["html"],
                }
            )

        return {"results": results, "total_pages": data.get("total_pages", 1)}
    except Exception as e:
        log.error(f"Error fetching from Unsplash: {e}")
        raise HTTPException(status_code=502, detail="Error fetching from Unsplash API")


@router.post("/pages/{page_id}/duplicate", dependencies=[Depends(require_role("editor"))])
async def duplicate_page(page_id: str, background_tasks: BackgroundTasks):
    """Duplicates an existing page and returns the new ID."""
    source_path = find_page_path(page_id)

    if not source_path or not source_path.exists():
        raise HTTPException(
            status_code=404, detail="Source page not found (non-existent ID)"
        )

    try:
        if _is_dashboard_file_path(source_path):
            metadata, body = _read_dashboard_file(source_path)
        else:
            raw_content = source_path.read_text(encoding="utf-8")
            metadata, body = parse_frontmatter(raw_content, source_path)

        # Nou UUID i ajustos de metadata
        new_page_id = str(uuid.uuid4())
        new_metadata = metadata.copy()
        new_metadata["id"] = new_page_id

        # Add prefix "(Copy)" to the title
        old_title = metadata.get("title", "Untitled")
        new_title = f"{old_title} (Copy)"
        new_metadata["title"] = new_title

        # Copies are created in the same directory as the original
        if _is_dashboard_file_path(source_path):
            new_file_path = source_path.parent / f"{new_page_id}.json"
            _write_dashboard_file(
                file_path=new_file_path,
                page_id=new_page_id,
                title=new_title,
                metadata=new_metadata,
                content=body,
                parent_id=new_metadata.get("parent_id"),
                is_database=bool(new_metadata.get("is_database")),
            )
        else:
            new_file_path = source_path.parent / f"{new_page_id}.md"
            # Una còpia és un recurs nou: regenerem la clau perquè no
            # col·lisioni amb la de l'original (que l'índex de cites
            # ombrejaria, deixant un dels dos no resoluble).
            new_metadata = _ensure_recursos_citation_key(new_metadata, regenerate=True)
            save_page_md(new_file_path, new_metadata, body)

        background_tasks.add_task(
            trigger_n8n_webhook, new_file_path.name, "Universal", body
        )
        background_tasks.add_task(update_link_index_for_page, new_file_path)

        return {
            "status": "created",
            "id": new_page_id,
            "message": "Page duplicated",
            "title": new_title,
        }

    except Exception as e:
        log.error(f"Error duplicating page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error duplicating target file")


def trigger_n8n_webhook(filename: str, folder: str, content: str):
    """Sends a POST to n8n invisibly when a note is saved or created."""
    try:
        url = "http://n8n:5678/webhook/vault-update"
        payload = {
            "event": "note_saved",
            "folder": folder,
            "filename": filename,
            "content": content[:2000],  # Limit content text for lightness
        }
        requests.post(url, json=payload, timeout=2)
    except Exception as e:
        log.warning(f"Could not notify event to n8n: {e}")


# Cache TTL pel id_title_index: el fan servir /backlinks, /unlinked-mentions
# i /global-index, tots a la càrrega d'una pàgina. Reusem `_iter_linkable_page_documents`
# (que ja té cau pròpia) per construir-lo.
def build_id_title_index() -> Dict[str, str]:
    """Builds a global mapping page_id -> title for vault and dashboard."""
    index: Dict[str, str] = {}
    for file_path, metadata, _body, is_dashboard in _iter_linkable_page_documents():
        try:
            if is_dashboard:
                page_id = str(metadata.get("id") or file_path.stem)
            else:
                page_id = str(
                    metadata.get("id") or metadata.get("migration_id") or file_path.stem
                )
            title = str(metadata.get("title") or file_path.stem)
            index[page_id] = title
        except Exception as e:
            log.warning(f"Error indexant {file_path.name}: {e}")
    return index


# Cache amb TTL per `_iter_linkable_page_documents`. Cada crida iterava
# 3000+ fitxers al OneDrive (rglob + read_text + parse_frontmatter), trigant
# 30+ segons en muntatges lents. Els endpoints /backlinks i /unlinked-mentions
# es criden alhora al carregar una pàgina, doblant la càrrega i fent timeout
# al frontend (axios.defaults.timeout = 30s). Amb un TTL de 60s reusem la
# llista entre crides consecutives. Els backlinks queden lleugerament
# desactualitzats (60s) — acceptable pel cas d'ús.
_iter_docs_cache: dict = {"docs": None, "ts": 0.0}
_iter_docs_lock = threading.Lock()
_ITER_DOCS_TTL = 60.0

# Cache de bodies de markdown indexada per path → (mtime_ns, body). Indep del
# TTL de la llista: aquest cache només invalida quan el fitxer canvia. Així
# la primera invocació de /backlinks després del TTL no força rellegir 3988
# fitxers; només els que han canviat. Els fitxers nous (no cachejats) es
# llegeixen un cop i s'incorporen.
#
# **Persistència a disc**: aquest cache es desa periòdicament a
# `/app/data/cache/vault_body_cache.json` perquè al reiniciar el backend
# (i autoreloads en mode dev) no calgui rellegir ~3500 fitxers d'OneDrive
# per reconstruir-lo (cost mesurat: 80-140 s la primera vegada). Al
# startup, es carrega del disc i es validen els mtime per descartar
# entries obsoletes ràpidament — sense haver de pagar el read.
_body_cache: Dict[str, tuple[int, str]] = {}
_body_cache_lock = threading.Lock()
_BODY_CACHE_PERSIST_PENDING = False
_BODY_CACHE_PERSIST_DEBOUNCE = 10.0  # segons
_body_cache_persist_lock = threading.Lock()


def _get_body_cache_path() -> Optional[Path]:
    """Path local on persistir el body cache. Mateix patró que page-index."""
    base = get_p("PAGE_INDEX_CACHE")
    if base:
        return base.parent / "vault_body_cache.json"
    return Path("/app/data/cache/vault_body_cache.json")


def _save_body_cache_to_disk() -> None:
    """Persisteix el body cache a disc. Crida sota lock per snapshot
    consistent. Mida típica: 3500 × ~3KB body = ~10MB JSON."""
    try:
        cache_path = _get_body_cache_path()
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with _body_cache_lock:
            payload = {
                path: {"mtime_ns": mt, "body": bd}
                for path, (mt, bd) in _body_cache.items()
            }
        safe_write_json(cache_path, payload, indent=None, ensure_ascii=False)
        log.info(f"💾 body-cache desat ({len(payload)} fitxers)")
    except Exception as e:
        log.warning(f"body-cache persist failed: {e}")


def _schedule_body_cache_persist() -> None:
    """Debounce persist: invalidacions puntuals disparen un save al disc
    com a màxim cada `_BODY_CACHE_PERSIST_DEBOUNCE` segons."""
    global _BODY_CACHE_PERSIST_PENDING
    with _body_cache_persist_lock:
        if _BODY_CACHE_PERSIST_PENDING:
            return
        _BODY_CACHE_PERSIST_PENDING = True

    def _run():
        global _BODY_CACHE_PERSIST_PENDING
        time.sleep(_BODY_CACHE_PERSIST_DEBOUNCE)
        try:
            _save_body_cache_to_disk()
        except Exception:
            pass
        finally:
            with _body_cache_persist_lock:
                _BODY_CACHE_PERSIST_PENDING = False

    threading.Thread(target=_run, daemon=True, name="body-cache-persist").start()


def _load_body_cache_from_disk() -> bool:
    """Carrega el body cache desat. Retorna True si ha estat útil. No
    valida els mtime aquí — això es fa al `_get_body_for_path` per cada
    entry consultada (cost amortitzat)."""
    try:
        cache_path = _get_body_cache_path()
        if not cache_path or not cache_path.exists():
            return False
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        with _body_cache_lock:
            _body_cache.clear()
            for path, val in data.items():
                if isinstance(val, dict):
                    mt = val.get("mtime_ns") or 0
                    bd = val.get("body") or ""
                    if mt and bd:
                        _body_cache[path] = (mt, bd)
        log.info(f"📂 body-cache carregat del disc ({len(_body_cache)} fitxers)")
        return True
    except Exception as e:
        log.warning(f"body-cache load failed: {e}")
        return False

# TTL del check d'stale paths a `_get_pages_snapshot`. Cada `Path.exists()`
# al OneDrive triga ~10ms — multiplicar per 3988 entries dóna 40s. Limitem a
# fer aquest cleanup només cada 10 min: amb 30s, les recàrregues consecutives
# de feeds embebuts disparen 4000 stat() cada vegada que el feed re-renderitza
# (cada navegació entre vistes). 10 min és més que suficient: els fitxers
# desapareixen rarament fora del propi flux de l'app, i el codi de
# `find_page_path` ja invalida entrades stale individualment quan les detecta.
_last_stale_check: dict = {"ts": 0.0}
_STALE_CHECK_TTL = 600.0


def _get_body_for_path(file_path: Path) -> str:
    """Retorna el body d'un .md aprofitant cache amb invalidació per mtime.

    Iterem TOTS els .md del Vault per a /backlinks i /unlinked-mentions.
    NO fem retry per Errno 35: amb 3988 fitxers, si N retornen deadlock
    en paral·lel, fer retry × N empitjora dramàticament l'iteració (60+
    segons enlloc de 5). Saltem el fitxer; la propera invocació de
    /backlinks (TTL expirat) tornarà a intentar i agafarà els que faltaven.
    Si un fitxer falla repetidament, els seus backlinks queden fora del
    resultat — degradació gradual acceptable.
    """
    path_str = str(file_path)
    try:
        mtime_ns = file_path.stat().st_mtime_ns
    except OSError:
        return ""

    with _body_cache_lock:
        cached = _body_cache.get(path_str)
        if cached and cached[0] == mtime_ns:
            return cached[1]

    try:
        raw_content = file_path.read_text(encoding="utf-8")
    except OSError as e:
        if e.errno == 35:
            # Errno 35 (deadlock) silenciós — log.debug en lloc de warning
            # per no saturar logs amb 3988 missatges quan OneDrive sync.
            log.debug(f"Body skip (Errno 35): {file_path.name}")
        else:
            log.warning(f"Error reading body of {file_path.name}: {e}")
        return ""
    except Exception as e:
        log.warning(f"Error reading body of {file_path.name}: {e}")
        return ""

    with _body_cache_lock:
        _body_cache[path_str] = (mtime_ns, raw_content)
    _schedule_body_cache_persist()
    return raw_content


def _iter_linkable_page_documents() -> List[tuple[Path, Dict[str, Any], str, bool]]:
    """Yields page documents as (path, metadata, body, is_dashboard).

    Cached per `_ITER_DOCS_TTL` seconds. Quan la cache de la llista expira,
    els bodies individuals no es rellegeixen si el seu mtime no ha canviat
    (vegeu `_get_body_for_path`). Així la 2a/3a/Nª invocació és O(stat()) per
    fitxer en lloc d'O(read).
    """
    now = time.time()
    cached = _iter_docs_cache.get("docs")
    cached_ts = _iter_docs_cache.get("ts", 0.0)
    if cached is not None and (now - cached_ts) < _ITER_DOCS_TTL:
        return cached

    with _iter_docs_lock:
        # Re-check sota lock per evitar dues construccions concurrents
        cached = _iter_docs_cache.get("docs")
        cached_ts = _iter_docs_cache.get("ts", 0.0)
        if cached is not None and (time.time() - cached_ts) < _ITER_DOCS_TTL:
            return cached

        docs: List[tuple[Path, Dict[str, Any], str, bool]] = []

        # Usem PathResolver (cache pre-warmed al startup) per la llista de
        # fitxers, evitant rglob lent al OneDrive. Si la cache encara no està
        # llesta, list_all_files fa fallback a rglob.
        vault_path = get_p("VAULT")
        if vault_path and vault_path.exists():
            try:
                from backend.services.path_resolver import path_resolver
                all_files = path_resolver.list_all_files(vault_path)
            except Exception:
                all_files = list(vault_path.rglob("*.md"))

            for file_path in all_files:
                if ".history" in file_path.parts:
                    continue
                try:
                    raw_content = _get_body_for_path(file_path)
                    if not raw_content:
                        continue
                    metadata, body = parse_frontmatter(raw_content, file_path)
                    docs.append((file_path, metadata, body, False))
                except Exception as e:
                    log.warning(f"Error parsing linkable page {file_path.name}: {e}")

        if get_p("DASHBOARDS") and get_p("DASHBOARDS").exists():
            for file_path in get_p("DASHBOARDS").rglob("*.json"):
                try:
                    metadata, body = _read_dashboard_file(file_path)
                    docs.append((file_path, metadata, body, True))
                except Exception as e:
                    log.warning(f"Error parsing dashboard page {file_path.name}: {e}")

        _iter_docs_cache["docs"] = docs
        _iter_docs_cache["ts"] = time.time()
        return docs


# ── Índex invers de wikilinks/backlinks (in-memory) ─────────────────────────
# Veure: docs/dev_memory/directives/wiki_inverse_link_index.md
#
# Motivació: /backlinks i /unlinked-mentions iteraven 4000 fitxers a cada
# crida. Encara amb body cache, la regex per source × N fitxers feia que la
# càrrega d'una pàgina trigués 30-60s la primera vegada. Amb aquest índex,
# /backlinks és O(lookup) i /unlinked-mentions filtra a ~10-100 candidats.
_outlinks_by_source: Dict[str, set] = {}
_backlinks_by_target: Dict[str, List[Dict[str, str]]] = {}
_backlinks_by_target_title: Dict[str, List[Dict[str, str]]] = {}
_tokens_by_source: Dict[str, frozenset] = {}
_page_meta_by_id: Dict[str, Dict[str, Any]] = {}
_link_index_lock = threading.RLock()
_link_index_built = False
_link_index_build_ts = 0.0
_link_index_source_count = 0
_LINK_INDEX_SCHEMA_VERSION = 1


_WIKILINK_RE = re.compile(r"!?\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|.*?)?\]\]")
_MDLINK_RE = re.compile(r"\[.*?\]\((.*?)\)")
_TOKEN_SPLIT_RE = re.compile(r"[^\wÀ-ÿ]+", re.UNICODE)


def _get_link_index_cache_path() -> Optional[Path]:
    p = get_p("LINK_INDEX_CACHE")
    if p:
        return p
    return Path("/app/data/cache/vault_link_index.json")


def _save_link_index_to_disk() -> None:
    """Persisteix l'índex invers al disc local. Crida sota lock per snapshot
    consistent. Format: JSON amb schema_version per migracions futures.
    """
    try:
        cache_path = _get_link_index_cache_path()
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with _link_index_lock:
            payload = {
                "schema_version": _LINK_INDEX_SCHEMA_VERSION,
                "built_ts": _link_index_build_ts,
                "outlinks": {pid: sorted(refs) for pid, refs in _outlinks_by_source.items()},
                "tokens": {pid: sorted(toks) for pid, toks in _tokens_by_source.items()},
                "meta": dict(_page_meta_by_id),
            }
        safe_write_json(cache_path, payload, indent=None, ensure_ascii=False)
        log.info(f"💾 link-index cache saved ({len(payload['meta'])} pàgines)")
    except Exception as e:
        log.error(f"❌ Error saving link-index cache: {e}")


def _load_link_index_from_disk() -> bool:
    """Carrega l'índex invers desat al disc. Retorna True si ha tingut èxit.
    Si el schema_version no coincideix, ignora el cache.
    """
    global _link_index_built, _link_index_build_ts, _link_index_source_count
    try:
        cache_path = _get_link_index_cache_path()
        if not cache_path or not cache_path.exists():
            return False
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        if data.get("schema_version") != _LINK_INDEX_SCHEMA_VERSION:
            log.info("link-index cache schema mismatch — ignorant")
            return False
        outlinks_raw = data.get("outlinks") or {}
        tokens_raw = data.get("tokens") or {}
        meta_raw = data.get("meta") or {}

        with _link_index_lock:
            _outlinks_by_source.clear()
            for pid, refs in outlinks_raw.items():
                _outlinks_by_source[pid] = set(refs)
            _tokens_by_source.clear()
            for pid, toks in tokens_raw.items():
                _tokens_by_source[pid] = frozenset(toks)
            _page_meta_by_id.clear()
            _page_meta_by_id.update(meta_raw)
            _rebuild_backlinks_invertion_locked()
            _link_index_built = True
            _link_index_build_ts = float(data.get("built_ts") or time.time())
            _link_index_source_count = len(_page_meta_by_id)

        log.info(f"📂 link-index loaded from disk ({_link_index_source_count} pàgines)")
        return True
    except Exception as e:
        log.error(f"❌ Error loading link-index cache: {e}")
        return False


def _normalize_ref_for_index(raw_ref: str) -> str:
    text = str(raw_ref or "").strip()
    if not text:
        return ""
    try:
        text = urllib.parse.unquote(text)
    except Exception:
        pass
    base = text.split("#", 1)[0].strip()
    vault_page_match = re.search(
        r"(?:https?://[^/]+)?/(?:api/)?vault/(?:page|pages)/([^/?#]+)",
        base,
        re.IGNORECASE,
    )
    if vault_page_match and vault_page_match.group(1):
        try:
            base = urllib.parse.unquote(vault_page_match.group(1).strip())
        except Exception:
            base = vault_page_match.group(1).strip()
    return base


def _extract_outlinks_from_doc(metadata: Dict[str, Any], body: str) -> set:
    """Returns a set of normalized refs (page_id or lowercased title) that this
    document links to. Includes wikilinks `[[X]]`, MD links `[..](X)` and
    metadata fields that look like ID references.
    """
    refs: set = set()

    def _add(value: Any):
        if value is None:
            return
        if isinstance(value, list):
            for item in value:
                _add(item)
            return
        text = str(value).strip()
        if not text:
            return
        norm = _normalize_ref_for_index(text)
        if norm:
            refs.add(norm)
            refs.add(norm.lower())

    for val in metadata.values():
        if isinstance(val, (str, list)):
            _add(val)

    if body:
        for raw in _WIKILINK_RE.findall(body):
            base = str(raw or "").split("#", 1)[0].strip()
            if base:
                refs.add(base)
                refs.add(base.lower())
        for raw in _MDLINK_RE.findall(body):
            norm = _normalize_ref_for_index(raw)
            if norm:
                refs.add(norm)
                refs.add(norm.lower())

    return refs


def _tokenize_body_for_mentions(body: str) -> frozenset:
    """Tokens normalitzats del body sanititzat (sense links existents).
    Usat com a pre-filtre per /unlinked-mentions.
    """
    if not body:
        return frozenset()
    sanitized = _strip_existing_links_for_mentions_scan(body)
    tokens = _TOKEN_SPLIT_RE.split(sanitized.lower())
    return frozenset(t for t in tokens if len(t) >= 2)


def _resolve_page_id_from_metadata(metadata: Dict[str, Any], file_path: Path) -> str:
    return str(
        metadata.get("id")
        or metadata.get("migration_id")
        or file_path.stem
    ).strip()


def _rebuild_backlinks_invertion_locked():
    """Reconstrueix `_backlinks_by_target` i `_backlinks_by_target_title` a
    partir de `_outlinks_by_source` i `_page_meta_by_id`. Cal el lock pres.
    """
    by_target: Dict[str, List[Dict[str, str]]] = {}
    by_title: Dict[str, List[Dict[str, str]]] = {}
    title_to_ids: Dict[str, set] = {}
    for pid, meta in _page_meta_by_id.items():
        title = str(meta.get("title") or "").strip().lower()
        if title:
            title_to_ids.setdefault(title, set()).add(pid)

    for source_id, refs in _outlinks_by_source.items():
        source_meta = _page_meta_by_id.get(source_id) or {}
        source_title = source_meta.get("title") or source_id
        seen_targets: set = set()
        for raw in refs:
            ref_lower = raw.lower()
            target_ids = set()
            if raw in _page_meta_by_id:
                target_ids.add(raw)
            for tid in title_to_ids.get(ref_lower, ()):  # match per title
                target_ids.add(tid)

            for tid in target_ids:
                if tid == source_id or tid in seen_targets:
                    continue
                seen_targets.add(tid)
                by_target.setdefault(tid, []).append(
                    {"id": source_id, "title": str(source_title)}
                )
            if not target_ids:
                by_title.setdefault(ref_lower, []).append(
                    {"id": source_id, "title": str(source_title)}
                )

    _backlinks_by_target.clear()
    _backlinks_by_target.update(by_target)
    _backlinks_by_target_title.clear()
    _backlinks_by_target_title.update(by_title)


def _rebuild_link_index(persist: bool = True) -> None:
    """Reconstrueix l'índex invers de zero. Operació O(N) sobre el vault.

    Idempotent: pot cridar-se múltiples vegades. Pren el lock global per evitar
    races amb invalidacions parcials concurrents. Si `persist=True`, desa el
    resultat a disc per accelerar arrencades futures.
    """
    global _link_index_built, _link_index_build_ts, _link_index_source_count
    started = time.time()
    docs = _iter_linkable_page_documents()

    new_outlinks: Dict[str, set] = {}
    new_tokens: Dict[str, frozenset] = {}
    new_meta: Dict[str, Dict[str, Any]] = {}

    for file_path, metadata, body, _is_dashboard in docs:
        try:
            pid = _resolve_page_id_from_metadata(metadata, file_path)
            if not pid:
                continue
            new_outlinks[pid] = _extract_outlinks_from_doc(metadata, body)
            new_tokens[pid] = _tokenize_body_for_mentions(body)
            new_meta[pid] = {
                "title": str(metadata.get("title") or file_path.stem),
                "path": str(file_path),
            }
        except Exception as e:
            log.warning(f"link-index: error indexing {file_path.name}: {e}")

    with _link_index_lock:
        _outlinks_by_source.clear()
        _outlinks_by_source.update(new_outlinks)
        _tokens_by_source.clear()
        _tokens_by_source.update(new_tokens)
        _page_meta_by_id.clear()
        _page_meta_by_id.update(new_meta)
        _rebuild_backlinks_invertion_locked()
        _link_index_built = True
        _link_index_build_ts = time.time()
        _link_index_source_count = len(new_meta)

    log.info(
        f"🔗 link-index built in {time.time() - started:.2f}s "
        f"({len(new_meta)} pàgines)"
    )

    if persist:
        try:
            _save_link_index_to_disk()
        except Exception as e:
            log.warning(f"link-index persist after rebuild failed: {e}")


# Debounced persist: invalidacions puntuals (writes) disparen un save al disc,
# però fer-ho sincrònicament a cada PUT seria costós. Acumulem i desem com a
# màxim cada N segons des d'un thread separat.
_link_index_persist_pending = False
_link_index_persist_lock = threading.Lock()
_LINK_INDEX_PERSIST_DEBOUNCE = 5.0  # segons


def _schedule_link_index_persist() -> None:
    global _link_index_persist_pending
    with _link_index_persist_lock:
        if _link_index_persist_pending:
            return
        _link_index_persist_pending = True

    def _run():
        global _link_index_persist_pending
        time.sleep(_LINK_INDEX_PERSIST_DEBOUNCE)
        try:
            _save_link_index_to_disk()
        except Exception as e:
            log.debug(f"link-index debounced persist failed: {e}")
        finally:
            with _link_index_persist_lock:
                _link_index_persist_pending = False

    t = threading.Thread(target=_run, daemon=True, name="link-index-persist")
    t.start()


_link_index_rebuild_in_progress = False
_link_index_rebuild_state_lock = threading.Lock()


def kickoff_link_index_rebuild() -> None:
    """Llança el rebuild en background. Safe to call multiple times: si
    n'hi ha un en marxa, no en llança un altre. Sense aquest guard, dues
    crides simultànies (p.ex. indexer warmup + endpoint que necessita
    backlinks) feien dos `_rebuild_link_index` concurrents que iteraven
    cada un 3500+ fitxers d'OneDrive en paral·lel, saturant el File
    Provider i bloquejant altres operacions del backend (PATCH inclosos)
    durant minuts.

    Si hi ha cache a disc vàlid, es carrega de seguida (síncron, milisegons)
    per servir resultats ràpids des del primer instant; després dispara un
    rebuild en background per reflectir canvis externs (sync OneDrive, etc.)
    """
    if not _link_index_built:
        try:
            _load_link_index_from_disk()
        except Exception as e:
            log.warning(f"link-index disk load failed: {e}")

    # Skip rebuild si el cache disc és recent (<30 min). Sense aquest
    # check, cada reload del backend dispara un rebuild O(N reads OneDrive)
    # que triga 80-140 s i satura el File Provider, encara que el cache que
    # acabem de carregar de disc ja sigui correcte. Els canvis individuals
    # de pàgines es propaguen via `update_link_index_for_page` (background
    # task del PATCH/PUT); el rebuild complet només cal per assolir canvis
    # externs (sync OneDrive d'un altre dispositiu, edicions fora del
    # backend). Un cop cada 30 min és més que suficient per a aquest cas.
    if _link_index_build_ts and (time.time() - _link_index_build_ts) < 1800:
        log.info(
            f"🔗 link-index rebuild skipped: cache de fa "
            f"{int(time.time() - _link_index_build_ts)}s (<1800s)"
        )
        return

    global _link_index_rebuild_in_progress
    with _link_index_rebuild_state_lock:
        if _link_index_rebuild_in_progress:
            return
        _link_index_rebuild_in_progress = True

    def _run():
        global _link_index_rebuild_in_progress
        try:
            _rebuild_link_index(persist=True)
        except Exception as e:
            log.error(f"link-index rebuild failed: {e}")
        finally:
            with _link_index_rebuild_state_lock:
                _link_index_rebuild_in_progress = False

    t = threading.Thread(target=_run, daemon=True, name="link-index-rebuild")
    t.start()


def update_link_index_for_page(file_path: Path) -> None:
    """Actualitza l'índex per una pàgina concreta (després d'un write).

    No bloqueja: si l'índex encara no està construït, ignora la crida (el
    rebuild inicial recollirà la pàgina).
    """
    if not _link_index_built:
        return
    if not file_path or not file_path.exists():
        return
    try:
        if _is_dashboard_file_path(file_path):
            metadata, body = _read_dashboard_file(file_path)
        else:
            raw = _get_body_for_path(file_path)
            if not raw:
                return
            metadata, body = parse_frontmatter(raw, file_path)
    except Exception as e:
        log.debug(f"link-index update skip {file_path.name}: {e}")
        return

    pid = _resolve_page_id_from_metadata(metadata, file_path)
    if not pid:
        return
    new_refs = _extract_outlinks_from_doc(metadata, body)
    new_tokens = _tokenize_body_for_mentions(body)
    new_title = str(metadata.get("title") or file_path.stem)

    with _link_index_lock:
        old_meta = _page_meta_by_id.get(pid) or {}
        old_title = str(old_meta.get("title") or "").strip().lower()
        _outlinks_by_source[pid] = new_refs
        _tokens_by_source[pid] = new_tokens
        _page_meta_by_id[pid] = {"title": new_title, "path": str(file_path)}
        # Si el títol del source ha canviat, el text mostrat als backlinks
        # canvia → cal reinvertir totalment. Si no, ho fem igualment perquè és
        # més simple i correcte; el cost és O(N_refs).
        _ = old_title  # reservat per optimitzacions futures
        _rebuild_backlinks_invertion_locked()

    # Re-link automàtic: si aquesta pàgina té un title que coincideix amb refs
    # no resoltes d'altres pàgines, els backlinks ja s'han actualitzat per
    # l'invertion (que mira `_page_meta_by_id`). No cal acció extra perquè el
    # rebuild_backlinks recorre tots els outlinks i resol per id i per títol.

    _schedule_link_index_persist()


def remove_from_link_index(page_id: str) -> None:
    """Elimina una pàgina de l'índex (després d'un DELETE)."""
    if not _link_index_built or not page_id:
        return
    pid = str(page_id).strip()
    with _link_index_lock:
        _outlinks_by_source.pop(pid, None)
        _tokens_by_source.pop(pid, None)
        _page_meta_by_id.pop(pid, None)
        _rebuild_backlinks_invertion_locked()
    _schedule_link_index_persist()


def rewrite_wikilinks_on_title_change(
    target_id: str, old_title: str, new_title: str
) -> int:
    """Reescriu els wikilinks per títol literal quan el target canvia de títol.

    Patrons modificats (match case-insensitive del títol, preservant àlies i secció):
      - `[[Old Title]]`               → `[[New Title]]`
      - `[[Old Title|alias]]`         → `[[New Title|alias]]`
      - `[[Old Title#Section]]`       → `[[New Title#Section]]`
      - `[[Old Title#Section|alias]]` → `[[New Title#Section|alias]]`

    No toca wikilinks per UUID (`[[uuid|...]]`) ni transclusions (`![[...]]`)
    perquè continuen funcionant sense canvis. Només reescriu fitxers que
    referencien el target via _backlinks_by_target / _backlinks_by_target_title.

    Retorna el nombre de fitxers efectivament modificats. Crida segura per
    invocar des d'un BackgroundTask: si l'índex no està construït o no hi ha
    backlinks, retorna 0 sense fer res.
    """
    old_clean = str(old_title or "").strip()
    new_clean = str(new_title or "").strip()
    if not old_clean or not new_clean or old_clean == new_clean:
        return 0
    if not _link_index_built:
        return 0
    tid = str(target_id or "").strip()
    if not tid:
        return 0

    # Recopilar candidats: pàgines que referencien per id resolt o per
    # títol antic literal. Deduplicate per source id.
    with _link_index_lock:
        by_id = list(_backlinks_by_target.get(tid, []))
        by_title = list(_backlinks_by_target_title.get(old_clean.lower(), []))
        page_meta_snapshot = dict(_page_meta_by_id)

    seen: set = set()
    candidates: List[Dict[str, str]] = []
    for src in by_id + by_title:
        sid = (src.get("id") or "").strip()
        if not sid or sid == tid or sid in seen:
            continue
        seen.add(sid)
        candidates.append(src)

    if not candidates:
        return 0

    # Pattern: [[ TitolAntic (#section)? (|alias)? ]]
    # Important: el match del cos exclou `|` i `[` i `]` per no creuar
    # límits de wikilinks; i exclou `#` per separar la secció (capturada
    # com a grup independent).
    escaped = re.escape(old_clean)
    pattern = re.compile(
        r"(?P<open>!?\[\[)\s*"
        + escaped
        + r"\s*(?P<section>#[^\]\|]+)?(?P<alias>\|[^\]]+)?(?P<close>\]\])",
        re.IGNORECASE,
    )

    def _replace(m: re.Match) -> str:
        section = m.group("section") or ""
        alias = m.group("alias") or ""
        return f"{m.group('open')}{new_clean}{section}{alias}{m.group('close')}"

    modified_count = 0
    for source in candidates:
        sid = source.get("id")
        if not sid:
            continue
        meta = page_meta_snapshot.get(sid) or {}
        path_str = meta.get("path") or source.get("path")
        if not path_str:
            continue
        path = Path(path_str)
        if not path.exists():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as e:
            log.warning(f"🔁 rewrite skip {path.name}: {e}")
            continue
        new_raw, n_subs = pattern.subn(_replace, raw)
        if n_subs == 0 or new_raw == raw:
            continue
        try:
            safe_write_text(path, new_raw)
            modified_count += 1
            # Actualitza l'índex per aquesta source perquè els outlinks/tokens
            # reflecteixin el text nou. update_link_index_for_page és segur
            # de cridar dins el mateix lock RLock (és re-entrant).
            update_link_index_for_page(path)
            log.debug(
                f"🔁 rewrote {n_subs} wikilink(s) in {path.name}: "
                f"'{old_clean}' → '{new_clean}'"
            )
        except Exception as e:
            log.warning(f"🔁 rewrite write fail {path.name}: {e}")
            continue

    if modified_count > 0:
        log.info(
            f"🔁 Rewrote wikilinks: '{old_clean}' → '{new_clean}' "
            f"on {modified_count}/{len(candidates)} source pages"
        )

    return modified_count


@router.get("/global-index")
def get_global_index():
    """Returns a global mapping id -> title for the entire Vault.

    Declared as `def` (not `async def`) so FastAPI runs it in a threadpool —
    `build_id_title_index` rglobs the whole vault on OneDrive and reads many
    files; running on the asyncio loop would block all concurrent requests.
    Same rationale as /backlinks and /unlinked-mentions below.
    """
    return build_id_title_index()


@router.get("/link-index/stats")
def get_link_index_stats():
    """Estat de l'índex invers de wikilinks (debug/observability).

    Veure: docs/dev_memory/directives/wiki_inverse_link_index.md
    """
    with _link_index_lock:
        targets_with_backlinks = len(_backlinks_by_target)
        unresolved_titles = len(_backlinks_by_target_title)
        total_outlinks = sum(len(refs) for refs in _outlinks_by_source.values())
        total_tokens = sum(len(toks) for toks in _tokens_by_source.values())
        built_ts = _link_index_build_ts
        sources = _link_index_source_count

    cache_path = _get_link_index_cache_path()
    cache_exists = bool(cache_path and cache_path.exists())
    cache_size = cache_path.stat().st_size if cache_exists else 0

    return {
        "built": _link_index_built,
        "built_ts": built_ts,
        "built_age_seconds": (time.time() - built_ts) if built_ts else None,
        "schema_version": _LINK_INDEX_SCHEMA_VERSION,
        "sources_indexed": sources,
        "targets_with_backlinks": targets_with_backlinks,
        "unresolved_title_buckets": unresolved_titles,
        "total_outlinks": total_outlinks,
        "total_tokens": total_tokens,
        "disk_cache": {
            "path": str(cache_path) if cache_path else None,
            "exists": cache_exists,
            "size_bytes": cache_size,
        },
    }


@router.post("/link-index/rebuild", dependencies=[Depends(require_role("admin"))])
def post_link_index_rebuild():
    """Força un rebuild complet de l'índex invers en background.

    Útil després d'edicions massives externes (sync OneDrive, scripts
    d'importació) que no han passat pels endpoints d'escriptura del backend.
    """
    kickoff_link_index_rebuild()
    return {"status": "rebuild_scheduled"}


@router.get("/backlinks")
def get_backlinks(id: str):
    """Finds all notes linking to a specific ID (both in metadata and body).

    Fast path: lookup directe a l'índex invers in-memory (`_backlinks_by_target`).
    Fallback: si l'índex encara no està construït (startup), recorre tot el
    vault com abans. Veure: docs/dev_memory/directives/wiki_inverse_link_index.md
    """
    target_id = str(id or "").strip()
    if not target_id:
        return []

    # Fast path: índex invers in-memory
    if _link_index_built:
        with _link_index_lock:
            target_title = str(
                (_page_meta_by_id.get(target_id) or {}).get("title") or ""
            ).strip().lower()
            results = list(_backlinks_by_target.get(target_id, []))
            if target_title:
                # També incloem refs no resoltes que apuntaven al títol
                seen_ids = {item["id"] for item in results}
                for item in _backlinks_by_target_title.get(target_title, []):
                    if item["id"] not in seen_ids and item["id"] != target_id:
                        seen_ids.add(item["id"])
                        results.append(item)
        return sorted(results, key=lambda x: str(x.get("title") or ""))

    # Fallback (índex no construït): codi original
    backlinks = []
    seen_backlink_ids: set[str] = set()
    id_title_index = build_id_title_index()
    target_title = str(id_title_index.get(target_id) or "").strip().lower()
    title_to_ids = {}
    for page_id, title in id_title_index.items():
        key = str(title or "").strip().lower()
        if not key:
            continue
        title_to_ids.setdefault(key, set()).add(str(page_id))

    def _candidate_targets_from_ref(raw_ref: str) -> set[str]:
        candidates: set[str] = set()
        text = str(raw_ref or "").strip()
        if not text:
            return candidates

        try:
            text = urllib.parse.unquote(text)
        except Exception:
            pass

        base = text.split("#", 1)[0].strip()
        if not base:
            return candidates

        candidates.add(base)

        vault_page_match = re.search(r"(?:https?://[^/]+)?/vault/page/([^/?#]+)", base, re.IGNORECASE)
        if vault_page_match and vault_page_match.group(1):
            try:
                candidates.add(urllib.parse.unquote(vault_page_match.group(1).strip()))
            except Exception:
                candidates.add(vault_page_match.group(1).strip())

        api_page_match = re.search(r"(?:https?://[^/]+)?/api/vault/pages/([^/?#]+)", base, re.IGNORECASE)
        if api_page_match and api_page_match.group(1):
            try:
                candidates.add(urllib.parse.unquote(api_page_match.group(1).strip()))
            except Exception:
                candidates.add(api_page_match.group(1).strip())

        lowered = base.lower()
        for matched_id in title_to_ids.get(lowered, set()):
            candidates.add(matched_id)

        return {c.strip() for c in candidates if str(c).strip()}

    def _matches_target(raw_ref: str) -> bool:
        for candidate in _candidate_targets_from_ref(raw_ref):
            if candidate == target_id:
                return True
            if target_title and candidate.lower() == target_title:
                return True
            for resolved_id in title_to_ids.get(candidate.lower(), set()):
                if resolved_id == target_id:
                    return True
        return False

    documents = _iter_linkable_page_documents()
    if not documents:
        return backlinks

    # Busquem per tot el Vault/Dashboard notes que referenciïn aquest ID
    for file_path, metadata, body, _is_dashboard_doc in documents:
        try:
            # Do not count ourselves as backlink
            current_id = str(metadata.get("id", file_path.stem) or file_path.stem).strip()
            if not current_id:
                continue
            if current_id == target_id:
                continue
            if current_id in seen_backlink_ids:
                continue

            found = False
            # 1. Check Metadata
            for val in metadata.values():
                if val == target_id:
                    found = True
                    break
                if isinstance(val, list):
                    for item in val:
                        item_str = str(item).strip()
                        if item_str == target_id:
                            found = True
                            break
                        if isinstance(item, str) and _matches_target(item):
                            found = True
                            break
                    if found:
                        break
                if isinstance(val, str) and _matches_target(val):
                    found = True
                    break

            # 2. Check Body (WikiLinks and MD Links)
            if not found:
                # Obsidian style [[ID]] / [[Title]] / [[Title#Section|Alias]] (and ![[...]]).
                wiki_links = re.findall(r"!?\[\[([^\]|]+(?:#[^\]|]+)?)(?:\|.*?)?\]\]", body)
                for raw_link in wiki_links:
                    base_target = str(raw_link or "").split("#", 1)[0].strip()
                    if _matches_target(base_target):
                        found = True
                        break

                # Standard MD links [text](ID)
                if not found:
                    md_links = re.findall(r"\[.*?\]\((.*?)\)", body)
                    for raw_link in md_links:
                        if _matches_target(raw_link):
                            found = True
                            break

            if found:
                seen_backlink_ids.add(current_id)
                backlinks.append(
                    {"id": current_id, "title": metadata.get("title") or file_path.stem}
                )
        except Exception as e:
            log.warning(f"Error processing backlinks for {file_path.name}: {e}")
            continue

    return backlinks


def _build_unlinked_mention_regex(target_title: str) -> Optional[re.Pattern]:
    safe_title = str(target_title or "").strip()
    if len(safe_title) < 2:
        return None

    escaped = re.escape(safe_title)
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


def _strip_existing_links_for_mentions_scan(text: str) -> str:
    source = str(text or "")
    source = re.sub(r"```[\s\S]*?```", " ", source)
    source = re.sub(r"!?\[\[[^\]]+\]\]", " ", source)
    source = re.sub(r"\[[^\]]*\]\([^)]+\)", " ", source)
    return source


def _count_unlinked_mentions(text: str, target_title: str) -> int:
    pattern = _build_unlinked_mention_regex(target_title)
    if not pattern:
        return 0
    sanitized = _strip_existing_links_for_mentions_scan(text)
    return len(list(pattern.finditer(sanitized)))


def _first_unlinked_mention_snippet(text: str, target_title: str, radius: int = 48) -> str:
    pattern = _build_unlinked_mention_regex(target_title)
    if not pattern:
        return ""

    sanitized = _strip_existing_links_for_mentions_scan(text)
    match = pattern.search(sanitized)
    if not match:
        return ""

    start = max(0, match.start() - radius)
    end = min(len(sanitized), match.end() + radius)
    snippet = sanitized[start:end].replace("\n", " ").strip()
    return re.sub(r"\s+", " ", snippet)


def _link_mentions_in_plain_segments(body: str, target_title: str, target_id: str) -> tuple[str, int]:
    pattern = _build_unlinked_mention_regex(target_title)
    if not pattern:
        return str(body or ""), 0

    source = str(body or "")
    link_token = f"/vault/page/{urllib.parse.quote(str(target_id or '').strip())}"
    existing_link_pattern = re.compile(r"!?\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\)")

    parts = []
    last_index = 0
    replacements = 0

    for match in existing_link_pattern.finditer(source):
        plain_segment = source[last_index:match.start()]

        def _replace_title(m: re.Match) -> str:
            nonlocal replacements
            replacements += 1
            return f"[{m.group(0)}]({link_token})"

        linked_segment = pattern.sub(_replace_title, plain_segment)
        parts.append(linked_segment)
        parts.append(match.group(0))
        last_index = match.end()

    tail = source[last_index:]

    def _replace_title_tail(m: re.Match) -> str:
        nonlocal replacements
        replacements += 1
        return f"[{m.group(0)}]({link_token})"

    parts.append(pattern.sub(_replace_title_tail, tail))

    return "".join(parts), replacements


@router.get("/unlinked-mentions")
def get_unlinked_mentions(id: str):
    """Finds notes mentioning target title in plain text without an actual link.

    Fast path: pre-filtra candidats amb `_tokens_by_source` (set lookup) i
    només executa regex sobre els documents on TOTS els tokens del títol hi
    apareixen. Redueix de 4000 → ~10-100 candidats típicament.
    Veure: docs/dev_memory/directives/wiki_inverse_link_index.md
    """
    target_id = str(id or "").strip()
    if not target_id:
        return []

    target_title = ""
    if _link_index_built:
        with _link_index_lock:
            target_title = str(
                (_page_meta_by_id.get(target_id) or {}).get("title") or ""
            ).strip()

    if not target_title:
        id_title_index = build_id_title_index()
        target_title = str(id_title_index.get(target_id) or "").strip()
        if not target_title:
            target_path = find_page_path(target_id)
            if target_path and target_path.exists():
                if _is_dashboard_file_path(target_path):
                    target_metadata, _ = _read_dashboard_file(target_path)
                else:
                    raw_target = target_path.read_text(encoding="utf-8")
                    target_metadata, _ = parse_frontmatter(raw_target, target_path)
                target_title = str(target_metadata.get("title") or "").strip()

    if len(target_title) < 2:
        return []

    title_tokens = frozenset(
        t for t in _TOKEN_SPLIT_RE.split(target_title.lower()) if len(t) >= 2
    )

    # Fast path amb pre-filter
    candidate_ids: Optional[set] = None
    if _link_index_built and title_tokens:
        with _link_index_lock:
            candidate_ids = {
                pid
                for pid, tokens in _tokens_by_source.items()
                if pid != target_id and title_tokens.issubset(tokens)
            }

    results = []
    documents = _iter_linkable_page_documents()
    if not documents:
        return results

    for file_path, metadata, body, _is_dashboard_doc in documents:
        try:
            current_id = str(metadata.get("id") or file_path.stem)
            if current_id == target_id:
                continue

            # Pre-filter: si tenim candidats i aquest no hi és, saltem regex
            if candidate_ids is not None and current_id not in candidate_ids:
                continue

            count = _count_unlinked_mentions(body, target_title)
            if count <= 0:
                continue

            results.append(
                {
                    "id": current_id,
                    "title": metadata.get("title") or file_path.stem,
                    "count": count,
                    "snippet": _first_unlinked_mention_snippet(body, target_title),
                }
            )
        except Exception as e:
            log.warning(f"Error processing unlinked mentions for {file_path.name}: {e}")

    results.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("title") or "")))
    return results


@router.post("/link-unlinked-mentions", dependencies=[Depends(require_role("editor"))])
async def link_unlinked_mentions(request: LinkMentionsRequest):
    """Converts plain mentions of target title into internal links in one source note or all notes."""
    target_id = str(request.target_id or "").strip()
    source_id = str(request.source_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="target_id is required")

    id_title_index = build_id_title_index()
    target_title = str(id_title_index.get(target_id) or "").strip()
    if len(target_title) < 2:
        raise HTTPException(status_code=400, detail="Target page title not found or too short")

    changed_notes = []
    total_replacements = 0

    if source_id:
        source_path = find_page_path(source_id)
        if not source_path or not source_path.exists():
            raise HTTPException(status_code=404, detail=f"Source page not found (ID: {source_id})")
        candidates = [source_path]
    else:
        candidates = [doc[0] for doc in _iter_linkable_page_documents()]

    for file_path in candidates:
        try:
            is_dashboard_doc = _is_dashboard_file_path(file_path)
            if is_dashboard_doc:
                metadata, body = _read_dashboard_file(file_path)
            else:
                raw_content = file_path.read_text(encoding="utf-8")
                metadata, body = parse_frontmatter(raw_content, file_path)
            current_id = str(metadata.get("id") or file_path.stem)
            if current_id == target_id:
                continue
            if source_id and current_id != source_id:
                continue

            updated_body, replacements = _link_mentions_in_plain_segments(
                body, target_title, target_id
            )
            if replacements <= 0:
                continue

            _create_page_version(current_id, file_path)
            if is_dashboard_doc:
                _write_dashboard_file(
                    file_path=file_path,
                    page_id=current_id,
                    title=str(metadata.get("title") or file_path.stem),
                    metadata=metadata,
                    content=updated_body,
                    parent_id=metadata.get("parent_id"),
                    is_database=bool(metadata.get("is_database")),
                )
            else:
                save_page_md(file_path, metadata, updated_body)

            changed_notes.append(
                {
                    "id": current_id,
                    "title": metadata.get("title") or file_path.stem,
                    "replacements": replacements,
                    "_path": file_path,
                }
            )
            total_replacements += replacements
        except Exception as e:
            log.warning(f"Error linking unlinked mentions for {file_path.name}: {e}")

    # Invalidem l'índex per cada source modificat. Si en són molts (>20),
    # un rebuild complet és més barat que N updates seqüencials.
    if changed_notes:
        if len(changed_notes) > 20:
            kickoff_link_index_rebuild()
        else:
            for note in changed_notes:
                try:
                    update_link_index_for_page(note["_path"])
                except Exception as e:
                    log.debug(f"link-index update skip: {e}")

    # Treiem el camp intern abans de retornar
    for note in changed_notes:
        note.pop("_path", None)

    changed_notes.sort(key=lambda item: str(item.get("title") or ""))
    return {
        "status": "success",
        "target_id": target_id,
        "target_title": target_title,
        "notes_changed": len(changed_notes),
        "total_replacements": total_replacements,
        "changed_notes": changed_notes,
    }


_registry_cache = None
_registry_cache_mtime = 0
_registry_cache_ts = 0.0  # monotonic time of last successful cache load
_registry_cache_ttl_seconds = 30  # serve from cache without stat() if recent

# Tracks tables that already had _ensure_table_vault_folder called once successfully
# during this process lifetime. Avoids redundant FUSE stat() calls on every read.
_registry_ensured_tables: set = set()



def load_registry():
    """Reads the central registry. Resilient to slow cloud filesystems (OneDrive).

    Strategy:
    - In-memory cache with 30s TTL: skip ALL filesystem I/O when fresh.
    - Beyond TTL, attempt mtime-based stat with short timeout; on slow FS, return stale cache.
    - Only run `_ensure_table_vault_folder` on first encounter per table per process.
    - On any unexpected error, return last cached data (graceful degradation).
    """
    global _registry_cache, _registry_cache_mtime, _registry_cache_ts

    # Fast path: cache is fresh (TTL not expired) → no filesystem I/O at all
    now = time.monotonic()
    if _registry_cache is not None and (now - _registry_cache_ts) < _registry_cache_ttl_seconds:
        return _registry_cache

    registry_path = get_p("REGISTRY")
    if not registry_path:
        return _registry_cache or {"databases": [], "tables": [], "views": []}

    # mtime check: if file unchanged since last load, return cache without re-reading
    try:
        if not registry_path.exists():
            return _registry_cache or {"databases": [], "tables": [], "views": []}
        mtime = registry_path.stat().st_mtime
        if _registry_cache is not None and mtime <= _registry_cache_mtime:
            _registry_cache_ts = now
            return _registry_cache
    except Exception as e:
        # FS hung (cloud sync etc.). Prefer stale cache over blocking the request.
        if _registry_cache is not None:
            log.warning(f"⚠️ load_registry: stat failed ({e}); serving stale cache")
            return _registry_cache
        # No cache yet: bail out with empty registry (better than hanging).
        log.error(f"❌ load_registry: stat failed and no cache available: {e}")
        return {"databases": [], "tables": [], "views": []}

    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))

        changed = False
        tables = data.get("tables", [])
        # 1. Cleanup: Delete default taula_1 if it exists
        if any(t.get("name") == "taula_1" for t in tables):
            data["tables"] = [t for t in tables if t.get("name") != "taula_1"]
            changed = True
            log.info("🗑️ Deleted default taula_1 from registry.")

        # 1.5 Cleanup: legacy wiki table is no longer supported as DB table.
        if any(str(t.get("id") or "").strip().lower() == "wiki" for t in data.get("tables", [])):
            data["tables"] = [
                t
                for t in data.get("tables", [])
                if str(t.get("id") or "").strip().lower() != "wiki"
            ]
            data["views"] = [
                v
                for v in data.get("views", [])
                if str(v.get("table_id") or "").strip().lower() != "wiki"
            ]
            changed = True
            log.info("🧹 Removed legacy wiki table and its views from registry.")

        # 2. Sanejament i creació de carpetes (només per taules no validades encara)
        for table in data.get("tables", []):
            folder_raw = table.get("folder") or table.get("name", "untitled_table")
            folder_normalized = _normalize_rel_folder(folder_raw)

            if table.get("folder") != folder_normalized:
                table["folder"] = folder_normalized
                changed = True
                log.info(f"🧹 Normalized table path '{table.get('name')}': {folder_normalized}")

            tid = str(table.get("id") or "")
            if tid and tid in _registry_ensured_tables:
                continue
            try:
                _ensure_table_vault_folder(table, data)
                if tid:
                    _registry_ensured_tables.add(tid)
            except Exception as e:
                log.error(f"❌ Error ensuring folder for table {table.get('name')}: {e}")

        if changed:
            save_registry(data)

        # Sync cache
        _registry_cache = data
        _registry_cache_ts = now
        try:
            _registry_cache_mtime = registry_path.stat().st_mtime
        except Exception:
            _registry_cache_mtime = mtime if 'mtime' in locals() else 0

        return data
    except Exception as e:
        log.error(f"❌ Error loading registry: {e}")
        if _registry_cache is not None:
            log.warning("⚠️ load_registry: serving stale cache after error")
            return _registry_cache
        return {"databases": [], "tables": [], "views": []}


def save_registry(data):
    """Saves the current state to the registry file and updates cache."""
    global _registry_cache, _registry_cache_mtime, _registry_cache_ts
    reg_path = get_p('REGISTRY')
    if not reg_path:
        log.warning("⚠️ Registry save attempt without configured path.")
        return
    try:
        # Atomic write — registry lives on cloud-synced storage, so any
        # half-flushed write would propagate to other devices and corrupt the
        # central config. safe_write_json does tmp + fsync + rename.
        safe_write_json(reg_path, data, indent=2, ensure_ascii=False)
        # Refresh cache so subsequent reads see new data without re-stat
        _registry_cache = data
        _registry_cache_ts = time.monotonic()
        try:
            _registry_cache_mtime = reg_path.stat().st_mtime
        except Exception:
            pass
    except Exception as e:
        log.error(f"❌ Error saving registry: {e}")


# ensure_default_registry_structure() # Desactivat: S'inicialitza dinàmicament per workspace


def _sort_key_name(item):
    """Sorting key that prioritizes 'order' and then the name (ignoring accents)."""
    order = item.get("order")
    # If it has order, return it as the first element of the tuple for sorting
    if order is not None:
        try:
            order_val = int(order)
        except (ValueError, TypeError):
            order_val = 999999
    else:
        order_val = 999999

    name = (item.get("name") or "").lower()
    normalized_name = "".join(
        c for c in unicodedata.normalize("NFD", name) if unicodedata.category(c) != "Mn"
    )
    return (order_val, normalized_name)


_HOST_OPEN_HELPER_URL = os.environ.get(
    "GNOSI_HOST_OPEN_HELPER_URL",
    "http://host.docker.internal:5099/open",
)

_HOST_TRASH_HELPER_URL = os.environ.get(
    "GNOSI_HOST_TRASH_HELPER_URL",
    _HOST_OPEN_HELPER_URL.rsplit("/", 1)[0] + "/trash",
)


def _try_host_trash_helper(target: str, timeout: float = 20.0) -> "tuple[bool, str]":
    """Demana al host_open_helper que mogui `target` a la Paperera del Mac.

    Cal perquè el contenidor monta HOME read-only i no pot esborrar fitxers de
    OneDrive/Biblioteca. Retorna (ok, detall_error).
    """
    try:
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            _HOST_TRASH_HELPER_URL,
            data=json.dumps({"path": target}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if 200 <= resp.status < 300:
                return True, ""
            return False, f"HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read() or b"{}").get("detail", str(e))
        except Exception:
            detail = str(e)
        return False, str(detail)
    except Exception as e:
        return False, str(e)


def _try_host_open_helper(target: str, timeout: float = 2.0) -> bool:
    """Delega l'obertura al helper que corre al host (Mac/Win/Linux real).

    El backend de Gnosi sol córrer dins d'un contenidor Docker Linux que NO
    té accés al sistema gràfic del host (Finder/Explorer). El helper
    `host_open_helper` (vegeu pipeline/skills/host_open_helper/) escolta a
    127.0.0.1:5099 al host i el contenidor el contacta via
    `host.docker.internal:5099`. Si no està disponible, fem fallback al
    `subprocess` local (que funciona si el backend corre directament al
    host, no en Docker).
    """
    try:
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            _HOST_OPEN_HELPER_URL,
            data=json.dumps({"path": target}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _safe_open_target(target: str) -> None:
    """Open URI/path with the system default app without shell interpolation.

    Primer prova el helper del host (necessari quan el backend corre dins
    de Docker, perquè el contenidor no pot cridar Finder/Explorer del Mac).
    Si el helper no està disponible, cau al `subprocess` local — útil quan
    el backend s'executa directament al host (mode debug/local).
    """
    if _try_host_open_helper(target):
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", target])
        return
    if os.name == "nt":
        os.startfile(target)  # type: ignore[attr-defined]
        return
    subprocess.Popen(["xdg-open", target])


def _extract_attachment_paths(attachments: object) -> List[str]:
    """Extract candidate file paths from heterogeneous attachment values."""
    if attachments is None:
        return []

    raw_values: List[str] = []
    if isinstance(attachments, list):
        raw_values = [str(v).strip() for v in attachments if str(v).strip()]
    elif isinstance(attachments, str):
        text = attachments.strip()
        if not text:
            return []
        parts = re.split(r"[\n;,]", text)
        raw_values = [p.strip() for p in parts if p.strip()]

    candidates: List[str] = []
    for item in raw_values:
        match = re.search(r"\(([^)]+)\)", item)
        if match:
            item = match.group(1).strip()

        if item.startswith("file://"):
            item = urllib.parse.unquote(item[7:])

        expanded = str(Path(item).expanduser())
        candidates.append(expanded)

    return candidates


def _pick_existing_path(
    file_path: Optional[str], attachments: Optional[object]
) -> Optional[str]:
    candidates: List[str] = []

    if isinstance(file_path, str) and file_path.strip():
        candidates.append(str(Path(file_path.strip()).expanduser()))

    candidates.extend(_extract_attachment_paths(attachments))

    for candidate in candidates:
        try:
            path = Path(candidate)
            if path.exists() and path.is_file():
                return str(path)
        except Exception:
            continue

    return None


@router.get("/registry")
async def get_registry():
    """Returns the full registry of databases, tables, and views (sorted alphabetically)."""
    try:
        registry = load_registry()
        registry["databases"] = sorted(
            registry.get("databases", []), key=_sort_key_name
        )
        registry["tables"] = sorted(
            [
                t
                for t in registry.get("tables", [])
                if str(t.get("id") or "").strip().lower() != "wiki"
            ],
            key=_sort_key_name,
        )
        # Vistes: respectem l'ordre d'inserció (append) del fitxer per evitar
        # que una vista nova amb nom "AAA…" salti al principi de les pestanyes.
        # PUT /api/vault/views/order persisteix l'ordre triat per l'usuari.
        registry["views"] = list(registry.get("views", []))
        return registry
    except Exception as e:
        logging.exception(f"ERROR in get_registry: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /registry"),
        )


@router.post("/registry", dependencies=[Depends(require_role("admin"))])
async def update_registry(data: dict = Body(...)):
    """Updates the entire registry (use with care).

    Auth: admin-only. Sobreescriu TOT el registry de cop, així que un
    error o un atacant amb un rol més baix podria destruir totes les
    databases/tables/views d'un workspace en una sola crida.
    """
    save_registry(data)
    return {"status": "success"}


@router.post("/open-resource", dependencies=[Depends(require_role("editor"))])
async def open_resource(payload: OpenResourceRequest):
    """Open a Zotero URI or local attachment path with the OS default handler.

    Auth gate: igual que /open-local-path. Aquest endpoint acaba invocant
    `subprocess.Popen(["open", target])` (macOS) o equivalents — és una
    superfície d'execució de comandes que no hauria de ser disponible per
    rols `viewer` en organitzacio mode.
    """
    zotero_uri = (payload.zotero_uri or "").strip()

    if zotero_uri:
        if not zotero_uri.startswith("zotero://"):
            raise HTTPException(status_code=400, detail="Invalid Zotero URI")
        try:
            _safe_open_target(zotero_uri)
            return {"status": "ok", "opened_with": "zotero_uri", "target": zotero_uri}
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Could not open Zotero URI: {e}"
            )

    existing_path = _pick_existing_path(payload.file_path, payload.attachments)
    if not existing_path:
        raise HTTPException(
            status_code=404, detail="No valid local attachment found"
        )

    try:
        _safe_open_target(existing_path)
        return {"status": "ok", "opened_with": "file_path", "target": existing_path}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Could not open local file: {e}"
        )


@router.post("/open-local-path", dependencies=[Depends(require_role("editor"))])
async def open_local_path(payload: dict = Body(...)):
    """
    Obre una ruta local (fitxer o carpeta) amb l'app per defecte del sistema.
    Accepta path absolut o URL file://. Útil per als enllaços file:// inserits
    al BlockEditor que els navegadors moderns bloquegen per seguretat.
    """
    raw = (payload or {}).get("path") or (payload or {}).get("url") or ""
    raw = str(raw).strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Missing 'path'")

    # Normalitza file://… → ruta del sistema
    if raw.lower().startswith("file://"):
        # file:///Users/foo  → /Users/foo  ;  file://host/share → //host/share
        without_scheme = raw[7:]
        if without_scheme.startswith("/"):
            target = urllib.parse.unquote(without_scheme)
        else:
            target = "//" + urllib.parse.unquote(without_scheme)
    else:
        target = raw

    # Expandeix ~ i resol simbòlicament
    try:
        path = Path(target).expanduser()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")

    try:
        _safe_open_target(str(path))
        return {"status": "ok", "target": str(path), "kind": "dir" if path.is_dir() else "file"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open: {e}")


@router.get("/databases")
async def list_databases():
    registry = load_registry()
    databases = registry.get("databases", [])
    return sorted(databases, key=_sort_key_name)


@router.post("/databases", dependencies=[Depends(require_role("editor"))])
async def create_database(db: dict = Body(...)):
    # Auth gate: crear/editar databases és una mutació estructural del
    # registry (impacta totes les vistes i taules). Igual que `delete_database`
    # més avall, ha de requerir mínim rol editor.
    registry = load_registry()
    if "id" not in db:
        db["id"] = str(uuid.uuid4())

    # Upsert
    existing_idx = next(
        (i for i, d in enumerate(registry["databases"]) if d["id"] == db["id"]), None
    )
    if existing_idx is not None:
        registry["databases"][existing_idx] = db
    else:
        registry["databases"].append(db)

    save_registry(registry)
    return db


@router.delete("/databases/{database_id}", dependencies=[Depends(require_role("admin"))])
async def delete_database(database_id: str):
    registry = load_registry()
    registry["databases"] = [
        db for db in registry["databases"] if db.get("id") != database_id
    ]
    # Netejar tables i views associades
    tables_to_remove = [
        t["id"] for t in registry["tables"] if t.get("database_id") == database_id
    ]
    registry["tables"] = [
        t for t in registry["tables"] if t.get("database_id") != database_id
    ]
    registry["views"] = [
        v for v in registry["views"] if v.get("table_id") not in tables_to_remove
    ]
    save_registry(registry)
    return {"status": "success"}


@router.get("/tables")
async def list_tables(database_id: Optional[str] = None):
    registry = load_registry()
    tables = [
        t
        for t in registry.get("tables", [])
        if str(t.get("id") or "").strip().lower() != "wiki"
    ]
    if database_id:
        tables = [t for t in tables if t.get("database_id") == database_id]
    return sorted(tables, key=_sort_key_name)


def _ensure_main_view(registry: dict, table_id: str) -> Optional[dict]:
    """Guarantee that `table_id` has at least one view with `is_main=True`.

    Resolution order:
      1. If a view already has `is_main=True`, do nothing.
      2. Otherwise promote an existing `type=="table"` view (the closest
         match for "default") by flagging it `is_main=True` — this avoids
         creating duplicate "Taula Principal" rows when migrating older
         tables whose only view simply lacked the flag.
      3. Otherwise (table has zero views at all) create a fresh
         `Taula Principal` view.

    Returns the view that ended up being the main one only when the
    registry was modified, otherwise None. The caller is responsible for
    persisting via `save_registry`.
    """
    views = registry.setdefault("views", [])
    table_views = [v for v in views if v.get("table_id") == table_id]
    if any(v.get("is_main") for v in table_views):
        return None
    # Prefer the first existing table-typed view (oldest at the top of
    # the list); fall back to any view; create only if there are none.
    promote_candidate = next(
        (v for v in table_views if v.get("type") == "table"),
        None,
    ) or (table_views[0] if table_views else None)
    if promote_candidate is not None:
        promote_candidate["is_main"] = True
        return promote_candidate
    new_view = {
        "id": str(uuid.uuid4()),
        "table_id": table_id,
        "name": "Taula Principal",
        "type": "table",
        "sort": {"field": "last_modified", "direction": "desc"},
        "filters": [],
        "is_main": True,
    }
    views.append(new_view)
    return new_view


@router.post("/tables", dependencies=[Depends(require_role("editor"))])
async def create_table(table: dict = Body(...)):
    registry = load_registry()
    if "id" not in table:
        table["id"] = str(uuid.uuid4())

    # Ensure and normalize the folder property
    folder_raw = table.get("folder") or table.get("name", "untitled_table")
    table["folder"] = _normalize_rel_folder(folder_raw)

    # If already exists, update it (upsert)
    existing_idx = next(
        (i for i, t in enumerate(registry["tables"]) if t["id"] == table["id"]), None
    )
    if existing_idx is not None:
        old_table = registry["tables"][existing_idx]
        # Detect removed properties to delete their assets folders
        old_asset_props = {
            str(p.get("name") or "").strip()
            for p in (old_table.get("properties") or [])
            if _is_asset_property(p) and str(p.get("name") or "").strip()
        }
        new_asset_props = {
            str(p.get("name") or "").strip()
            for p in (table.get("properties") or [])
            if _is_asset_property(p) and str(p.get("name") or "").strip()
        }
        removed_props = old_asset_props - new_asset_props
        if removed_props:
            db_entry = next(
                (
                    d
                    for d in registry.get("databases", [])
                    if str(d.get("id")) == str(old_table.get("database_id"))
                ),
                None,
            )
            for prop_name in removed_props:
                _delete_asset_property_dir(old_table, db_entry, prop_name)
        registry["tables"][existing_idx] = table
    else:
        registry["tables"].append(table)

    _ensure_asset_dirs_for_table_entry(table, registry)
    _ensure_table_vault_folder(table, registry)

    # Product invariant: every table must always own at least one main
    # view. Without this, a freshly-created table renders as a blank
    # canvas in the UI and the (now-guarded) frontend auto-create no
    # longer kicks in. Doing it server-side also covers any non-UI client
    # that POSTs a table directly.
    _ensure_main_view(registry, table["id"])

    save_registry(registry)
    return table


@router.delete("/tables/{table_id}", dependencies=[Depends(require_role("admin"))])
async def delete_table(table_id: str, background_tasks: BackgroundTasks):
    """Delete a table.

    Why background_tasks for the rmtree:
      The asset folders may live on cloud-synced storage (OneDrive FUSE)
      where deleting hundreds of files can take seconds-to-minutes. Doing
      it inline blocks the HTTP response → the frontend modal hangs in
      `isSubmitting=true` state, looking like the operation is broken.
      We update the registry synchronously (the user-visible source of
      truth) and queue the disk cleanup as a background task.
    """
    registry = load_registry()
    # Get table info BEFORE deleting it from registry
    table_entry = next((t for t in registry["tables"] if t.get("id") == table_id), None)
    db_entry = None
    if table_entry:
        db_entry = next(
            (
                d
                for d in registry.get("databases", [])
                if str(d.get("id")) == str(table_entry.get("database_id"))
            ),
            None,
        )
    # Update registry FIRST so the response is fast and the UI updates immediately
    registry["tables"] = [t for t in registry["tables"] if t.get("id") != table_id]
    # Netejar views associades
    registry["views"] = [v for v in registry["views"] if v.get("table_id") != table_id]
    save_registry(registry)

    # Schedule the slow filesystem cleanup off the request path
    if table_entry:
        background_tasks.add_task(_delete_asset_table_dir, table_entry, db_entry)

    return {"status": "success"}


@router.put("/tables/{table_id}", dependencies=[Depends(require_role("editor"))])
async def rename_table(table_id: str, data: dict = Body(...)):
    registry = load_registry()
    for t in registry["tables"]:
        if t["id"] == table_id:
            old_name = str(t.get("name") or "").strip()
            if "name" in data:
                t["name"] = data["name"]
                if not t.get("folder"):
                    t["folder"] = data["name"]
            if "folder" in data:
                t["folder"] = data["folder"]
            new_name = str(t.get("name") or "").strip()

            # Si el nom ha canviat, mou ambdues carpetes d'assets perquè els
            # fitxers existents segueixin l'objecte taula:
            #   1) Assets/<OldName>/                  (plana, drag&drop genèric)
            #   2) Assets/<DB>/<OldTable>/            (estructurada per propietats)
            # Si la destinació ja existeix (col·lisió raríssima), no fem res
            # i deixem un warning al log per inspeccionar manualment.
            if old_name and new_name and old_name != new_name:
                # Resol la DB un sol cop: la necessitem per al nesting
                # estructurat (pas 2) i per detectar col·lisions entre la
                # carpeta plana i l'arrel de la DB (pas 1).
                db_entry = next(
                    (
                        d
                        for d in registry.get("databases", []) or []
                        if str(d.get("id")) == str(t.get("database_id"))
                    ),
                    None,
                )
                db_seg = _sanitize_asset_segment(
                    (db_entry or {}).get("name") or t.get("database_id") or "General",
                    "General",
                )
                old_seg = _sanitize_asset_segment(old_name, "Table")
                new_seg = _sanitize_asset_segment(new_name, "Table")

                # 1) Plana Assets/<Taula>/
                #
                # COL·LISIÓ (vegeu docs/dev_memory/directives/table_rename_flat_folder_collision.md):
                # quan el segment de la taula coincideix amb el de la DB
                # (case-insensitive a APFS), `Assets/<Taula>/` és FÍSICAMENT
                # el mateix directori que l'arrel de nesting `Assets/<DB>/`.
                # Renombrar-lo en bloc arrossegaria els arbres estructurats
                # d'altres taules (p.ex. Assets/Cervell Digital/Recursos/...)
                # i trencaria les seves referències. En aquest cas movem
                # només els fitxers solts de la taula.
                should_rewrite_refs = False
                try:
                    old_dir = get_p("ASSETS") / old_seg
                    new_dir = get_p("ASSETS") / new_seg
                    old_collides = _asset_segments_collide(old_seg, db_seg)
                    new_collides = _asset_segments_collide(new_seg, db_seg)

                    if old_dir.is_dir():
                        if old_collides and new_collides:
                            # Old i new resolen tots dos a l'arrel de la DB:
                            # només canvia la capitalització, res a reubicar.
                            log.info(
                                f"Flat assets folder coincides with DB root for "
                                f"both names ({old_name}→{new_name}); nothing to move."
                            )
                        elif old_collides or new_collides:
                            # Un dels segments és l'arrel de la DB: mai
                            # renombrem en bloc; movem només els fitxers solts.
                            moved = _move_loose_files(old_dir, new_dir)
                            should_rewrite_refs = True
                            log.info(
                                f"Collision-safe flat assets move "
                                f"({old_name}→{new_name}): {moved} loose file(s) "
                                f"{old_dir} → {new_dir}; left DB-nested "
                                f"subfolders in place."
                            )
                        elif not new_dir.exists():
                            old_dir.rename(new_dir)
                            should_rewrite_refs = True
                            log.info(f"Renamed flat assets folder: {old_dir} → {new_dir}")
                        else:
                            log.warning(
                                f"Both old and new flat assets dirs exist for table "
                                f"rename ({old_name}→{new_name}); leaving as-is."
                            )
                except Exception as e:
                    log.warning(f"Could not rename flat assets folder: {e}")

                # 1b) Si la carpeta plana ha canviat de segment, els fitxers
                #     solts viuen ara a <new_seg>: reescriu les refs inline
                #     dels cossos de pàgina (`/api/vault/assets/<seg>/...`).
                if should_rewrite_refs:
                    try:
                        table_dir = _table_vault_dir(t, registry)
                        if table_dir:
                            # rglob + read/write per molts .md: ho descarreguem
                            # a un thread per no bloquejar l'event loop en taules
                            # grans o vaults sincronitzats al núvol (lents).
                            n = await asyncio.to_thread(_rewrite_inline_asset_refs, table_dir, old_seg, new_seg)
                            if n:
                                log.info(
                                    f"Rewrote inline asset refs in {n} page(s) for "
                                    f"table rename ({old_seg}→{new_seg})."
                                )
                    except Exception as e:
                        log.warning(f"Could not rewrite inline asset refs: {e}")

                # 2) Estructurada Assets/<DB>/<Taula>/ — sempre segura: va
                #    niada sota <DB>/, mai col·lisiona amb l'arrel.
                try:
                    old_struct = get_p("ASSETS") / db_seg / old_seg
                    new_struct = get_p("ASSETS") / db_seg / new_seg
                    if old_struct.is_dir() and not new_struct.exists():
                        old_struct.rename(new_struct)
                        log.info(f"Renamed structured assets folder: {old_struct} → {new_struct}")
                    elif old_struct.is_dir() and new_struct.exists():
                        log.warning(
                            f"Both old and new structured assets dirs exist for "
                            f"table rename ({old_name}→{new_name}); leaving as-is."
                        )
                except Exception as e:
                    log.warning(f"Could not rename structured assets folder: {e}")

            _ensure_asset_dirs_for_table_entry(t, registry)
            _ensure_table_vault_folder(t, registry)
            break
    save_registry(registry)
    return {"status": "success"}


@router.patch("/tables/{table_id}/properties/{field_id}",
               dependencies=[Depends(require_role("editor"))])
async def patch_table_property(table_id: str, field_id: str, data: dict = Body(...)):
    """
    Renomena o actualitza atributs no estructurals d'una property identificada
    pel seu 'id' immutable. Mai canvia l'id.

    PERSISTÈNCIA PER NOM: com que les pàgines guarden les claus pel nom actual,
    renomenar registra el nom antic com a `alias` de la property. Les files amb
    el nom antic segueixen resolent (via àlies) i es migren soles al nom nou en
    el següent desament — sense reescriure cap fitxer aquí (instantani, robust
    offline). Vegeu `vault_persist_by_name.md`.

    Body acceptat (tots opcionals):
      - name: nou nom mostrat
      - type: nou type (només si la migració de dades és segura)
      - config: dict que es fa merge amb la config existent
    """
    registry = load_registry()
    target_table = None
    target_prop = None
    for t in registry.get("tables", []):
        if t.get("id") == table_id:
            target_table = t
            for p in t.get("properties", []) or []:
                if p.get("id") == field_id:
                    target_prop = p
                    break
            break
    if not target_table:
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")
    if not target_prop:
        raise HTTPException(
            status_code=404,
            detail=f"Property {field_id} not found in table {table_id}",
        )

    if "name" in data and isinstance(data["name"], str) and data["name"].strip():
        new_name = data["name"].strip()
        # Validació: no permetre col·lisió amb un altre nom de la mateixa taula
        for p in target_table.get("properties", []) or []:
            if p is target_prop:
                continue
            if (p.get("name") or "").strip() == new_name:
                raise HTTPException(
                    status_code=409,
                    detail=f"Ja existeix una property amb el nom '{new_name}' a la taula",
                )
        old_name = (target_prop.get("name") or "").strip()
        if old_name and old_name != new_name:
            # Registra el nom antic com a àlies perquè les files existents (que el
            # guarden com a clau) segueixin resolent fins que es migrin soles.
            aliases = target_prop.get("aliases") or []
            if old_name not in aliases:
                aliases.append(old_name)
            # El nom nou no pot ser alhora àlies (d'aquesta o d'una altra property).
            aliases = [a for a in aliases if a != new_name]
            target_prop["aliases"] = aliases
            for p in target_table.get("properties", []) or []:
                if p is target_prop:
                    continue
                if new_name in (p.get("aliases") or []):
                    p["aliases"] = [a for a in p["aliases"] if a != new_name]
        target_prop["name"] = new_name

    if "type" in data and isinstance(data["type"], str):
        target_prop["type"] = data["type"]

    if "config" in data and isinstance(data["config"], dict):
        existing = target_prop.get("config") or {}
        if not isinstance(existing, dict):
            existing = {}
        existing.update(data["config"])
        target_prop["config"] = existing

    save_registry(registry)
    return {
        "status": "success",
        "table_id": table_id,
        "property": target_prop,
    }


@router.get("/views")
async def list_views(table_id: Optional[str] = None):
    registry = load_registry()
    views = registry.get("views", [])
    if table_id:
        views = [v for v in views if v.get("table_id") == table_id]

    # ensure new configuration fields have sensible defaults so frontend
    # can render older views without modifications
    for v in views:
        # cardSize is only meaningful for gallery views; default to 'medium'
        if v.get("cardSize") is None:
            v["cardSize"] = "medium"
        # galleryPreview can be 'cover','properties' or 'content'
        if v.get("galleryPreview") is None:
            v["galleryPreview"] = "cover"
        # visibleProperties may be missing; frontend treats undefined as show-all
    return sorted(views, key=_sort_key_name)


@router.post("/views", dependencies=[Depends(require_role("editor"))])
async def create_view(view: dict = Body(...)):
    registry = load_registry()
    if "id" not in view:
        view["id"] = str(uuid.uuid4())

    existing_idx = next(
        (i for i, v in enumerate(registry["views"]) if v["id"] == view["id"]), None
    )
    if existing_idx is not None:
        registry["views"][existing_idx] = view
    else:
        registry["views"].append(view)

    save_registry(registry)
    return view


@router.put("/views/order", dependencies=[Depends(require_role("editor"))])
async def reorder_views(body: dict = Body(...)):
    """Reordena les vistes d'una taula segons l'ordre rebut.

    Body: {"table_id": "...", "ordered_ids": ["v1", "v2", "v3"]}.
    Les vistes d'altres taules mantenen la seva posició relativa. Les vistes
    de la taula referenciada es col·loquen al final del registry seguint
    l'ordre indicat.
    """
    table_id = str(body.get("table_id") or "").strip()
    ordered_ids = body.get("ordered_ids") or []
    if not table_id or not isinstance(ordered_ids, list):
        raise HTTPException(status_code=422, detail="Cal table_id i ordered_ids (list).")

    registry = load_registry()
    views = registry.get("views") or []
    table_views = {v["id"]: v for v in views if v.get("table_id") == table_id}
    if not table_views:
        raise HTTPException(status_code=404, detail=f"No hi ha vistes per a la taula '{table_id}'.")

    other_views = [v for v in views if v.get("table_id") != table_id]
    seen = set()
    ordered_table_views = []
    for vid in ordered_ids:
        v = table_views.get(vid)
        if v and vid not in seen:
            ordered_table_views.append(v)
            seen.add(vid)
    for v in views:
        if v.get("table_id") == table_id and v["id"] not in seen:
            ordered_table_views.append(v)

    registry["views"] = other_views + ordered_table_views
    save_registry(registry)
    return {"ok": True, "table_id": table_id, "count": len(ordered_table_views)}


@router.get("/views/{view_id}")
async def get_view(view_id: str):
    registry = load_registry()
    views = registry.get("views", [])
    view = next((v for v in views if v.get("id") == view_id), None)
    if not view:
        raise HTTPException(status_code=404, detail="View not found")

    response_view = dict(view)
    if response_view.get("cardSize") is None:
        response_view["cardSize"] = "medium"
    if response_view.get("galleryPreview") is None:
        response_view["galleryPreview"] = "cover"
    return response_view


@router.delete("/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def delete_view(view_id: str):
    registry = load_registry()
    views = registry.get("views", [])
    target = next((v for v in views if v.get("id") == view_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="View not found")

    table_id = target.get("table_id")
    siblings = [v for v in views if v.get("table_id") == table_id]
    is_only = len(siblings) <= 1
    is_main = bool(target.get("is_main"))
    other_mains = [v for v in siblings if v.get("id") != view_id and v.get("is_main")]

    # Product invariant: every table must keep at least one main view at
    # all times. Reject deletes that would leave a table with no views, or
    # that would strip the last `is_main` flag.
    if is_only:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "cannot_delete_last_view",
                "message": (
                    "No es pot eliminar l'única vista d'una taula. "
                    "Crea'n una altra primer."
                ),
            },
        )
    if is_main and not other_mains:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "cannot_delete_main_view",
                "message": (
                    "No es pot eliminar la vista principal. Marca una "
                    "altra vista com a principal abans d'eliminar aquesta."
                ),
            },
        )

    registry["views"] = [v for v in views if v.get("id") != view_id]
    save_registry(registry)
    return {"status": "success"}


@router.put("/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def update_view(view_id: str, data: dict = Body(...)):
    registry = load_registry()
    found = False
    for v in registry["views"]:
        if v["id"] == view_id:
            # Update all sent fields
            for key, value in data.items():
                v[key] = value
            found = True
            break

    if not found:
        # If it doesn't exist and we have enough data, we could create it,
        # but the expected behavior of PUT is update.
        # However, for robustness with the frontend, if they pass the whole object:
        if "id" in data and data["id"] == view_id:
            registry["views"].append(data)
        else:
            raise HTTPException(status_code=404, detail="View not found")

    save_registry(registry)
    return {"status": "success"}


def _resolve_subpath_within_vault(folder: str, *segments: str) -> Path:
    """Resolve `VAULT/folder/segments...` and ensure it stays under VAULT.

    Raises HTTPException(400) si el `folder` que arriba per query string
    intenta sortir del Vault (`../etc`, paths absoluts, símbolic links, etc.).
    """
    vault_root = get_p("VAULT").resolve()
    rel = str(folder or "").strip()
    if not rel:
        raise HTTPException(status_code=400, detail="Empty folder")
    try:
        target = (vault_root / rel).joinpath(*segments).resolve()
        target.relative_to(vault_root)
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail="Invalid folder path")
    return target


# Ruta per retrocompatibilitat amb el frontend existent (SchemaConfigModal)
@router.post("/schema", dependencies=[Depends(require_role("editor"))])
async def save_schema(folder: str, schema: dict = Body(...)):
    """
    Legacy route to save schemas per folder.
    Now we redirect it to table creation if needed, or save it as a local file.
    """
    schema_path = _resolve_subpath_within_vault(folder, "schema.json")
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(schema_path, schema, indent=2)
    return {"status": "success"}


@router.get("/schema")
async def get_schema(folder: str):
    schema_path = _resolve_subpath_within_vault(folder, "schema.json")
    if not schema_path.exists():
        return {}
    try:
        return json.loads(schema_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        # Schema corrupte (write a meitat des d'altres processos / sync OneDrive)
        # → retornem {} en lloc de 500 perquè la UI pugui obrir la taula
        # i sobreescriure-la des de SchemaConfigModal.
        log.warning(f"Schema {schema_path} corrupte o no llegible: {e}")
        return {}


# --------------------------------------------------------------------------
# EXCALIDRAW DRAWINGS ROUTES
# --------------------------------------------------------------------------


@router.get("/drawings")
async def list_drawings():
    """Lists all drawings in the vault (tldraw and excalidraw)."""
    dib_path = get_p('DIBUIXOS')
    dib_path.mkdir(parents=True, exist_ok=True)
    drawings = []
    seen_ids = set()

    # First search for .tldraw.json files (new format)
    for file_path in dib_path.glob("*.tldraw.json"):
        drawing_id = file_path.stem.replace(".tldraw", "")
        seen_ids.add(drawing_id)
        stat = file_path.stat()
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            # New format has { title, data, metadata }
            title = data.get("title", drawing_id)
            drawings.append(
                {
                    "id": drawing_id,
                    "title": title,
                    "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "size": stat.st_size,
                }
            )
        except Exception as e:
            log.warning(f"Error llegint dibuix {file_path.name}: {e}")

    # Then search for .excalidraw.json files (old format)
    for file_path in get_p("DIBUIXOS").glob("*.excalidraw.json"):
        drawing_id = file_path.stem.replace(".excalidraw", "")
        if drawing_id in seen_ids:
            continue  # We already have the new format
        stat = file_path.stat()
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            drawings.append(
                {
                    "id": drawing_id,
                    "title": data.get("metadata", {}).get("title", drawing_id),
                    "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "size": stat.st_size,
                }
            )
        except Exception as e:
            log.warning(f"Error llegint dibuix {file_path.name}: {e}")

    return drawings


@router.get("/drawings/{drawing_id}")
async def get_drawing(drawing_id: str):
    """Returns the data of a Tldraw drawing."""
    # Search first in new format (.tldraw.json)
    file_path = get_p("DIBUIXOS") / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        # Fallback to old format (.excalidraw.json)
        file_path = get_p("DIBUIXOS") / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Drawing not found")

    try:
        file_data = json.loads(file_path.read_text(encoding="utf-8"))
        # New format has { title, data, metadata } - return data
        if "data" in file_data:
            return file_data["data"]
        # Old format - return as-is
        return file_data
    except Exception as e:
        log.error(f"Error reading drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading target file")


@router.put("/drawings/{drawing_id}", dependencies=[Depends(require_role("editor"))])
async def save_drawing(drawing_id: str, request: DrawingSaveRequest):
    """Saves or updates a Tldraw drawing."""
    get_p("DIBUIXOS").mkdir(parents=True, exist_ok=True)
    file_path = get_p("DIBUIXOS") / f"{drawing_id}.tldraw.json"

    # Save title and data together
    payload = {
        "title": request.title,
        "data": request.data,
        "metadata": request.metadata or {},
    }

    try:
        safe_write_json(file_path, payload, indent=2, ensure_ascii=False)
        return {"status": "success", "id": drawing_id}
    except Exception as e:
        log.error(f"Error saving drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error writing target file")


@router.delete("/drawings/{drawing_id}", dependencies=[Depends(require_role("editor"))])
async def delete_drawing(drawing_id: str):
    """Deletes a drawing."""
    dib_path = get_p('DIBUIXOS')
    file_path = dib_path / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        file_path = dib_path / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Drawing not found")

    file_path.unlink()
    return {"status": "success"}


def _create_page_version(page_id: str, file_path: Path):
    """Saves a version of the current file to .history/{page_id}/{timestamp}.md if cooldown passed."""
    if not file_path or not file_path.exists():
        return

    history_base = get_p("VAULT") / ".history" / page_id
    history_base.mkdir(parents=True, exist_ok=True)

    # 10-minute cooldown (600 seconds) to avoid saturating with auto-saves
    COOLDOWN = 600

    # Check the last saved version to respect cooldown
    versions = sorted(history_base.glob("*.md"))
    if versions:
        last_version = versions[-1]
        try:
            if time.time() - last_version.stat().st_mtime < COOLDOWN:
                return
        except Exception:
            pass

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    version_path = history_base / f"{timestamp}.md"
    try:
        shutil.copy2(file_path, version_path)
        log.info(f"Page version created: {version_path}")
    except Exception as e:
        log.warning(f"Could not create version for {page_id}: {e}")


def _create_page_version_from_content(page_id: str, original_content: str):
    """Variant de `_create_page_version` que escriu directament el contingut
    original passat com a paràmetre, sense haver de fer `shutil.copy2` del
    fitxer. Pensat per executar-se com a `background_task` DESPRÉS que la
    resposta al client ja s'hagi enviat: si esperéssim a copiar el fitxer
    abans del `save_page_md`, l'usuari pagaria 50-300 ms d'I/O OneDrive
    extra per cada PATCH; aquí ho fem en background amb el contingut que el
    handler ja tenia en memòria.

    Manté el cooldown de 10 min original.
    """
    if not original_content:
        return
    history_base = get_p("VAULT") / ".history" / page_id
    try:
        history_base.mkdir(parents=True, exist_ok=True)
    except Exception:
        return
    COOLDOWN = 600
    versions = sorted(history_base.glob("*.md"))
    if versions:
        last_version = versions[-1]
        try:
            if time.time() - last_version.stat().st_mtime < COOLDOWN:
                return
        except Exception:
            pass
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    version_path = history_base / f"{timestamp}.md"
    try:
        version_path.write_text(original_content, encoding="utf-8")
        log.info(f"Page version created (bg): {version_path}")
    except Exception as e:
        log.warning(f"Could not create version (bg) for {page_id}: {e}")


@router.get("/pages/{page_id}/history")
async def get_page_history(page_id: str):
    """Returns the list of available versions for a page."""
    page_id = _validate_safe_page_id(page_id)
    history_base = get_p("VAULT") / ".history" / page_id
    if not history_base.exists():
        return []
    
    versions = []
    # Glob returns files, we sort them descending by name (which is the timestamp)
    for f in sorted(history_base.glob("*.md"), key=lambda x: x.name, reverse=True):
        ts_str = f.stem
        try:
            # Try to format the timestamp to make it readable
            dt = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
            readable_ts = dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            readable_ts = ts_str
            
        versions.append({
            "id": ts_str,
            "timestamp": readable_ts,
            "size": f.stat().st_size
        })
    return versions


@router.get("/pages/{page_id}/history/{timestamp}")
async def get_page_version_content(page_id: str, timestamp: str):
    """Returns the content of a specific version."""
    page_id = _validate_safe_page_id(page_id)
    timestamp = _validate_history_timestamp(timestamp)
    version_path = get_p("VAULT") / ".history" / page_id / f"{timestamp}.md"
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Version not found")
    
    try:
        raw_content = version_path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(raw_content, version_path)
        return {
            "id": page_id,
            "version_id": timestamp,
            "metadata": metadata,
            "content": body.strip()
        }
    except Exception as e:
        log.error(f"Error reading version {timestamp} of {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading the version")


@router.post("/pages/{page_id}/history/restore/{timestamp}", dependencies=[Depends(require_role("editor"))])
async def restore_page_version(page_id: str, timestamp: str, background_tasks: BackgroundTasks):
    """Restores a page to a previous version."""
    page_id = _validate_safe_page_id(page_id)
    timestamp = _validate_history_timestamp(timestamp)
    version_path = get_p("VAULT") / ".history" / page_id / f"{timestamp}.md"
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Version not found")
    
    file_path = find_page_path(page_id)
    if not file_path:
         raise HTTPException(status_code=404, detail="Current page not found")

    # Save current version (state just before restoration) just in case
    _create_page_version(page_id, file_path)
    
    try:
        shutil.copy2(version_path, file_path)
        log.info(f"Page {page_id} restored to version {timestamp}")
        
        # Optionally recompute formulas if page belongs to a table
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, _ = parse_frontmatter(raw_content, file_path)
        table_id = get_table_id(metadata)
        if table_id:
            background_tasks.add_task(_recompute_cross_record_formulas_for_table, table_id, page_id)
            
        return {"status": "success", "message": "Page restored successfully"}
    except Exception as e:
        log.error(f"Error restoring version {timestamp} of {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error restoring the version")


@router.delete("/pages/{page_id}/history", dependencies=[Depends(require_role("admin"))])
async def purge_page_history(page_id: str):
    """Deletes all version history of a page.

    Important: `page_id` ha de passar `_validate_safe_page_id` ABANS de
    construir el path. Sense això, `page_id=".."` faria
    `shutil.rmtree(VAULT/.history/..)` = esborrar el Vault sencer.
    """
    page_id = _validate_safe_page_id(page_id)
    history_base = get_p("VAULT") / ".history" / page_id
    if not history_base.exists():
        return {"status": "success", "message": "No history to delete"}
    
    try:
        shutil.rmtree(history_base)
        log.info(f"Page history for {page_id} purged")
        return {"status": "success", "message": "History deleted successfully"}
    except Exception as e:
        log.error(f"Error purging history for {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Error deleting history")


# ---------------------------------------------------------------------------
# Skills — actions triggered from `button`-typed fields in the table schema.
# Each skill expects the row id and any action-specific payload, runs its
# logic synchronously (creating subitems, calling external APIs, etc.) and
# returns a structured summary the UI can surface.
# ---------------------------------------------------------------------------


@router.post("/skills/translate-row", dependencies=[Depends(require_role("editor"))])
async def translate_row(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Translate the translatable fields of a row to one subitem per language.

    Body:
        {
          "item_id": "<uuid of the row>",
          "target_languages": ["en", "es", ...],
          "button_action": "translate_row"  # validated; rejects others
        }

    The row's table must have `translation_enabled: true` and at least one
    property marked with `translatable: true`. For each target language a new
    subitem is created (`parent_id = item_id`), with the translated values
    keyed by the same property `id`/`name` as the parent row.
    """
    item_id = (payload.get("item_id") or "").strip()
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_row"

    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    if not isinstance(target_languages, list) or not target_languages:
        raise HTTPException(status_code=400, detail="target_languages must be a non-empty list")
    if button_action != "translate_row":
        raise HTTPException(status_code=400, detail=f"Unsupported button_action: {button_action}")

    # Defer the import so a missing `requests` dependency at startup doesn't
    # break the whole API — translation is opt-in per table.
    try:
        from pipeline.skills.translate_row.scripts.translate_text import (
            translate as _translate,
            detect_source_lang as _detect_source_lang,
        )
    except Exception as exc:
        log.error(f"translate_row skill not importable: {exc}")
        raise HTTPException(status_code=500, detail="translate_row skill unavailable")

    # Read the DeepL API key from the Keychain — preferred location for
    # secrets in Gnosi. Falls back silently to env var if Keychain isn't
    # available. The Softcatalà URL lives in .env_shared since it isn't a
    # secret, so we let the skill read it from os.environ.
    deepl_api_key = ""
    try:
        from backend.security.keychain_manager import get_keychain
        kc = get_keychain()
        if kc.has_credential("deepl_api_key"):
            deepl_api_key = kc.get_credential("deepl_api_key") or ""
    except Exception as exc:
        log.warning(f"translate_row: keychain unavailable, using env fallback: {exc}")

    # 1. Locate and read the source page.
    file_path = await asyncio.to_thread(find_page_path, item_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {item_id})")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = parse_frontmatter(raw_content, file_path)

    # 2. Resolve the parent table.
    table_id = get_table_id(metadata)
    table = _table_by_id(table_id) if table_id else None
    if not table:
        raise HTTPException(status_code=400, detail="Row is not part of a table")
    if not table.get("translation_enabled"):
        raise HTTPException(
            status_code=400,
            detail="This table is not configured for translation. Enable it in the schema config.",
        )

    # 3. Filter translatable properties — they carry the explicit flag the
    #    SchemaConfigModal writes into each property's config.
    properties = table.get("properties") or []
    translatable_props = [p for p in properties if p.get("translatable") is True]
    if not translatable_props:
        raise HTTPException(
            status_code=400,
            detail="No translatable fields configured on this table.",
        )

    def _read_meta(prop: dict):
        prop_id = prop.get("id") or prop.get("name")
        prop_name = prop.get("name") or ""
        if prop_id and prop_id in metadata:
            return metadata.get(prop_id)
        if prop_name and prop_name in metadata:
            return metadata.get(prop_name)
        return None

    # 4. Detect source language from the longest non-empty translatable value.
    sample = ""
    for p in translatable_props:
        val = _read_meta(p)
        if isinstance(val, str) and len(val.strip()) > len(sample):
            sample = val.strip()
    if not sample:
        sample = str(metadata.get("title") or "")
    source_lang = _detect_source_lang(sample) if sample else "ca"

    # 5. Translate per language and create subitems.
    parent_title = str(metadata.get("title") or "")
    title_is_translatable = any(
        (p.get("name") == "title" or p.get("type") == "title") and p.get("translatable") is True
        for p in translatable_props
    )
    created = []
    skipped = []

    for lang in target_languages:
        if not isinstance(lang, str) or not lang.strip():
            continue
        lang = lang.strip().lower()
        if lang == source_lang:
            skipped.append({"lang": lang, "reason": "same as source"})
            continue

        sub_metadata: Dict[str, Any] = {
            "table_id": table_id,
            "database_table_id": table_id,
            "translation_lang": lang,
            "translation_source_lang": source_lang,
            "translation_origin_id": item_id,
        }
        providers_used = set()
        any_translated = False
        translated_title = ""
        first_text_translation = ""

        for prop in translatable_props:
            val = _read_meta(prop)
            if not isinstance(val, str) or not val.strip():
                continue
            try:
                translated, provider = _translate(val, source_lang, lang, deepl_api_key=deepl_api_key)
            except Exception as exc:
                log.warning(f"translate_row: failed translating field {prop.get('name')} → {lang}: {exc}")
                translated = f"[error: {exc}]"
                provider = "error"
            providers_used.add(provider)
            # Persist by the same key the parent row uses, preferring stable id.
            key = prop.get("id") or prop.get("name")
            if key:
                sub_metadata[key] = translated
            any_translated = True
            if (prop.get("name") == "title" or prop.get("type") == "title") and not translated_title:
                translated_title = translated
            elif not first_text_translation and prop.get("type") in ("text", "rich_text"):
                first_text_translation = translated

        if not any_translated:
            skipped.append({"lang": lang, "reason": "no translatable content"})
            continue

        if title_is_translatable and translated_title:
            sub_title = translated_title
        elif first_text_translation:
            sub_title = first_text_translation[:120]
        else:
            sub_title = f"{parent_title} ({lang})" if parent_title else lang
        sub_metadata["translation_provider"] = (
            "mixed" if len(providers_used) > 1 else (next(iter(providers_used), "placeholder"))
        )

        sub_request = PageSaveRequest(
            title=sub_title,
            content="",
            parent_id=item_id,
            metadata=sub_metadata,
        )
        try:
            result = await create_page(sub_request, background_tasks)
            created.append({
                "id": result.get("id"),
                "lang": lang,
                "providers": sorted(providers_used),
                "title": sub_title,
            })
        except Exception as exc:
            log.error(f"translate_row: failed creating subitem for {lang}: {exc}")
            skipped.append({"lang": lang, "reason": f"create failed: {exc}"})

    return {
        "status": "ok",
        "item_id": item_id,
        "source_lang": source_lang,
        "created": created,
        "skipped": skipped,
    }


# -----------------------------------------------------------------------------
# PDF annotations
# -----------------------------------------------------------------------------
# Anotacions persistents del visor PDF integrat. Vegeu
# `backend/models/pdf_annotation.py` per al model i camps. La taula viu
# a la BD del vault actiu (es crea via Base.metadata.create_all al primer
# get_engine_for_path d'aquest vault).

from sqlalchemy.orm import Session as _AnnSession
from backend.data.db import get_db as _ann_get_db
from backend.models.pdf_annotation import PdfAnnotation as _PdfAnnotation


class _PdfAnnotationCreate(BaseModel):
    source_uri: str
    page: int
    type: str
    color: Optional[str] = "#ffeb3b"
    rects: Optional[List[Dict[str, float]]] = None
    text: Optional[str] = None
    comment: Optional[str] = None
    tags: Optional[str] = None


class _PdfAnnotationUpdate(BaseModel):
    color: Optional[str] = None
    rects: Optional[List[Dict[str, float]]] = None
    text: Optional[str] = None
    comment: Optional[str] = None
    tags: Optional[str] = None


def _pdf_annotation_to_dict(ann: _PdfAnnotation) -> Dict[str, Any]:
    return {
        "id": ann.id,
        "source_uri": ann.source_uri,
        "page": ann.page,
        "type": ann.type,
        "color": ann.color,
        "rects": json.loads(ann.rects_json) if ann.rects_json else [],
        "text": ann.text,
        "comment": ann.comment,
        "tags": ann.tags,
        "created_at": ann.created_at.isoformat() if ann.created_at else None,
        "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
    }


@router.get("/pdf-annotations")
def list_pdf_annotations(
    source_uri: str = Query(..., min_length=1),
    db: _AnnSession = Depends(_ann_get_db),
):
    """Llista totes les anotacions associades a un PDF (per `source_uri`).

    Ordenades per pàgina ascendent + data de creació, perquè la sidebar
    pugui mostrar-les en l'ordre de lectura natural.
    """
    items = (
        db.query(_PdfAnnotation)
        .filter(_PdfAnnotation.source_uri == source_uri)
        .order_by(_PdfAnnotation.page.asc(), _PdfAnnotation.created_at.asc())
        .all()
    )
    return [_pdf_annotation_to_dict(i) for i in items]


@router.post(
    "/pdf-annotations",
    dependencies=[Depends(require_role("editor"))],
)
def create_pdf_annotation(
    body: _PdfAnnotationCreate,
    db: _AnnSession = Depends(_ann_get_db),
):
    # Tipus suportats: els del visor pdf.js antic (highlight, underline,
    # strikeout, comment, area) MÉS els que emet el reader Zotero (text,
    # note, ink, image). Sense aquests últims, els saves provinents del
    # reader integrat tornarien 400 i el frontend els perdria silenciosament.
    if body.type not in {
        "highlight", "underline", "strikeout", "comment", "area",
        "text", "note", "ink", "image",
    }:
        raise HTTPException(status_code=400, detail=f"Unsupported annotation type: {body.type}")
    ann = _PdfAnnotation(
        source_uri=body.source_uri,
        page=body.page,
        type=body.type,
        color=body.color or "#ffeb3b",
        rects_json=json.dumps(body.rects) if body.rects else None,
        text=body.text,
        comment=body.comment,
        tags=body.tags,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@router.patch(
    "/pdf-annotations/{ann_id}",
    dependencies=[Depends(require_role("editor"))],
)
def update_pdf_annotation(
    ann_id: int,
    body: _PdfAnnotationUpdate,
    db: _AnnSession = Depends(_ann_get_db),
):
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if body.color is not None:
        ann.color = body.color
    if body.comment is not None:
        ann.comment = body.comment
    if body.tags is not None:
        ann.tags = body.tags
    if body.text is not None:
        ann.text = body.text
    if body.rects is not None:
        ann.rects_json = json.dumps(body.rects)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@router.delete(
    "/pdf-annotations/{ann_id}",
    dependencies=[Depends(require_role("editor"))],
)
def delete_pdf_annotation(
    ann_id: int,
    db: _AnnSession = Depends(_ann_get_db),
):
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    db.delete(ann)
    db.commit()
    return {"status": "ok", "id": ann_id}
