"""Endpoints de l'importador de Notion → Vault de Gnosi.

Cablega `services.notion_importer.import_workspace` amb writers SÍNCRONS que reusen el
registry de taules/vistes i escriuen les pàgines al disc (patró `/import`). L'import és
bloquejant (HTTP a Notion) → s'executa en un thread. Token a `integrations.json` (com Google).

cf. directives `notion_api_importer.md` i `vault_knowledge_agents.md`.
"""
import asyncio
import json
import re
import uuid
from typing import List, Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.config.app_config import load_params
from backend.services.workspace_service import require_role
from backend.services.context_vars import get_active_vault_path
from backend.utils.safe_io import safe_write_text
from backend.services.notion_importer import (
    NotionClient, import_workspace, _plain_title, _page_title, blocks_to_md,
)
from backend.services import notion_diff
from backend.services import notion_mcp
from backend.services import notion_mcp_md
from backend.services import notion_clone
from backend.services import notion_view_recreator as nvr
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


@router.get("/loose-pages", dependencies=[Depends(require_role("editor"))])
async def list_loose_pages():
    """Pàgines de Notion FORA de qualsevol BD (parent workspace/page) → per triar wiki/dashboard."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        pages = await asyncio.to_thread(NotionClient(token).search_pages)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error consultant Notion: {e}")
    out = [{"id": p["id"], "title": _page_title(p) or "Sense títol"}
           for p in pages if (p.get("parent") or {}).get("type") in ("workspace", "page_id")]
    return {"pages": out}


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------
class ImportPayload(BaseModel):
    database_ids: Optional[List[str]] = None
    create_group_views: bool = True
    target_folder: str = "Importades/Notion"
    follow_links: bool = True   # tancament transitiu (relacions + child pages/dbs + mencions)
    max_pages: int = 5000
    only_new: bool = True        # sync guardat: només afegeix pàgines NOVES, mai sobreescriu
    include_loose_pages: bool = False  # també pàgines soltes (no a cap BD)
    recreate_views: bool = False  # Fase 2: recrear vistes incrustades via MCP (cal token OAuth)
    schema_overrides: Optional[dict] = None  # {db_id: esquema SchemaConfigModal} configurat per l'usuari


def _sanitize_folder(name: str) -> str:
    return re.sub(r"[^\w\s\-/À-ÿ]", "", str(name or "")).strip() or "Notion"


def _norm_name(s) -> str:
    return re.sub(r"[^\w]", "", str(s or "").lower())


def _norm_id(s) -> str:
    return str(s or "").replace("-", "").lower()


def _vault_index() -> dict:
    """Estat del vault per a aparellament: {ids:set, titles:set, by_table:{tid:[PageInfo]},
    tables_by_name:{norm_name:table}}. Llegit de l'índex en memòria (no toca disc)."""
    v_str = str(get_active_vault_path() or "")
    entries = vault_routes._page_index_entries.get(v_str, {}) or {}
    ids, titles = set(), set()
    for pid, e in entries.items():
        ids.add(_norm_id(pid))
        meta = (e.get("metadata") or {}) if isinstance(e, dict) else {}
        if meta.get("id"):
            ids.add(_norm_id(meta["id"]))
        t = (e.get("title") if isinstance(e, dict) else "") or meta.get("title") or ""
        if t:
            titles.add(_norm_name(t))
    reg = vault_routes.load_registry()
    tables_by_name = {_norm_name(t.get("name")): t for t in reg.get("tables", [])}
    tables_by_id = {_norm_id(t.get("id")): t for t in reg.get("tables", [])}
    return {"v_str": v_str, "ids": ids, "titles": titles,
            "tables_by_name": tables_by_name, "tables_by_id": tables_by_id}


def _build_exists(idx: dict):
    ids, titles = idx["ids"], idx["titles"]
    def exists(notion_id: str, title: str) -> bool:
        return _norm_id(notion_id) in ids or _norm_name(title) in titles
    return exists


