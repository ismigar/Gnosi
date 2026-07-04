"""Endpoints del CLON de Notion → Vault de Gnosi.

Connexió (token d'integració REST + MCP OAuth), llistat de BD i pàgines soltes, esquema per
BD i el CLON EXACTE a una carpeta nova (`services.notion_clone.clone_workspace`): esquema,
pàgines, relacions, vistes incrustades, colors, columnes, adjunts i portades. Bloquejant (HTTP
a Notion/MCP) → s'executa en un thread. Token a `integrations.json` (com Google).

cf. directives `notion_exact_clone.md` i `notion_import_configurable_schema.md`.
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

router = APIRouter(prefix="/notion", tags=["Notion Import"])


# ---------------------------------------------------------------------------
# Token: integració de PRIMERA CLASSE via IntegrationManager (clau `notion`).
# El manager fa read-modify-write amb lock i cau compartits → no el clobbera cap
# altre servei (abans s'escrivia directe a integrations.json i es perdia).
# ---------------------------------------------------------------------------
def _get_token() -> Optional[str]:
    return (integration_manager.get_raw("notion") or {}).get("token")


class TokenPayload(BaseModel):
    token: str


@router.post("/token", dependencies=[Depends(require_role("admin"))])
async def set_token(payload: TokenPayload):
    """Desa i valida el token d'integració de Notion (prova amb /users/me)."""
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
# Config del panell d'importació: PER-WORKSPACE al servidor (no només localStorage).
# El frontend la desava NOMÉS a localStorage i es perdia a cada canvi d'origen
# (http→https, port de preview, altre Mac, perfil de navegador) — incident 2026-07-03.
# Es guarda tal qual (mateixa forma JSON que la clau localStorage
# `gnosi_notion_import_cfg`) a local_data/system/notion_import_config.json amb
# escriptura atòmica (safe_write_json) i lock de read-modify-write, com integrations.json.
# NO va a integrations.json: get_all_safe() emmascararia/mostraria la config com si
# fos una credencial a la resta de consumidors (mail, calendari, settings).
# ---------------------------------------------------------------------------
_IMPORT_CFG_LOCK = threading.Lock()


def _import_cfg_path():
    from backend.config.app_config import load_params
    return load_params(strict_env=False).paths["LOCAL_DATA"] / "system" / "notion_import_config.json"


