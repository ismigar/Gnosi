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
from backend.api import vault_routes

router = APIRouter(prefix="/notion", tags=["Notion Import"])


# ---------------------------------------------------------------------------
# Token (integrations.json, clau `notion`)
# ---------------------------------------------------------------------------
def _integrations_path():
    return load_params(strict_env=False).paths["SECRETS"] / "integrations.json"


def _load_integrations() -> dict:
    p = _integrations_path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_integrations(data: dict):
    p = _integrations_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    safe_write_text(p, json.dumps(data, ensure_ascii=False, indent=2))


def _get_token() -> Optional[str]:
    return (_load_integrations().get("notion") or {}).get("token")


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
    data = _load_integrations()
    data["notion"] = {"token": token, "name": me.get("name") or "Notion"}
    _save_integrations(data)
    return {"status": "success", "name": data["notion"]["name"]}


@router.get("/status")
async def notion_status():
    return {"connected": bool(_get_token())}


@router.delete("/token", dependencies=[Depends(require_role("admin"))])
async def delete_token():
    data = _load_integrations()
    if "notion" in data:
        data.pop("notion")
        _save_integrations(data)
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
    return {"v_str": v_str, "ids": ids, "titles": titles, "tables_by_name": tables_by_name}


def _build_exists(idx: dict):
    ids, titles = idx["ids"], idx["titles"]
    def exists(notion_id: str, title: str) -> bool:
        return _norm_id(notion_id) in ids or _norm_name(title) in titles
    return exists


def _run_import_sync(token: str, database_ids, create_group_views, target_folder,
                     follow_links=True, max_pages=5000, only_new=True,
                     include_loose_pages=False) -> dict:
    """Executat en thread: writers síncrons que reusen registry + filesystem."""
    vault = get_active_vault_path()
    if not vault:
        raise RuntimeError("No hi ha cap vault actiu")
    client = NotionClient(token)
    folder_by_table: dict = {}

    def write_table(table: dict):
        # Carpeta pròpia per a cada BD: <target>/<nom>
        folder = f"{_sanitize_folder(target_folder)}/{_sanitize_folder(table.get('name'))}"
        table["folder"] = folder
        folder_by_table[table["id"]] = folder
        reg = vault_routes.load_registry()
        tables = reg.setdefault("tables", [])
        idx = next((i for i, t in enumerate(tables) if t.get("id") == table["id"]), None)
        if idx is not None:
            tables[idx] = table
        else:
            tables.append(table)
        reg.setdefault("views", [])
        vault_routes.save_registry(reg)
        (vault / folder).mkdir(parents=True, exist_ok=True)

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

    exists = _build_exists(_vault_index()) if only_new else None
    return import_workspace(
        client,
        write_table=write_table, write_page=write_page, write_view=write_view,
        database_ids=database_ids, create_group_views=create_group_views,
        target_folder=target_folder,
        follow_relations=follow_links, follow_children=follow_links, max_pages=max_pages,
        exists=exists, only_new=only_new, include_loose_pages=include_loose_pages,
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
            payload.include_loose_pages,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error important de Notion: {e}")
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
            vtable = tables_by_name.get(_norm_name(db_name))
            notion_rows = [{"id": r["id"], "title": _page_title(r) or "Sense títol"}
                           for r in client.query_database(db_id)]
            if not vtable:
                out["tables"].append({"notion_db": db_name, "vault_table": None,
                                      "new": len(notion_rows), "matched": 0, "vault_only": 0,
                                      "diverged": [], "identical": 0, "note": "taula inexistent al vault"})
                out["summary"]["new"] += len(notion_rows)
                continue
            vpages = vault_routes._get_pages_by_table_id(v_str, vtable["id"])
            vlist = [{"id": p.id, "title": p.title, "path": p.path} for p in vpages]
            m = notion_diff.match_pages(notion_rows, vlist)
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
                 "new": len(m["notion_only"]), "matched": len(m["matched"]),
                 "vault_only": len(m["vault_only"]), "diverged": diverged,
                 "identical": identical, "similar": similar,
                 "notion_blank": notion_blank, "vault_blank": vault_blank,
                 "deep_sampled": deep_done}
            out["tables"].append(t)
            s = out["summary"]
            s["new"] += len(m["notion_only"]); s["matched"] += len(m["matched"])
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
