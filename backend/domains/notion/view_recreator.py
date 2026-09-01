"""Typed recreator of embedded Notion views (Phase 2, via hosted MCP).

The REST API doesn't resolve linked database views, but Notion's hosted MCP DOES: when you
`fetch` a page, it returns the views as `<database url=".../<id>" inline>` under the
headings, and when you `fetch` the view it gives the **target table** (data source) and the
**exact filter** (e.g. `📀 Projecte relation_contains <this page>`).

This module holds the PURE transformations (parse + building the `gnosi-view` + embed),
testable with the MCP's real data, without a network. The I/O layer (HTTP+OAuth MCP client)
is separate (cf. directive `notion_mcp_oauth_views.md`).
"""

from __future__ import annotations

import json as json
import re as re
import uuid as uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

JsonMap = Dict[str, Any]
FetchView = Callable[[str], str]
ResolveTable = Callable[[str], Optional[JsonMap]]

_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000002")
_DB_RE = re.compile(r'<database\s+url="[^"]*?([0-9a-f]{32})"[^>]*\binline="true"')
_HEADING_RE = re.compile(r"^\s*(#{1,6})\s+(.+?)(?:\s*\{[^}]*\})?\s*$")
_DS_NAME_RE = re.compile(r"The title of this Data Source is:\s*(.+)")
_VIEW_RE = re.compile(r"<view\s+url=\"([^\"]*)\"\s*>\s*(\{.*?\})\s*</view>", re.DOTALL)
# Each data source in the block: the title line follows the label (to resolve the
# `dataSourceUrl` of each view in multi-source databases).
_DS_ENTRY_RE = re.compile(
    r'<data-source\s+url="\{?\{?collection://([0-9a-f-]+)\}?\}?"[^>]*>\s*\n'
    r"The title of this Data Source is:\s*(.+)"
)
_PAGE_ID_RE = re.compile(r"([0-9a-f]{32})")


def _uid(s: Any) -> str:
    return str(s or "").replace("-", "").lower()


def _strip_icon(name: str) -> str:
    """Strip decorative emoji/prefix and normalize to compare field/table names."""
    return re.sub(r"[^\w]", "", str(name or "").lower())


# ---------------------------------------------------------------------------
# 1) Parse the PAGE (MCP markdown) → sections with views
# ---------------------------------------------------------------------------
def parse_mcp_page(page_md: str) -> List[Dict[str, Any]]:
    """Returns [{heading, db_id}] in order: each `<database inline>` with the heading that
    precedes it. `db_id` is the block id (32-hex) of the view (needs a `fetch` to resolve it)."""
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
# 2) Parse the VIEW (markdown from `fetch` of the database) → metadata
# ---------------------------------------------------------------------------
def _advanced_filters(af: Any) -> List[Dict[str, Any]]:
    """Flattens a Notion `advancedFilter` into a list of flat property filters.
    Only AND groups (or a single filter, where and==or): Gnosi's filters are AND. The
    formula case (`operator:"every"` with `resultFilter`) is merged: the outer property +
    the inner operator/value (e.g. «Strong connections»: Centrality > 10)."""
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
            out.append(
                {
                    "type": "property",
                    "property": f["property"],
                    "operator": rf.get("operator"),
                    "value": rf.get("value"),
                }
            )
        elif f.get("operator") and f.get("operator") != "every":
            out.append(f)
    return out


