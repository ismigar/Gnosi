"""Localized boundaries for graph libraries that do not publish type metadata."""

from typing import Any, TypeAlias

import networkx as nx
import yaml

Graph: TypeAlias = Any


def directed_graph() -> Graph:
    """Create the directed graph used by the domain."""
    return nx.DiGraph()


__all__ = ["Graph", "directed_graph", "nx", "yaml"]
