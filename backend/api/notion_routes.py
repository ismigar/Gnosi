"""Endpoints for the Notion CLONE → Gnosi Vault.

Connection (REST integration token + MCP OAuth), listing DBs and loose pages, schema per
DB, and the EXACT CLONE into a new folder (`services.notion_clone.clone_workspace`): schema,
pages, relations, embedded views, colors, columns, attachments, and covers. Blocking (HTTP
to Notion/MCP) → runs in a thread. Token in `integrations.json` (like Google).

cf. directives `notion_exact_clone.md` and `notion_import_configurable_schema.md`.
"""
import asyncio
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import List, Optional

import yaml
from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel

from backend.services.workspace_service import require_role
from backend.services.context_vars import get_active_vault_path
from backend.services.notion_importer import NotionClient, _plain_title, _page_title
from backend.services import notion_mcp
from backend.services import notion_mcp_md
from backend.services import notion_clone
from backend.services.integration_manager import integration_manager
from backend.api import vault_routes
from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title
from backend.config.logger_config import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/notion", tags=["Notion Import"])


# ---------------------------------------------------------------------------
# Token: FIRST-CLASS integration via IntegrationManager (key `notion`).
# The manager does read-modify-write with a lock and shared caches → nothing clobbers it
# another service (it used to be written directly to integrations.json and got lost).
# ---------------------------------------------------------------------------
def _get_token() -> Optional[str]:
    return (integration_manager.get_raw("notion") or {}).get("token")


class TokenPayload(BaseModel):
    token: str


@router.post("/token", dependencies=[Depends(require_role("admin"))])
async def set_token(payload: TokenPayload):
    """Saves and validates the Notion integration token (tests it with /users/me)."""
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="El token és buit")
    try:
        me = await asyncio.to_thread(NotionClient(token).me)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token invàlid o sense permisos: {e}")
    name = me.get("name") or "Notion"
    integration_manager.replace_key("notion", {"token": token, "name": name})
    return {"status": "success", "name": name}


@router.get("/status")
async def notion_status():
    return {"connected": bool(_get_token())}


@router.delete("/token", dependencies=[Depends(require_role("admin"))])
async def delete_token():
    integration_manager.replace_key("notion", {})
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Import panel config: PER-WORKSPACE on the server (not just localStorage).
# The frontend used to save it ONLY to localStorage and it got lost on every origin change
# (http→https, preview port, different Mac, browser profile) — incident 2026-07-03.
# It's saved as-is (same JSON shape as the localStorage key
# `gnosi_notion_import_cfg`) to local_data/system/notion_import_config.json with
# atomic write (safe_write_json) and read-modify-write lock, like integrations.json.
# It does NOT go into integrations.json: get_all_safe() would mask/show the config as if
# were a credential to the rest of the consumers (mail, calendar, settings).
# ---------------------------------------------------------------------------
_IMPORT_CFG_LOCK = threading.Lock()


def _import_cfg_path():
    from backend.config.app_config import load_params
    return load_params(strict_env=False).paths["LOCAL_DATA"] / "system" / "notion_import_config.json"


