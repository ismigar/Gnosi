"""Compatibility-preserving FastAPI surface for the typed Notion domain."""

from __future__ import annotations

import asyncio as asyncio
import json as json
import os as os
from pathlib import Path
import re as re
import threading as threading
import time as time
from typing import Any, Callable, Dict, List, Optional, cast
import uuid as uuid

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
import yaml as yaml

from backend.api import vault_routes
from backend.config.logger_config import get_logger
from backend.domains.notion import discovery
from backend.domains.notion.route_clone import (
    RouteCloneDependencies,
    VaultRoutesPort,
    run_route_clone,
)
from backend.domains.notion.verification import (
    VerificationDependencies,
    run_verification,
    split_frontmatter,
)
from backend.services import notion_clone, notion_mcp, notion_mcp_md
from backend.services.context_vars import get_active_vault_path
from backend.services.integration_manager import integration_manager
from backend.services.notion_importer import NotionClient, _page_title, _plain_title
from backend.services.workspace_service import require_role
from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title

JsonMap = Dict[str, Any]

log = get_logger(__name__)

router = APIRouter(prefix="/notion", tags=["Notion Import"])


def _get_token() -> Optional[str]:
    raw = integration_manager.get_raw("notion") or {}
    token = raw.get("token") if isinstance(raw, dict) else None
    return str(token) if token else None


class TokenPayload(BaseModel):
    token: str


class NotionTokenResponse(BaseModel):
    status: str
    name: str


class NotionStatusResponse(BaseModel):
    connected: bool


class NotionMutationResponse(BaseModel):
    status: str


class NotionImportConfigResponse(BaseModel):
    config: Optional[JsonMap]


class NotionDatabaseResponse(BaseModel):
    id: str
    title: str


class NotionDatabasesResponse(BaseModel):
    databases: List[NotionDatabaseResponse]


class NotionDatabaseSchemaResponse(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    name: Optional[str] = None
    schema_: JsonMap = Field(alias="schema")


class NotionLinkedDatabaseResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str
    page_title: str
    kind: str


class NotionLinkedDatabasesResponse(BaseModel):
    linked: List[NotionLinkedDatabaseResponse]
    scanned: int
    capped: bool


class NotionLoosePageResponse(BaseModel):
    id: str
    title: str


class NotionLoosePagesResponse(BaseModel):
    pages: List[NotionLoosePageResponse]


class NotionCloneProgressResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    running: bool
    phase: str
    done: int
    total: int
    pages: int
    tables: int
    views: int
    attachments: int
    collected: int
    tables_total: int
    pages_total: int
    vault_id: Optional[str]
    scan_done: Optional[int] = None
    scan_total: Optional[int] = None


class NotionCloneAbortResponse(BaseModel):
    status: str
    detail: Optional[str] = None


class NotionCloneResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str
    tables: int
    pages: int
    views: int
    attachments: int
    errors: List[JsonMap]
    warnings: List[str]
    truncated: bool
    collected: Optional[int] = None
    tables_total: Optional[int] = None
    pages_total: Optional[int] = None
    scan_done: Optional[int] = None
    scan_total: Optional[int] = None
    orphan_rows_pruned: Optional[int] = None


class NotionVerificationSummaryResponse(BaseModel):
    healthy: bool
    tables_ok: int
    tables_total: int
    pages: int
    empty_bodies: int
    views: int
    orphan_relations: int
    missing_assets: int


class NotionVerificationTableResponse(BaseModel):
    table_id: str
    notion: int
    clone: int
    ok: bool
    missing: int


class NotionOrphanRelationResponse(BaseModel):
    page: Optional[str] = None
    rel: str


class NotionMissingAssetResponse(BaseModel):
    page: Optional[str] = None
    asset: str


class NotionVerificationResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str
    summary: NotionVerificationSummaryResponse
    tables: List[NotionVerificationTableResponse]
    empty_bodies: List[Optional[str]]
    orphan_relations: List[NotionOrphanRelationResponse]
    missing_assets: List[NotionMissingAssetResponse]


@router.post(
    "/token",
    dependencies=[Depends(require_role("admin"))],
    response_model=NotionTokenResponse,
)
async def set_token(payload: TokenPayload) -> JsonMap:
    """Saves and validates the Notion integration token (tests it with /users/me)."""
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="El token és buit")
    try:
        me = await asyncio.to_thread(NotionClient(token).me)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Token invàlid o sense permisos: {exc}"
        ) from exc
    name = str(me.get("name") or "Notion")
    integration_manager.replace_key("notion", {"token": token, "name": name})
    return {"status": "success", "name": name}