@router.get("/import-config", dependencies=[Depends(require_role("editor"))])
async def get_import_config():
    """Config desada del panell d'importació (databases, selected, schemaOverrides,
    cloneVaultId, newVaultName, loosePageTypes…). {config: null} si no n'hi ha."""
    path = _import_cfg_path()
    if not path.exists():
        return {"config": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — fitxer corrupte = com si no existís
        return {"config": None}
    return {"config": data if isinstance(data, dict) else None}


@router.put("/import-config", dependencies=[Depends(require_role("editor"))])
async def put_import_config(payload: dict = Body(...)):
    """Desa la config del panell d'importació (JSON lliure, mateixa forma que el
    localStorage del frontend). Sobreescriu sencer (last-write-wins)."""
    from backend.utils.safe_io import safe_write_json
    path = _import_cfg_path()
    with _IMPORT_CFG_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(path, payload, ensure_ascii=False, indent=2)
    return {"status": "success"}


@router.get("/databases", dependencies=[Depends(require_role("editor"))])
async def list_databases():
    """Llista les BD de Notion compartides amb la integració."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        dbs = await asyncio.to_thread(NotionClient(token).search_databases)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    return {"databases": [
        {"id": d["id"], "title": _plain_title(d.get("title")) or "Sense títol"} for d in dbs
    ]}


@router.get("/databases/{db_id}/schema", dependencies=[Depends(require_role("editor"))])
async def database_schema(db_id: str):
    """Esquema d'una BD de Notion en format de SchemaConfigModal (per configurar-lo abans
    d'importar/clonar). {schema: {camp:tipus, camp_config:{...}}, name}."""
    from backend.services.notion_importer import map_database_schema
    from backend.services.notion_schema_config import notion_props_to_modal_schema
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        db = await asyncio.to_thread(NotionClient(token).get_database, db_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    table = map_database_schema(db)
    return {"name": table.get("name"), "schema": notion_props_to_modal_schema(table.get("properties", []))}


def _collect_loose_pages(token: str) -> list:
    """Pàgines REALMENT fora de qualsevol BD: pujant per la cadena de `parent` s'arriba a
    `workspace` sense trobar mai cap `database_id`. No n'hi ha prou amb mirar el pare directe:
    una subpàgina niada dins d'una fila de BD té `parent.type == "page_id"` (el pare és la
    pàgina-fila) i s'havia colat a la llista de "soltes". Resolem la cadena amb memoització
    (cau per id + reús de les pàgines ja carregades) per limitar les crides a Notion."""
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
        if key in seen:  # guarda contra cicles (no n'hi hauria d'haver)
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
        else:  # desconegut → no amaguem la pàgina (comportament conservador)
            res = True
        cache[key] = res
        return res

    return [{"id": p["id"], "title": _page_title(p) or "Sense títol"}
            for p in pages if _is_loose(p["id"], "page", set())]


def _find_linked_databases(token: str, max_pages: int = 400) -> dict:
    """Troba les BD ENLLAÇADES (vistes) visibles a Notion però NO importables: l'API no pot
    llegir-les i `/search` no les retorna. Viuen com a blocs `child_database` dins de pàgines
    (taullells/directoris). Escanegem els fills DIRECTES de les pàgines soltes (depth 1, on solen
    estar, p. ex. una pàgina «BD»); una BD que no és font accessible i dona error 'linked database'
    / no trobada → és una vista enllaçada (cal compartir-ne la FONT). Acotat per `max_pages`."""
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
                    "title": (b.get("child_database") or {}).get("title") or "Sense títol",
                    "page_title": p.get("title") or "Sense títol",
                    "kind": kind,
                }
    return {"linked": list(found.values()), "scanned": scanned, "capped": capped}


@router.get("/linked-databases", dependencies=[Depends(require_role("editor"))])
async def list_linked_databases():
    """BD enllaçades (vistes) que es veuen a Notion però no es poden importar via API."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        out = await asyncio.to_thread(_find_linked_databases, token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    return out


@router.get("/loose-pages", dependencies=[Depends(require_role("editor"))])
async def list_loose_pages():
    """Pàgines de Notion FORA de qualsevol BD → per triar wiki/dashboard."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        out = await asyncio.to_thread(_collect_loose_pages, token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    return {"pages": out}


def _sanitize_folder(name: str) -> str:
    return re.sub(r"[^\w\s\-/À-ÿ]", "", str(name or "")).strip() or "Notion"


# ---------------------------------------------------------------------------
# CLON EXACTE (Notion = font de veritat) → carpeta NOVA, ids namespaced, cos via MCP
# ---------------------------------------------------------------------------
class ClonePayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = ""   # buit = arrel del vault (clon sense subcarpeta)
    schema_overrides: Optional[dict] = None  # {db_id: esquema SchemaConfigModal}
    loose_page_types: Optional[dict] = None  # {notion_page_id: "wiki"|"dashboard"}
    download_assets: bool = True  # False = no baixa adjunts (deixa les URLs de Notion); clon ràpid


# Progrés del clon en curs: el clon corre en un thread (bloquejant) i el frontend el consulta
# amb polling a GET /clone/progress. Single-user local → n'hi ha prou amb un estat de mòdul (les
# escriptures/lectures de dict són atòmiques sota el GIL). Es reinicia a l'inici de cada clon.
_CLONE_PROGRESS: dict = {"running": False, "phase": "idle", "done": 0, "total": 0,
                         "pages": 0, "tables": 0, "views": 0, "attachments": 0,
                         "collected": 0, "tables_total": 0, "pages_total": 0,
                         "vault_id": None}
# Senyal d'avortament cooperatiu: POST /clone/abort el posa a True; clone_workspace el comprova
# entre elements (via should_cancel) i atura amb CloneAborted (deixa el clon parcial al disc).
_CLONE_CANCEL: dict = {"flag": False}


# Heartbeat del clon per al watchdog natiu (sh/native_watchdog.sh): el clon corre en un
# thread i pot deixar l'event loop tan carregat que el sondeig HTTP del watchdog falli
# (incident 2026-07-04: kickstart -k va matar DOS clons sans). El thread toca aquest
# fitxer a cada element processat; el watchdog, si el veu fresc, no reinicia el servei.
_CLONE_HEARTBEAT_PATH = Path(os.environ.get("GNOSI_CLONE_HEARTBEAT",
                                            str(Path.home() / ".gnosi_clone_heartbeat")))
_CLONE_HEARTBEAT_MIN_INTERVAL = 5.0  # s; throttle (l'emissió ara és per fila)
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
    })
    # Notifica els plugins de dades quan el clon acaba (bus d'esdeveniments v2).
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
    """Estat del clon en curs (per a la barra de progrés del frontend). No bloca."""
    return dict(_CLONE_PROGRESS)


