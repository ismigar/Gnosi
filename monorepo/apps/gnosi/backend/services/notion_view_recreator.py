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
_VIEW_RE = re.compile(r"<view\s+url=\"([^\"]*)\"\s*>\s*(\{.*?\})\s*</view>", re.DOTALL)
# Cada data source del bloc: la línia de títol segueix l'etiqueta (per resoldre el
# `dataSourceUrl` de cada vista en bases multi-font).
_DS_ENTRY_RE = re.compile(
    r'<data-source\s+url="\{?\{?collection://([0-9a-f-]+)\}?\}?"[^>]*>\s*\n'
    r"The title of this Data Source is:\s*(.+)")
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
def _advanced_filters(af: Any) -> List[Dict[str, Any]]:
    """Aplana un `advancedFilter` de Notion a una llista de filtres property plans.
    Només grups AND (o d'UN filtre, on and==or): els filtres de Gnosi són AND. El cas
    fórmula (`operator:"every"` amb `resultFilter`) es fusiona: property de fora +
    operator/value de dins (p. ex. «Connexions fortes»: Centralitat > 10)."""
    if not isinstance(af, dict) or af.get("type") != "group":
        return []
    items = [f for f in (af.get("filters") or []) if isinstance(f, dict)]
    if str(af.get("operator") or "and").lower() != "and" and len(items) > 1:
        return []
    out: List[Dict[str, Any]] = []
    for f in items:
        if f.get("type") != "property" or not f.get("property"):
            continue
        rf = f.get("resultFilter")
        if isinstance(rf, dict) and rf.get("operator"):
            out.append({"type": "property", "property": f["property"],
                        "operator": rf.get("operator"), "value": rf.get("value")})
        elif f.get("operator") and f.get("operator") != "every":
            out.append(f)
    return out


def _parse_view_json(v: Dict[str, Any], ds_names: Dict[str, str], default_ds: str,
                     view_url: str) -> Dict[str, Any]:
    """JSON d'un `<view>` de l'MCP → meta de vista (forma de parse_mcp_view + name/view_url/
    chart/timeline_by/date_by, i el data source resolt per `dataSourceUrl`)."""
    ds_name = default_ds
    m = re.search(r"collection://([0-9a-f-]+)", str(v.get("dataSourceUrl") or ""))
    if m and ds_names.get(m.group(1)):
        ds_name = ds_names[m.group(1)]
    meta: Dict[str, Any] = {
        "data_source_name": ds_name, "view_type": v.get("type", "table"),
        "name": (v.get("name") or "").strip() or None, "view_url": view_url or None,
        "display_properties": v.get("displayProperties", []) or [],
        "filter_property": None, "filter_value_page_id": None,
        "filters_raw": [], "sorts": [], "group_by": None,
        "chart": None, "timeline_by": None, "date_by": None,
    }
    simple = [(f.get("filter") or {}) for f in (v.get("simpleFilters") or [])]
    for flt in simple + _advanced_filters(v.get("advancedFilter")):
        if flt.get("type") != "property" or not flt.get("property"):
            continue
        meta["filters_raw"].append(flt)
        if meta["filter_property"] is None:
            meta["filter_property"] = flt.get("property")
            # `value` pot venir com a dict {"value":X}, llista o escalar: usem
            # _filter_value (mateixa desambiguació que la resta del mòdul). Abans
            # es feia `.get("value")` cru i petava amb AttributeError si era llista
            # (p. ex. filtre de relació ["<page-id>"]) → l'except se l'empassava i
            # la vista perdia filtres/ordre/grup silenciosament.
            val = _filter_value(flt) or ""
            pid = _PAGE_ID_RE.search(str(val))
            meta["filter_value_page_id"] = pid.group(1) if pid else None
    # Ordre i agrupació (si la vista en porta; formats defensius)
    for s in (v.get("sorts") or []):
        if not isinstance(s, dict):
            continue
        fld = s.get("property") or s.get("field")
        if not fld:
            continue
        d = "desc" if str(s.get("direction") or "").lower().startswith("desc") else "asc"
        meta["sorts"].append({"field": fld, "direction": d})
    gb = v.get("groupBy") or v.get("group_by")
    if isinstance(gb, dict):
        gb = gb.get("property") or gb.get("field")
    meta["group_by"] = gb or None
    # Timeline/calendar: el camp de data de la vista (VaultTimeline/Calendar: dateField)
    tb = v.get("timelineBy")
    meta["timeline_by"] = tb if isinstance(tb, str) and tb.strip() else None
    cb = v.get("calendarBy")
    meta["date_by"] = cb if isinstance(cb, str) and cb.strip() else None
    # Chart: config de VaultChart {chartType, xField, yField, aggregation}
    if v.get("type") == "chart":
        cc = v.get("chartConfig") or {}
        dc = cc.get("dataConfig") or {}
        xgb = dc.get("groupBy") or {}
        agg = ((dc.get("aggregationConfig") or {}).get("aggregation") or {})
        ctype = str(cc.get("type") or "bar").lower()
        aggr = str(agg.get("aggregator") or "count").lower()
        meta["chart"] = {
            "chartType": ctype if ctype in ("bar", "hbar", "line", "pie", "donut") else "bar",
            "xField": xgb.get("property") or None,
            "yField": agg.get("property") or None,
            "aggregation": {"average": "avg"}.get(aggr, aggr),
        }
    return meta