@router.get("/status", response_model=NotionStatusResponse)
async def notion_status() -> JsonMap:
    return {"connected": bool(_get_token())}


@router.delete(
    "/token",
    dependencies=[Depends(require_role("admin"))],
    response_model=NotionMutationResponse,
)
async def delete_token() -> JsonMap:
    integration_manager.replace_key("notion", {})
    return {"status": "success"}


_IMPORT_CFG_LOCK = threading.Lock()


def _import_cfg_path() -> Path:
    from backend.config.app_config import load_params

    configured_root = load_params(strict_env=False).paths.get("LOCAL_DATA")
    if configured_root is None:
        raise RuntimeError("LOCAL_DATA is required for Notion import configuration")
    return Path(configured_root) / "system" / "notion_import_config.json"


@router.get(
    "/import-config",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionImportConfigResponse,
)
async def get_import_config() -> JsonMap:
    """Saved config of the import panel (databases, selected, schemaOverrides,
    cloneVaultId, newVaultName, loosePageTypes…). {config: null} if there is none."""
    path = _import_cfg_path()
    if not path.exists():
        return {"config": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"config": None}
    return {"config": data if isinstance(data, dict) else None}


@router.put(
    "/import-config",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionMutationResponse,
)
async def put_import_config(payload: Dict[str, Any] = Body(...)) -> JsonMap:
    """Saves the import panel config (free-form JSON, same shape as the frontend's
    localStorage). Overwrites it wholesale (last-write-wins)."""
    from backend.utils.safe_io import safe_write_json

    path = _import_cfg_path()
    with _IMPORT_CFG_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(path, payload, ensure_ascii=False, indent=2)
    return {"status": "success"}


@router.get(
    "/databases",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionDatabasesResponse,
)
async def list_databases() -> JsonMap:
    """Lists the Notion DBs shared with the integration."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        databases = await asyncio.to_thread(NotionClient(token).search_databases)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {exc}") from exc
    return {
        "databases": [
            {
                "id": database["id"],
                "title": _plain_title(database.get("title")) or "Untitled",
            }
            for database in databases
        ]
    }


@router.get(
    "/databases/{db_id}/schema",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionDatabaseSchemaResponse,
    response_model_exclude_unset=True,
)
async def database_schema(db_id: str) -> JsonMap:
    """Schema of a Notion DB in SchemaConfigModal format (to configure it before
    importing/cloning it). {schema: {field:type, camp_config:{...}}, name}."""
    from backend.services.notion_importer import map_database_schema
    from backend.services.notion_schema_config import notion_props_to_modal_schema

    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        database = await asyncio.to_thread(NotionClient(token).get_database, db_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {exc}") from exc
    table = map_database_schema(database)
    schema = notion_props_to_modal_schema(table.get("properties", []))
    return {"name": table.get("name"), "schema": schema}


def _collect_loose_pages(token: str) -> List[Dict[str, str]]:
    return discovery.collect_loose_pages(
        token,
        cast(discovery.ClientFactory, NotionClient),
        cast(discovery.TitleResolver, _page_title),
    )


def _find_linked_databases(token: str, max_pages: int = 400) -> Dict[str, object]:
    return discovery.find_linked_databases(
        token,
        cast(discovery.ClientFactory, NotionClient),
        _collect_loose_pages,
        max_pages,
    )


@router.get(
    "/linked-databases",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionLinkedDatabasesResponse,
)
async def list_linked_databases() -> Dict[str, object]:
    """Linked DBs (views) that show up in Notion but can't be imported via API."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        return await asyncio.to_thread(_find_linked_databases, token)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {exc}") from exc