def _parse_view_json(
    v: Dict[str, Any], ds_names: Dict[str, str], default_ds: str, view_url: str
) -> Dict[str, Any]:
    """JSON of an MCP `<view>` → view meta (shape of parse_mcp_view + name/view_url/
    chart/timeline_by/date_by, and the data source resolved via `dataSourceUrl`)."""
    ds_name = default_ds
    m = re.search(r"collection://([0-9a-f-]+)", str(v.get("dataSourceUrl") or ""))
    if m and ds_names.get(m.group(1)):
        ds_name = ds_names[m.group(1)]
    meta: Dict[str, Any] = {
        "data_source_name": ds_name,
        "view_type": v.get("type", "table"),
        "name": (v.get("name") or "").strip() or None,
        "view_url": view_url or None,
        "display_properties": v.get("displayProperties", []) or [],
        "filter_property": None,
        "filter_value_page_id": None,
        "filters_raw": [],
        "sorts": [],
        "group_by": None,
        "chart": None,
        "timeline_by": None,
        "date_by": None,
    }
    simple = [(f.get("filter") or {}) for f in (v.get("simpleFilters") or [])]
    for flt in simple + _advanced_filters(v.get("advancedFilter")):
        if flt.get("type") != "property" or not flt.get("property"):
            continue
        meta["filters_raw"].append(flt)
        if meta["filter_property"] is None:
            meta["filter_property"] = flt.get("property")
            # `value` can come as a dict {"value":X}, a list, or a scalar: we use
            # _filter_value (same disambiguation as the rest of the module). Before,
            # it did a raw `.get("value")` and crashed with AttributeError if it was a list
            # (e.g. relation filter ["<page-id>"]) → the except swallowed it and
            # the view was silently losing filters/order/group.
            val = _filter_value(flt) or ""
            pid = _PAGE_ID_RE.search(str(val))
            meta["filter_value_page_id"] = pid.group(1) if pid else None
    # Sort and grouping (if the view has them; defensive formats)
    for s in v.get("sorts") or []:
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
    # Timeline/calendar: the view's date field (VaultTimeline/Calendar: dateField)
    tb = v.get("timelineBy")
    meta["timeline_by"] = tb if isinstance(tb, str) and tb.strip() else None
    cb = v.get("calendarBy")
    meta["date_by"] = cb if isinstance(cb, str) and cb.strip() else None
    # Chart: VaultChart config {chartType, xField, yField, aggregation}
    if v.get("type") == "chart":
        cc = v.get("chartConfig") or {}
        dc = cc.get("dataConfig") or {}
        xgb = dc.get("groupBy") or {}
        agg = (dc.get("aggregationConfig") or {}).get("aggregation") or {}
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
    """ALL the views (tabs) of an MCP `<database>` block, in order.

    Notion groups N views as tabs of the same linked-database block, and the MCP
    fetch returns all of them as `<view url>{json}</view>`; previously only the first one was read
    (`.search`) and the rest were silently lost («Digital Brain»: 10 → 1)."""
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
        view_url = vid.group(1) if vid else ""
        out.append(_parse_view_json(v, ds_names, default_ds, view_url))
    return out


def parse_mcp_view(view_md: str) -> Dict[str, Any]:
    """Metadata of the FIRST view in the block (compat; for all tabs: parse_mcp_views)."""
    views = parse_mcp_views(view_md)
    if views:
        return views[0]
    ds = _DS_NAME_RE.search(view_md or "")
    return {
        "data_source_name": ds.group(1).strip() if ds else "",
        "view_type": "table",
        "name": None,
        "view_url": None,
        "display_properties": [],
        "filter_property": None,
        "filter_value_page_id": None,
        "filters_raw": [],
        "sorts": [],
        "group_by": None,
        "chart": None,
        "timeline_by": None,
        "date_by": None,
    }