def parse_mcp_views(view_md: str) -> List[Dict[str, Any]]:
    """TOTES les vistes (pestanyes) d'un bloc `<database>` de l'MCP, en ordre.

    Notion agrupa N vistes com a pestanyes d'un mateix bloc de linked database i el fetch
    MCP les retorna totes com a `<view url>{json}</view>`; abans només es llegia la primera
    (`.search`) i la resta es perdien en silenci («Cervell digital»: 10 → 1)."""
    ds_names = {m.group(1): m.group(2).strip() for m in _DS_ENTRY_RE.finditer(view_md or "")}
    nm = _DS_NAME_RE.search(view_md or "")
    default_ds = nm.group(1).strip() if nm else ""
    out: List[Dict[str, Any]] = []
    for vm in _VIEW_RE.finditer(view_md or ""):
        try:
            v = json.loads(vm.group(2))
        except Exception:
            continue
        vid = re.search(r"view://([0-9a-f-]+)", vm.group(1) or "")
        out.append(_parse_view_json(v, ds_names, default_ds, vid.group(1) if vid else None))
    return out


def parse_mcp_view(view_md: str) -> Dict[str, Any]:
    """Meta de la PRIMERA vista del bloc (compat; per a totes les pestanyes: parse_mcp_views)."""
    views = parse_mcp_views(view_md)
    if views:
        return views[0]
    ds = _DS_NAME_RE.search(view_md or "")
    return {
        "data_source_name": ds.group(1).strip() if ds else "", "view_type": "table",
        "name": None, "view_url": None,
        "display_properties": [], "filter_property": None, "filter_value_page_id": None,
        "filters_raw": [], "sorts": [], "group_by": None,
        "chart": None, "timeline_by": None, "date_by": None,
    }