@router.get("/import-config", dependencies=[Depends(require_role("editor"))])
async def get_import_config():
    """Saved config of the import panel (databases, selected, schemaOverrides,
    cloneVaultId, newVaultName, loosePageTypes…). {config: null} if there is none."""
    path = _import_cfg_path()
    if not path.exists():
        return {"config": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — corrupt file = as if it did not exist
        return {"config": None}
    return {"config": data if isinstance(data, dict) else None}


@router.put("/import-config", dependencies=[Depends(require_role("editor"))])
async def put_import_config(payload: dict = Body(...)):
    """Saves the import panel config (free-form JSON, same shape as the frontend's
    localStorage). Overwrites it wholesale (last-write-wins)."""
    from backend.utils.safe_io import safe_write_json
    path = _import_cfg_path()
    with _IMPORT_CFG_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(path, payload, ensure_ascii=False, indent=2)
    return {"status": "success"}


@router.get("/databases", dependencies=[Depends(require_role("editor"))])
async def list_databases():
    """Lists the Notion DBs shared with the integration."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        dbs = await asyncio.to_thread(NotionClient(token).search_databases)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    return {"databases": [
        {"id": d["id"], "title": _plain_title(d.get("title")) or "Untitled"} for d in dbs
    ]}


@router.get("/databases/{db_id}/schema", dependencies=[Depends(require_role("editor"))])
async def database_schema(db_id: str):
    """Schema of a Notion DB in SchemaConfigModal format (to configure it before
    importing/cloning it). {schema: {field:type, camp_config:{...}}, name}."""
    from backend.services.notion_importer import map_database_schema
    from backend.services.notion_schema_config import notion_props_to_modal_schema
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        db = await asyncio.to_thread(NotionClient(token).get_database, db_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    table = map_database_schema(db)
    return {"name": table.get("name"), "schema": notion_props_to_modal_schema(table.get("properties", []))}


def _collect_loose_pages(token: str) -> list:
    """Pages that are TRULY outside any DB: walking up the `parent` chain reaches
    `workspace` without ever finding a `database_id`. Looking only at the direct parent isn't enough:
    a subpage nested inside a DB row has `parent.type == "page_id"` (the parent is the
    row-page) and used to slip into the "loose" list. We resolve the chain with memoization
    (cache by id + reuse of already-loaded pages) to limit calls to Notion."""
    client = NotionClient(token)
    pages = client.search_pages()
    by_id = {p["id"]: p for p in pages}
    cache: dict = {}

    def _parent_of(node_id: str, fetch) -> dict:
        node = by_id.get(node_id)
        if node is None:
            try:
                node = fetch(node_id)
                by_id[node_id] = node
            except Exception:
                return {}
        return node.get("parent") or {}

    def _is_loose(node_id: str, kind: str, seen: set) -> bool:
        key = (kind, node_id)
        if key in cache:
            return cache[key]
        if key in seen:  # guard against cycles (there shouldn't be any)
            return True
        seen.add(key)
        parent = _parent_of(node_id, client.get_block if kind == "block" else client.get_page)
        ptype = parent.get("type")
        if ptype == "database_id":
            res = False
        elif ptype == "workspace":
            res = True
        elif ptype == "page_id":
            res = _is_loose(parent["page_id"], "page", seen)
        elif ptype == "block_id":
            res = _is_loose(parent["block_id"], "block", seen)
        else:  # unknown → we don't hide the page (conservative behavior)
            res = True
        cache[key] = res
        return res

    return [{"id": p["id"], "title": _page_title(p) or "Untitled"}
            for p in pages if _is_loose(p["id"], "page", set())]


def _find_linked_databases(token: str, max_pages: int = 400) -> dict:
    """Finds LINKED DBs (views) visible in Notion but NOT importable: the API can't
    read them and `/search` doesn't return them. They live as `child_database` blocks inside pages
    (dashboards/directories). We scan the DIRECT children of loose pages (depth 1, where they usually
    are, e.g. a «DB» page); a DB that isn't an accessible source and returns a 'linked database'
    error / not found → is a linked view (its SOURCE needs to be shared). Bounded by `max_pages`."""
    client = NotionClient(token)
    accessible = {d["id"] for d in client.search_databases()}
    loose = _collect_loose_pages(token)
    found: dict = {}
    scanned, capped = 0, False
    for p in loose:
        if scanned >= max_pages:
            capped = True
            break
        scanned += 1
        try:
            blocks = client.get_block_children_shallow(p["id"])
        except Exception:  # noqa: BLE001
            continue
        for b in blocks:
            if b.get("type") != "child_database":
                continue
            dbid = b["id"]
            if dbid in accessible or dbid in found:
                continue
            kind = client.database_kind(dbid)
            if kind in ("linked", "inaccessible", "page"):
                found[dbid] = {
                    "title": (b.get("child_database") or {}).get("title") or "Untitled",
                    "page_title": p.get("title") or "Untitled",
                    "kind": kind,
                }
    return {"linked": list(found.values()), "scanned": scanned, "capped": capped}


@router.get("/linked-databases", dependencies=[Depends(require_role("editor"))])
async def list_linked_databases():
    """Linked DBs (views) that show up in Notion but can't be imported via API."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        out = await asyncio.to_thread(_find_linked_databases, token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    return out


@router.get("/loose-pages", dependencies=[Depends(require_role("editor"))])
async def list_loose_pages():
    """Notion pages OUTSIDE any DB → for choosing wiki/dashboard."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        out = await asyncio.to_thread(_collect_loose_pages, token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    return {"pages": out}


def _sanitize_folder(name: str) -> str:
    # Per-segment OneDrive sanitation (keeps `/` for nesting): forbidden chars,
    # trailing dot/space per segment, Windows reserved names, `..` traversal.
    return sanitize_rel_folder(name, fallback="Notion")


# ---------------------------------------------------------------------------
# EXACT CLONE (Notion = source of truth) → NEW folder, namespaced ids, body via MCP
# ---------------------------------------------------------------------------
class ClonePayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = ""   # empty = vault root (clone without subfolder)
    schema_overrides: Optional[dict] = None  # {db_id: SchemaConfigModal schema}
    loose_page_types: Optional[dict] = None  # {notion_page_id: "wiki"|"dashboard"}
    download_assets: bool = True  # False = doesn't download attachments (leaves the Notion URLs); fast clone
    prune_orphans: bool = False  # explicit source-of-truth repair: soft-delete rows absent from Notion
    follow_subpages: bool = True


# Progress of the ongoing clone: the clone runs in a (blocking) thread and the frontend polls it
# via polling on GET /clone/progress. Local single-user → a module-level state is enough (dict
# reads/writes are atomic under the GIL). It's reset at the start of every clone.
_CLONE_PROGRESS: dict = {"running": False, "phase": "idle", "done": 0, "total": 0,
                         "pages": 0, "tables": 0, "views": 0, "attachments": 0,
                         "collected": 0, "tables_total": 0, "pages_total": 0,
                         "vault_id": None}
# Cooperative abort signal: POST /clone/abort sets it to True; clone_workspace checks it
# between items (via should_cancel) and stops with CloneAborted (leaves the partial clone on disk).
_CLONE_CANCEL: dict = {"flag": False}


# Clone heartbeat for the native watchdog (scripts/runtime/native_watchdog.sh): the clone runs in a
# thread and can leave the event loop so busy that the watchdog's HTTP polling fails
# (incident 2026-07-04: kickstart -k killed TWO healthy clones). The thread touches this
# file on every processed item; the watchdog, if it sees it fresh, doesn't restart the service.
_CLONE_HEARTBEAT_PATH = Path(os.environ.get("GNOSI_CLONE_HEARTBEAT",
                                            str(Path.home() / ".gnosi_clone_heartbeat")))
_CLONE_HEARTBEAT_MIN_INTERVAL = 5.0  # s; throttle (emission is now per row)
_clone_heartbeat_last: list = [0.0]


def _touch_clone_heartbeat() -> None:
    now = time.monotonic()
    if now - _clone_heartbeat_last[0] < _CLONE_HEARTBEAT_MIN_INTERVAL:
        return
    _clone_heartbeat_last[0] = now
    try:
        _CLONE_HEARTBEAT_PATH.touch()
    except Exception:  # noqa: BLE001
        pass


def _clear_clone_heartbeat() -> None:
    try:
        _CLONE_HEARTBEAT_PATH.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


def _clone_progress_cb(phase: str, done: int, total: int, report: dict) -> None:
    _touch_clone_heartbeat()
    _CLONE_PROGRESS.update({
        "running": phase != "done", "phase": phase, "done": done, "total": total,
        "pages": report.get("pages", 0), "tables": report.get("tables", 0),
        "views": report.get("views", 0), "attachments": report.get("attachments", 0),
        "collected": report.get("collected", 0),
        "tables_total": report.get("tables_total", 0), "pages_total": report.get("pages_total", 0),
        "scan_done": report.get("scan_done", 0), "scan_total": report.get("scan_total", 0),
    })
    # Notifies data plugins when the clone finishes (events bus v2).
    if phase == "done":
        try:
            from backend.services import plugin_events
            plugin_events.emit("clone:finished", {
                "source": "notion",
                "pages": report.get("pages", 0),
                "tables": report.get("tables", 0),
            })
        except Exception:  # noqa: BLE001
            pass


@router.get("/clone/progress", dependencies=[Depends(require_role("editor"))])
async def clone_progress():
    """Status of the ongoing clone (for the frontend's progress bar). Non-blocking."""
    return dict(_CLONE_PROGRESS)


@router.post("/clone/abort", dependencies=[Depends(require_role("editor"))])
async def clone_abort():
    """Requests to abort the ongoing clone. Cooperative cancellation: it stops at the next
    checkpoint (between pages), leaving what's already been cloned on disk. Non-blocking."""
    if not _CLONE_PROGRESS.get("running"):
        return {"status": "idle", "detail": "No clone is running"}
    _CLONE_CANCEL["flag"] = True
    return {"status": "aborting"}


def _run_clone_sync(database_ids, target_folder="Clon Notion", schema_overrides=None,
                    loose_page_types=None, download_assets=True, prune_orphans=False,
                    follow_subpages=True) -> dict:
    token = _get_token()
    if not token:
        raise RuntimeError("No Notion integration token is configured")
    if not notion_mcp.is_connected():
        raise RuntimeError("Connect Notion MCP (embedded views) before cloning")
    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("There is no active vault")
    rest = NotionClient(token)
    folder_by_table: dict = {}
    # Optional subfolder: empty ("") = the clone goes DIRECTLY to the vault root (no wrapper).
    tf = sanitize_rel_folder(target_folder)

    # RECLONE DEDUPLICATION (2026-07-04 incident, 907 duplicates): clone ids are
    # deterministic (UUID5 from the Notion id). Recloning a vault that already
    # contains a clone must OVERWRITE each page's existing file (same frontmatter
    # id), never create a second "Title id8.md". The id8 suffix is reserved for
    # genuine title collisions between pages with DIFFERENT ids. Build the
    # id-to-path map once by scanning ONLY clone output roots (BD/Wiki/.Dashboards);
    # reading the entire vault would download unrelated online-only OneDrive files.

    def _frontmatter_meta(p: Path) -> dict:
        try:
            with open(p, encoding="utf-8") as fh:
                if fh.readline().strip() != "---":
                    return {}
                lines = []
                for line in fh:
                    if line.strip() == "---":
                        return yaml.safe_load("".join(lines)) or {}
                    lines.append(line)
        except Exception:  # noqa: BLE001
            pass
        return {}

    path_by_id: dict = {}
    for root in ("BD", "Wiki", ".Dashboards"):
        if not (vault / root).is_dir():
            continue
        for p in (vault / root).rglob("*.md"):
            pid = _frontmatter_meta(p).get("id")
            if pid:
                path_by_id.setdefault(str(pid), p)
    written_ids_by_table: dict = {}  # table_id → written ids, used to detect orphan files

    def write_table(table: dict):
        # The clone runs in a worker thread (via asyncio.to_thread): without the shared
        # shared, these load→modify→save cycles could clobber each other with those
        # of a vault_routes handler (or with write_view/write_page from the clone itself).
        with vault_routes.registry_mutation():
            reg = vault_routes.load_registry()
            tables = reg.setdefault("tables", [])
            reg.setdefault("views", [])
            # The SIDEBAR groups tables by registry.databases (VaultSidebar shows "There are no
            # databases" if it's empty, even when there are tables): the clone must create the DB entry
            # grouping entry and link each table to it, like the native ones. folder="BD" because the physical location is
            # VAULT/BD/<table["folder"]> (the subfolder, if any, lives INSIDE table["folder"];
            # cf. _resolve_table_folder_from_metadata: VAULT/<db_folder>/<table_folder>).
            dbs = reg.setdefault("databases", [])
            entry = next((d for d in dbs if d.get("id") == "notion_clone_db"), None)
            if entry is None:
                dbs.append({"id": "notion_clone_db", "name": "Notion", "folder": "BD"})
            else:
                # ENSURES the fields (like ensure_default_registry_structure): a registry repaired in
                # set by hand or left mid-state with folder≠"BD" would make the folder resolution not match
                # the physical path the clone writes to. The name is only filled in when missing (custom values are respected).
                if not entry.get("name"):
                    entry["name"] = "Notion"
                if entry.get("folder") != "BD":
                    entry["folder"] = "BD"
            table["database_id"] = "notion_clone_db"
            idx = next((i for i, t in enumerate(tables) if t.get("id") == table["id"]), None)
            if idx is not None:
                existing = tables[idx]
                # GUARD against silent schema loss on re-clone. write_table REPLACES
                # the registry entry by id, so a degenerate clone — a transient/partial
                # Notion `get_database` fetch, or an empty schema override — that builds
                # the table with `properties: []` would clobber a previously-good schema.
                # Real incident: "Recursos" lost its 35 properties and the grid rendered
                # only Title + last-edited. A Notion database always has at least the
                # title property, so empty incoming properties are never intentional:
                # keep the existing schema instead of wiping it.
                if not (table.get("properties") or []) and (existing.get("properties") or []):
                    log.warning(
                        "notion clone: refusing to overwrite table %r (%s) with an empty "
                        "properties list; keeping the %d existing propert(ies).",
                        existing.get("name"), table.get("id"), len(existing["properties"]),
                    )
                    table["properties"] = existing["properties"]
                previous_revision = vault_routes._schema_revision(
                    existing.get("schema_revision")
                )
                if vault_routes._table_schema_signature(
                    table.get("properties")
                ) != vault_routes._table_schema_signature(existing.get("properties")):
                    table["schema_revision"] = previous_revision + 1
                elif previous_revision:
                    table["schema_revision"] = previous_revision
                tables[idx] = table
            else:
                table["schema_revision"] = 1
                tables.append(table)
            # The registry stores the LEAF (table["folder"], e.g. "Àrees"); the physical path goes under BD/ as
            # Gnosi's native tables do (cf. _ensure_table_vault_folder / _resolve_table_folder_
            # from_metadata: VAULT/BD/<folder> when the table has no database). This way it won't need migrating later.
            phys = f"BD/{table['folder']}"
            folder_by_table[table["id"]] = phys
            vault_routes.save_registry(reg)
        (vault / phys).mkdir(parents=True, exist_ok=True)

    def write_view(view: dict):
        with vault_routes.registry_mutation():
            reg = vault_routes.load_registry()
            views = reg.setdefault("views", [])
            idx = next((i for i, v in enumerate(views) if v.get("id") == view.get("id")), None)
            if idx is not None:
                views[idx] = view
            else:
                views.append(view)
            vault_routes.save_registry(reg)

    def write_page(page: dict):
        meta = dict(page.get("metadata") or {})
        # Same placement as the native save (cf. vault_routes save_page):
        #   · a table's row → the table's folder (DB/<Table>)
        #   · loose dashboard page (is_dashboard) → .Dashboards/
        #   · loose wiki page → Wiki/
        folder = folder_by_table.get(meta.get("table_id"))
        if folder is None:
            folder = ".Dashboards" if meta.get("is_dashboard") else "Wiki"
        meta["title"] = page.get("title") or "Untitled"
        meta["id"] = page.get("id") or str(uuid.uuid4())
        meta = {k: v for k, v in meta.items() if v is not None}
        safe = sanitize_vault_title(meta["title"])
        target_dir = vault / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        # Recloning OVERWRITES a file with the same frontmatter id in place. If
        # the page moved to a different folder in Notion, delete the old file and
        # write the new one so the same id never has two files.
        existing = path_by_id.get(meta["id"])
        if existing is not None and existing.exists() and existing.parent != target_dir:
            existing.unlink()
            existing = None
        if existing is not None and existing.exists():
            path = existing
        else:
            path = target_dir / f"{safe}.md"
            if path.exists() and str(_frontmatter_meta(path).get("id")) != meta["id"]:
                # Genuine title collision between pages with different ids: add id8.
                path = target_dir / f"{safe} {meta['id'][:8]}.md"
        path_by_id[meta["id"]] = path
        if meta.get("table_id"):
            written_ids_by_table.setdefault(meta["table_id"], set()).add(meta["id"])
        fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
        path.write_text(f"---\n{fm}\n---\n\n{str(page.get('content') or '').lstrip()}\n",
                        encoding="utf-8")
        vault_routes.register_page_in_index(path)

    def save_asset(url, prop, table):
        """Downloads an attachment to its place according to the field's config (like the native save):
        · file field with `storage_folder='library'` → Library folder INSIDE the
          clone's vault (self-contained), portable value `/api/vault/library/<file>`.
        · everything else (Assets by default, body images, icons/covers) → Assets/[subfolder/]<Table>/<Field|_body>/."""
        from backend.services.notion_attachments import download_to, download_file
        # `prop` is the field's NAME (or None for cos/_icones/_portades). Look it up in the schema to
        # read its storage_folder; only real file fields can go to Library.
        prop_dict = next((p for p in (table.get("properties") or []) if p.get("name") == prop), None) if prop else None
        storage = str((vault_routes._property_config_value(prop_dict, "storage_folder") if prop_dict else "") or "").strip().lower()
        # Short timeout: on a slow network, a file that doesn't download within 15s is skipped (better a
        # complete clone missing an attachment or two than getting stuck for 60s per file). Fast ones still make it.
        # TOTAL budget per file: generous enough for large PDFs (20-30 MB at ~400KB/s),
        # but capped so a degraded S3 doesn't stall the clone forever (2026-07-01).
        DL_TIMEOUT = 90.0
        if storage == "library":
            # INSIDE the clone's vault (self-contained: deleting the vault takes everything with it).
            # The vault-first resolution of get_p("LIBRARY") will find it from now on;
            # vaults with a legacy (sibling) Library are unaffected (read fallback).
            biblio = vault / "Library"
            fname = download_file(url, biblio, timeout=DL_TIMEOUT)
            return f"/api/vault/library/{fname}" if fname else None
        # Folder segments (table/field name): OneDrive forbids trailing dots/spaces
        # and reserved names also on FOLDERS, hence sanitize_vault_title per segment.
        clean = lambda s, d: sanitize_vault_title(s, fallback=d)  # noqa: E731
        leaf = clean(table.get("name"), "Taula")
        sub = clean(prop, "") if prop else "_cos"
        dest = vault / "Assets"
        if tf:
            dest = dest / tf
        dest = dest / leaf / (sub or "_camp")
        return download_to(url, dest, vault, timeout=DL_TIMEOUT)

    report = notion_clone.clone_workspace(
        rest, fetch_page=notion_mcp.fetch, mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
        write_table=write_table, write_page=write_page, write_view=write_view,
        # [] ≠ None: an EMPTY list is an explicit choice ("no DBs" — e.g. an
        # incremental clone of loose pages only); previously `or` turned it into "ALL
        # DBs" and a loose-only clone ended up cloning the whole workspace. None (a payload with no
        # field) does mean "all" (kept for compatibility with API calls).
        database_ids=(database_ids if database_ids is not None
                      else [d["id"] for d in rest.search_databases()]),
        target_folder=tf,
        schema_overrides=schema_overrides,
        save_asset=(save_asset if download_assets else None),
        loose_page_types=loose_page_types,
        progress_cb=_clone_progress_cb,
        should_cancel=lambda: _CLONE_CANCEL["flag"],
        registry_tables=vault_routes.load_registry().get("tables", []),
        follow_subpages=follow_subpages,
    )

    # ORPHAN FILES have a cloned table_id but an id that no longer exists in
    # Notion (deleted or recreated rows). The default remains report-only. An
    # explicit source-of-truth repair can soft-delete them to `.trash`, but only
    # after a complete, error-free clone; otherwise unwritten pages would look
    # like false orphans and valid content could be removed.
    report["orphan_rows_pruned"] = 0
    if not report.get("truncated") and not report.get("errors") and not _CLONE_CANCEL["flag"]:
        for table_id, phys in folder_by_table.items():
            table_dir = vault / phys
            if not table_dir.is_dir():
                continue
            written = written_ids_by_table.get(table_id, set())
            for p in sorted(table_dir.glob("*.md")):
                m = _frontmatter_meta(p)
                if str(m.get("table_id")) == str(table_id) and str(m.get("id")) not in written:
                    page_id = str(m.get("id") or "")
                    if prune_orphans and page_id:
                        try:
                            vault_routes._move_page_to_trash(page_id, p)
                            vault_routes.remove_from_link_index(page_id)
                            vault_routes._remove_page_from_index_cache(page_id, p)
                            report["orphan_rows_pruned"] += 1
                            continue
                        except Exception as exc:  # noqa: BLE001
                            report["warnings"].append(
                                f"Could not move orphan row «{p.relative_to(vault)}» "
                                f"(id {page_id}) to trash: {exc}")
                    report["warnings"].append(
                        f"Orphan row (id no longer exists in Notion): «{p.relative_to(vault)}» "
                        f"(id {m.get('id')}). It was not deleted automatically.")
    return report


@router.post("/clone", dependencies=[Depends(require_role("editor"))])
async def run_clone(payload: ClonePayload, x_vault_id: Optional[str] = Header(default=None)):
    """EXACT Notion clone into a NEW folder (views+columns via MCP). Doesn't touch the vault."""
    # SAFETY GUARD: if a specific destination vault is requested (X-Vault-Id) but it does NOT resolve to any
    # real vault (e.g. it was deleted and the frontend sends the old id), we abort. Without this the
    # middleware silently falls back to the PRINCIPAL vault and the clone dirties it (real incident).
    if x_vault_id:
        # Direct DB validation (no cache) to avoid false positives and avoid relying on private functions.
        try:
            from backend.data.management_db import _get_or_init_mgmt_engine
            from backend.models.management import Vault
            _, SessionLocal = _get_or_init_mgmt_engine()
            db = SessionLocal()
            try:
                row = db.query(Vault.path_override).filter(Vault.id == x_vault_id).first()
                ok = bool(row and row[0])
            finally:
                db.close()
        except Exception:
            ok = False
        if not ok:
            raise HTTPException(
                status_code=400,
                detail="The selected destination vault does not exist and may have "
                       "been deleted. Refresh the page and select it again before cloning.",
            )
    if not notion_mcp.is_connected():
        raise HTTPException(
            status_code=400,
            detail="Connect the Notion MCP for embedded views before running an exact clone",
        )
    # Preflight: a single live MCP check. If the token has expired (and can't
    # be renewed) we abort RIGHT AWAY with a clear message, instead of running a long clone that would come out
    # empty, hitting the dead MCP for every single page (this was the "never finishes" bug).
    ok, reason = await asyncio.to_thread(notion_mcp.healthcheck)
    if not ok:
        msg = ("The Notion MCP has expired; reconnect it with “Connect MCP” and clone again"
               if reason in ("expired", "no_token")
               else f"The Notion MCP is not responding ({reason}); reconnect it and try again")
        raise HTTPException(status_code=400, detail=msg)
    _CLONE_CANCEL["flag"] = False
    _CLONE_PROGRESS.update({"running": True, "phase": "starting", "done": 0, "total": 0,
                            "pages": 0, "tables": 0, "views": 0, "attachments": 0, "collected": 0,
                            "tables_total": 0, "pages_total": 0,
                            "vault_id": x_vault_id})  # so the frontend checks against the correct vault
    try:
        report = await asyncio.to_thread(_run_clone_sync, payload.database_ids,
                                         payload.target_folder, payload.schema_overrides,
                                         payload.loose_page_types, payload.download_assets,
                                         payload.prune_orphans, payload.follow_subpages)
    except notion_clone.CloneAborted:
        # Aborted by the user: whatever has been cloned so far stays on disk. We return the
        # partial counters (from _CLONE_PROGRESS) so the frontend can show what was done before stopping.
        _CLONE_PROGRESS["phase"] = "cancelled"
        return {"status": "cancelled",
                "tables": _CLONE_PROGRESS.get("tables", 0), "pages": _CLONE_PROGRESS.get("pages", 0),
                "views": _CLONE_PROGRESS.get("views", 0),
                "attachments": _CLONE_PROGRESS.get("attachments", 0),
                "errors": [], "warnings": ["Clone aborted by the user. This is a partial "
                                           "clone; completed content remains on disk."], "truncated": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error cloning from Notion: {e}")
    finally:
        _CLONE_PROGRESS["running"] = False
        _CLONE_CANCEL["flag"] = False
        # With no clone running, the watchdog should regain its normal authority.
        _clear_clone_heartbeat()
    return {"status": "success", **report}


# ---------------------------------------------------------------------------
# VERIFY THE CLONE (Notion ↔ clone health): to build confidence before abandoning Notion
# ---------------------------------------------------------------------------
class VerifyPayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = ""   # empty = vault root (clone without subfolder)


def _split_frontmatter(text: str):
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            meta = yaml.safe_load(parts[1]) or {}
            return (meta if isinstance(meta, dict) else {}), parts[2].lstrip("\n")
    return {}, text


def _run_verify_sync(token: str, database_ids, target_folder="") -> dict:
    from backend.services.notion_clone_verify import verify_clone, relation_ids
    from backend.services.relation_links import relation_keys_from_table
    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("There is no active vault")
    rest = NotionClient(token)
    db_ids = database_ids or [d["id"] for d in rest.search_databases()]
    notion_counts = {}
    for db_id in db_ids:
        try:
            notion_counts[notion_clone.clone_table_id(db_id)] = sum(1 for _ in rest.query_database(db_id))
        except Exception:  # noqa: BLE001
            notion_counts[notion_clone.clone_table_id(db_id)] = -1

    reg = vault_routes.load_registry()
    rel_keys_by_table = {t.get("id"): relation_keys_from_table(t) for t in reg.get("tables", [])}

    pages = []
    tf = sanitize_rel_folder(target_folder)
    folder = (vault / tf) if tf else vault   # empty = vault root
    for md in folder.rglob("*.md"):
        try:
            meta, body = _split_frontmatter(md.read_text(encoding="utf-8"))
            tid = meta.get("table_id")
            relations = []
            for k in rel_keys_by_table.get(tid, set()):
                relations += relation_ids(meta.get(k))
            assets = [v for key in ("icon", "cover")
                      for v in [meta.get(key)] if isinstance(v, str) and v.startswith("Assets/")]
            assets += re.findall(r"!\[[^\]]*\]\((Assets/[^)\s]+)\)", body)
            missing = [a for a in assets if not (vault / a).exists()]
            pages.append({"id": meta.get("id"), "table_id": tid,
                          "body_empty": not body.strip(),
                          "view_count": body.count("gnosi-view:def"),
                          "relations": relations, "missing_assets": missing})
        except Exception:  # noqa: BLE001
            continue
    return verify_clone(notion_counts, pages)


@router.post("/verify-clone", dependencies=[Depends(require_role("editor"))])
async def verify_clone_route(payload: VerifyPayload):
    """Checks the health of the clone (Notion ↔ clone): count parity per DB, empty bodies,
    orphaned relations, recreated views, and attachments missing from disk. Doesn't touch anything."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        result = await asyncio.to_thread(_run_verify_sync, token, payload.database_ids,
                                         payload.target_folder)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error verificant el clon: {e}")
    return {"status": "success", **result}