@router.post("/clone/abort", dependencies=[Depends(require_role("editor"))])
async def clone_abort():
    """Demana avortar el clon en curs. Cancel·lació cooperativa: s'atura al següent punt de
    control (entre pàgines), deixant el que ja s'ha clonat al disc. No bloca."""
    if not _CLONE_PROGRESS.get("running"):
        return {"status": "idle", "detail": "No hi ha cap clon en curs"}
    _CLONE_CANCEL["flag"] = True
    return {"status": "aborting"}


def _run_clone_sync(database_ids, target_folder="Clon Notion", schema_overrides=None,
                    loose_page_types=None, download_assets=True) -> dict:
    token = _get_token()
    if not token:
        raise RuntimeError("No hi ha cap token d'integració de Notion configurat")
    if not notion_mcp.is_connected():
        raise RuntimeError("Cal connectar l'MCP de Notion (vistes incrustades) per al clon")
    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("No hi ha cap vault actiu")
    rest = NotionClient(token)
    folder_by_table: dict = {}
    # Subcarpeta opcional: buit ("") = el clon va DIRECTE a l'arrel del vault (sense embolcall).
    tf = re.sub(r"[^\w\s\-/À-ÿ]", "", str(target_folder or "")).strip()

    # DEDUPE RE-CLON (incident 2026-07-04, 907 duplicats): els ids del clon són deterministes
    # (uuid5 de l'id de Notion), així que re-clonar sobre un vault que ja té un clon ha de
    # SOBREESCRIURE el fitxer existent de cada pàgina (mateix id al frontmatter), mai crear-ne
    # un segon «Títol id8.md». El sufix id8 queda NOMÉS per a col·lisions reals de títol entre
    # pàgines d'ids DIFERENTS. Mapa id→path construït UNA vegada escanejant NOMÉS les arrels
    # on escriu el clon (BD/Wiki/.Dashboards): llegir tot el vault forçaria descàrregues de
    # fitxers OneDrive online-only aliens al clon.

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
    written_ids_by_table: dict = {}  # table_id → set d'ids escrits (per detectar fantasmes)

    def write_table(table: dict):
        reg = vault_routes.load_registry()
        tables = reg.setdefault("tables", [])
        reg.setdefault("views", [])
        # La SIDEBAR agrupa les taules per registry.databases (VaultSidebar mostra "No hi ha bases
        # de dades" si és buit, encara que hi hagi taules): el clon ha de crear l'entrada de BD
        # agrupadora i vincular-hi cada taula, com les natives. folder="BD" perquè el físic és
        # VAULT/BD/<table["folder"]> (la subcarpeta, si n'hi ha, viu DINS de table["folder"];
        # cf. _resolve_table_folder_from_metadata: VAULT/<db_folder>/<folder de la taula>).
        dbs = reg.setdefault("databases", [])
        entry = next((d for d in dbs if d.get("id") == "notion_clone_db"), None)
        if entry is None:
            dbs.append({"id": "notion_clone_db", "name": "Notion", "folder": "BD"})
        else:
            # ASSEGURA els camps (com ensure_default_registry_structure): un registre reparat a
            # mà o a mig estat amb folder≠"BD" faria que la resolució de carpetes no casés amb
            # el físic que escriu el clon. El nom només s'omple si falta (es respecta el custom).
            if not entry.get("name"):
                entry["name"] = "Notion"
            if entry.get("folder") != "BD":
                entry["folder"] = "BD"
        table["database_id"] = "notion_clone_db"
        idx = next((i for i, t in enumerate(tables) if t.get("id") == table["id"]), None)
        if idx is not None:
            tables[idx] = table
        else:
            tables.append(table)
        # El registre guarda la FULLA (table["folder"], p. ex. "Àrees"); el físic va sota BD/ com
        # fan les taules natives de Gnosi (cf. _ensure_table_vault_folder / _resolve_table_folder_
        # from_metadata: VAULT/BD/<folder> quan la taula no té database). Així no es migra després.
        phys = f"BD/{table['folder']}"
        folder_by_table[table["id"]] = phys
        vault_routes.save_registry(reg)
        (vault / phys).mkdir(parents=True, exist_ok=True)

    def write_view(view: dict):
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
        # Mateixa col·locació que el desat natiu (cf. vault_routes save_page):
        #   · fila d'una taula → carpeta de la taula (BD/<Taula>)
        #   · pàgina solta dashboard (is_dashboard) → .Dashboards/
        #   · pàgina solta wiki → Wiki/
        folder = folder_by_table.get(meta.get("table_id"))
        if folder is None:
            folder = ".Dashboards" if meta.get("is_dashboard") else "Wiki"
        meta["title"] = page.get("title") or "Sense títol"
        meta["id"] = page.get("id") or str(uuid.uuid4())
        meta = {k: v for k, v in meta.items() if v is not None}
        safe = re.sub(r"[^\w\s\-.,()À-ÿ]", "", meta["title"]).strip()[:120] or "Sense títol"
        target_dir = vault / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        # Re-clon: si ja hi ha un fitxer amb aquest id (frontmatter), es SOBREESCRIU al mateix
        # path. Si la pàgina ha canviat de carpeta (moguda de taula a Notion), es reubica:
        # s'esborra l'antic i s'escriu al nou — mai dos fitxers per al mateix id.
        existing = path_by_id.get(meta["id"])
        if existing is not None and existing.exists() and existing.parent != target_dir:
            existing.unlink()
            existing = None
        if existing is not None and existing.exists():
            path = existing
        else:
            path = target_dir / f"{safe}.md"
            if path.exists() and str(_frontmatter_meta(path).get("id")) != meta["id"]:
                # Col·lisió REAL de títol entre pàgines d'ids diferents → sufix id8.
                path = target_dir / f"{safe} {meta['id'][:8]}.md"
        path_by_id[meta["id"]] = path
        if meta.get("table_id"):
            written_ids_by_table.setdefault(meta["table_id"], set()).add(meta["id"])
        fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
        path.write_text(f"---\n{fm}\n---\n\n{str(page.get('content') or '').lstrip()}\n",
                        encoding="utf-8")
        vault_routes.register_page_in_index(path)

    def save_asset(url, prop, table):
        """Baixa un adjunt al seu lloc segons la config del camp (com el desat natiu):
        · camp d'arxiu amb `storage_folder='biblioteca'` → carpeta Biblioteca DINS del vault
          del clon (autocontingut), valor portable `/api/vault/biblioteca/<fitxer>`.
        · resta (Assets per defecte, imatges del cos, icones/portades) → Assets/[subcarpeta/]<Taula>/<Camp|_cos>/."""
        from backend.services.notion_attachments import download_to, download_file
        # `prop` és el NOM del camp (o None per al cos/_icones/_portades). Busca'l a l'esquema per
        # llegir-ne storage_folder; només els camps d'arxiu reals poden anar a Biblioteca.
        prop_dict = next((p for p in (table.get("properties") or []) if p.get("name") == prop), None) if prop else None
        storage = str((vault_routes._property_config_value(prop_dict, "storage_folder") if prop_dict else "") or "").strip().lower()
        # Timeout curt: sota xarxa lenta, un fitxer que no baixa en 15s es salta (millor un clon
        # complet amb algun adjunt de menys que quedar-se encallat 60s per fitxer). Els ràpids sí.
        # Pressupost TOTAL per fitxer: prou generós per a PDFs grans (20-30 MB a ~400KB/s),
        # però acotat perquè un S3 degradat no encalli el clon per sempre (2026-07-01).
        DL_TIMEOUT = 90.0
        if storage == "biblioteca":
            # DINS del vault del clon (autocontingut: esborrar el vault s'ho emporta tot).
            # La resolució vault-first de get_p("BIBLIOTECA") la trobarà a partir d'ara;
            # els vaults amb Biblioteca llegada (germana) no canvien (fallback de lectura).
            biblio = vault / "Biblioteca"
            fname = download_file(url, biblio, timeout=DL_TIMEOUT)
            return f"/api/vault/biblioteca/{fname}" if fname else None
        clean = lambda s, d: (re.sub(r"[^\w\s\-.()À-ÿ]", "", str(s)).strip() or d)  # noqa: E731
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
        # [] ≠ None: una llista BUIDA és una tria explícita ("cap BD" — p. ex. clon
        # incremental només de pàgines soltes); abans `or` la convertia en "TOTES les
        # BD" i un clon només-soltes clonava el workspace sencer. None (payload sense
        # camp) sí que vol dir "totes" (compat amb crides per API).
        database_ids=(database_ids if database_ids is not None
                      else [d["id"] for d in rest.search_databases()]),
        target_folder=tf,
        schema_overrides=schema_overrides,
        save_asset=(save_asset if download_assets else None),
        loose_page_types=loose_page_types,
        progress_cb=_clone_progress_cb,
        should_cancel=lambda: _CLONE_CANCEL["flag"],
        registry_tables=vault_routes.load_registry().get("tables", []),
    )

    # FILES FANTASMA: fitxers del vault amb table_id d'una taula clonada l'id dels quals ja NO
    # existeix a Notion (rows esborrades/recreades). NOMÉS s'informa (warning al report), mai
    # s'esborra automàticament. Si el clon s'ha truncat, avortat o té errors, se salta el
    # diagnòstic: les pàgines no escrites semblarien fantasmes sense ser-ho.
    if not report.get("truncated") and not report.get("errors") and not _CLONE_CANCEL["flag"]:
        for table_id, phys in folder_by_table.items():
            table_dir = vault / phys
            if not table_dir.is_dir():
                continue
            written = written_ids_by_table.get(table_id, set())
            for p in sorted(table_dir.glob("*.md")):
                m = _frontmatter_meta(p)
                if str(m.get("table_id")) == str(table_id) and str(m.get("id")) not in written:
                    report["warnings"].append(
                        f"Fila fantasma (l'id ja no és a Notion): «{p.relative_to(vault)}» "
                        f"(id {m.get('id')}). No s'ha esborrat automàticament.")
    return report


