"""
vault_views_routes.py — API to manage per-page views.

POST   /api/pages/{page_id}/views          → adds/updates a view
GET    /api/pages/{page_id}/views          → lists the page's views
DELETE /api/pages/{page_id}/views/{heading} → deletes a view
"""

import json
import logging
import sys
from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any, List, Optional, cast

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict

from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_json
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role

log = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ViewFilter(BaseModel):
    field: str
    value: str  # "this" = current page_id, or an explicit UUID


class ViewSection(BaseModel):
    # Allows additional fields (view_id, sorts, visible_properties, view_type,
    # group_by, etc.) that the frontend adds on top of the canonical
    # minimal version. This way sections saved to the registry preserve all the fields
    # when re-saved — previously, undeclared ones were lost in model_dump.
    model_config = ConfigDict(extra='allow')

    heading: str
    heading_level: int = 1
    type: str = "db_view"
    source_table_id: str
    filter: Optional[ViewFilter] = None
    columns: List[str] = ["title"]
    # Multi-table views: ordered joins to apply on top of `source_table_id`.
    # Each item: { tableId, type: inner|left|right, leftField, rightField }.
    # Optional (absent = single-table view, backward compatible).
    joins: Optional[List[dict[str, Any]]] = None

    def model_post_init(self, _ctx: Any) -> None:
        # Sanitize heading: line breaks split the final markdown and
        # generate an invalid `# Heading\nrest`. We flatten to spaces.
        if self.heading:
            self.heading = " ".join(self.heading.splitlines()).strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _registry_mutation() -> AbstractContextManager[None]:
    """Context manager for the registry's RMW cycle, SHARED with vault_routes.

    This module and vault_routes.py do RMW on THE SAME file
    (`vault_db_registry.json`): vault_routes mutates `tables`/`views`/... and here
    we mutate `pages`, but both load and save the WHOLE file. Without a
    single lock, a concurrent `create_table` (vault_routes) and a view upsert (here)
    would clobber each other (last-writer-wins between modules). Lazy import to
    break the import cycle (server imports both routers).
    
    """
    from backend.api import vault_routes as _vr
    mutation = cast(
        Callable[[], AbstractContextManager[None]],
        _vr.registry_mutation,
    )
    return mutation()


def _load_registry(vault_path: Path) -> tuple[dict[str, Any], Path]:
    registry_path = vault_path / "BD" / "vault_db_registry.json"
    if not registry_path.exists():
        registry_path = vault_path / "vault_db_registry.json"
    if not registry_path.exists():
        raise FileNotFoundError(f"Registry no trobat: {registry_path}")
    payload: Any = json.loads(registry_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Vault registry root must be an object")
    registry = cast(dict[str, Any], payload)
    return registry, registry_path


def _save_registry(registry: dict[str, Any], registry_path: Path) -> None:
    # Atomic write — registry sits on cloud-synced storage; half-flushed
    # writes propagate to other devices and break everyone.
    safe_write_json(registry_path, registry, indent=2, ensure_ascii=False)
    # Refreshes vault_routes' in-memory cache. CRITICAL: vault_routes.load_registry
    # has a 30s fast-path (TTL) that returns the cached object WITHOUT even a stat() on the
    # file. If we didn't refresh it, a vault_routes mutator (e.g. create_table)
    # within this window would resume from its stale snapshot —without the
    # `pages` changes we just wrote— and would save over it, losing them. Refreshing it
    # with the fresh data makes that load already see this save.
    try:
        from backend.api import vault_routes as _vr
        _vr._update_registry_cache(registry_path, registry)
    except Exception as e:  # best-effort: never fail the save because of the cache
        log.debug("Could not refresh the vault_routes registry cache: %s", e)


def _page_exists_on_disk(page_id: str) -> bool:
    """Checks that the page exists in the vault.

    Delegates to `find_page_path` because it uses canonical id
    comparison (case- and dash-insensitive: frontmatter with
    `id: df3614865ff34a1490055d9b7b456492` matches a URL with
    `df361486-5ff3-4a14-9005-5d9b7b456492`, and vice versa).
    
    """
    try:
        from backend.api import vault_routes

        find_page = cast(Callable[[str], Path | None], vault_routes.find_page_path)
        return find_page(page_id) is not None
    except Exception as e:
        log.warning(f"_page_exists_on_disk error: {e}")
        return False


def _sync_page(page_id: str, registry: dict[str, Any], vault_path: Path) -> bool:
    """Syncs the .md sections (flat table for Obsidian).

    `sync_sections` lives in `pipeline/sandbox/` (gitignored): in the
    production image the directory is empty, the import fails and we return False. This
    is OK because the `gnosi-view` block is rendered by the frontend from the
    registry — the flat table is a best-effort for external markdown
    clients (Obsidian) and isn't necessary to see the view in the app.
    
    """
    try:
        sandbox = Path(__file__).parents[2] / "pipeline" / "sandbox"
        if str(sandbox) not in sys.path:
            sys.path.insert(0, str(sandbox))
        from sync_sections import sync_page_view  # type: ignore
        sync = cast(Callable[[str, dict[str, Any], Path], bool], sync_page_view)
        return sync(page_id, registry, vault_path)
    except Exception as e:
        log.debug(f"sync_page_view no disponible: {e}")
        return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/pages/{page_id}/views")
async def get_page_views(page_id: str):  # type: ignore[no-untyped-def]
    """Returns the views configured for a page."""
    try:
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            raise HTTPException(status_code=500, detail="VAULT_PATH no configurat")

        registry, _ = _load_registry(vault_path)
        page_cfg = (registry.get("pages") or {}).get(page_id, {})
        return {
            "page_id": page_id,
            "sections": page_cfg.get("sections", []),
        }
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=safe_error_detail(e, "GET /pages/{page_id}/views"),
        )
    except Exception as e:
        log.exception(e)
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /pages/{page_id}/views"),
        )