def _recreate_page_views(path, notion_page_id: str, host_table_id: str) -> int:
    """Fase 2: enriqueix una pàgina importada amb les seves vistes incrustades de Notion,
    via l'MCP allotjat. Crea les `gnosi-view` i afegeix els embeds al cos. Defensiu: mai
    trenca l'import. Inert si no hi ha token MCP."""
    page_md = notion_mcp.fetch(notion_page_id)
    if not page_md:
        return 0
    reg = vault_routes.load_registry()
    tables = reg.get("tables", [])

    def resolve_table(ds_name):
        want = nvr._strip_icon(ds_name)
        return next((t for t in tables if nvr._strip_icon(t.get("name")) == want), None)

    results = nvr.recreate_views_for_page(
        page_md, notion_page_id, host_table_id,
        fetch_view=notion_mcp.fetch, resolve_table=resolve_table)
    if not results:
        return 0
    views = reg.setdefault("views", [])
    for r in results:
        v = r["view"]
        idx = next((i for i, x in enumerate(views) if x.get("id") == v.get("id")), None)
        if idx is not None:
            views[idx] = v
        else:
            views.append(v)
    vault_routes.save_registry(reg)
    from pathlib import Path as _P
    body = _P(path).read_text(encoding="utf-8")
    extra = "".join(f"\n## {r['heading']}\n\n{r['embed']}\n"
                    for r in results if r["embed"] not in body)
    if extra:
        _P(path).write_text(body.rstrip() + "\n" + extra, encoding="utf-8")
    return len(results)


def _run_import_sync(token: str, database_ids, create_group_views, target_folder,
                     follow_links=True, max_pages=5000, only_new=True,
                     include_loose_pages=False, recreate_views=False,
                     schema_overrides=None) -> dict:
    """Executat en thread: writers síncrons que reusen registry + filesystem."""
    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("No hi ha cap vault actiu")
    client = NotionClient(token)
    folder_by_table: dict = {}
    new_table_ids: set = set()
    _mcp_views = bool(recreate_views and notion_mcp.is_connected())

    def write_table(table: dict):
        reg = vault_routes.load_registry()
        tables = reg.setdefault("tables", [])
        reg.setdefault("views", [])
        idx = next((i for i, t in enumerate(tables) if t.get("id") == table["id"]), None)
        if idx is not None:
            # La taula JA existeix al vault (id = id de BD de Notion) → NO sobreescriure el
            # seu esquema (propietats/àlies del vault); només reusar-la com a destí.
            existing = tables[idx]
            folder = existing.get("folder") or f"{_sanitize_folder(target_folder)}/{_sanitize_folder(table.get('name'))}"
            folder_by_table[table["id"]] = folder
            (vault / folder).mkdir(parents=True, exist_ok=True)
            return
        # Taula NOVA: carpeta pròpia <target>/<nom>
        folder = f"{_sanitize_folder(target_folder)}/{_sanitize_folder(table.get('name'))}"
        table["folder"] = folder
        folder_by_table[table["id"]] = folder
        new_table_ids.add(table["id"])
        tables.append(table)
        vault_routes.save_registry(reg)
        (vault / folder).mkdir(parents=True, exist_ok=True)

    def write_view(view: dict):
        # Només afegim vistes per a taules NOVES (les existents ja tenen les seves).
        if view.get("table_id") not in new_table_ids:
            return
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
        table_id = meta.get("table_id")
        folder = folder_by_table.get(table_id) or _sanitize_folder(target_folder)
        meta["title"] = page.get("title") or meta.get("title") or "Sense títol"
        meta["id"] = page.get("id") or str(uuid.uuid4())
        meta = {k: v for k, v in meta.items() if v is not None}
        safe = re.sub(r"[^\w\s\-.,()À-ÿ]", "", meta["title"]).strip()[:120] or "Sense títol"
        target_dir = vault / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / f"{safe}.md"
        if path.exists():
            path = target_dir / f"{safe} {meta['id'][:8]}.md"
        fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
        path.write_text(f"---\n{fm}\n---\n\n{str(page.get('content') or '').lstrip()}\n",
                        encoding="utf-8")
        vault_routes.register_page_in_index(path)
        # Fase 2 (opcional): recrear les vistes incrustades via MCP. Inert sense token.
        if recreate_views and table_id and _mcp_views:
            try:
                _recreate_page_views(path, meta["id"], table_id)
            except Exception:  # noqa: BLE001
                pass

    exists = _build_exists(_vault_index()) if only_new else None
    return import_workspace(
        client,
        write_table=write_table, write_page=write_page, write_view=write_view,
        database_ids=database_ids, create_group_views=create_group_views,
        target_folder=target_folder,
        follow_relations=follow_links, follow_children=follow_links, max_pages=max_pages,
        exists=exists, only_new=only_new, include_loose_pages=include_loose_pages,
        schema_overrides=schema_overrides,
    )