@router.post("/clone", dependencies=[Depends(require_role("editor"))])
async def run_clone(payload: ClonePayload, x_vault_id: Optional[str] = Header(default=None)):
    """Clon EXACTE de Notion a una carpeta NOVA (vistes+columnes via MCP). No toca el vault."""
    # GUARD DE SEGURETAT: si es demana un vault destí concret (X-Vault-Id) però NO resol a cap
    # vault real (p. ex. s'ha esborrat i el frontend n'envia l'id vell), avortem. Sense això el
    # middleware cau silenciosament al vault PRINCIPAL i el clon l'embruta (incident real).
    if x_vault_id:
        # Validació directa a BD (sense caché) per evitar falsos positius i no dependre de funcions privades.
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
                detail="El vault destí indicat no existeix (potser s'ha esborrat). "
                       "Refresca la pàgina i torna a triar-lo abans de clonar.",
            )
    if not notion_mcp.is_connected():
        raise HTTPException(status_code=400,
                            detail="Connecta l'MCP de Notion (vistes incrustades) per al clon exacte")
    # Preflight: una sola comprovació viva de l'MCP. Si el token ha caducat (i no es pot
    # renovar) avortem JA amb un missatge clar, en comptes de fer un clon llarg que sortiria
    # buit picant l'MCP mort per cada pàgina (era el "no acaba mai").
    ok, reason = await asyncio.to_thread(notion_mcp.healthcheck)
    if not ok:
        msg = ("L'MCP de Notion ha caducat: reconnecta'l (botó «Connecta MCP») i torna a clonar"
               if reason in ("expired", "no_token")
               else f"L'MCP de Notion no respon ({reason}); reconnecta'l i torna-ho a provar")
        raise HTTPException(status_code=400, detail=msg)
    _CLONE_CANCEL["flag"] = False
    _CLONE_PROGRESS.update({"running": True, "phase": "starting", "done": 0, "total": 0,
                            "pages": 0, "tables": 0, "views": 0, "attachments": 0, "collected": 0,
                            "tables_total": 0, "pages_total": 0,
                            "vault_id": x_vault_id})  # perquè el frontend verifiqui al vault correcte
    try:
        report = await asyncio.to_thread(_run_clone_sync, payload.database_ids,
                                         payload.target_folder, payload.schema_overrides,
                                         payload.loose_page_types, payload.download_assets)
    except notion_clone.CloneAborted:
        # Avortat per l'usuari: el que s'ha clonat fins ara queda al disc. Tornem els comptadors
        # parcials (de _CLONE_PROGRESS) perquè el frontend mostri què s'ha fet abans d'aturar.
        _CLONE_PROGRESS["phase"] = "cancelled"
        return {"status": "cancelled",
                "tables": _CLONE_PROGRESS.get("tables", 0), "pages": _CLONE_PROGRESS.get("pages", 0),
                "views": _CLONE_PROGRESS.get("views", 0),
                "attachments": _CLONE_PROGRESS.get("attachments", 0),
                "errors": [], "warnings": ["Clon avortat per l'usuari: parcial (el que ja s'havia "
                                           "clonat queda al disc)."], "truncated": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error clonant de Notion: {e}")
    finally:
        _CLONE_PROGRESS["running"] = False
        _CLONE_CANCEL["flag"] = False
        # Sense clon en marxa, el watchdog ha de recuperar la seva autoritat normal.
        _clear_clone_heartbeat()
    return {"status": "success", **report}


# ---------------------------------------------------------------------------
# VERIFICA EL CLON (salut Notion ↔ clon): per donar confiança abans d'abandonar Notion
# ---------------------------------------------------------------------------
class VerifyPayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = ""   # buit = arrel del vault (clon sense subcarpeta)


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
        raise RuntimeError("No hi ha cap vault actiu")
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
    tf = re.sub(r"[^\w\s\-/À-ÿ]", "", str(target_folder or "")).strip()
    folder = (vault / tf) if tf else vault   # buit = arrel del vault
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
    """Comprova la salut del clon (Notion ↔ clon): paritat de recompte per BD, cossos buits,
    relacions òrfenes, vistes recreades i adjunts que falten al disc. No toca res."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        result = await asyncio.to_thread(_run_verify_sync, token, payload.database_ids,
                                         payload.target_folder)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error verificant el clon: {e}")
    return {"status": "success", **result}