def _find_section_upsert_index(
    sections: list[dict[str, Any]],
    new_vid: Any,
    heading: str,
) -> int | None:
    """Index of the section to REPLACE in an upsert, or ``None`` to add a
    new one.

    If the incoming section has ``view_id``, it's matched by ``view_id`` (stable
    block identity): this way two embeds with the same heading (e.g. empty) but
    different view_id do NOT collide. If it doesn't have one (inline/legacy section),
    it's matched by ``heading`` but ONLY with sections that also lack a view_id
    (so as not to trample a section anchored to a registry view).
    
    """
    if new_vid:
        return next(
            (i for i, s in enumerate(sections) if s.get("view_id") == new_vid),
            None,
        )
    return next(
        (
            i for i, s in enumerate(sections)
            if not s.get("view_id") and s.get("heading") == heading
        ),
        None,
    )


@router.post("/pages/{page_id}/views", dependencies=[Depends(require_role("editor"))])
async def upsert_page_view(  # type: ignore[no-untyped-def]
    page_id: str,
    view: ViewSection,
):
    """
        Adds or updates a view for a specific page.
    Saves the config to the registry and syncs the .md.
    
    """
    try:
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            raise HTTPException(status_code=500, detail="VAULT_PATH no configurat")

        # Entire load→modify→save cycle under a lock SHARED with vault_routes
        # (same registry file). Synchronous body, no `await`: atomic too
        # relative to other coroutines. `_sync_page` (best-effort, touches the .md) used to
        # OUTSIDE the lock.
        with _registry_mutation():
            registry, registry_path = _load_registry(vault_path)

            # Source table validation before touching anything in the registry: this way
            # errors are clear (422) instead of a silent 200 with
            # md_synced: False, which confused the user.
            tables = registry.get("tables") or []
            target_table = next(
                (t for t in tables if str(t.get("id")) == str(view.source_table_id)),
                None,
            )
            if target_table is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Source table '{view.source_table_id}' does not exist in the registry.",
                )

            # If there's a filter, validate that the field exists in the table.
            if view.filter and view.filter.field:
                prop_names = {p.get("name") for p in (target_table.get("properties") or [])}
                if view.filter.field not in prop_names:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Filter field '{view.filter.field}' does not exist in table "
                            f"'{target_table.get('name')}'."
                        ),
                    )

            # The page must exist on disk before touching the registry. We use
            # `find_page_path` (canonical comparison) instead of a scan limited
            # to `.Dashboards`: pages in any vault folder (BD/, Arees/,
            # …) must also be validated.
            if not _page_exists_on_disk(page_id):
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Page {page_id} was not found on disk. The view was not created."
                    ),
                )

            # Initializes `pages` if it doesn't exist
            if "pages" not in registry:
                registry["pages"] = {}
            if page_id not in registry["pages"]:
                registry["pages"][page_id] = {"sections": []}

            pages = cast(dict[str, Any], registry["pages"])
            page_config = cast(dict[str, Any], pages[page_id])
            sections = cast(
                list[dict[str, Any]],
                page_config.setdefault("sections", []),
            )

            # Upsert: identifies the section by `view_id` (STABLE identity of the
            # block), not by heading — this way multiple embeds WITHOUT a heading on the
            # same page do NOT collide. See `_find_section_upsert_index`.
            new_section = view.model_dump()
            existing_idx = _find_section_upsert_index(
                sections, new_section.get("view_id"), view.heading
            )
            if existing_idx is not None:
                sections[existing_idx] = new_section
                action = "updated"
            else:
                sections.append(new_section)
                action = "created"

            _save_registry(registry, registry_path)

        # Best-effort: syncs the flat table to the .md file for Obsidian.
        # In production (without `pipeline/sandbox/`) it returns False — the block
        # `gnosi-view` is rendered by the frontend, not needed for the app.
        synced = _sync_page(page_id, registry, vault_path)

        return {
            "ok": True,
            "action": action,
            "page_id": page_id,
            "heading": view.heading,
            "md_synced": synced,
        }

    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=safe_error_detail(e, "POST /pages/{page_id}/views"),
        )
    except Exception as e:
        log.exception(e)
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /pages/{page_id}/views"),
        )


@router.delete("/pages/{page_id}/views/{heading}", dependencies=[Depends(require_role("editor"))])
async def delete_page_view(  # type: ignore[no-untyped-def]
    page_id: str,
    heading: str,
):
    """Deletes a view from a page and re-syncs the .md."""
    try:
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            raise HTTPException(status_code=500, detail="VAULT_PATH no configurat")

        # load→modify→save cycle under a shared lock; `_sync_page` outside.
        with _registry_mutation():
            registry, registry_path = _load_registry(vault_path)

            pages = registry.get("pages") or {}
            page_cfg = pages.get(page_id)
            if not page_cfg:
                raise HTTPException(status_code=404, detail=f"Page {page_id} has no views")

            sections = page_cfg.get("sections", [])
            new_sections = [s for s in sections if s.get("heading") != heading]
            if len(new_sections) == len(sections):
                raise HTTPException(status_code=404, detail=f"View '{heading}' not found")

            registry["pages"][page_id]["sections"] = new_sections
            _save_registry(registry, registry_path)
        _sync_page(page_id, registry, vault_path)

        return {"ok": True, "page_id": page_id, "heading_deleted": heading}

    except HTTPException:
        raise
    except Exception as e:
        log.exception(e)
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /pages/{page_id}/views/{heading}"),
        )
