import os
import errno
import json
import subprocess
import yaml
import re
import hashlib
import logging
import networkx as nx
from pathlib import Path
import time
from typing import List, Dict, Any, Optional, Tuple
from backend.config.app_config import load_params
from backend.services.frontmatter_fallback import parse_frontmatter_fallback
from backend.services.relation_links import (
    is_relation_key,
    relation_keys_from_table,
    strip_item,
    strip_relation_wikilinks,
)

log = logging.getLogger(__name__)

# Colors for Sigma.js (Sync with frontend config if possible)
COLOR_PALETTE = {
    "page": "#10b981",      # Emerald (Permanent)
    "unresolved": "#cbd5e1",  # Slate (Obsidian unresolved link)
    "default": "#94a3b8"    # Slate
}


def _string_to_color(value: str) -> str:
    """Return the deterministic colour used by the graph client for a label."""
    color_hash = 0
    for character in value:
        color_hash = ord(character) + ((color_hash << 5) - color_hash)
    return "#" + "".join(
        f"{(color_hash >> (index * 8)) & 0xFF:02x}" for index in range(3)
    )


def _cluster_label(value: Any) -> Optional[str]:
    """Normalize a stored cluster or tag value into a displayable label."""
    if isinstance(value, dict):
        value = value.get("name") or value.get("label")
    if value is None:
        return None
    label = str(value).strip()
    return label or None


def _node_cluster(metadata: Dict[str, Any], attrs: Dict[str, Any]) -> Optional[str]:
    """Get the primary user-defined cluster from graph attributes or metadata."""
    cluster = _cluster_label(attrs.get("cluster") or metadata.get("cluster"))
    if cluster:
        return cluster
    tags = metadata.get("tags") or attrs.get("tags") or []
    if isinstance(tags, (str, dict)):
        tags = [tags]
    return _cluster_label(tags[0]) if tags else None

# Optimization: Directories to skip during recursive scans
IGNORED_DIRS = {
    "node_modules", ".venv", ".git", ".tmp", "dist", "build",
    "target", ".cache", "__pycache__", "Plantilles", "Library", ".gemini",
    # System folders managed by dedicated services (not wiki pages)
    # Contacts and Images are cloud-only on OneDrive: rglob/scandir takes ~18s via FUSE.
    # Contacts are added from SQLite by _add_contact_nodes.
    "Mail", "Calendar", "Contacts", "Contactes", "Images",
    "system", "custom_icons", "data",
}

# Status override: detects "idea" as a whole word in the status value to
# color the node yellow. With \b we avoid false positives like "idealment" or
# "ideari" that contain "idea" as a substring.
_STATUS_IDEA_RE = re.compile(r"\bidea\b", re.IGNORECASE)

