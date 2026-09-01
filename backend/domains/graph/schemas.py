"""Public response contracts for the heterogeneous vault graph."""

from __future__ import annotations

from typing import Any, TypeAlias

from pydantic import BaseModel, ConfigDict

GraphIdentifier: TypeAlias = str | int | float | bool


class ExtensibleGraphModel(BaseModel):
    """Typed stable fields while retaining graph and plugin extensions."""

    model_config = ConfigDict(extra="allow")


class GraphNodeResponse(ExtensibleGraphModel):
    """One projected page, contact, or unresolved graph node."""

    id: GraphIdentifier
    key: GraphIdentifier
    label: str
    size: int | float
    color: str
    kind: str
    metadata: dict[str, Any]
    cluster: str | None
    path: str
    table_id: GraphIdentifier | None
    database_id: GraphIdentifier | None


class GraphEdgeResponse(ExtensibleGraphModel):
    """One structural, relation, link, or suggestion graph edge."""

    id: str
    source: GraphIdentifier
    target: GraphIdentifier
    src: GraphIdentifier
    dst: GraphIdentifier
    directed: bool
    color: str
    size: int | float
    dashed: bool
    kind: str
    body_link: bool
    unresolved: bool
    reason: str | None = None
    suggestion_id: str | None = None


class GraphLegendItemResponse(ExtensibleGraphModel):
    """Count and display color for one node kind or cluster."""

    label: str
    color: str
    count: int


class GraphLegendResponse(ExtensibleGraphModel):
    """Dynamic legends derived from the projected nodes."""

    kinds: list[GraphLegendItemResponse]
    clusters: list[GraphLegendItemResponse]


class GraphResponse(ExtensibleGraphModel):
    """Complete graph, optionally marked as partial after skipped directories."""

    nodes: list[GraphNodeResponse]
    edges: list[GraphEdgeResponse]
    legend: GraphLegendResponse
    partial: bool | None = None
    skipped_dirs: list[str] | None = None
