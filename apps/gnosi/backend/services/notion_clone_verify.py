"""Verificació de salut d'un clon de Notion (Notion ↔ clon al vault).

Després de clonar, dóna confiança per abandonar Notion: compara el recompte de files per BD,
detecta cossos buits (MCP fallit), relacions òrfenes (BD no seleccionades), vistes recreades i
adjunts que falten al disc. PUR → testejable; la capa d'endpoint hi posa els recomptes de Notion,
llegeix les pàgines del clon i comprova els fitxers d'Assets.

cf. directiva `notion_exact_clone.md`.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

_WIKILINK_RE = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]")


def relation_ids(value: Any) -> List[str]:
    """Valor d'un camp relació → ids nets (accepta `[[Títol|id]]`, `[[id]]` o id pelat)."""
    items = value if isinstance(value, list) else ([value] if value else [])
    out: List[str] = []
    for v in items:
        if not isinstance(v, str) or not v.strip():
            continue
        m = _WIKILINK_RE.match(v.strip())
        out.append((m.group(1) if m else v).strip())
    return out


def verify_clone(notion_counts: Dict[str, int], clone_pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Informe de salut del clon.

    `notion_counts`: {clone_table_id: nombre de files a Notion d'aquella BD}.
    `clone_pages`: [{id, table_id, body_empty: bool, view_count: int, relations: [ids],
                     missing_assets: [rutes]}] llegides del vault clonat.
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