@router.get(
    "/loose-pages",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionLoosePagesResponse,
)
async def list_loose_pages() -> JsonMap:
    """Notion pages OUTSIDE any DB → for choosing wiki/dashboard."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        pages = await asyncio.to_thread(_collect_loose_pages, token)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {exc}") from exc
    return {"pages": pages}


def _sanitize_folder(name: str) -> str:
    return str(sanitize_rel_folder(name, fallback="Notion"))


class ClonePayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = ""
    schema_overrides: Optional[Dict[str, Any]] = None
    loose_page_types: Optional[Dict[str, Any]] = None
    download_assets: bool = True
    prune_orphans: bool = False
    follow_subpages: bool = True


_CLONE_PROGRESS: JsonMap = {
    "running": False,
    "phase": "idle",
    "done": 0,
    "total": 0,
    "pages": 0,
    "tables": 0,
    "views": 0,
    "attachments": 0,
    "collected": 0,
    "tables_total": 0,
    "pages_total": 0,
    "vault_id": None,
}
_CLONE_CANCEL: Dict[str, bool] = {"flag": False}

_CLONE_HEARTBEAT_PATH = Path(
    os.environ.get("GNOSI_CLONE_HEARTBEAT", str(Path.home() / ".gnosi_clone_heartbeat"))
)
_CLONE_HEARTBEAT_MIN_INTERVAL = 5.0
_clone_heartbeat_last: List[float] = [0.0]


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


def _clone_progress_cb(phase: str, done: int, total: int, report: JsonMap) -> None:
    _touch_clone_heartbeat()
    _CLONE_PROGRESS.update(
        {
            "running": phase != "done",
            "phase": phase,
            "done": done,
            "total": total,
            "pages": report.get("pages", 0),
            "tables": report.get("tables", 0),
            "views": report.get("views", 0),
            "attachments": report.get("attachments", 0),
            "collected": report.get("collected", 0),
            "tables_total": report.get("tables_total", 0),
            "pages_total": report.get("pages_total", 0),
            "scan_done": report.get("scan_done", 0),
            "scan_total": report.get("scan_total", 0),
        }
    )
    if phase == "done":
        try:
            from backend.services import plugin_events

            plugin_events.emit(
                "clone:finished",
                {
                    "source": "notion",
                    "pages": report.get("pages", 0),
                    "tables": report.get("tables", 0),
                },
            )
        except Exception:  # noqa: BLE001
            pass


@router.get(
    "/clone/progress",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionCloneProgressResponse,
    response_model_exclude_unset=True,
)
async def clone_progress() -> JsonMap:
    """Status of the ongoing clone (for the frontend's progress bar). Non-blocking."""
    return dict(_CLONE_PROGRESS)


@router.post(
    "/clone/abort",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionCloneAbortResponse,
    response_model_exclude_unset=True,
)
async def clone_abort() -> JsonMap:
    """Requests to abort the ongoing clone. Cooperative cancellation: it stops at the next
    checkpoint (between pages), leaving what's already been cloned on disk. Non-blocking."""
    if not _CLONE_PROGRESS.get("running"):
        return {"status": "idle", "detail": "No clone is running"}
    _CLONE_CANCEL["flag"] = True
    return {"status": "aborting"}


def _route_clone_dependencies() -> RouteCloneDependencies:
    return RouteCloneDependencies(
        get_token=_get_token,
        mcp_connected=lambda: bool(notion_mcp.is_connected()),
        active_vault_path=get_active_vault_path,
        client_factory=cast(Callable[[str], Any], NotionClient),
        fetch_page=lambda page_id: str(notion_mcp.fetch(page_id)),
        mcp_to_markdown=lambda markdown: str(notion_mcp_md.mcp_to_markdown(markdown)),
        clone_workspace=lambda *args, **kwargs: dict(notion_clone.clone_workspace(*args, **kwargs)),
        progress_callback=_clone_progress_cb,
        should_cancel=lambda: bool(_CLONE_CANCEL["flag"]),
        sanitize_folder=lambda value: str(sanitize_rel_folder(value)),
        sanitize_title=lambda value, **kwargs: str(sanitize_vault_title(value, **kwargs)),
        vault_routes=cast(VaultRoutesPort, vault_routes),
        log_warning=log.warning,
    )


def _run_clone_sync(
    database_ids: Optional[List[str]],
    target_folder: str = "Clon Notion",
    schema_overrides: Optional[Dict[str, JsonMap]] = None,
    loose_page_types: Optional[Dict[str, str]] = None,
    download_assets: bool = True,
    prune_orphans: bool = False,
    follow_subpages: bool = True,
) -> JsonMap:
    return run_route_clone(
        _route_clone_dependencies(),
        database_ids,
        target_folder,
        schema_overrides,
        loose_page_types,
        download_assets,
        prune_orphans,
        follow_subpages,
    )


def _destination_vault_exists(vault_id: str) -> bool:
    try:
        from backend.data.management_db import _get_or_init_mgmt_engine
        from backend.models.management import Vault

        _, session_factory = _get_or_init_mgmt_engine()
        database = session_factory()
        try:
            row = database.query(Vault.path_override).filter(Vault.id == vault_id).first()
            return bool(row and row[0])
        finally:
            database.close()
    except Exception:  # noqa: BLE001
        return False


@router.post(
    "/clone",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionCloneResponse,
    response_model_exclude_unset=True,
)
async def run_clone(
    payload: ClonePayload,
    x_vault_id: Optional[str] = Header(default=None),
) -> JsonMap:
    """EXACT Notion clone into a NEW folder (views+columns via MCP). Doesn't touch the vault."""
    if x_vault_id and not _destination_vault_exists(x_vault_id):
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
    healthy, reason = await asyncio.to_thread(notion_mcp.healthcheck)
    if not healthy:
        message = (
            "The Notion MCP has expired; reconnect it with “Connect MCP” and clone again"
            if reason in ("expired", "no_token")
            else f"The Notion MCP is not responding ({reason}); reconnect it and try again"
        )
        raise HTTPException(status_code=400, detail=message)
    _CLONE_CANCEL["flag"] = False
    _CLONE_PROGRESS.update(
        {
            "running": True,
            "phase": "starting",
            "done": 0,
            "total": 0,
            "pages": 0,
            "tables": 0,
            "views": 0,
            "attachments": 0,
            "collected": 0,
            "tables_total": 0,
            "pages_total": 0,
            "vault_id": x_vault_id,
        }
    )
    try:
        report = await asyncio.to_thread(
            _run_clone_sync,
            payload.database_ids,
            payload.target_folder,
            payload.schema_overrides,
            payload.loose_page_types,
            payload.download_assets,
            payload.prune_orphans,
            payload.follow_subpages,
        )
    except notion_clone.CloneAborted:
        _CLONE_PROGRESS["phase"] = "cancelled"
        return {
            "status": "cancelled",
            "tables": _CLONE_PROGRESS.get("tables", 0),
            "pages": _CLONE_PROGRESS.get("pages", 0),
            "views": _CLONE_PROGRESS.get("views", 0),
            "attachments": _CLONE_PROGRESS.get("attachments", 0),
            "errors": [],
            "warnings": [
                "Clone aborted by the user. This is a partial clone; completed content remains on disk."
            ],
            "truncated": False,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error cloning from Notion: {exc}") from exc
    finally:
        _CLONE_PROGRESS["running"] = False
        _CLONE_CANCEL["flag"] = False
        _clear_clone_heartbeat()
    return {"status": "success", **report}


class VerifyPayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = ""


def _split_frontmatter(text: str) -> tuple[JsonMap, str]:
    return split_frontmatter(text)


def _verification_dependencies() -> VerificationDependencies:
    from backend.services.notion_clone_verify import relation_ids, verify_clone
    from backend.services.relation_links import relation_keys_from_table

    return VerificationDependencies(
        active_vault_path=get_active_vault_path,
        client_factory=cast(Callable[[str], Any], NotionClient),
        clone_table_id=notion_clone.clone_table_id,
        load_registry=lambda: dict(vault_routes.load_registry()),
        relation_ids=lambda value: list(relation_ids(value)),
        relation_keys_from_table=lambda table: set(relation_keys_from_table(table)),
        sanitize_folder=lambda value: str(sanitize_rel_folder(value)),
        verify_clone=lambda counts, pages: dict(verify_clone(counts, pages)),
    )


def _run_verify_sync(
    token: str,
    database_ids: Optional[List[str]],
    target_folder: str = "",
) -> JsonMap:
    return run_verification(_verification_dependencies(), token, database_ids, target_folder)


@router.post(
    "/verify-clone",
    dependencies=[Depends(require_role("editor"))],
    response_model=NotionVerificationResponse,
    response_model_exclude_unset=True,
)
async def verify_clone_route(payload: VerifyPayload) -> JsonMap:
    """Checks the health of the clone (Notion ↔ clone): count parity per DB, empty bodies,
    orphaned relations, recreated views, and attachments missing from disk. Doesn't touch anything."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No Notion token is configured")
    try:
        result = await asyncio.to_thread(
            _run_verify_sync, token, payload.database_ids, payload.target_folder
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error verificant el clon: {exc}") from exc
    return {"status": "success", **result}
