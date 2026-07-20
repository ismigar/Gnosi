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
