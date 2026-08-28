"""Projection of the canonical graph into the stable frontend payload."""

from __future__ import annotations

import re
from typing import Any, Dict, List, cast

from backend.domains.graph.adapters import Graph
from backend.domains.graph.scanning import (
    COLOR_PALETTE,
    _node_cluster,
    _string_to_color,
)

_RELATION_INDEX_RE = re.compile(
    r"^(?P<prefix>(?:Index|Índex)\s*[·:]\s*(?:Projecte|Project|Àrea|Area)\s*:\s*)"
    r"(?P<id>[0-9a-f]{8}-[0-9a-f-]{27,})$",
    re.IGNORECASE,
)


def project_nodes(graph: Graph) -> List[Dict[str, Any]]:
    """Export graph nodes without changing the historical payload shape."""
    graph_labels = {
        str(node_id): str(attrs.get("label") or node_id)
        for node_id, attrs in graph.nodes(data=True)
    }
    nodes: List[Dict[str, Any]] = []
    for node_id in graph.nodes():
        attrs = cast(Dict[str, Any], graph.nodes[node_id])
        metadata = cast(Dict[str, Any], attrs.get("metadata", {}) or {})
        label = _relation_index_label(
            str(attrs.get("label", node_id)),
            graph_labels,
        )
        nodes.append(
            {
                "id": node_id,
                "key": node_id,
                "label": label,
                "size": attrs.get("size", 10),
                "color": attrs.get(
                    "color",
                    COLOR_PALETTE.get(cast(str, attrs.get("kind")), COLOR_PALETTE["default"]),
                ),
                "kind": attrs.get("kind", "page"),
                "metadata": metadata,
                "cluster": _node_cluster(metadata, attrs),
                "path": attrs.get("path", ""),
                "table_id": attrs.get("table_id")
                or metadata.get("table_id")
                or metadata.get("database_table_id"),
                "database_id": attrs.get("database_id") or metadata.get("database_id"),
            }
        )
    return nodes


def _relation_index_label(label: str, graph_labels: Dict[str, str]) -> str:
    match = _RELATION_INDEX_RE.match(label.strip())
    if not match:
        return label
    related_label = graph_labels.get(match.group("id"))
    if related_label and related_label != match.group("id"):
        return f"{match.group('prefix')}{related_label}"
    return label


def project_edges(graph: Graph) -> List[Dict[str, Any]]:
    """Export graph edges with direction and overlay metadata intact."""
    edges: List[Dict[str, Any]] = []
    for source, target in graph.edges():
        attrs = cast(Dict[str, Any], graph.edges[source, target])
        edge: Dict[str, Any] = {
            "id": f"e_{source}_{target}",
            "source": source,
            "target": target,
            "src": attrs.get("src", source),
            "dst": attrs.get("dst", target),
            "directed": attrs.get("directed", False),
            "color": attrs.get("color", "#cbd5e1"),
            "size": attrs.get("size", 1),
            "dashed": attrs.get("dashed", False),
            "kind": attrs.get("kind", "structural"),
            "body_link": bool(attrs.get("body_link", False)),
            "unresolved": bool(attrs.get("unresolved", False)),
        }
        if edge["kind"] == "suggestion":
            edge["reason"] = attrs.get("reason", "")
            edge["suggestion_id"] = attrs.get("suggestion_id", "")
        edges.append(edge)
    return edges


def build_legend(nodes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build the dynamic kind and cluster legend exported to the client."""
    kind_counts: Dict[str, int] = {}
    kind_colors: Dict[str, Any] = {}
    cluster_counts: Dict[str, int] = {}
    cluster_colors: Dict[str, str] = {}
    for node in nodes:
        kind = cast(OptionalString, node.get("kind"))
        if kind:
            kind_counts[kind] = kind_counts.get(kind, 0) + 1
            kind_colors.setdefault(
                kind,
                node.get("color", COLOR_PALETTE.get(kind, COLOR_PALETTE["default"])),
            )
        cluster = cast(OptionalString, node.get("cluster"))
        if cluster:
            cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1
            cluster_colors.setdefault(cluster, _string_to_color(cluster))

    kinds = [
        {"label": kind.capitalize(), "color": kind_colors[kind], "count": count}
        for kind, count in kind_counts.items()
    ]
    clusters = [
        {"label": label, "color": cluster_colors[label], "count": count}
        for label, count in sorted(cluster_counts.items())
    ]
    return {"kinds": kinds, "clusters": clusters}


OptionalString = str | None