def _scalar(v: Any) -> str:
    """Valor de filtre de Notion → string de Gnosi (checkbox: 'true'/'false', paritat amb
    vaultFilters.asBool del frontend)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    return "" if v is None else str(v)


def _filter_value(flt: Dict[str, Any]) -> Any:
    """El `value` d'un simpleFilter en qualsevol de les formes vistes de l'MCP:
    {"type":"exact","value":X} · llista directa · escalar directe."""
    v = flt.get("value")
    if isinstance(v, dict):
        return v.get("value")
    return v


def map_simple_filter(flt: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """simpleFilter de Notion → filtre de Gnosi {field, operator, value} (None si no mapejable).
    Operadors de Gnosi (cf. frontend vaultFilters.js): equals, not_equals, contains,
    not_contains, is_empty, is_not_empty, greater_than, less_than."""
    prop = flt.get("property")
    op = str(flt.get("operator") or "")
    if not prop or not op:
        return None
    val = _filter_value(flt)
    if isinstance(val, list):
        # llista = OR ("és una de…"); els filtres de Gnosi són AND → només el cas d'un element
        # és mapejable amb fidelitat.
        if len(val) != 1:
            return None
        val = val[0]
    if isinstance(val, dict):
        # Formes de status: {"type":"is_option","value":"X"} → el valor; {"type":"is_group"}
        # (grup d'estats) no té equivalent a un select pla de Gnosi → no mapejable.
        if val.get("type") == "is_option":
            val = val.get("value")
        else:
            return None
    if op.endswith("is_not_empty"):
        return {"field": prop, "operator": "is_not_empty"}
    if op.endswith("is_empty"):
        return {"field": prop, "operator": "is_empty"}
    if val is None:
        # Filtre incomplet a Notion (operador triat sense valor): no filtra res allà;
        # mapejar-lo amb valor buit aquí sí que filtraria → es descarta.
        return None
    if "not_contain" in op:
        return {"field": prop, "operator": "not_contains", "value": _scalar(val)}
    if "contain" in op:
        return {"field": prop, "operator": "contains", "value": _scalar(val)}
    if op.endswith("is_not") or "not_equal" in op:
        return {"field": prop, "operator": "not_equals", "value": _scalar(val)}
    if op.endswith("_is") or op in ("is", "equals", "equal"):
        return {"field": prop, "operator": "equals", "value": _scalar(val)}
    if "greater" in op or op.endswith("_after"):
        return {"field": prop, "operator": "greater_than", "value": _scalar(val)}
    if "less" in op or op.endswith("_before"):
        return {"field": prop, "operator": "less_than", "value": _scalar(val)}
    return None


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
                     view_meta: Dict[str, Any], heading: str,
                     salt: str = "") -> Dict[str, Any]:
    """Vista de Gnosi (per a `POST /api/vault/views`) equivalent a la vista incrustada de Notion.
    Filtre `{field, value:"this"}` quan la vista filtra per la relació a la pàgina amfitriona.
    `salt`: sufix de l'id per a les pestanyes 2..N d'un mateix bloc (la 1a el deixa buit i
    conserva l'id llegat → els embeds de clons previs continuen resolent)."""
    seed = f"{host_page_id}:{target_table.get('id')}:{heading}"
    if salt:
        seed += f":{salt}"
    view_id = str(uuid.uuid5(_NS, seed))
    view: Dict[str, Any] = {
        "id": view_id,
        "table_id": target_table.get("id"),
        "name": heading or target_table.get("name") or "Vista",
        "type": view_meta.get("view_type", "table"),
        "visibleProperties": view_meta.get("display_properties") or [],
        # Vista contextual d'una secció de pàgina: el tauler no la mostra com a
        # pestanya (frontend isPageEmbedView); els embeds la segueixen llegint
        # del registry amb normalitat.
        "embedded": True,
    }
    # Config específica del tipus (mateixes claus que llegeixen VaultChart/VaultTimeline/
    # DigitalBrainCalendar al frontend).
    ch = view_meta.get("chart")
    if isinstance(ch, dict) and view["type"] == "chart":
        view["chartType"] = ch.get("chartType") or "bar"
        if ch.get("xField"):
            view["xField"] = ch["xField"]
        if ch.get("yField"):
            view["yField"] = ch["yField"]
        view["aggregation"] = ch.get("aggregation") or "count"
    date_by = view_meta.get("timeline_by") or view_meta.get("date_by")
    if date_by and view["type"] in ("timeline", "calendar"):
        view["dateField"] = date_by
    # TOTS els filtres de la vista: el de relació a la pàgina amfitriona → {value:"this"}
    # (format històric, el motor el resol al host); la resta → operadors de Gnosi.
    filters: List[Dict[str, Any]] = []
    for flt in (view_meta.get("filters_raw") or []):
        val = _filter_value(flt)
        # el filtre de relació pot dur la pàgina com a escalar O dins d'una llista
        _cands = val if isinstance(val, list) else [val]
        pid = None
        for c in _cands:
            m = _PAGE_ID_RE.search(str(c)) if c is not None else None
            if m:
                pid = m
                break
        if pid and _uid(pid.group(1)) == _uid(host_page_id):
            fname = resolve_filter_field(target_table, host_table_id, flt.get("property"))
            if fname:
                filters.append({"field": fname, "value": "this"})
            continue
        mapped = map_simple_filter(flt)
        if mapped:
            filters.append(mapped)
    # Compat: metas antics sense filters_raw però amb el filtre "aquesta pàgina" detectat
    if not filters and view_meta.get("filter_value_page_id") \
            and _uid(view_meta["filter_value_page_id"]) == _uid(host_page_id):
        fname = resolve_filter_field(target_table, host_table_id, view_meta.get("filter_property"))
        if fname:
            filters.append({"field": fname, "value": "this"})
    if filters:
        view["filters"] = filters
    if view_meta.get("sorts"):
        view["sorts"] = [dict(s) for s in view_meta["sorts"]]
    if view_meta.get("group_by"):
        view["groupBy"] = view_meta["group_by"]
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
    incrustada resoluble a una taula del vault — TOTES les pestanyes de cada bloc, no només
    la primera. Només la 1a pestanya de cada bloc (l'ÀNCORA) porta `embed` (l'única que va
    al cos, com a Notion); la resta hi pengen pel camp `tabs` de l'àncora. Les vistes de
    gràfic "suggerides" per l'MCP (no existeixen com a pestanyes reals) s'ometen. La capa
    que escriu (POST /views + insereix l'embed sota la capçalera) i el client MCP són a part."""
    results: List[Dict[str, Any]] = []
    for sec in parse_mcp_page(page_md):
        try:
            view_md = fetch_view(sec["db_id"])
            if not view_md:
                continue
            block: List[Dict[str, Any]] = []
            for j, meta in enumerate(parse_mcp_views(view_md)):
                if meta.get("view_type") == "chart":
                    continue
                table = resolve_table(meta.get("data_source_name"))
                if not table:
                    continue
                name = sec["heading"] or meta.get("name") or ""
                gview = build_gnosi_view(host_page_id, table, host_table_id, meta, name,
                                         salt=(meta.get("view_url") or str(j)) if j else "")
                if meta.get("name"):
                    gview["name"] = meta["name"]
                block.append({"heading": sec["heading"], "db_id": sec["db_id"],
                              "view": gview, "embed": None})
            if block:
                block[0]["view"]["tabs"] = [b["view"]["id"] for b in block[1:]]
                block[0]["embed"] = view_embed(block[0]["view"]["id"])
                results.extend(block)
        except Exception:
            continue
    return results