def _scalar(v: Any) -> str:
    """Notion filter value → Gnosi string (checkbox: 'true'/'false', parity with
    the frontend's vaultFilters.asBool)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    return "" if v is None else str(v)


_INVALID_FILTER_VALUE = object()


def _normalize_filter_value(value: Any) -> Any:
    if isinstance(value, list):
        if len(value) != 1:
            return _INVALID_FILTER_VALUE
        return value[0]
    if isinstance(value, dict):
        if value.get("type") != "is_option":
            return _INVALID_FILTER_VALUE
        return value.get("value")
    return value


def _map_filter_operator(prop: Any, operator: str, value: Any) -> Optional[JsonMap]:
    if operator.endswith("is_not_empty"):
        return {"field": prop, "operator": "is_not_empty"}
    if operator.endswith("is_empty"):
        return {"field": prop, "operator": "is_empty"}
    if value is None:
        return None
    if "not_contain" in operator:
        target = "not_contains"
    elif "contain" in operator:
        target = "contains"
    elif operator.endswith("is_not") or "not_equal" in operator:
        target = "not_equals"
    elif operator.endswith("_is") or operator in ("is", "equals", "equal"):
        target = "equals"
    elif "greater_than_or_equal" in operator or operator.endswith("_on_or_after"):
        target = "greater_than_or_equal"
    elif "greater" in operator or operator.endswith("_after"):
        target = "greater_than"
    elif "less_than_or_equal" in operator or operator.endswith("_on_or_before"):
        target = "less_than_or_equal"
    elif "less" in operator or operator.endswith("_before"):
        target = "less_than"
    else:
        return None
    return {"field": prop, "operator": target, "value": _scalar(value)}


def _filter_value(flt: Dict[str, Any]) -> Any:
    """The `value` of a simpleFilter in any of the forms seen from the MCP:
    {"type":"exact","value":X} · direct list · direct scalar."""
    v = flt.get("value")
    if isinstance(v, dict):
        return v.get("value")
    return v


def _value_mentions_host_page(value: Any, host_page_id: str) -> bool:
    """Return whether a raw Notion filter value is scoped to the host page."""
    host_uid = _uid(host_page_id)
    if not host_uid:
        return False
    if isinstance(value, list):
        return any(_value_mentions_host_page(item, host_page_id) for item in value)
    if isinstance(value, dict):
        return any(_value_mentions_host_page(item, host_page_id) for item in value.values())
    return host_uid in _uid(value)


def is_contextual_view(view_meta: Dict[str, Any], host_page_id: str) -> bool:
    """Whether a parsed Notion view depends on the page where it is embedded.

    A relation filter can arrive either as the resolved ``this`` marker or as a
    Notion URL. Both forms must remain page-scoped. Views without either form
    are safe to share across pages and should not create one registry entry per
    host page.
    """
    for flt in view_meta.get("filters_raw") or []:
        if not isinstance(flt, dict):
            continue
        if _value_mentions_host_page(_filter_value(flt), host_page_id):
            return True
    if _uid(view_meta.get("filter_value_page_id")) == _uid(host_page_id):
        return True
    return False


def _canonical_view_payload(view: Dict[str, Any]) -> str:
    """Canonical payload used to identify equivalent imported global views."""
    ignored = {
        "id",
        "tabs",
        "embedded",
        "is_main",
        "hidden",
        "order",
        "source_view_id",
    }
    payload = {key: value for key, value in view.items() if key not in ignored}
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def view_identity(view: Dict[str, Any]) -> Optional[Tuple[str, ...]]:
    """Return a merge key for a safe-to-share imported view, or ``None``.

    Contextual views are intentionally never merged: their ``this`` filter is
    evaluated against the host page. Only views explicitly marked as embedded
    and lacking a host-page filter are candidates for cleanup.
    """
    if view.get("embedded") is not True:
        return None
    if any(isinstance(f, dict) and f.get("value") == "this" for f in view.get("filters") or []):
        return None
    source_view_id = str(view.get("source_view_id") or "").strip()
    if source_view_id:
        return ("source", str(view.get("table_id") or ""), source_view_id)
    return ("payload", str(view.get("table_id") or ""), _canonical_view_payload(view))


def deduplicate_view_definitions(
    views: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Deduplicate safe imported global views while returning ID aliases.

    The first registry entry wins to keep existing references valid. Callers
    must rewrite body markers and ``tabs`` through the returned aliases before
    persisting the compacted registry. Page-scoped views and ordinary user
    views are left untouched.
    """
    kept: List[Dict[str, Any]] = []
    aliases: Dict[str, str] = {}
    canonical_by_key: Dict[Tuple[str, ...], Dict[str, Any]] = {}

    for view in views:
        key = view_identity(view)
        if key is None:
            kept.append(view)
            continue
        canonical = canonical_by_key.get(key)
        if canonical is None:
            canonical_by_key[key] = view
            kept.append(view)
            continue
        duplicate_id = str(view.get("id") or "").strip()
        canonical_id = str(canonical.get("id") or "").strip()
        if duplicate_id and canonical_id and duplicate_id != canonical_id:
            aliases[duplicate_id] = canonical_id

    if not aliases:
        return kept, aliases

    def resolve(view_id: str) -> str:
        seen = set()
        current = view_id
        while current in aliases and current not in seen:
            seen.add(current)
            current = aliases[current]
        return current

    # Collapse aliases transitively so callers can use one map safely.
    aliases = {old: resolve(old) for old in aliases}

    for view in kept:
        tabs = view.get("tabs")
        if not isinstance(tabs, list):
            continue
        new_tabs: List[str] = []
        for tab_id in tabs:
            resolved = resolve(str(tab_id))
            if resolved != str(view.get("id") or "") and resolved not in new_tabs:
                new_tabs.append(resolved)
        view["tabs"] = new_tabs

    return kept, aliases


