"""Structural, relation and body-link edge construction."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple, cast

from backend.domains.graph.adapters import Graph
from backend.domains.graph.scanning import COLOR_PALETTE
from backend.services.relation_links import (
    is_relation_key,
    relation_keys_from_table,
    strip_item,
)

GENERIC_TITLES = {"untitled", "sense títol", "sin título", "new page", "nova pàgina"}


def add_frontmatter_edges(graph: Graph, registry: Dict[str, Any]) -> None:
    """Add parent and schema-declared relation edges."""
    relation_keys = {
        table.get("id"): relation_keys_from_table(table)
        for table in cast(List[Dict[str, Any]], registry.get("tables", []))
    }
    for node_id, attrs in graph.nodes(data=True):
        if attrs.get("kind") in ["database", "table", "view"]:
            continue
        metadata = cast(Dict[str, Any], attrs.get("metadata", {}))
        _add_parent_edge(graph, node_id, metadata)
        table_id = metadata.get("table_id") or metadata.get("database_table_id")
        _add_relation_edges(graph, node_id, metadata, relation_keys.get(table_id))


def _add_parent_edge(graph: Graph, node_id: str, metadata: Dict[str, Any]) -> None:
    parent_id = metadata.get("parent_id")
    if parent_id and graph.has_node(parent_id):
        graph.add_edge(
            parent_id,
            node_id,
            kind="structural",
            color="#94a3b8",
            size=1,
            src=parent_id,
            dst=node_id,
            directed=True,
        )


def _add_relation_edges(
    graph: Graph,
    node_id: str,
    metadata: Dict[str, Any],
    relation_keys: Set[str] | None,
) -> None:
    for key, value in metadata.items():
        if not is_relation_key(key, relation_keys):
            continue
        targets = value if isinstance(value, list) else [value]
        for target in targets:
            target_id = strip_item(target)
            if isinstance(target_id, str) and graph.has_node(target_id):
                graph.add_edge(
                    node_id,
                    target_id,
                    kind="relation",
                    color="#6366f1",
                    size=1.5,
                    src=node_id,
                    dst=target_id,
                    directed=True,
                )


def add_body_edges(
    graph: Graph, page_nodes: List[Dict[str, Any]], registry: Dict[str, Any]
) -> None:
    """Add resolved and unresolved wikilinks from the per-page cache."""
    label_ids, stem_ids = _link_indexes(graph)
    table_sections = _table_sections(registry)
    for page in page_nodes:
        node_id = str(page["id"])
        table_id = page.get("table_id") or graph.nodes[node_id].get("table_id")
        db_view_headings = table_sections.get(table_id, {}) if table_id else {}
        section_links = cast(Dict[str | None, List[str]], page.get("section_links") or {})
        headings = sorted(
            section_links,
            key=lambda heading: 0 if heading in db_view_headings else 1,
        )
        for heading in headings:
            is_db_view = heading in db_view_headings
            for target_label in section_links[heading]:
                resolved = _resolve_link(graph, target_label, label_ids, stem_ids)
                if not resolved:
                    _add_unresolved(graph, node_id, target_label)
                    continue
                if resolved == node_id or not graph.has_node(resolved):
                    continue
                _add_body_edge(graph, node_id, resolved, is_db_view)


def _link_indexes(graph: Graph) -> Tuple[Dict[str, str], Dict[str, str]]:
    label_ids: Dict[str, str] = {}
    stem_ids: Dict[str, str] = {}
    for node_id, attrs in graph.nodes(data=True):
        label = str(attrs.get("label") or "").strip().lower()
        if label and label not in GENERIC_TITLES:
            label_ids.setdefault(label, node_id)
        node_path = attrs.get("path", "")
        if node_path:
            stem = Path(node_path).stem.lower()
            if stem not in GENERIC_TITLES:
                stem_ids.setdefault(stem, node_id)
    return label_ids, stem_ids


def _table_sections(registry: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    result: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for table in cast(List[Dict[str, Any]], registry.get("tables", [])):
        sections = cast(List[Dict[str, Any]], table.get("sections", []))
        if sections:
            result[str(table["id"])] = {
                str(section["heading"]): section
                for section in sections
                if section.get("type") == "db_view"
            }
    return result


def _resolve_link(
    graph: Graph,
    target_label: str,
    label_ids: Dict[str, str],
    stem_ids: Dict[str, str],
) -> str | None:
    target_key = target_label.split("|")[0].split("#")[0].strip()
    if graph.has_node(target_key):
        return target_key
    return label_ids.get(target_key.lower()) or stem_ids.get(target_key.lower())


def _add_unresolved(graph: Graph, source_id: str, target_label: str) -> str:
    target_key = target_label.split("|")[0].split("#")[0].strip()
    digest = hashlib.sha1(target_key.casefold().encode("utf-8")).hexdigest()[:20]
    unresolved_id = f"unresolved:{digest}"
    if not graph.has_node(unresolved_id):
        graph.add_node(
            unresolved_id,
            label=target_key,
            kind="unresolved",
            color=COLOR_PALETTE["unresolved"],
            size=6,
            metadata={"unresolved": True},
        )
    if not graph.has_edge(source_id, unresolved_id):
        graph.add_edge(
            source_id,
            unresolved_id,
            kind="link",
            body_link=True,
            color="#cbd5e1",
            size=0.8,
            src=source_id,
            dst=unresolved_id,
            directed=True,
            unresolved=True,
        )
    return unresolved_id


def _add_body_edge(graph: Graph, source_id: str, target_id: str, is_db_view: bool) -> None:
    if graph.has_edge(source_id, target_id):
        graph.edges[source_id, target_id]["body_link"] = True
        if is_db_view and graph.edges[source_id, target_id].get("kind") == "link":
            graph.edges[source_id, target_id]["kind"] = "relation"
            graph.edges[source_id, target_id]["color"] = "#6366f1"
            graph.edges[source_id, target_id]["size"] = 1.5
        return
    graph.add_edge(
        source_id,
        target_id,
        kind="relation" if is_db_view else "link",
        body_link=True,
        color="#6366f1" if is_db_view else "#10b981",
        size=1.5 if is_db_view else 1.2,
        src=source_id,
        dst=target_id,
        directed=True,
    )
