"""Orquestrador del CLON EXACTE de Notion → Gnosi (a carpeta nova, Notion = font de veritat).

Diferent del sync guardat: ids NAMESPACED (no toca ni col·lisiona amb el vault existent),
TOTES les pàgines, i el cos ve de l'MCP (fidelitat: columnes, vistes incrustades) en comptes
dels blocs REST. Cada `<!-- gnosi-notion-db:id -->` (de `notion_mcp_md`) es resol a una
`gnosi-view` de la taula CLONADA (via `notion_view_recreator`).

Esquema + valors de fila vénen de la REST (estructurat); el cos i les vistes, de l'MCP.
cf. directiva `notion_exact_clone.md`.
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Callable, Dict, List, Optional

from backend.services.notion_importer import (
    map_database_schema, page_to_values, _page_title, _emoji_icon,
)
from backend.services import notion_view_recreator as nvr

_CLONE_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000003")
_MARKER_RE = re.compile(r"<!--\s*gnosi-notion-db:([0-9a-f]{32})\s*-->")


def clone_table_id(notion_db_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "table:" + str(notion_db_id or "").replace("-", "")))


def clone_page_id(notion_page_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "page:" + str(notion_page_id or "").replace("-", "")))


def clone_table_schema(notion_db: Dict[str, Any]) -> Dict[str, Any]:
    """Esquema de taula clonat: id i relacions namespaced al clon."""
    t = map_database_schema(notion_db)
    t["id"] = clone_table_id(notion_db.get("id"))
    for p in t.get("properties", []):
        if p.get("type") == "relation" and p.get("relation_database_id"):
            p["relation_database_id"] = clone_table_id(p["relation_database_id"])
    return t


def clone_values(values: Dict[str, Any], schema: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Remapa NOMÉS els camps de relació a ids de pàgina del clon (la resta intacta)."""
    rel_fields = {p["name"] for p in (schema or []) if p.get("type") == "relation"}
    out: Dict[str, Any] = {}
    for k, v in values.items():
        if k in rel_fields and isinstance(v, list):
            out[k] = [clone_page_id(x) for x in v if x]
        else:
            out[k] = v
    return out


def resolve_view_markers(body_md: str, notion_host_page_id: str, clone_host_table_id: str,
                         *, fetch_view: Callable[[str], str],
                         resolve_clone_table: Callable[[str], Optional[Dict[str, Any]]]):
    """Substitueix els `<!-- gnosi-notion-db:id -->` per `gnosi-view` de la taula clonada.

    `fetch_view(view_block_id)` → markdown MCP de la vista. `resolve_clone_table(data_source_name)`
    → taula clonada (dict amb id de clon) o None. Retorna (cos_amb_embeds, [vistes_a_crear]).
    """
    views: List[Dict[str, Any]] = []

    def repl(m):
        vid = m.group(1)
        try:
            meta = nvr.parse_mcp_view(fetch_view(vid))
            ct = resolve_clone_table(meta.get("data_source_name"))
            if not ct:
                return ""  # la taula destí no s'ha clonat → treu el marcador
            gv = nvr.build_gnosi_view(notion_host_page_id, ct, clone_host_table_id, meta,
                                      meta.get("data_source_name") or ct.get("name") or "Vista")
            gv["id"] = str(uuid.uuid5(_CLONE_NS, f"view:{notion_host_page_id}:{vid}"))
            views.append(gv)
            return nvr.view_embed(gv["id"])
        except Exception:
            return ""

    return _MARKER_RE.sub(repl, body_md), views


def clone_workspace(
    rest_client,                       # NotionClient (REST): esquema + files + valors
    *,
    fetch_page: Callable[[str], str],  # MCP: id pàgina → markdown Notion (cos + vistes)
    mcp_to_markdown: Callable[[str], str],
    write_table: Callable[[Dict[str, Any]], None],
    write_page: Callable[[Dict[str, Any]], None],
    write_view: Callable[[Dict[str, Any]], None],
    database_ids: List[str],
    target_folder: str = "Clon Notion",
    max_pages: int = 5000,
    schema_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Clona les BD seleccionades a `target_folder` amb ids del clon i cos de fidelitat (MCP)."""
    report = {"tables": 0, "pages": 0, "views": 0, "errors": [], "truncated": False}
    users = rest_client.list_users()

    # Mapa nom-de-data-source (sense icona) → taula clonada, per resoldre vistes
    clone_tables_by_name: Dict[str, Dict[str, Any]] = {}

    # PASSADA 1: clonar TOTS els esquemes de taula abans de les pàgines, perquè una vista pot
    # referenciar una taula que es clona més tard (resolució de marcadors completa).
    db_by_id: Dict[str, Dict[str, Any]] = {}
    for db_id in database_ids:
        try:
            db = rest_client.get_database(db_id)
            db_by_id[db_id] = db
            table = clone_table_schema(db)
            if schema_overrides and db_id in schema_overrides:
                from backend.services.notion_schema_config import apply_override
                table = apply_override(table, schema_overrides[db_id])
            table["folder"] = f"{target_folder}/{table.get('name') or 'Taula'}"
            write_table(table)
            report["tables"] += 1
            clone_tables_by_name[nvr._strip_icon(table.get("name"))] = table
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"database": db_id, "stage": "schema", "error": str(e)})

    # PASSADA 2: clonar les pàgines (cos + vistes via MCP) — totes les taules ja existeixen
    for db_id, db in db_by_id.items():
        try:
            from backend.services.notion_importer import _plain_title
            table = clone_tables_by_name.get(nvr._strip_icon(_plain_title(db.get("title"))))
            if not table:
                continue
            for row in rest_client.query_database(db_id):
                if report["pages"] >= max_pages:
                    report["truncated"] = True
                    break
                try:
                    values = clone_values(page_to_values(row, users), table.get("properties", []))
                    title = values.pop("title", None) or _page_title(row) or "Sense títol"
                    # cos + vistes via MCP
                    body = ""
                    try:
                        page_md = fetch_page(row["id"])
                        body = mcp_to_markdown(page_md) if page_md else ""
                        host_pid = str(row["id"]).replace("-", "")
                        body, gviews = resolve_view_markers(
                            body, host_pid, table["id"],
                            fetch_view=fetch_page,
                            resolve_clone_table=lambda n: clone_tables_by_name.get(nvr._strip_icon(n)))
                        for gv in gviews:
                            write_view(gv)
                            report["views"] += 1
                    except Exception as e:  # noqa: BLE001
                        report["errors"].append({"page": row.get("id"), "stage": "mcp", "error": str(e)})
                    write_page({
                        "id": clone_page_id(row["id"]),
                        "title": title,
                        "content": body,
                        "metadata": {"table_id": table["id"], **values,
                                    "icon": _emoji_icon(row.get("icon"))},
                    })
                    report["pages"] += 1
                except Exception as e:  # noqa: BLE001
                    report["errors"].append({"page": row.get("id"), "error": str(e)})
        except Exception as e:  # noqa: BLE001
            report["errors"].append({"database": db_id, "error": str(e)})

    return report
