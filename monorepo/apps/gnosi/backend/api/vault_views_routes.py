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
    value: str  # "this" = page_id actual, o un UUID explícit


class ViewSection(BaseModel):
    # Permet camps addicionals (view_id, sorts, visible_properties, view_type,
    # group_by, etc.) que el frontend afegeix a partir de la versió canònica
    # mínima. Així les seccions guardades al registry preserven tots els camps
    # quan són re-desades — abans, els no declarats es perdien al model_dump.
    model_config = ConfigDict(extra='allow')

    heading: str
    heading_level: int = 1
    type: str = "db_view"
    source_table_id: str
    filter: Optional[ViewFilter] = None
    columns: List[str] = ["title"]

    def model_post_init(self, _ctx) -> None:
        # Sanititzar heading: salts de línia parteixen el markdown final i
        # generen `# Heading\nresta` invàlid. Aplanem a espais.
        if self.heading:
            self.heading = " ".join(self.heading.splitlines()).strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _registry_mutation():
    """Context manager del cicle RMW del registre, COMPARTIT amb vault_routes.

    Aquest mòdul i vault_routes.py fan RMW sobre EL MATEIX fitxer
    (`vault_db_registry.json`): vault_routes muta `tables`/`views`/... i aquí
    mutem `pages`, però tots dos carreguen i desen el fitxer SENCER. Sense un
    candau únic, un `create_table` (vault_routes) i un upsert de vista (aquí)
    concurrents s'esclafarien (last-writer-wins entre mòduls). Import mandrós per
    trencar el cicle d'imports (server importa tots dos routers).
    """
    from backend.api import vault_routes as _vr
    return _vr.registry_mutation()


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
    # Refresca la caché en memòria de vault_routes. CRÍTIC: vault_routes.load_registry
    # té una fast-path de 30s (TTL) que torna l'objecte en caché SENSE ni stat() del
    # fitxer. Si no la refresquéssim, un mutador de vault_routes (p. ex. create_table)
    # dins d'aquesta finestra reprendria el seu snapshot ranci —sense els canvis de
    # `pages` que acabem d'escriure— i el desaria a sobre, perdent-los. Refrescar-la
    # amb les dades fresques fa que aquell load vegi ja aquest desat.
    try:
        from backend.api import vault_routes as _vr
        _vr._update_registry_cache(registry_path, registry)
    except Exception as e:  # best-effort: mai fer fallar el desat per la caché
        log.debug(f"No s'ha pogut refrescar la caché del registre de vault_routes: {e}")


def _page_exists_on_disk(page_id: str) -> bool:
    """Comprova que la pàgina existeix al vault.

    Delega a `find_page_path` perquè usa comparació canònica d'ids
    (insensible a guionets i majúscules: una frontmatter amb
    `id: df3614865ff34a1490055d9b7b456492` casa amb una URL amb
    `df361486-5ff3-4a14-9005-5d9b7b456492`, i a l'inrevés).
    """
    try:
        from backend.api.vault_routes import find_page_path
        return find_page_path(page_id) is not None
    except Exception as e:
        log.warning(f"_page_exists_on_disk error: {e}")
        return False


def _sync_page(page_id: str, registry: dict, vault_path: Path) -> bool:
    """Sincronitza les seccions del .md (taula plana per a Obsidian).

    `sync_sections` viu a `pipeline/sandbox/` (gitignored): a la imatge de
    producció el directori és buit, l'import falla i retornem False. Això
    és OK perquè el bloc `gnosi-view` el renderitza el frontend des del
    registry — la taula plana és un best-effort per a clients markdown
    externs (Obsidian) i no és necessària per veure la vista a l'app.
    """
    try:
        sandbox = Path(__file__).parents[2] / "pipeline" / "sandbox"
        if str(sandbox) not in sys.path:
            sys.path.insert(0, str(sandbox))
        from sync_sections import sync_page_view  # type: ignore
        return sync_page_view(page_id, registry, vault_path)
    except Exception as e:
        log.debug(f"sync_page_view no disponible: {e}")
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


def _find_section_upsert_index(sections, new_vid, heading):
    """Índex de la secció a SUBSTITUIR en un upsert, o ``None`` per afegir-ne una
    de nova.

    Si la secció entrant té ``view_id``, s'aparella per ``view_id`` (identitat
    estable del bloc): així dos embeds amb el mateix heading (p. ex. buit) però
    view_id diferent NO col·lisionen. Si no en té (secció inline/llegada),
    s'aparella per ``heading`` però NOMÉS amb seccions que tampoc tenen view_id
    (per no trepitjar una secció ancorada a una vista del registry).
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

        # Cicle load→modify→save sencer sota candau COMPARTIT amb vault_routes
        # (mateix fitxer de registre). Cos síncron, sense `await`: atòmic també
        # respecte altres corrutines. `_sync_page` (best-effort, toca el .md) va
        # FORA del candau.
        with _registry_mutation():
            registry, registry_path = _load_registry(vault_path)

            # Validació de la taula origen abans de tocar res al registry: així
            # els errors són clars (422) en lloc d'un 200 silenciós amb
            # md_synced: False que confonia l'usuari.
            tables = registry.get("tables") or []
            target_table = next(
                (t for t in tables if str(t.get("id")) == str(view.source_table_id)),
                None,
            )
            if target_table is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Taula origen '{view.source_table_id}' no existeix al registry.",
                )

            # Si hi ha filtre, validar que el camp existeixi a la taula.
            if view.filter and view.filter.field:
                prop_names = {p.get("name") for p in (target_table.get("properties") or [])}
                if view.filter.field not in prop_names:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"El camp de filtre '{view.filter.field}' no existeix a la taula "
                            f"'{target_table.get('name')}'."
                        ),
                    )

            # La pàgina ha d'existir al disc abans de tocar el registry. Usem
            # `find_page_path` (comparació canònica) en lloc d'un scan limitat
            # a `.Dashboards`: pàgines en qualsevol carpeta del vault (BD/, Arees/,
            # …) també han de validar-se.
            if not _page_exists_on_disk(page_id):
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Pàgina {page_id} no trobada al disc. La vista no s'ha creat."
                    ),
                )

            # Inicialitza `pages` si no existeix
            if "pages" not in registry:
                registry["pages"] = {}
            if page_id not in registry["pages"]:
                registry["pages"][page_id] = {"sections": []}

            sections: list = registry["pages"][page_id].setdefault("sections", [])

            # Upsert: identifica la secció pel `view_id` (identitat ESTABLE del
            # bloc), no pel heading — així múltiples embeds SENSE encapçalament a la
            # mateixa pàgina NO col·lisionen. Vegeu `_find_section_upsert_index`.
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

        # Best-effort: sincronitza la taula plana al .md per a Obsidian.
        # En producció (sense `pipeline/sandbox/`) retorna False — el block
        # `gnosi-view` el renderitza el frontend, no fa falta per a l'app.
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

        # Cicle load→modify→save sota candau compartit; `_sync_page` fora.
        with _registry_mutation():
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