# Classification of `note_type` → `kind`. Each pattern requires the token
# to appear at the start or preceded by a separator to avoid false
# positives like "Impermanent" → permanent or "Eventualment" → event. It accepts
# an optional suffix limited to `\w{0,4}` and, after that, a separator or end
# of text (`(?=[\s_\-]|$)`), to cover plurals and linguistic variations ("permanente", "permanents",
# "calendari", "diaris", etc.). Order matters: the first match is returned.
_KIND_PATTERNS = (
    (re.compile(r"(^|[\s_\-])(reading|lectura)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "reading"),
    (re.compile(r"(^|[\s_\-])permanent\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "permanent"),
    (re.compile(r"(^|[\s_\-])(index|índex)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "index"),
    (re.compile(r"(^|[\s_\-])(journal|diari|bitàcora)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "journal"),
    (re.compile(r"(^|[\s_\-])(dialogue|diàleg|dialogo)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "dialogue"),
    (re.compile(r"(^|[\s_\-])contact\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "contact"),
    (re.compile(r"(^|[\s_\-])(calendar|event)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "calendar"),
    (re.compile(r"(^|[\s_\-])(mail|email)\w{0,4}(?=[\s_\-]|$)", re.IGNORECASE), "mail"),
)

# Throttle for best-effort directory warmups: one `open` per wedged path every
# _DIR_WARMUP_THROTTLE_S seconds, so repeated graph rebuilds while OneDrive is
# stuck don't spawn a Finder window per rebuild.
_DIR_WARMUP_REQUESTED: Dict[str, float] = {}
_DIR_WARMUP_THROTTLE_S = 300.0


def _request_dir_warmup(dir_path: Path) -> None:
    """Best-effort: ask LaunchServices to open a wedged online-only directory.

    A process running under launchd cannot trigger OneDrive's on-access
    materialization (the File Provider returns EDEADLK instantly — see
    feedback_onedrive_warmup_native and files_provider/onedrive.py). Opening the
    directory from the user's Aqua session (Finder, via `open -g -j`) does
    hydrate it, which is the same mechanism ONEDRIVE_WARMUP_MODE=open uses for
    files. Fire-and-forget: we never wait for hydration here; the next graph
    rebuild simply picks the directory up once it's readable.

    Only runs when the effective warmup mode is "open" (native macOS); in
    "daemon" mode (Docker) the backend has no LaunchServices access, and the
    walk's skip+log behaviour is already the correct degradation.
    """
    try:
        from backend.services.files_provider.onedrive import _default_warmup_mode
        mode = (os.environ.get("ONEDRIVE_WARMUP_MODE") or _default_warmup_mode()).strip().lower()
        if mode != "open":
            return
        key = str(dir_path)
        now = time.monotonic()
        # Membership check, NOT a 0.0 default: `time.monotonic()` is measured
        # from an arbitrary epoch (system boot on Linux and on the macOS builds
        # we ship), so `now - 0.0 < THROTTLE` silently swallows the FIRST
        # request for every directory whenever monotonic() is still below the
        # window — i.e. during the first 5 minutes of uptime, exactly when the
        # LaunchAgent starts and OneDrive subtrees are coldest.
        last = _DIR_WARMUP_REQUESTED.get(key)
        if last is not None and now - last < _DIR_WARMUP_THROTTLE_S:
            return
        _DIR_WARMUP_REQUESTED[key] = now
        # `-g` keeps Finder in the background, `-j` launches hidden: no focus steal.
        subprocess.Popen(
            ["/usr/bin/open", "-g", "-j", key],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log.info(f"☁️ Requested Finder warmup for wedged directory {dir_path}")
    except Exception as e:
        # warning, not debug: this except only sees genuine failures — the
        # "not applicable here" cases (wrong mode, throttled) return early
        # without raising. At debug level a broken warmup was indistinguishable
        # from a working one, which is how the throttle bug fixed in #890 stayed
        # invisible: the request was dropped and nothing said so.
        log.warning(f"Directory warmup request failed for {dir_path}: {e}")


def get_markdown_files_efficient(root_path: Path, skipped_dirs: Optional[List[str]] = None) -> List[Path]:
    """Efficiently finds all .md files skipping IGNORED_DIRS.

    Unreadable directories are skipped (and logged) instead of aborting the
    whole walk: on OneDrive, listing a non-materialized subtree from a launchd
    process raises EDEADLK (errno 11) / EAGAIN — one wedged folder used to turn
    the entire scan (and GET /api/graph) into a 500. Skipped paths are appended
    to ``skipped_dirs`` when provided, so callers can flag the result as
    partial instead of caching it as complete, and a background hydration of
    the wedged directory is requested (see _request_dir_warmup).
    """
    md_files = []
    try:
        for entry in os.scandir(root_path):
            if entry.is_dir():
                if entry.name in IGNORED_DIRS or entry.name.startswith("."):
                    continue
                md_files.extend(get_markdown_files_efficient(Path(entry.path), skipped_dirs))
            elif entry.is_file() and entry.name.endswith(".md") and not entry.name.startswith("."):
                md_files.append(Path(entry.path))
    except (PermissionError, FileNotFoundError):
        pass
    except OSError as e:
        # Cloud-FS wedged subtree (or any other listing failure): skip it and
        # keep walking so the rest of the vault still reaches the graph.
        log.warning(f"Skipping unreadable directory {root_path}: {e}")
        if skipped_dirs is not None:
            skipped_dirs.append(str(root_path))
        if e.errno in (errno.EDEADLK, errno.EAGAIN):
            _request_dir_warmup(root_path)
    return md_files


def parse_section_links(content: str) -> dict[str | None, list[str]]:
    """Extracts wikilinks from the .md body grouped by heading.

    Returns {heading_str: [link, ...], None: [link, ...]}
    where None = links before the first heading.
    Ignores :::gnosi-ignore blocks and ```code``` blocks to avoid duplicating Notion artifacts.
    
    """
    # Strip frontmatter
    match = re.match(r'^---\s*\n.*?\n---\s*\n', content, re.DOTALL)
    body = content[match.end():] if match else content

    sections: dict[str | None, list[str]] = {None: []}
    current_heading: str | None = None
    in_ignore = False
    in_code = False

    for line in body.split("\n"):
        stripped = line.strip()

        # Track :::gnosi-ignore blocks (Notion artifacts — they don't count towards the graph)
        if stripped.startswith(":::gnosi-ignore"):
            in_ignore = True
            continue
        if in_ignore:
            if stripped == ":::":
                in_ignore = False
            continue

        # Track code fences
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue

        # Detect heading
        h_match = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if h_match:
            current_heading = h_match.group(2).strip()
            if current_heading not in sections:
                sections[current_heading] = []
            continue

        # Extract wikilinks from this line
        for raw in re.findall(r'\[\[(.*?)\]\]', line):
            target = raw.split('|')[0].split('#')[0].strip()
            if target:
                bucket = sections.setdefault(current_heading, [])
                bucket.append(target)

    return sections


def parse_frontmatter(content: str, file_path: Optional[Path] = None):
    """Parses a markdown file for YAML frontmatter and body.

    ``file_path`` is optional and used only for logging context if parsing fails.
    """
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end():]
        try:
            metadata = yaml.safe_load(yaml_content) or {}
            # Stripping of relation wikilinks ('[[Title|id]]' → id) is done
            # by the caller using the table's SCHEMA: here (a free function) it's not
            # known which fields are relation fields.
            return metadata, body
        except yaml.YAMLError as e:
            # Tolerant rescue, SAME as the Vault (vault_routes.parse_frontmatter):
            # without this, a page with slightly malformed YAML (an unclosed quote,
            # a tab, a reserved indicator…) would come out EMPTY in the graph (without title/
            # type/color) even though it read fine in the Vault.
            fallback_metadata = parse_frontmatter_fallback(yaml_content)
            if fallback_metadata:
                return fallback_metadata, body
            location = f" in {file_path}" if file_path else ""
            # debug level to avoid log spam if some pages have bad frontmatter
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content

def _resolve_active_vault_path(cfg):
    """Prefer the request's active vault over the env-default VAULT.

    `cfg.paths` always reflects the env-default vault, so a multi-vault user
    with X-Vault-Id set to vault B would otherwise get vault A's graph and node
    counts (cross-vault data exposure). Honor the active-vault contextvar the
    same way `vault_routes.get_p()` does.
    """
    try:
        from backend.services.context_vars import get_active_vault_path
        active = get_active_vault_path()
        if active:
            return active
    except Exception:
        pass
    return cfg.paths.get("VAULT")


class GraphService:
    # Last complete count per vault. It is derived from the canonical graph,
    # never from a second filesystem scan, and protects stats from partial
    # OneDrive snapshots.
    _node_count_cache: dict = {}

    # Cache for the full graph, keyed per vault (str path).
    _graph_cache: dict = {}
    _last_graph_time: dict = {}
    _GRAPH_CACHE_TTL = 30  # seconds — enough to avoid continuous rebuilds but reactive to changes

    @classmethod
    def invalidate_response_cache(cls) -> None:
        """Invalidate all per-vault graph responses."""

        cls._graph_cache = {}
        cls._last_graph_time = {}

    # Class-level Persistent Node Data Cache (metadata, links, etc.)
    # Format: { path_str: { mtime: float, metadata: dict, size: int, links: list, kind: str, color: str, title: str } }
    _NODE_DATA_CACHE = {}

    # Persistence of _NODE_DATA_CACHE to disk: avoids re-reading thousands of files
    # from the vault on the first build after restarting the backend (cold start
    # ~10s -> ~1s). Invalidation by mtime (in _add_page_nodes) guarantees
    # consistency: changed files are still re-read.
    _NODE_CACHE_LOADED = False

    @staticmethod
    def _node_cache_path():
        try:
            base = load_params(strict_env=False).paths.get("LOCAL_CACHE")
            return (base / "graph_node_cache.json") if base else None
        except Exception:
            return None

    @classmethod
    def _load_node_cache(cls):
        """Loads _NODE_DATA_CACHE from disk once (cold start). Best-effort."""
        if cls._NODE_CACHE_LOADED:
            return
        cls._NODE_CACHE_LOADED = True
        if cls._NODE_DATA_CACHE:
            return  # already populated in memory
        p = cls._node_cache_path()
        if not p or not p.exists():
            return
        try:
            import json
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cls._NODE_DATA_CACHE.update(data)
                log.info(f"📥 Graph node cache: loaded {len(data)} entries from disk")
        except Exception as e:
            log.warning(f"Could not load the graph node cache: {e}")

    @classmethod
    def _save_node_cache(cls):
        """Persists _NODE_DATA_CACHE to disk (atomic write). Best-effort."""
        p = cls._node_cache_path()
        if not p or not cls._NODE_DATA_CACHE:
            return
        try:
            import json
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cls._NODE_DATA_CACHE, f, default=str)
            tmp.replace(p)
        except Exception as e:
            log.warning(f"Could not save the graph node cache: {e}")

    def __init__(self):
        self.registry = self._load_registry()
        
    def _load_registry(self) -> Dict[str, Any]:
        """Loads the database and table registry from file or memory."""
        cfg = load_params(strict_env=False)
        
        # Safety check for VAULT path
        vault_path = _resolve_active_vault_path(cfg)
        if not vault_path:
            log.warning("VAULT path not configured in cfg.paths. Skipping registry load.")
            return {"databases": [], "tables": [], "views": []}

        registry_path = cfg.paths.get("REGISTRY")
        if not registry_path and vault_path:
            # Canonical location is BD/; fall back to the legacy root path.
            registry_path = vault_path / "BD" / "vault_db_registry.json"
            if not registry_path.exists():
                registry_path = vault_path / "vault_db_registry.json"

        if registry_path and registry_path.exists():
            try:
                with open(registry_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                log.error(f"Error loading vault_db_registry.json: {e}")
        
        return {"databases": [], "tables": [], "views": []}

    def build_unified_graph(self) -> Dict[str, Any]:
        """
        Build the current vault topology and its semantic proposal overlay.

        The frontend owns coordinates and visible-subgraph layout.
        """
        now = time.time()
        # 0. Load live config (needed to resolve the active vault for the cache key)
        cfg = load_params(strict_env=False)
        vault_key = str(_resolve_active_vault_path(cfg) or "")
        # Tolerate caches invalidated by an older scheduler implementation
        # that used ``None`` instead of the documented per-vault dictionary.
        if not isinstance(GraphService._graph_cache, dict):
            log.warning("Resetting invalid graph cache state")
            GraphService._graph_cache = {}
        if not isinstance(GraphService._last_graph_time, dict):
            GraphService._last_graph_time = {}
        cached = GraphService._graph_cache.get(vault_key)
        if cached and (now - GraphService._last_graph_time.get(vault_key, 0) < self._GRAPH_CACHE_TTL):
            log.info("Serving graph from cache")
            return cached

        self.registry = self._load_registry()
        
        log.info("Building current vault graph...")
        # Direction is domain data: reciprocal links must remain two distinct
        # edges instead of being collapsed by an undirected NetworkX graph.
        G = nx.DiGraph()

        # Cold start: loads the node cache from disk to avoid re-reading thousands of
        # files after a restart (mtime invalidation is still preserved).
        GraphService._load_node_cache()
        page_nodes, skipped_dirs = self._add_page_nodes(G)
        # Per-file node cache stays valid even on a partial scan: it only holds
        # files that were actually read, keyed by path with mtime invalidation.
        GraphService._save_node_cache()
        self._add_contact_nodes(G)
        self._add_structural_edges(G, page_nodes)

        # Pending semantic proposals are an overlay, not structural topology.
        # The frontend owns layout and excludes this layer from its simulation.
        self._add_suggestion_edges(G)

        # Index pages generated for relation fields sometimes inherit the raw
        # relation UUID in their filename (for example, ``Index · Projecte:
        # <uuid>``). Resolve that UUID against the already-built graph so the
        # UI displays the related area's/project's human title.
        graph_labels = {
            str(node_id): str(attrs.get("label") or node_id)
            for node_id, attrs in G.nodes(data=True)
        }
        relation_index_re = re.compile(
            r"^(?P<prefix>(?:Index|Índex)\s*[·:]\s*(?:Projecte|Project|Àrea|Area)\s*:\s*)(?P<id>[0-9a-f]{8}-[0-9a-f-]{27,})$",
            re.IGNORECASE,
        )

        nodes = []
        for node_id in G.nodes():
            attrs = G.nodes[node_id]
            meta = attrs.get("metadata", {}) or {}
            cluster = _node_cluster(meta, attrs)
            label = str(attrs.get("label", node_id))
            match = relation_index_re.match(label.strip())
            if match:
                related_label = graph_labels.get(match.group("id"))
                if related_label and related_label != match.group("id"):
                    label = f"{match.group('prefix')}{related_label}"
            nodes.append({
                "id": node_id,
                "key": node_id,
                "label": label,
                "size": attrs.get("size", 10),
                "color": attrs.get("color", COLOR_PALETTE.get(attrs.get("kind"), COLOR_PALETTE["default"])),
                "kind": attrs.get("kind", "page"),
                "metadata": meta,
                "cluster": cluster,
                # Additional attributes needed for categorization in the frontend (graphFilters.js)
                "path": attrs.get("path", ""),
                "table_id": attrs.get("table_id") or meta.get("table_id") or meta.get("database_table_id"),
                "database_id": attrs.get("database_id") or meta.get("database_id"),
            })
            
        edges = []
        for u, v in G.edges():
            edge_attrs = G.edges[u, v]
            edge = {
                "id": f"e_{u}_{v}",
                "source": u,
                "target": v,
                # `src`/`dst` remain explicit for consumers that use semantic
                # direction rather than the transport endpoint names.
                "src": edge_attrs.get("src", u),
                "dst": edge_attrs.get("dst", v),
                "directed": edge_attrs.get("directed", False),
                "color": edge_attrs.get("color", "#cbd5e1"),
                "size": edge_attrs.get("size", 1),
                "dashed": edge_attrs.get("dashed", False),
                "kind": edge_attrs.get("kind", "structural"),
                "body_link": bool(edge_attrs.get("body_link", False)),
                "unresolved": bool(edge_attrs.get("unresolved", False)),
            }
            if edge["kind"] == "suggestion":
                edge["reason"] = edge_attrs.get("reason", "")
                edge["suggestion_id"] = edge_attrs.get("suggestion_id", "")
            edges.append(edge)
            
        # Legend generation (dynamic based on the fields exported to the client).
        legend_kinds = []
        kind_counts = {}
        kind_colors = {}
        cluster_counts = {}
        cluster_colors = {}
        
        for n in nodes:
            k = n.get("kind")
            if k:
                kind_counts[k] = kind_counts.get(k, 0) + 1
                if k not in kind_colors:
                    kind_colors[k] = n.get("color", COLOR_PALETTE.get(k, COLOR_PALETTE["default"]))
            cluster = n.get("cluster")
            if cluster:
                cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1
                cluster_colors.setdefault(cluster, _string_to_color(cluster))
        
        for k, count in kind_counts.items():
            label = k.capitalize()
            legend_kinds.append({
                "label": label, 
                "color": kind_colors[k],
                "count": count
            })

        legend_clusters = [
            {"label": label, "color": cluster_colors[label], "count": count}
            for label, count in sorted(cluster_counts.items())
        ]
        result = {
            "nodes": nodes,
            "edges": edges,
            "legend": {
                "kinds": legend_kinds,
                "clusters": legend_clusters,
            }
        }

        if skipped_dirs:
            # PARTIAL graph: one or more vault subtrees could not be listed
            # (wedged online-only OneDrive dirs). Serve what we have — far
            # better than a 500 — but DON'T store it in the TTL cache: the
            # next request retries a full build instead of pinning an
            # incomplete (possibly near-empty) graph for _GRAPH_CACHE_TTL.
            result["partial"] = True
            result["skipped_dirs"] = skipped_dirs
            log.warning(
                f"Graph built PARTIALLY: {len(skipped_dirs)} unreadable dir(s) "
                f"skipped ({', '.join(skipped_dirs[:5])}"
                f"{'…' if len(skipped_dirs) > 5 else ''}); result not cached"
            )
            return result

        GraphService._graph_cache[vault_key] = result
        GraphService._last_graph_time[vault_key] = time.time()  # time AFTER the build, not before
        return result

    def _add_page_nodes(self, G: nx.Graph) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Adds one node per vault .md file.

        Returns ``(page_nodes, skipped_dirs)``: ``skipped_dirs`` holds the
        vault-relative paths of directories the scan could not list (wedged
        OneDrive subtrees) — non-empty means the graph is PARTIAL and must not
        be cached as the complete graph.
        """
        cfg = load_params(strict_env=False)
        vault_path = _resolve_active_vault_path(cfg)
        page_nodes = []
        if not vault_path or not vault_path.exists():
            return [], []

        # Build folder→table_id lookup so BD page nodes get table_id even without frontmatter
        folder_to_table_id: dict = {}
        folder_to_db_id: dict = {}
        for t in self.registry.get("tables", []):
            folder = t.get("folder")
            if folder:
                folder_to_table_id[folder] = t["id"]
                folder_to_db_id[folder] = t.get("database_id", "")

        # Recursive scan for all .md files - EFFICIENT VERSION
        skipped_abs: List[str] = []
        all_md_files = get_markdown_files_efficient(vault_path, skipped_abs)
        # Vault-relative paths: nicer for logs/clients, no host paths leaked.
        skipped_dirs: List[str] = []
        for d in skipped_abs:
            try:
                skipped_dirs.append(str(Path(d).relative_to(vault_path)))
            except ValueError:
                skipped_dirs.append(d)

        for file_path in all_md_files:
            path_str = str(file_path.relative_to(vault_path))
            # Cache key is the ABSOLUTE path so entries never collide across
            # vaults that share a relative path (e.g. two vaults' Notes/foo.md).
            cache_key = str(file_path)
            mtime = os.path.getmtime(file_path)

            # Use cached data if mtime hasn't changed
            cache_entry = GraphService._NODE_DATA_CACHE.get(cache_key)
            if cache_entry and cache_entry.get("mtime") == mtime:
                metadata = cache_entry["metadata"]
                id_to_use = cache_entry["id"]
                title = cache_entry["title"]
                kind = cache_entry["kind"]
                color = cache_entry["color"]
                pass  # size read from cache_entry["size"] in G.add_node
            else:
                # Cache miss - Read and parse file
                try:
                    raw_content = file_path.read_text(encoding="utf-8")
                    metadata, body = parse_frontmatter(raw_content, file_path)
                    
                    file_id = file_path.stem
                    id_to_use = metadata.get("id") or file_id
                    managed_kind = ""
                    try:
                        from backend.services import llm_wiki_config, llm_wiki_storage

                        metadata = llm_wiki_storage.merge_page_metadata(
                            metadata,
                            str(id_to_use),
                        )
                        managed_kind = llm_wiki_config.metadata_note_type(metadata)
                    except Exception:  # noqa: BLE001
                        pass
                    title = metadata.get("title") or file_id
                    
                    # Extract kind
                    app_cfg = cfg.get("app", {})
                    type_prop = app_cfg.get("type_property", "note_type")
                    raw_kind = (
                        metadata.get("note_type")
                        or metadata.get(type_prop)
                        or managed_kind
                        or metadata.get("type")
                        or "page"
                    )
                    
                    norm_kind = str(raw_kind)
                    kind = "page"
                    for pattern, kind_value in _KIND_PATTERNS:
                        if pattern.search(norm_kind):
                            kind = kind_value
                            break

                    # Fallback: detect by path if the frontmatter doesn't specify the type
                    if kind == "page":
                        if path_str.startswith("Contacts/") or path_str.startswith("Contactes/"):
                            kind = "contact"
                        elif path_str.startswith("Calendar/"):
                            kind = "calendar"

                    # Color
                    node_colors = cfg.colors.get("node_types", {})
                    color_cfg = node_colors.get(kind, node_colors.get("default", {}))
                    color = color_cfg.get("bg", COLOR_PALETTE.get(kind, COLOR_PALETTE["page"]))

                    # Status override
                    status = str(metadata.get("estat") or metadata.get("status") or "")
                    if _STATUS_IDEA_RE.search(status): color = "#fcd34d"

                    # PRE-EXTRACT WIKILINKS per section (avoids re-reading in the edges step)
                    section_links = parse_section_links(raw_content)
                    # Flat list for backward compatibility
                    all_links = list({lnk for links in section_links.values() for lnk in links})

                    # Update Cache
                    cache_entry = {
                        "mtime": mtime,
                        "id": id_to_use,
                        "title": title,
                        "kind": kind,
                        "color": color,
                        "size": 8 + min(len(body) // 1000, 10),
                        "metadata": metadata,
                        "links": all_links,
                        "section_links": section_links,
                    }
                    GraphService._NODE_DATA_CACHE[cache_key] = cache_entry
                except Exception as e:
                    log.error(f"Error processing node {path_str}: {e}")
                    continue

            # Infer table_id from path if not in frontmatter (BD/[DB]/[TableFolder]/file.md)
            inferred_table_id = metadata.get("table_id") or metadata.get("database_table_id")
            inferred_db_id = metadata.get("database_id")
            if not inferred_table_id:
                path_parts = path_str.replace("\\", "/").split("/")
                if len(path_parts) >= 3 and path_parts[0] == "BD":
                    table_folder = path_parts[2]
                    inferred_table_id = folder_to_table_id.get(table_folder)
                    inferred_db_id = inferred_db_id or folder_to_db_id.get(table_folder)

            # Relation fields → clean ids ('[[Title|id]]' → id) according to the SCHEMA
            # of the table. Edges are created in _add_structural_edges; here we
            # clean up the node's metadata (on a copy, never the cache).
            _rel_keys = relation_keys_from_table(
                next((t for t in self.registry.get("tables", [])
                      if t.get("id") == inferred_table_id), None))
            if _rel_keys:
                metadata = strip_relation_wikilinks(dict(metadata), _rel_keys)

            # Add to NetworkX
            G.add_node(id_to_use,
                       label=title,
                       kind=kind,
                       color=color,
                       size=cache_entry["size"],
                       metadata=metadata,
                       path=path_str,
                       table_id=inferred_table_id,
                       database_id=inferred_db_id)
            
            page_nodes.append({
                "id": id_to_use,
                "title": title,
                "tags": metadata.get("tags", []),
                "metadata": metadata,
                "path": file_path,
                "links": cache_entry["links"],
                "section_links": cache_entry.get("section_links", {}),
                "table_id": inferred_table_id,
            })

        return page_nodes, skipped_dirs

    def _add_contact_nodes(self, G: nx.Graph):
        """Adds contacts from management.sqlite (local DB, NOT the vault).

        The Contact model lives in management_db.Base (management.sqlite) — the
        same DB that serves /api/contacts via get_mgmt_db. It used to open the
        vault DB (get_engine_for_path), which does NOT have the 'contacts' table →
        'no such table: contacts' and no contacts in the graph.
        
        """
        try:
            from backend.data.management_db import get_mgmt_session
            from backend.models.contact import Contact

            cfg = load_params(strict_env=False)
            node_colors = cfg.colors.get("node_types", {})
            color_cfg = node_colors.get("contact", node_colors.get("default", {}))
            color = color_cfg.get("bg", "#10b981")

            with get_mgmt_session() as db:
                contacts = db.query(Contact).all()
                for c in contacts:
                    node_id = f"contact_{c.id}"
                    label = c.name or c.email or str(c.id)
                    metadata = {
                        "id": str(c.id),
                        "title": label,
                        "email": c.email,
                        "company": getattr(c, "company", None),
                        "job_title": getattr(c, "job_title", None),
                        "source": str(getattr(c, "source", "custom")),
                        "account_id": getattr(c, "account_id", None),
                    }
                    G.add_node(node_id,
                               label=label,
                               kind="contact",
                               color=color,
                               size=8,
                               metadata=metadata,
                               path=f"Contacts/{label}.md")
        except Exception as e:
            log.warning(f"_add_contact_nodes: {e}")

    def _add_structural_edges(self, G: nx.Graph, page_nodes: List[Dict[str, Any]]):
        # 1. Frontmatter relation detection (Already loaded in node attributes).
        # Recognizes relation fields via the SCHEMA (type=relation, name+aliases),
        # regardless of the column name. See vault_relation_inverse_sync.md
        rel_keys_by_table = {
            t.get("id"): relation_keys_from_table(t)
            for t in self.registry.get("tables", [])
        }
        for node_id, attrs in G.nodes(data=True):
            if attrs.get("kind") in ["database", "table", "view"]:
                continue

            metadata = attrs.get("metadata", {})

            # Vault structural parent
            parent_id = metadata.get("parent_id")
            if parent_id and G.has_node(parent_id):
                G.add_edge(parent_id, node_id, kind="structural", color="#94a3b8", size=1,
                           src=parent_id, dst=node_id, directed=True)

            tid = metadata.get("table_id") or metadata.get("database_table_id")
            rel_keys = rel_keys_by_table.get(tid)
            # Scan for relation fields (by schema)
            for key, value in metadata.items():
                if is_relation_key(key, rel_keys):
                    targets = value if isinstance(value, list) else [value]
                    for t in targets:
                        t_id = strip_item(t)  # `[[Title|id]]` → id (or id as-is)
                        if isinstance(t_id, str) and G.has_node(t_id):
                            G.add_edge(node_id, t_id, kind="relation", color="#6366f1", size=1.5,
                                       src=node_id, dst=t_id, directed=True)

        # 2. Wikipedia-style links from cached link data (NO NEW FILE READS!)
        # Generic Notion titles that must NOT become hubs (export artifacts)
        GENERIC_TITLES = {"untitled", "sense títol", "sin título", "new page", "nova pàgina"}

        # Pre-build O(1) lookup indexes before iterating links
        label_to_id: dict[str, str] = {}   # lowercase label → node_id
        stem_to_id: dict[str, str] = {}    # lowercase path stem → node_id
        for n_id, n_attrs in G.nodes(data=True):
            label = str(n_attrs.get("label") or "").strip().lower()
            if label and label not in GENERIC_TITLES:
                label_to_id.setdefault(label, n_id)
            node_path = n_attrs.get("path", "")
            if node_path:
                stem = Path(node_path).stem.lower()
                if stem not in GENERIC_TITLES:
                    stem_to_id.setdefault(stem, n_id)

        # Pre-build table_id → {heading: section_config} to classify edges
        table_sections_map: dict[str, dict[str, dict]] = {}
        for table in self.registry.get("tables", []):
            sections = table.get("sections", [])
            if sections:
                table_sections_map[table["id"]] = {
                    s["heading"]: s
                    for s in sections
                    if s.get("type") == "db_view"
                }

        def resolve_link(target_label: str):
            target_key = target_label.split('|')[0].split('#')[0].strip()
            target_lower = target_key.lower()
            if G.has_node(target_key):
                # Gnosi-generated body links use stable page IDs as targets.
                # Page identity is independent of the human-readable filename.
                return target_key
            return label_to_id.get(target_lower) or stem_to_id.get(target_lower)

        def add_unresolved(source_id: str, target_label: str) -> str:
            """Add one global placeholder for a genuinely missing target."""
            target_key = target_label.split('|')[0].split('#')[0].strip()
            digest = hashlib.sha1(
                target_key.casefold().encode("utf-8")
            ).hexdigest()[:20]
            unresolved_id = f"unresolved:{digest}"

            if not G.has_node(unresolved_id):
                G.add_node(
                    unresolved_id,
                    label=target_key,
                    kind="unresolved",
                    color=COLOR_PALETTE["unresolved"],
                    size=6,
                    metadata={"unresolved": True},
                )

            if not G.has_edge(source_id, unresolved_id):
                G.add_edge(
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

        for page in page_nodes:
            node_id = page["id"]
            table_id = page.get("table_id") or G.nodes[node_id].get("table_id")
            db_view_headings = table_sections_map.get(table_id, {}) if table_id else {}

            section_links = page.get("section_links") or {}

            # Processes db_view sections first to guarantee kind='relation' in case of conflict
            ordered_headings = sorted(
                section_links.keys(),
                key=lambda h: (0 if h in db_view_headings else 1),
            )

            for heading in ordered_headings:
                links = section_links[heading]
                is_db_view = heading in db_view_headings

                for target_label in links:
                    resolved = resolve_link(target_label)
                    if not resolved:
                        add_unresolved(node_id, target_label)
                        continue
                    if resolved == node_id or not G.has_node(resolved):
                        continue

                    if G.has_edge(node_id, resolved):
                        G.edges[node_id, resolved]["body_link"] = True
                        # If it already exists as a simple link but is now a db_view, promote it
                        if is_db_view and G.edges[node_id, resolved].get("kind") == "link":
                            G.edges[node_id, resolved]["kind"] = "relation"
                            G.edges[node_id, resolved]["color"] = "#6366f1"
                            G.edges[node_id, resolved]["size"] = 1.5
                        continue
                    if is_db_view:
                        G.add_edge(node_id, resolved, kind="relation", body_link=True,
                                   color="#6366f1", size=1.5,
                                   src=node_id, dst=resolved, directed=True)
                    else:
                        G.add_edge(node_id, resolved, kind="link", body_link=True,
                                   color="#10b981", size=1.2,
                                   src=node_id, dst=resolved, directed=True)

    
    def _add_suggestion_edges(self, G: nx.Graph):
        """Add the canonical Brain proposal queue as a non-structural overlay."""
        try:
            from backend.services.llm_wiki_suggestions import list_graph_edges

            for suggestion in list_graph_edges():
                source_id = str(suggestion.get("source") or "")
                target_id = str(suggestion.get("target") or "")
                if not source_id or not target_id:
                    continue
                if not G.has_node(source_id) or not G.has_node(target_id):
                    continue
                # An explicit relationship supersedes a proposal.
                if G.has_edge(source_id, target_id) or G.has_edge(target_id, source_id):
                    continue
                G.add_edge(
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
        except Exception as e:
            log.error(f"Error loading Brain suggestions: {e}")

    def get_node_count(self) -> int:
        """Return the real-node count from the canonical graph projection."""
        cfg = load_params(strict_env=False)
        vault_path = _resolve_active_vault_path(cfg)
        vault_key = str(vault_path or "")
        try:
            graph = self.build_unified_graph()
            count = sum(
                1
                for node in graph.get("nodes", [])
                if str(node.get("kind") or "page").lower() != "unresolved"
            )
            if graph.get("partial") and vault_key in GraphService._node_count_cache:
                return GraphService._node_count_cache[vault_key]
            GraphService._node_count_cache[vault_key] = count
            return count
        except Exception as e:
            log.error(f"Error counting nodes: {e}")
            return GraphService._node_count_cache.get(vault_key, 0)

# graph_service = GraphService()
