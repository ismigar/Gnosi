"""Canonical graph service orchestration."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import threading
import time
from collections.abc import Iterator
from typing import Any, Dict, List, Optional, Tuple, cast
from weakref import WeakValueDictionary

from pydantic_core import from_json

from backend.config.app_config import load_params
from backend.domains.graph.adapters import Graph, directed_graph
from backend.domains.graph.cache_inputs import (
    GraphInputs, capture_graph_inputs, capture_managed_state, log_graph_input_failure,
    scope_graph_config, semantic_revision,
)
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
    indexed_markdown_files,
    log,
)
from backend.domains.graph.timing import graph_cache_hit, graph_phase
from backend.utils.safe_io import safe_write_text


class GraphService:
    """Build and cache the current vault graph."""

    _node_count_cache: Dict[str, int] = {}
    _graph_cache: object = {}
    _last_graph_time: object = {}
    _GRAPH_CACHE_TTL = 30
    _NODE_DATA_CACHE: Dict[str, Dict[str, Any]] = {}
    _NODE_CACHE_LOADED: set[str] = set()
    _NODE_CACHE_DIRTY: set[str] = set()
    _NODE_CACHE_WRITE_LOCK = threading.Lock()
    _BUILD_LOCKS_GUARD = threading.Lock()
    _BUILD_LOCKS: WeakValueDictionary[str, Any] = WeakValueDictionary()
    _graph_input_revisions: Dict[str, Tuple[Dict[str, Any], str]] = {}
    _NODE_SEMANTIC_REVISION: Dict[str, str] = {}

    def __init__(self) -> None:
        self._registry: Dict[str, Any] | None = None
        self._inputs: GraphInputs | None = None
        self._input_read_failed = False
        self._managed_states: Dict[str, Dict[str, Any]] | None = None

    @property
    def registry(self) -> Dict[str, Any]:
        # A response-cache hit needs only the vault identity. Cloud registry I/O
        # belongs to a new build or an explicit registry consumer.
        if self._registry is None:
            self._registry = self._load_registry()
        return self._registry

    @registry.setter
    def registry(self, value: Dict[str, Any]) -> None:
        self._registry = value

    @classmethod
    def _build_lock(cls, vault_key: str) -> Any:
        # Coalesce overlapping builds of one vault without serializing different
        # vaults or retaining an unbounded set of inactive locks.
        with cls._BUILD_LOCKS_GUARD:
            lock = cls._BUILD_LOCKS.get(vault_key)
            if lock is None:
                lock = threading.Lock()
                cls._BUILD_LOCKS[vault_key] = lock
            return lock

    @classmethod
    def invalidate_response_cache(cls) -> None:
        """Invalidate all per-vault graph responses."""
        cls._graph_cache = {}
        cls._last_graph_time = {}
        cls._graph_input_revisions = {}

    @staticmethod
    def _node_cache_path(vault_path: Path | None = None) -> Optional[Path]:
        try:
            base = load_params(strict_env=False).paths.get("LOCAL_CACHE")
            if not base:
                return None
            if vault_path is None:
                return base / "graph_node_cache.json"
            identity = hashlib.sha256(str(vault_path).encode("utf-8")).hexdigest()
            return base / "graph_nodes" / f"{identity}.json"
        except Exception:
            return None

    @classmethod
    def _load_node_cache(cls, vault_path: Path | None) -> None:
        """Load only this vault's persistent cache, migrating the legacy file once."""
        if vault_path is None:
            return
        scope = str(vault_path)
        prefix = scope.rstrip(os.sep) + os.sep
        with cls._NODE_CACHE_WRITE_LOCK:
            if scope in cls._NODE_CACHE_LOADED:
                return
            cls._NODE_CACHE_LOADED.add(scope)
            path = cls._node_cache_path(vault_path)
            legacy = path is not None and not path.exists()
            if legacy:
                path = cls._node_cache_path()
            if not path or not path.exists():
                return
            try:
                with graph_phase("node_cache_read"):
                    raw = path.read_text(encoding="utf-8")
                with graph_phase("node_cache_parse"):
                    data = cls._parse_node_cache(raw)
                with graph_phase("node_cache_hash"):
                    cache_digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
                if isinstance(data, dict):
                    scoped = {
                        key: value for key, value in data.items()
                        if isinstance(key, str) and key.startswith(prefix)
                    }
                    cls._NODE_DATA_CACHE.update(cast(Dict[str, Dict[str, Any]], scoped))
                    cls._NODE_SEMANTIC_REVISION.pop(scope, None)
                    if not legacy:
                        try:
                            marker = json.loads(path.with_suffix(".meta.json").read_text(encoding="utf-8"))
                            if marker.get("cache_digest") == cache_digest and isinstance(marker.get("semantic"), str):
                                cls._NODE_SEMANTIC_REVISION[scope] = marker["semantic"]
                        except (OSError, ValueError, AttributeError):
                            pass
                    if legacy and scoped:
                        cls._NODE_CACHE_DIRTY.add(scope)
                    log.info(f"📥 Graph node cache: loaded {len(scoped)} entries from disk")
            except Exception as error:
                log.warning(f"Could not load the graph node cache: {error}")

    @staticmethod
    def _parse_node_cache(raw: str) -> Any:
        try:
            return from_json(raw)
        except ValueError:
            # Keep stdlib acceptance of escaped surrogates/deep nesting and
            # its errors for corrupt files. Parse outside the exception handler
            # so a Core error cannot leak through a chained traceback.
            pass
        return json.loads(raw)

    @classmethod
    def _save_node_cache(cls, vault_path: Path | None) -> None:
        """Persist changed cache entries, retaining a retry after failed writes."""
        if vault_path is None:
            return
        scope = str(vault_path)
        prefix = scope.rstrip(os.sep) + os.sep
        with cls._NODE_CACHE_WRITE_LOCK:
            if scope not in cls._NODE_CACHE_DIRTY:
                return
            path = cls._node_cache_path(vault_path)
            if not path:
                return
            try:
                # Entries are replaced, not modified during page reads. Snapshot
                # the mapping and encode it at once: json.dump iterates millions
                # of tiny Python writes for a large vault. The atomic writer also
                # uses a unique temporary file, unlike a shared .json.tmp path.
                snapshot = dict(cls._NODE_DATA_CACHE)
                scoped = {key: value for key, value in snapshot.items() if key.startswith(prefix)}
                encoded = json.dumps(scoped, default=str)
                safe_write_text(path, encoded)
                semantic = cls._NODE_SEMANTIC_REVISION.get(scope)
                if semantic is not None:
                    safe_write_text(path.with_suffix(".meta.json"), json.dumps({
                        "semantic": semantic,
                        "cache_digest": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
                    }))
                cls._NODE_CACHE_DIRTY.discard(scope)
            except Exception as error:
                log.warning(f"Could not save the graph node cache: {error}")

    @classmethod
    def _prepare_node_semantics(cls, vault_path: Path, semantic: str) -> None:
        scope = str(vault_path)
        prefix = scope.rstrip(os.sep) + os.sep
        with cls._NODE_CACHE_WRITE_LOCK:
            if cls._NODE_SEMANTIC_REVISION.get(scope) == semantic:
                return
            for key in list(cls._NODE_DATA_CACHE):
                if key.startswith(prefix):
                    cls._NODE_DATA_CACHE.pop(key, None)
            cls._NODE_SEMANTIC_REVISION[scope] = semantic
            cls._NODE_CACHE_DIRTY.add(scope)

    def _load_registry(self) -> Dict[str, Any]:
        """Load the database and table registry from the active vault."""
        cfg = load_params(strict_env=False)
        vault_path = _resolve_active_vault_path(cfg)
        if not vault_path:
            log.warning("VAULT path not configured in cfg.paths. Skipping registry load.")
            return {"databases": [], "tables": [], "views": []}

        cfg = scope_graph_config(cfg, vault_path)

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
                self._input_read_failed = True
                log_graph_input_failure("registry", error)
        return {"databases": [], "tables": [], "views": []}

    def _capture_inputs(self, vault_path: Path | None) -> GraphInputs | None:
        if vault_path is None:
            return None
        source = "index"
        try:
            files = indexed_markdown_files(vault_path)
            if files is None:
                # A filesystem fallback has no authoritative index snapshot.
                return None
            source = "config"
            cfg = load_params(strict_env=False)
            cfg = scope_graph_config(cfg, vault_path)
            if not isinstance(cfg.paths.get("GNOSI_CONFIG"), Path):
                return None
            source = "registry"
            registry = self._load_registry()
            if self._input_read_failed:
                return None
            source = "sources"
            return capture_graph_inputs(cfg, files, registry)
        except Exception as error:
            self._input_read_failed = True
            if source != "sources":
                log_graph_input_failure(source, error)
            return None

    def build_unified_graph(self) -> Dict[str, Any]:
        """Build the current vault topology and its semantic proposal overlay."""
        with graph_phase("resolve"):
            cfg = load_params(strict_env=False)
            vault_path = _resolve_active_vault_path(cfg)
        vault_key = str(vault_path or "")
        with self._build_lock(vault_key):
            return self._build_for_vault(vault_path, vault_key)

    def _capture_build_semantics(self, vault_path: Path | None) -> str | None:
        """Capture managed metadata before building, including standalone fallbacks."""
        build_semantic = self._inputs.semantic if self._inputs is not None else None
        self._managed_states = self._inputs.managed_states if self._inputs is not None else None
        if build_semantic is None:
            semantic_cfg: Any = None
            try:
                semantic_cfg = load_params(strict_env=False)
                if vault_path is not None:
                    semantic_cfg = scope_graph_config(semantic_cfg, vault_path)
                build_semantic, self._managed_states = capture_managed_state(semantic_cfg)
            except Exception:
                if (callable(getattr(semantic_cfg, "get", None)) and hasattr(semantic_cfg, "colors")
                        and isinstance(getattr(semantic_cfg, "paths", {}).get("GNOSI_CONFIG"), Path)):
                    self._input_read_failed = True
                # Standalone consumers can lack managed configuration. They
                # still rebuild at the normal TTL and cannot certify node data.
                if vault_path is not None:
                    GraphService._NODE_SEMANTIC_REVISION.pop(str(vault_path), None)
        return build_semantic

    def _verify_build_inputs(self, vault_path: Path | None, build_semantic: str | None) -> None:
        """Reject cache publication when captured inputs changed during the build."""
        if self._inputs is not None:
            with graph_phase("verify_inputs"):
                current_inputs = self._capture_inputs(vault_path)
            if current_inputs is None or current_inputs.revision != self._inputs.revision:
                self._input_read_failed = True
        elif build_semantic is not None:
            try:
                semantic_cfg = load_params(strict_env=False)
                if vault_path is not None:
                    semantic_cfg = scope_graph_config(semantic_cfg, vault_path)
                if semantic_revision(semantic_cfg) != build_semantic:
                    self._input_read_failed = True
            except Exception:
                self._input_read_failed = True

    def _build_for_vault(self, vault_path: Path | None, vault_key: str) -> Dict[str, Any]:
        now = time.time()
        if not isinstance(GraphService._graph_cache, dict):
            log.warning("Resetting invalid graph cache state")
            GraphService._graph_cache = {}
        if not isinstance(GraphService._last_graph_time, dict):
            GraphService._last_graph_time = {}
        graph_cache = cast(Dict[str, Dict[str, Any]], GraphService._graph_cache)
        graph_times = cast(Dict[str, float], GraphService._last_graph_time)
        cached = graph_cache.get(vault_key)
        if cached and now - graph_times.get(vault_key, 0) < self._GRAPH_CACHE_TTL:
            graph_cache_hit("graph", True)
            log.info("Serving graph from cache")
            return cached

        self._input_read_failed = False
        with graph_phase("revalidate"):
            self._inputs = self._capture_inputs(vault_path)
        previous_inputs = GraphService._graph_input_revisions.get(vault_key)
        if (
            cached and self._inputs is not None and previous_inputs is not None
            and previous_inputs[0] is cached and previous_inputs[1] == self._inputs.revision
            and GraphService._graph_cache is graph_cache
        ):
            # Thirty seconds limits source revalidation, not reuse of an
            # unchanged immutable projection and its encoded/compressed bodies.
            graph_times[vault_key] = time.time()
            if (
                vault_key in GraphService._NODE_CACHE_DIRTY
                and GraphService._NODE_SEMANTIC_REVISION.get(vault_key) == self._inputs.semantic
            ):
                with graph_phase("node_cache_save"):
                    GraphService._save_node_cache(vault_path)
            graph_cache_hit("graph", True)
            return cached

        graph_cache_hit("graph", False)
        with graph_phase("registry"):
            self.registry = self._inputs.registry if self._inputs is not None else self._load_registry()
        build_semantic = self._capture_build_semantics(vault_path)
        log.info("Building current vault graph...")
        graph = directed_graph()
        try:
            with graph_phase("node_cache_load"):
                GraphService._load_node_cache(vault_path)
                if build_semantic is not None and vault_path is not None:
                    GraphService._prepare_node_semantics(vault_path, build_semantic)
                elif vault_path is not None:
                    GraphService._NODE_SEMANTIC_REVISION.pop(str(vault_path), None)
            with graph_phase("pages"):
                page_nodes, skipped_dirs = self._add_page_nodes(graph)
            with graph_phase("contacts"):
                self._add_contact_nodes(graph)
            with graph_phase("edges"):
                self._add_structural_edges(graph, page_nodes)
            with graph_phase("suggestions"):
                self._add_suggestion_edges(graph)

            with graph_phase("project"):
                nodes = project_nodes(graph)
                result: Dict[str, Any] = {
                    "nodes": nodes,
                    "edges": project_edges(graph),
                    "legend": build_legend(nodes),
                }
        finally:
            # NetworkX's cached views can retain the temporary graph in cycles.
            # Release its adjacency/attribute storage before response validation,
            # keeping only the independently projected payload and node cache.
            graph.clear()
        self._verify_build_inputs(vault_path, build_semantic)
        if skipped_dirs or self._input_read_failed:
            result["partial"] = True
            result["skipped_dirs"] = skipped_dirs
            log.warning("Graph built partially: %d skipped directories, input read failure=%s; result not cached",
                        len(skipped_dirs), self._input_read_failed)
            return result

        with graph_phase("node_cache_save"):
            GraphService._save_node_cache(vault_path)
        graph_cache[vault_key] = result
        graph_times[vault_key] = time.time()
        if self._inputs is not None and GraphService._graph_cache is graph_cache:
            GraphService._graph_input_revisions[vault_key] = (result, self._inputs.revision)
        elif GraphService._graph_cache is graph_cache:
            GraphService._graph_input_revisions.pop(vault_key, None)
        return result

    def _add_page_nodes(self, graph: Graph) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Add one node per vault markdown file and report unreadable directories."""
        cfg = self._inputs.cfg if self._inputs is not None else load_params(strict_env=False)
        vault_path = _resolve_active_vault_path(cfg)
        if not vault_path or not vault_path.exists():
            return [], []

        cfg = scope_graph_config(cfg, vault_path)

        table_ids, database_ids = build_folder_lookups(self.registry)
        skipped_absolute: List[str] = []
        indexed_files = self._inputs.files if self._inputs is not None else indexed_markdown_files(vault_path)
        candidates: Iterator[tuple[Path, float | None]]
        if indexed_files is None:
            markdown_files = get_markdown_files_efficient(vault_path, skipped_absolute)
            candidates = ((path, None) for path in markdown_files)
        else:
            candidates = ((path, mtime) for path, mtime in indexed_files)
        skipped_dirs = relative_skipped_dirs(vault_path, skipped_absolute)
        page_nodes: List[Dict[str, Any]] = []
        # A registry snapshot is fixed during this batch. Reuse each table's
        # relation names/aliases, including empty schemas, only within this build.
        # Unclassified pages share the missing-table lookup too; otherwise each
        # such page scans every table even when none can provide a schema.
        relation_keys_cache: Dict[str | None, set[str]] = {}
        for file_path, indexed_mtime in candidates:
            path_str = str(file_path.relative_to(vault_path))
            try:
                previous = GraphService._NODE_DATA_CACHE.get(str(file_path))
                data = load_page_data(
                    file_path,
                    path_str,
                    indexed_mtime if indexed_mtime is not None else os.path.getmtime(file_path),
                    cfg,
                    GraphService._NODE_DATA_CACHE,
                    self._managed_states,
                )
                if data is not previous:
                    # Mark after updating the mapping. If another build is
                    # persisting its snapshot, this waits until it finishes and
                    # leaves the new entry dirty for the next atomic write.
                    with GraphService._NODE_CACHE_WRITE_LOCK:
                        GraphService._NODE_CACHE_DIRTY.add(str(vault_path))
            except Exception as error:
                self._input_read_failed = True
                log.error(f"Error processing node {path_str}: {error}")
                continue

            metadata = cast(Dict[str, Any], data["metadata"])
            table_id, database_id = infer_table_ids(
                metadata,
                path_str,
                table_ids,
                database_ids,
            )
            metadata = relation_metadata(
                metadata, table_id, self.registry, relation_keys_cache=relation_keys_cache
            )
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
        if self._inputs is not None:
            for captured_contact in self._inputs.contacts:
                graph.add_node(captured_contact["id"], **{
                    key: value for key, value in captured_contact.items() if key != "id"
                })
            return
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
            self._input_read_failed = True
            log.warning(f"_add_contact_nodes: {error}")

    def _add_structural_edges(self, graph: Graph, page_nodes: List[Dict[str, Any]]) -> None:
        """Add schema relations and cached body links to the graph."""
        add_frontmatter_edges(graph, self.registry)
        add_body_edges(graph, page_nodes, self.registry)

    def _add_suggestion_edges(self, graph: Graph) -> None:
        """Add the canonical Brain proposal queue as a non-structural overlay."""
        try:
            if self._inputs is not None:
                suggestions = self._inputs.suggestions
            else:
                from backend.services.llm_wiki_suggestions import list_graph_edges

                suggestions = list_graph_edges()
            for suggestion in suggestions:
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
            self._input_read_failed = True
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
