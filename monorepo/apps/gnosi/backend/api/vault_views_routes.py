"""
vault_views_routes.py — API per gestionar vistes per pàgina.

POST   /api/pages/{page_id}/views          → afegeix/actualitza una vista
GET    /api/pages/{page_id}/views          → llista vistes de la pàgina
DELETE /api/pages/{page_id}/views/{heading} → elimina una vista
"""

import json
import logging
import sys
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

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
    value: str  # "this" = page_id actual, o un UUID explícit


class ViewSection(BaseModel):
    heading: str
    heading_level: int = 1
    type: str = "db_view"
    source_table_id: str
    filter: Optional[ViewFilter] = None
    columns: List[str] = ["title"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_registry(vault_path: Path) -> tuple[dict, Path]:
    registry_path = vault_path / "BD" / "vault_db_registry.json"
    if not registry_path.exists():
        registry_path = vault_path / "vault_db_registry.json"
    if not registry_path.exists():
        raise FileNotFoundError(f"Registry no trobat: {registry_path}")
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    return registry, registry_path


def _save_registry(registry: dict, registry_path: Path) -> None:
    # Atomic write — registry sits on cloud-synced storage; half-flushed
    # writes propagate to other devices and break everyone.
    safe_write_json(registry_path, registry, indent=2, ensure_ascii=False)


def _sync_page(page_id: str, registry: dict, vault_path: Path) -> bool:
    """Crida sync_page_view del pipeline/sandbox per actualitzar el .md."""
    try:
        sandbox = Path(__file__).parents[2] / "pipeline" / "sandbox"
        if str(sandbox) not in sys.path:
            sys.path.insert(0, str(sandbox))
        from sync_sections import sync_page_view  # type: ignore
        return sync_page_view(page_id, registry, vault_path)
    except Exception as e:
        log.warning(f"sync_page_view error: {e}")
        return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/pages/{page_id}/views")
async def get_page_views(page_id: str):
    """Retorna les vistes configurades per a una pàgina."""
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


@router.post("/pages/{page_id}/views", dependencies=[Depends(require_role("editor"))])
async def upsert_page_view(page_id: str, view: ViewSection):
    """
    Afegeix o actualitza una vista per a una pàgina concreta.
    Guarda la config al registry i sincronitza el .md.
    """
    try:
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            raise HTTPException(status_code=500, detail="VAULT_PATH no configurat")

        registry, registry_path = _load_registry(vault_path)

        # Inicialitza `pages` si no existeix
        if "pages" not in registry:
            registry["pages"] = {}
        if page_id not in registry["pages"]:
            registry["pages"][page_id] = {"sections": []}

        sections: list = registry["pages"][page_id].setdefault("sections", [])

        # Upsert: substitueix si ja existeix un heading igual
        new_section = view.model_dump()
        existing_idx = next(
            (i for i, s in enumerate(sections) if s.get("heading") == view.heading),
            None,
        )
        if existing_idx is not None:
            sections[existing_idx] = new_section
            action = "updated"
        else:
            sections.append(new_section)
            action = "created"

        _save_registry(registry, registry_path)

        # Sync el .md
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
async def delete_page_view(page_id: str, heading: str):
    """Elimina una vista d'una pàgina i re-sincronitza el .md."""
    try:
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            raise HTTPException(status_code=500, detail="VAULT_PATH no configurat")

        registry, registry_path = _load_registry(vault_path)

        pages = registry.get("pages") or {}
        page_cfg = pages.get(page_id)
        if not page_cfg:
            raise HTTPException(status_code=404, detail=f"Pàgina {page_id} sense vistes")

        sections = page_cfg.get("sections", [])
        new_sections = [s for s in sections if s.get("heading") != heading]
        if len(new_sections) == len(sections):
            raise HTTPException(status_code=404, detail=f"Vista '{heading}' no trobada")

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
