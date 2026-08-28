"""Canonical graph service orchestration."""

from __future__ import annotations

import json
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple, cast

from backend.config.app_config import load_params
from backend.domains.graph.adapters import Graph, directed_graph
from backend.domains.graph.edges import add_body_edges, add_frontmatter_edges
from backend.domains.graph.nodes import (
    add_page_node,
    build_folder_lookups,
    infer_table_ids,
    load_page_data,
    relation_metadata,
    relative_skipped_dirs,
)
from backend.domains.graph.projection import build_legend, project_edges, project_nodes
from backend.domains.graph.scanning import (
    _resolve_active_vault_path,
    get_markdown_files_efficient,
    log,
)


class GraphService:
    """Build and cache the current vault graph."""

    _node_count_cache: Dict[str, int] = {}
    _graph_cache: object = {}
    _last_graph_time: object = {}
    _GRAPH_CACHE_TTL = 30
    _NODE_DATA_CACHE: Dict[str, Dict[str, Any]] = {}
    _NODE_CACHE_LOADED = False

    def __init__(self) -> None:
        self.registry = self._load_registry()

    @classmethod
    def invalidate_response_cache(cls) -> None:
        """Invalidate all per-vault graph responses."""
        cls._graph_cache = {}
        cls._last_graph_time = {}

    @staticmethod
    def _node_cache_path() -> Optional[Path]:
        try:
            base = load_params(strict_env=False).paths.get("LOCAL_CACHE")
            return base / "graph_node_cache.json" if base else None
        except Exception:
            return None

    @classmethod
    def _load_node_cache(cls) -> None:
        """Load the persistent per-file cache once, on a best-effort basis."""
        if cls._NODE_CACHE_LOADED:
            return
        cls._NODE_CACHE_LOADED = True
        if cls._NODE_DATA_CACHE:
            return
        path = cls._node_cache_path()
        if not path or not path.exists():
            return
        try:
            with path.open(encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                cls._NODE_DATA_CACHE.update(cast(Dict[str, Dict[str, Any]], data))
                log.info(f"📥 Graph node cache: loaded {len(data)} entries from disk")
        except Exception as error:
            log.warning(f"Could not load the graph node cache: {error}")

    @classmethod
    def _save_node_cache(cls) -> None:
        """Persist the per-file cache atomically, on a best-effort basis."""
        path = cls._node_cache_path()
        if not path or not cls._NODE_DATA_CACHE:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".json.tmp")
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(cls._NODE_DATA_CACHE, handle, default=str)
            temporary.replace(path)
        except Exception as error:
            log.warning(f"Could not save the graph node cache: {error}")

    def _load_registry(self) -> Dict[str, Any]:
        """Load the database and table registry from the active vault."""
        cfg = load_params(strict_env=False)
        vault_path = _resolve_active_vault_path(cfg)
        if not vault_path:
            log.warning("VAULT path not configured in cfg.paths. Skipping registry load.")
            return {"databases": [], "tables": [], "views": []}

        registry_path = cfg.paths.get("REGISTRY")
        if not registry_path:
            registry_path = vault_path / "BD" / "vault_db_registry.json"
            if not registry_path.exists():
                registry_path = vault_path / "vault_db_registry.json"
        if registry_path and registry_path.exists():
            try:
                with open(registry_path, encoding="utf-8") as handle:
                    return cast(Dict[str, Any], json.load(handle))
            except Exception as error:
                log.error(f"Error loading vault_db_registry.json: {error}")
        return {"databases": [], "tables": [], "views": []}

    def build_unified_graph(self) -> Dict[str, Any]:
        """Build the current vault topology and its semantic proposal overlay."""
        now = time.time()
        cfg = load_params(strict_env=False)
        vault_key = str(_resolve_active_vault_path(cfg) or "")
        if not isinstance(GraphService._graph_cache, dict):
            log.warning("Resetting invalid graph cache state")
            GraphService._graph_cache = {}
        if not isinstance(GraphService._last_graph_time, dict):
            GraphService._last_graph_time = {}
        graph_cache = cast(Dict[str, Dict[str, Any]], GraphService._graph_cache)
        graph_times = cast(Dict[str, float], GraphService._last_graph_time)
        cached = graph_cache.get(vault_key)
        if cached and now - graph_times.get(vault_key, 0) < self._GRAPH_CACHE_TTL:
            log.info("Serving graph from cache")
            return cached

        self.registry = self._load_registry()
        log.info("Building current vault graph...")
        graph = directed_graph()
        GraphService._load_node_cache()
        page_nodes, skipped_dirs = self._add_page_nodes(graph)
        GraphService._save_node_cache()
        self._add_contact_nodes(graph)
        self._add_structural_edges(graph, page_nodes)
        self._add_suggestion_edges(graph)

        nodes = project_nodes(graph)
        result: Dict[str, Any] = {
            "nodes": nodes,
            "edges": project_edges(graph),
            "legend": build_legend(nodes),
        }
        if skipped_dirs:
            result["partial"] = True
            result["skipped_dirs"] = skipped_dirs
            log.warning(
                f"Graph built PARTIALLY: {len(skipped_dirs)} unreadable dir(s) "
                f"skipped ({', '.join(skipped_dirs[:5])}"
                f"{'…' if len(skipped_dirs) > 5 else ''}); result not cached"
            )
            return result

        graph_cache[vault_key] = result
        graph_times[vault_key] = time.time()
        return result

    def _add_page_nodes(self, graph: Graph) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Add one node per vault markdown file and report unreadable directories."""
        cfg = load_params(strict_env=False)
        vault_path = _resolve_active_vault_path(cfg)
        if not vault_path or not vault_path.exists():
            return [], []

        table_ids, database_ids = build_folder_lookups(self.registry)
        skipped_absolute: List[str] = []
        markdown_files = get_markdown_files_efficient(vault_path, skipped_absolute)
        skipped_dirs = relative_skipped_dirs(vault_path, skipped_absolute)
        page_nodes: List[Dict[str, Any]] = []
        for file_path in markdown_files:
            path_str = str(file_path.relative_to(vault_path))
            try:
                data = load_page_data(
                    file_path,
                    path_str,
                    os.path.getmtime(file_path),
                    cfg,
                    GraphService._NODE_DATA_CACHE,
                )
            except Exception as error:
                log.error(f"Error processing node {path_str}: {error}")
                continue

            metadata = cast(Dict[str, Any], data["metadata"])
            table_id, database_id = infer_table_ids(
                metadata,
                path_str,
                table_ids,
                database_ids,
            )
            metadata = relation_metadata(metadata, table_id, self.registry)
            add_page_node(
                graph,
                data,
                metadata,
                path_str,
                file_path,
                table_id,
                database_id,
                page_nodes,
            )
        return page_nodes, skipped_dirs

    def _add_contact_nodes(self, graph: Graph) -> None:
        """Add contacts from management.sqlite, not from the vault database."""
        try:
            from backend.data.management_db import get_mgmt_session
            from backend.models.contact import Contact

            cfg = load_params(strict_env=False)
            node_colors = cfg.colors.get("node_types", {})
            color_cfg = node_colors.get("contact", node_colors.get("default", {}))
            color = color_cfg.get("bg", "#10b981")
            with get_mgmt_session() as db:
                contacts = db.query(Contact).all()
                for contact in contacts:
                    node_id = f"contact_{contact.id}"
                    label = contact.name or contact.email or str(contact.id)
                    metadata = {
                        "id": str(contact.id),
                        "title": label,
                        "email": contact.email,
                        "company": getattr(contact, "company", None),
                        "job_title": getattr(contact, "job_title", None),
                        "source": str(getattr(contact, "source", "custom")),
                        "account_id": getattr(contact, "account_id", None),
                    }
                    graph.add_node(
                        node_id,
                        label=label,
                        kind="contact",
                        color=color,
                        size=8,
                        metadata=metadata,
                        path=f"Contacts/{label}.md",
                    )
        except Exception as error:
            log.warning(f"_add_contact_nodes: {error}")

    def _add_structural_edges(self, graph: Graph, page_nodes: List[Dict[str, Any]]) -> None:
        """Add schema relations and cached body links to the graph."""
        add_frontmatter_edges(graph, self.registry)
        add_body_edges(graph, page_nodes, self.registry)

    def _add_suggestion_edges(self, graph: Graph) -> None:
        """Add the canonical Brain proposal queue as a non-structural overlay."""
        try:
            from backend.services.llm_wiki_suggestions import list_graph_edges

            for suggestion in list_graph_edges():
                source_id = str(suggestion.get("source") or "")
                target_id = str(suggestion.get("target") or "")
                if not source_id or not target_id:
                    continue
                if not graph.has_node(source_id) or not graph.has_node(target_id):
                    continue
                if graph.has_edge(source_id, target_id) or graph.has_edge(target_id, source_id):
                    continue
                graph.add_edge(
                    source_id,
                    target_id,
                    kind="suggestion",
                    color="#a855f7",
                    size=1,
                    dashed=True,
                    reason=str(suggestion.get("reason") or ""),
                    suggestion_id=str(suggestion.get("suggestion_id") or ""),
                    src=source_id,
                    dst=target_id,
                    directed=False,
                )
        except Exception as error:
            log.error(f"Error loading Brain suggestions: {error}")

    def get_node_count(self) -> int:
        """Return the real-node count from the canonical graph projection."""
        cfg = load_params(strict_env=False)
        vault_key = str(_resolve_active_vault_path(cfg) or "")
        try:
            graph = self.build_unified_graph()
            count = sum(
                1
                for node in cast(List[Dict[str, Any]], graph.get("nodes", []))
                if str(node.get("kind") or "page").lower() != "unresolved"
            )
            if graph.get("partial") and vault_key in GraphService._node_count_cache:
                return GraphService._node_count_cache[vault_key]
            GraphService._node_count_cache[vault_key] = count
            return count
        except Exception as error:
            log.error(f"Error counting nodes: {error}")
            return GraphService._node_count_cache.get(vault_key, 0)
