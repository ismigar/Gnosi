"""Recreador de vistes incrustades de Notion (Fase 2, via MCP allotjat).

L'API REST no resol les linked database views, però l'MCP allotjat de Notion SÍ: en fer
`fetch` d'una pàgina retorna les vistes com `<database url=".../<id>" inline>` sota les
capçaleres, i en fer `fetch` de la vista en dóna la **taula destí** (data source) i el
**filtre exacte** (p.ex. `📀 Projecte relation_contains <aquesta pàgina>`).

Aquest mòdul són les transformacions PURES (parse + construcció de la `gnosi-view` + embed),
testejables amb les dades reals de l'MCP, sense xarxa. La capa d'I/O (client MCP HTTP+OAuth)
és a part (cf. directiva `notion_mcp_oauth_views.md`).
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional

_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000002")
_DB_RE = re.compile(r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"')
_HEADING_RE = re.compile(r"^\s*(#{1,6})\s+(.+?)(?:\s*\{[^}]*\})?\s*$")
_DS_NAME_RE = re.compile(r"The title of this Data Source is:\s*(.+)")
_VIEW_RE = re.compile(r"<view\s+url=\"[^\"]*\">\s*(\{.*?\})\s*</view>", re.DOTALL)
_PAGE_ID_RE = re.compile(r"([0-9a-f]{32})")


def _uid(s) -> str:
    return str(s or "").replace("-", "").lower()


def _strip_icon(name: str) -> str:
    """Treu emoji/prefix decoratiu i normalitza per comparar noms de camp/taula."""
    return re.sub(r"[^\w]", "", str(name or "").lower())


# ---------------------------------------------------------------------------
# 1) Parse de la PÀGINA (markdown de l'MCP) → seccions amb vistes
# ---------------------------------------------------------------------------
def parse_mcp_page(page_md: str) -> List[Dict[str, Any]]:
    """Retorna [{heading, db_id}] en ordre: cada `<database inline>` amb la capçalera que el
    precedeix. `db_id` és el block id (32-hex) de la vista (cal `fetch` per resoldre-la)."""
    m = re.search(r"<content>(.*)</content>", page_md, re.DOTALL)
    body = m.group(1) if m else page_md
    out: List[Dict[str, Any]] = []
    current_heading = ""
    for line in body.splitlines():
        h = _HEADING_RE.match(line)
        if h:
            current_heading = h.group(2).strip()
            continue
        for db_id in _DB_RE.findall(line):
            out.append({"heading": current_heading, "db_id": db_id})
    return out


# ---------------------------------------------------------------------------
# 2) Parse de la VISTA (markdown de `fetch` del database) → metadada
# ---------------------------------------------------------------------------
def parse_mcp_view(view_md: str) -> Dict[str, Any]:
    """Extreu {data_source_name, view_type, display_properties, filter_property,
    filter_value_page_id} d'una vista incrustada retornada per l'MCP."""
    ds_name = ""
    nm = _DS_NAME_RE.search(view_md)
    if nm:
        ds_name = nm.group(1).strip()
    meta: Dict[str, Any] = {
        "data_source_name": ds_name, "view_type": "table",
        "display_properties": [], "filter_property": None, "filter_value_page_id": None,
    }
    vm = _VIEW_RE.search(view_md)
    if vm:
        try:
            v = json.loads(vm.group(1))
            meta["view_type"] = v.get("type", "table")
            meta["display_properties"] = v.get("displayProperties", []) or []
            for f in (v.get("simpleFilters") or []):
                flt = f.get("filter") or {}
                if flt.get("type") == "property" and flt.get("property"):
                    meta["filter_property"] = flt.get("property")
                    val = ((flt.get("value") or {}).get("value")) or ""
                    pid = _PAGE_ID_RE.search(str(val))
                    meta["filter_value_page_id"] = pid.group(1) if pid else None
                    break
        except Exception:
            pass
    return meta


# ---------------------------------------------------------------------------
# 3) Construcció de la `gnosi-view` del vault + embed
# ---------------------------------------------------------------------------
def resolve_filter_field(target_table: Dict[str, Any], host_table_id: str,
                         filter_property: Optional[str]) -> Optional[str]:
    """Camp de `target_table` pel qual filtrar = la relació que apunta a la taula amfitriona
    (per id) o, si no, per nom (= filter_property de Notion, p.ex. '📀 Projecte' → 'Projecte')."""
    props = target_table.get("properties", []) or []
    for p in props:
        if p.get("type") == "relation" and _uid(p.get("relation_database_id")) == _uid(host_table_id):
            return p.get("name")
    if filter_property:
        want = _strip_icon(filter_property)
        for p in props:
            if _strip_icon(p.get("name")) == want:
                return p.get("name")
    return None


def build_gnosi_view(host_page_id: str, target_table: Dict[str, Any], host_table_id: str,
                     view_meta: Dict[str, Any], heading: str) -> Dict[str, Any]:
    """Vista de Gnosi (per a `POST /api/vault/views`) equivalent a la vista incrustada de Notion.
    Filtre `{field, value:"this"}` quan la vista filtra per la relació a la pàgina amfitriona."""
    view_id = str(uuid.uuid5(_NS, f"{host_page_id}:{target_table.get('id')}:{heading}"))
    view: Dict[str, Any] = {
        "id": view_id,
        "table_id": target_table.get("id"),
        "name": heading or target_table.get("name") or "Vista",
        "type": view_meta.get("view_type", "table"),
        "visibleProperties": view_meta.get("display_properties") or [],
    }
    # Filtre "aquesta pàgina" si la vista de Notion filtrava per relació a l'amfitrió
    if view_meta.get("filter_value_page_id") and _uid(view_meta["filter_value_page_id"]) == _uid(host_page_id):
        fname = resolve_filter_field(target_table, host_table_id, view_meta.get("filter_property"))
        if fname:
            view["filters"] = [{"field": fname, "value": "this"}]
    return view


def view_embed(view_id: str) -> str:
    """La incrustació al cos de la pàgina (comentari HTML que el vault materialitza)."""
    return f'<!-- gnosi-view:def {{"view_id":"{view_id}"}} -->'


# ---------------------------------------------------------------------------
# 4) Orquestrador (fetch_view / resolve_table injectats → desacoblat de l'I/O MCP)
# ---------------------------------------------------------------------------
def recreate_views_for_page(
    page_md: str,
    host_page_id: str,
    host_table_id: str,
    *,
    fetch_view,            # callable(db_id) -> markdown de la vista (via MCP)
    resolve_table,         # callable(data_source_name) -> taula del vault (dict) o None
) -> List[Dict[str, Any]]:
    """Per a una pàgina (markdown MCP), retorna [{heading, db_id, view, embed}] de cada vista
    incrustada resoluble a una taula del vault. La capa que escriu (POST /views + insereix
    l'embed sota la capçalera) i el client MCP són a part."""
    results: List[Dict[str, Any]] = []
    for sec in parse_mcp_page(page_md):
        try:
            view_md = fetch_view(sec["db_id"])
            if not view_md:
                continue
            meta = parse_mcp_view(view_md)
            table = resolve_table(meta.get("data_source_name"))
            if not table:
                continue
            gview = build_gnosi_view(host_page_id, table, host_table_id, meta, sec["heading"])
            results.append({"heading": sec["heading"], "db_id": sec["db_id"],
                            "view": gview, "embed": view_embed(gview["id"])})
        except Exception:
            continue
    return results