def map_simple_filter(flt: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Notion simpleFilter → Gnosi filter {field, operator, value} (None if not mappable).
    Gnosi operators (cf. frontend vaultFilters.js): equals, not_equals, contains,
    not_contains, is_empty, is_not_empty, greater_than, less_than."""
    prop = flt.get("property")
    op = str(flt.get("operator") or "")
    if not prop or not op:
        return None
    value = _normalize_filter_value(_filter_value(flt))
    if value is _INVALID_FILTER_VALUE:
        return None
    return _map_filter_operator(prop, op, value)


# ---------------------------------------------------------------------------
# 3) Building the vault's `gnosi-view` + embed
# ---------------------------------------------------------------------------
def resolve_filter_field(
    target_table: Dict[str, Any], host_table_id: str, filter_property: Optional[str]
) -> Optional[str]:
    """`target_table` field to filter by = the relation that points to the host table
    (by id) or, failing that, by name (= Notion's filter_property, e.g. '📀 Projecte' → 'Projecte')."""
    props = target_table.get("properties", []) or []
    for p in props:
        if p.get("type") == "relation" and _uid(p.get("relation_database_id")) == _uid(
            host_table_id
        ):
            name = p.get("name")
            return str(name) if name is not None else None
    if filter_property:
        want = _strip_icon(filter_property)
        for p in props:
            if _strip_icon(p.get("name")) == want:
                name = p.get("name")
                return str(name) if name is not None else None
    return None


def _view_seed(
    host_page_id: str,
    target_table_id: str,
    view_meta: JsonMap,
    heading: str,
    salt: str,
) -> tuple[str, str]:
    source_view_id = str(view_meta.get("view_url") or "").strip()
    contextual = is_contextual_view(view_meta, host_page_id)
    if not contextual and source_view_id:
        return f"global:{target_table_id}:{source_view_id}", source_view_id
    if not contextual:
        payload = _canonical_view_payload(view_meta)
        return f"global:{target_table_id}:{payload}", source_view_id
    seed = f"{host_page_id}:{target_table_id}:{heading}"
    return (f"{seed}:{salt}" if salt else seed), source_view_id


def _apply_view_type_config(view: JsonMap, view_meta: JsonMap) -> None:
    chart = view_meta.get("chart")
    if isinstance(chart, dict) and view["type"] == "chart":
        view["chartType"] = chart.get("chartType") or "bar"
        if chart.get("xField"):
            view["xField"] = chart["xField"]
        if chart.get("yField"):
            view["yField"] = chart["yField"]
        view["aggregation"] = chart.get("aggregation") or "count"
    date_by = view_meta.get("timeline_by") or view_meta.get("date_by")
    if date_by and view["type"] in ("timeline", "calendar"):
        view["dateField"] = date_by


def _page_id_from_filter_value(value: Any) -> Optional[str]:
    candidates = value if isinstance(value, list) else [value]
    for candidate in candidates:
        match = _PAGE_ID_RE.search(str(candidate)) if candidate is not None else None
        if match:
            return match.group(1)
    return None


def _build_view_filters(
    host_page_id: str,
    host_table_id: str,
    target_table: JsonMap,
    view_meta: JsonMap,
) -> List[JsonMap]:
    filters: List[JsonMap] = []
    for raw_filter in view_meta.get("filters_raw") or []:
        if not isinstance(raw_filter, dict):
            continue
        page_id = _page_id_from_filter_value(_filter_value(raw_filter))
        if page_id and _uid(page_id) == _uid(host_page_id):
            field = resolve_filter_field(target_table, host_table_id, raw_filter.get("property"))
            if field:
                filters.append({"field": field, "value": "this"})
            continue
        mapped = map_simple_filter(raw_filter)
        if mapped:
            filters.append(mapped)
    return filters


def _add_legacy_context_filter(
    filters: List[JsonMap],
    host_page_id: str,
    host_table_id: str,
    target_table: JsonMap,
    view_meta: JsonMap,
) -> None:
    legacy_page_id = view_meta.get("filter_value_page_id")
    if filters or not legacy_page_id or _uid(legacy_page_id) != _uid(host_page_id):
        return
    field = resolve_filter_field(target_table, host_table_id, view_meta.get("filter_property"))
    if field:
        filters.append({"field": field, "value": "this"})


def build_gnosi_view(
    host_page_id: str,
    target_table: Dict[str, Any],
    host_table_id: str,
    view_meta: Dict[str, Any],
    heading: str,
    salt: str = "",
) -> Dict[str, Any]:
    """Gnosi view (for `POST /api/vault/views`) equivalent to Notion's embedded view.
    Filter `{field, value:"this"}` when the view filters by the relation to the host page.
    `salt`: id suffix for tabs 2..N of the same block (the 1st leaves it empty and
    keeps the legacy id → embeds from previous clones keep resolving)."""
    target_table_id = str(target_table.get("id") or "")
    seed, source_view_id = _view_seed(host_page_id, target_table_id, view_meta, heading, salt)
    view_id = str(uuid.uuid5(_NS, seed))
    view: Dict[str, Any] = {
        "id": view_id,
        "table_id": target_table.get("id"),
        "name": heading or target_table.get("name") or "Vista",
        "type": view_meta.get("view_type", "table"),
        "visibleProperties": view_meta.get("display_properties") or [],
        # Contextual view of a page section: the dashboard doesn't show it as
        # tab (frontend isPageEmbedView); the embeds keep reading it
        # a normal part of the registry.
        "embedded": True,
    }
    if source_view_id:
        view["source_view_id"] = source_view_id
    _apply_view_type_config(view, view_meta)
    filters = _build_view_filters(host_page_id, host_table_id, target_table, view_meta)
    _add_legacy_context_filter(filters, host_page_id, host_table_id, target_table, view_meta)
    if filters:
        view["filters"] = filters
    if view_meta.get("sorts"):
        view["sorts"] = [dict(s) for s in view_meta["sorts"]]
    if view_meta.get("group_by"):
        view["groupBy"] = view_meta["group_by"]
    return view


def view_embed(view_id: str) -> str:
    """The embed in the page body (HTML comment that the vault materializes)."""
    return f'<!-- gnosi-view:def {{"view_id":"{view_id}"}} -->'


# ---------------------------------------------------------------------------
# 4) Orchestrator (fetch_view / resolve_table injected → decoupled from the MCP I/O)
# ---------------------------------------------------------------------------
def recreate_views_for_page(
    page_md: str,
    host_page_id: str,
    host_table_id: str,
    *,
    fetch_view: FetchView,
    resolve_table: ResolveTable,
) -> List[Dict[str, Any]]:
    """For a page (MCP markdown), returns [{heading, db_id, view, embed}] for each
    embedded view resolvable to a vault table — ALL tabs of each block, not just
    the first. Only the 1st tab of each block (the ANCHOR) carries `embed` (the only one that goes
    into the body, as in Notion); the rest hang off the anchor's `tabs` field. The
    chart views "suggested" by the MCP (they don't exist as real tabs) are omitted. The
    layer that writes (POST /views + inserts the embed under the heading) and the MCP client are separate."""
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
                table = resolve_table(str(meta.get("data_source_name") or ""))
                if not table:
                    continue
                name = sec["heading"] or meta.get("name") or ""
                gview = build_gnosi_view(
                    host_page_id,
                    table,
                    host_table_id,
                    meta,
                    name,
                    salt=(meta.get("view_url") or str(j)) if j else "",
                )
                if meta.get("name"):
                    gview["name"] = meta["name"]
                block.append(
                    {"heading": sec["heading"], "db_id": sec["db_id"], "view": gview, "embed": None}
                )
            if block:
                block[0]["view"]["tabs"] = [b["view"]["id"] for b in block[1:]]
                block[0]["embed"] = view_embed(block[0]["view"]["id"])
                results.extend(block)
        except Exception:
            continue
    return results
