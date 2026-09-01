"""Health check of a Notion clone (Notion ↔ vault clone).

After cloning, it gives confidence to abandon Notion: compares row counts per DB,
detects empty bodies (failed MCP), orphaned relations (unselected DBs), recreated views and
missing attachments on disk. PURE → testable; the endpoint layer supplies the Notion counts,
reads the clone's pages and checks the Assets files.

cf. directive `notion_exact_clone.md`.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

_WIKILINK_RE = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]")
_PAGE_SYSTEM_KEYS = {"id", "title", "table_id", "icon", "cover"}


def relation_ids(value: Any) -> List[str]:
    """Value of a relation field → clean ids (accepts `[[Title|id]]`, `[[id]]`, or bare id)."""
    items = value if isinstance(value, list) else ([value] if value else [])
    out: List[str] = []
    for v in items:
        if not isinstance(v, str) or not v.strip():
            continue
        m = _WIKILINK_RE.match(v.strip())
        out.append((m.group(1) if m else v).strip())
    return out


def _property_signature(prop: Dict[str, Any]) -> Dict[str, Any]:
    """Comparable source-faithful subset of a Gnosi property definition."""
    raw_config = prop.get("config")
    config = raw_config if isinstance(raw_config, dict) else {}
    options = prop.get("options")
    if options is None:
        options = config.get("options")
    return {
        "id": prop.get("id"),
        "type": prop.get("type"),
        "relation_database_id": prop.get("relation_database_id"),
        "read_only": bool(prop.get("read_only")),
        "options": options or [],
    }


def _normalize_exact_value(value: Any, field_type: str) -> Any:
    """Normalize storage-only decoration while preserving the source value."""
    if field_type == "relation":
        return relation_ids(value)
    if isinstance(value, dict):
        return {
            str(key): _normalize_exact_value(item, "")
            for key, item in sorted(value.items())
        }
    if isinstance(value, list):
        return [_normalize_exact_value(item, "") for item in value]
    return value


def verify_exact_table(
    expected_table: Dict[str, Any],
    expected_rows: Dict[str, Dict[str, Any]],
    clone_table: Dict[str, Any],
    clone_rows: Dict[str, Dict[str, Any]],
    *,
    max_examples: int = 50,
) -> Dict[str, Any]:
    """Compare one cloned table with its mapped Notion schema and row values.

    Relation wikilink decoration is ignored, but IDs and every other structured
    value remain significant. This deliberately detects undeclared frontmatter
    keys because they surface as page-specific properties in the editor.
    """
    expected_props = expected_table.get("properties") or []
    clone_props = clone_table.get("properties") or []
    expected_by_name = {str(prop.get("name")): prop for prop in expected_props}
    clone_by_name = {str(prop.get("name")): prop for prop in clone_props}

    expected_names = list(expected_by_name)
    clone_names = list(clone_by_name)
    missing_properties = [name for name in expected_names if name not in clone_by_name]
    extra_properties = [name for name in clone_names if name not in expected_by_name]
    property_mismatches = []
    for name in expected_names:
        if name not in clone_by_name:
            continue
        expected_signature = _property_signature(expected_by_name[name])
        clone_signature = _property_signature(clone_by_name[name])
        if expected_signature != clone_signature:
            property_mismatches.append({
                "property": name,
                "notion": expected_signature,
                "clone": clone_signature,
            })

    expected_ids = set(expected_rows)
    clone_ids = set(clone_rows)
    missing_rows = sorted(expected_ids - clone_ids)
    extra_rows = sorted(clone_ids - expected_ids)

    value_mismatches = []
    for page_id in sorted(expected_ids & clone_ids):
        expected_meta = expected_rows[page_id]
        clone_meta = clone_rows[page_id]
        for name, prop in expected_by_name.items():
            field_type = str(prop.get("type") or "")
            expected_value = _normalize_exact_value(expected_meta.get(name), field_type)
            clone_value = _normalize_exact_value(clone_meta.get(name), field_type)
            if expected_value != clone_value:
                value_mismatches.append({
                    "page": page_id,
                    "title": expected_meta.get("title") or clone_meta.get("title"),
                    "property": name,
                    "notion": expected_value,
                    "clone": clone_value,
                })

    declared = set(clone_by_name)
    undeclared = []
    for page_id, metadata in clone_rows.items():
        for name in metadata:
            if name not in declared and name not in _PAGE_SYSTEM_KEYS:
                undeclared.append({
                    "page": page_id,
                    "title": metadata.get("title"),
                    "property": name,
                })

    schema_order_ok = expected_names == clone_names
    schema_ok = (
        not missing_properties
        and not extra_properties
        and not property_mismatches
        and schema_order_ok
    )
    rows_ok = not missing_rows and not extra_rows
    values_ok = not value_mismatches and not undeclared
    return {
        "summary": {
            "exact": schema_ok and rows_ok and values_ok,
            "schema_ok": schema_ok,
            "rows_ok": rows_ok,
            "values_ok": values_ok,
            "notion_properties": len(expected_props),
            "clone_properties": len(clone_props),
            "notion_rows": len(expected_rows),
            "clone_rows": len(clone_rows),
            "missing_properties": len(missing_properties),
            "extra_properties": len(extra_properties),
            "property_mismatches": len(property_mismatches),
            "schema_order_ok": schema_order_ok,
            "missing_rows": len(missing_rows),
            "extra_rows": len(extra_rows),
            "value_mismatches": len(value_mismatches),
            "undeclared_properties": len(undeclared),
        },
        "schema": {
            "missing": missing_properties,
            "extra": extra_properties,
            "mismatches": property_mismatches[:max_examples],
            "notion_order": expected_names,
            "clone_order": clone_names,
        },
        "rows": {
            "missing": missing_rows[:max_examples],
            "extra": extra_rows[:max_examples],
        },
        "value_mismatches": value_mismatches[:max_examples],
        "undeclared_properties": undeclared[:max_examples],
    }


def verify_clone(notion_counts: Dict[str, int], clone_pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Clone health report.

    `notion_counts`: {clone_table_id: number of rows in Notion for that DB}.
    `clone_pages`: [{id, table_id, body_empty: bool, view_count: int, relations: [ids],
                     missing_assets: [paths]}] read from the cloned vault.
    
    """
    all_ids = {p.get("id") for p in clone_pages}
    by_table: Dict[Any, List[Dict[str, Any]]] = {}
    for p in clone_pages:
        by_table.setdefault(p.get("table_id"), []).append(p)

    tables = []
    for tid, n_notion in notion_counts.items():
        n_clone = len(by_table.get(tid, []))
        tables.append({"table_id": tid, "notion": n_notion, "clone": n_clone,
                       "ok": n_clone == n_notion, "missing": max(0, n_notion - n_clone)})

    empty = [p.get("id") for p in clone_pages if p.get("body_empty")]
    orphans = [{"page": p.get("id"), "rel": rid}
               for p in clone_pages for rid in (p.get("relations") or [])
               if rid and rid not in all_ids]
    missing_assets = [{"page": p.get("id"), "asset": a}
                      for p in clone_pages for a in (p.get("missing_assets") or [])]
    total_views = sum(int(p.get("view_count") or 0) for p in clone_pages)

    healthy = (all(t["ok"] for t in tables) and not empty and not orphans and not missing_assets)
    summary = {
        "healthy": healthy,
        "tables_ok": sum(1 for t in tables if t["ok"]),
        "tables_total": len(tables),
        "pages": len(clone_pages),
        "empty_bodies": len(empty),
        "views": total_views,
        "orphan_relations": len(orphans),
        "missing_assets": len(missing_assets),
    }
    return {
        "summary": summary,
        "tables": tables,
        "empty_bodies": empty[:50],
        "orphan_relations": orphans[:50],
        "missing_assets": missing_assets[:50],
    }