@router.post("/import", dependencies=[Depends(require_role("editor"))])
async def run_import(payload: ImportPayload):
    """Importa BD de Notion al vault. Retorna {tables, pages, views, errors[]}."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        report = await asyncio.to_thread(
            _run_import_sync, token, payload.database_ids,
            payload.create_group_views, payload.target_folder,
            payload.follow_links, payload.max_pages, payload.only_new,
            payload.include_loose_pages, payload.recreate_views,
            payload.schema_overrides,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error important de Notion: {e}")
    return {"status": "success", **report}


# ---------------------------------------------------------------------------
# CLON EXACTE (Notion = font de veritat) → carpeta NOVA, ids namespaced, cos via MCP
# ---------------------------------------------------------------------------
class ClonePayload(BaseModel):
    database_ids: Optional[List[str]] = None
    target_folder: str = "Clon Notion"
    schema_overrides: Optional[dict] = None  # {db_id: esquema SchemaConfigModal}
    loose_page_types: Optional[dict] = None  # {notion_page_id: "wiki"|"dashboard"}


def _run_clone_sync(database_ids, target_folder="Clon Notion", schema_overrides=None,
                    loose_page_types=None) -> dict:
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

    def write_table(table: dict):
        reg = vault_routes.load_registry()
        tables = reg.setdefault("tables", [])
        reg.setdefault("views", [])
        idx = next((i for i, t in enumerate(tables) if t.get("id") == table["id"]), None)
        if idx is not None:
            tables[idx] = table
        else:
            tables.append(table)
        folder_by_table[table["id"]] = table.get("folder")
        vault_routes.save_registry(reg)
        (vault / table["folder"]).mkdir(parents=True, exist_ok=True)

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
        folder = folder_by_table.get(meta.get("table_id")) or _sanitize_folder(target_folder)
        meta["title"] = page.get("title") or "Sense títol"
        meta["id"] = page.get("id") or str(uuid.uuid4())
        meta = {k: v for k, v in meta.items() if v is not None}
        safe = re.sub(r"[^\w\s\-.,()À-ÿ]", "", meta["title"]).strip()[:120] or "Sense títol"
        target_dir = vault / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / f"{safe}.md"
        if path.exists():
            path = target_dir / f"{safe} {meta['id'][:8]}.md"
        fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
        path.write_text(f"---\n{fm}\n---\n\n{str(page.get('content') or '').lstrip()}\n",
                        encoding="utf-8")
        vault_routes.register_page_in_index(path)

    def save_asset(url, prop, table):
        """Baixa un adjunt (camp d'arxiu o imatge del cos) a Assets/<carpeta clon>/<Taula>/<Camp|_cos>/."""
        from backend.services.notion_attachments import download_to
        clean = lambda s, d: (re.sub(r"[^\w\s\-.()À-ÿ]", "", str(s)).strip() or d)  # noqa: E731
        leaf = clean(table.get("name"), "Taula")
        sub = clean(prop, "") if prop else "_cos"
        dest = vault / "Assets" / _sanitize_folder(target_folder) / leaf / (sub or "_camp")
        return download_to(url, dest, vault)

    return notion_clone.clone_workspace(
        rest, fetch_page=notion_mcp.fetch, mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
        write_table=write_table, write_page=write_page, write_view=write_view,
        database_ids=database_ids or [d["id"] for d in rest.search_databases()],
        target_folder=_sanitize_folder(target_folder),
        schema_overrides=schema_overrides,
        save_asset=save_asset,
        loose_page_types=loose_page_types,
    )


@router.post("/clone", dependencies=[Depends(require_role("editor"))])
async def run_clone(payload: ClonePayload):
    """Clon EXACTE de Notion a una carpeta NOVA (vistes+columnes via MCP). No toca el vault."""
    if not notion_mcp.is_connected():
        raise HTTPException(status_code=400,
                            detail="Connecta l'MCP de Notion (vistes incrustades) per al clon exacte")
    try:
        report = await asyncio.to_thread(_run_clone_sync, payload.database_ids,
                                         payload.target_folder, payload.schema_overrides,
                                         payload.loose_page_types)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error clonant de Notion: {e}")
    return {"status": "success", **report}


# ---------------------------------------------------------------------------
# Diff dry-run (no destructiu): compara Notion ↔ vault per id/títol + contingut
# ---------------------------------------------------------------------------
class DiffPayload(BaseModel):
    database_ids: Optional[List[str]] = None
    deep: bool = True            # comparar també el COS i les vistes incrustades
    max_deep_per_table: int = 25


def _run_diff_sync(token: str, database_ids, deep=True, max_deep_per_table=25) -> dict:
    client = NotionClient(token)
    idx = _vault_index()
    tables_by_name = idx["tables_by_name"]
    tables_by_id = idx["tables_by_id"]
    v_str = idx["v_str"]

    if database_ids is None:
        database_ids = [d["id"] for d in client.search_databases()]

    out = {"tables": [], "summary": {"new": 0, "diverged": 0, "identical": 0,
                                     "similar": 0, "vault_only": 0, "matched": 0,
                                     "notion_blank": 0, "vault_blank": 0}}
    for db_id in database_ids:
        try:
            db = client.get_database(db_id)
            db_name = _plain_title(db.get("title")) or "Sense títol"
            vtable = tables_by_id.get(_norm_id(db_id)) or tables_by_name.get(_norm_name(db_name))
            notion_rows = [{"id": r["id"], "title": _page_title(r) or "Sense títol"}
                           for r in client.query_database(db_id)]
            if not vtable:
                out["tables"].append({"notion_db": db_name, "vault_table": None,
                                      "new": len(notion_rows), "matched": 0, "vault_only": 0,
                                      "diverged": [], "identical": 0, "note": "taula inexistent al vault"})
                out["summary"]["new"] += len(notion_rows)
                continue
            vpages = vault_routes._get_pages_by_table_id(v_str, vtable["id"])
            # Pertinença per id-O-títol (mateixa lògica que el guard de l'import) → el diff
            # no sobre-reporta "noves" respecte del que l'import realment afegiria.
            v_ids, v_titles, vlist = set(), set(), []
            for p in vpages:
                meta = p.metadata if isinstance(p.metadata, dict) else {}
                v_ids.add(_norm_id(p.id))
                if meta.get("id"):
                    v_ids.add(_norm_id(meta["id"]))
                v_titles.add(_norm_name(p.title))
                vlist.append({"id": p.id, "title": p.title, "path": p.path})

            def _in_vault(n):
                return _norm_id(n["id"]) in v_ids or _norm_name(n["title"]) in v_titles

            new_rows = [n for n in notion_rows if not _in_vault(n)]
            m = notion_diff.match_pages([n for n in notion_rows if _in_vault(n)], vlist)
            diverged, identical, similar, notion_blank, vault_blank, deep_done = [], 0, 0, 0, 0, 0
            for n, v in m["matched"]:
                if not deep or deep_done >= max_deep_per_table:
                    continue
                try:
                    vbody = ""
                    if v.get("path"):
                        from pathlib import Path as _P
                        vbody = _P(v["path"]).read_text(encoding="utf-8")
                    blocks = client.get_block_children(n["id"])
                    nmd = blocks_to_md(blocks)
                    child = notion_diff.extract_notion_child_databases(blocks)
                    dp = notion_diff.diff_page(nmd, vbody, notion_child_dbs=child)
                    deep_done += 1
                    st = dp["body_status"]
                    if st == "diverged":
                        diverged.append({"title": v["title"], "similarity": dp["body_similarity"],
                                        "notion_embeds": dp["notion_embeds"], "vault_embeds": dp["vault_embeds"]})
                    elif st == "identical":
                        identical += 1
                    elif st == "notion_blank":
                        notion_blank += 1
                    elif st == "vault_blank":
                        vault_blank += 1
                    else:
                        similar += 1
                except Exception as e:  # noqa: BLE001
                    diverged.append({"title": v.get("title"), "error": str(e)})
            t = {"notion_db": db_name, "vault_table": vtable.get("name"),
                 "new": len(new_rows), "new_titles": [n["title"] for n in new_rows][:50],
                 "matched": len(m["matched"]),
                 "vault_only": len(m["vault_only"]), "diverged": diverged,
                 "identical": identical, "similar": similar,
                 "notion_blank": notion_blank, "vault_blank": vault_blank,
                 "deep_sampled": deep_done}
            out["tables"].append(t)
            s = out["summary"]
            s["new"] += len(new_rows); s["matched"] += len(m["matched"])
            s["vault_only"] += len(m["vault_only"]); s["diverged"] += len(diverged)
            s["notion_blank"] += notion_blank; s["vault_blank"] += vault_blank
            s["identical"] += identical; s["similar"] += similar
        except Exception as e:  # noqa: BLE001
            out["tables"].append({"notion_db": db_id, "error": str(e)})
    return out


@router.post("/diff", dependencies=[Depends(require_role("editor"))])
async def run_diff(payload: DiffPayload):
    """Dry-run NO destructiu: compara Notion ↔ vault (per id/títol + cos + vistes)."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=400, detail="No hi ha cap token de Notion configurat")
    try:
        report = await asyncio.to_thread(
            _run_diff_sync, token, payload.database_ids, payload.deep, payload.max_deep_per_table,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error comparant amb Notion: {e}")
    return {"status": "success", **report}
