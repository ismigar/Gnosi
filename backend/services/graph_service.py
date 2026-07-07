import os
import json
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

try:
    import igraph as ig  # type: ignore
    _HAS_IGRAPH = True
except ImportError:
    ig = None
    _HAS_IGRAPH = False

# Import suggestion handler (Phase 1 MVP) - DISABLED: No module named 'pipeline.skills.graph_suggestions'
# from pipeline.skills.graph_suggestions.scripts.graph_suggestion_handler import SuggestionHandler
SuggestionHandler = None

log = logging.getLogger(__name__)

# Colors for Sigma.js (Sync with frontend config if possible)
COLOR_PALETTE = {
    "database": "#6366f1",  # Indigo
    "table": "#8b5cf6",     # Violet
    "view": "#d946ef",      # Fuchsia
    "page": "#10b981",      # Emerald (Permanent)
    "tag": "#f59e0b",       # Amber
    "media": "#ec4899",     # Pink (New)
    "default": "#94a3b8"    # Slate
}

# Optimization: Directories to skip during recursive scans
IGNORED_DIRS = {
    "node_modules", ".venv", ".git", ".tmp", "dist", "build",
    "target", ".cache", "__pycache__", "Plantilles", "Library", ".gemini",
    # Carpetes de sistema gestionades per serveis dedicats (no pàgines wiki)
    # Contacts i Images són cloud-only a OneDrive: el rglob/scandir triga ~18s via FUSE.
    # S'afegeixen al graf via _add_contact_nodes (SQLite) i _add_media_nodes (desactivat).
    "Mail", "Calendar", "Contacts", "Contactes", "Images",
    "system", "custom_icons", "data",
}

# Status override: detecta "idea" com a paraula sencera al valor d'estat per
# pintar el node en groc. Amb \b s'eviten falsos positius com "idealment" o
# "ideari" que contenen "idea" com a substring.
_STATUS_IDEA_RE = re.compile(r"\bidea\b", re.IGNORECASE)

# Classificació de `note_type` → `kind`. Cada patró requereix que el token
# aparegui al començament o precedit per un separador per evitar falsos
# positius com "Impermanent" → permanent o "Eventualment" → event. S'accepta
# un sufix opcional però limitat a `\w{0,4}` i, després, un separador o final
# de text (`(?=[\s_\-]|$)`), per cobrir plurals i variacions lingüístiques ("permanente", "permanents",
# "calendari", "diaris", etc.). L'ordre importa: es retorna el primer match.
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

def get_markdown_files_efficient(root_path: Path) -> List[Path]:
    """Efficiently finds all .md files skipping IGNORED_DIRS."""
    md_files = []
    try:
        for entry in os.scandir(root_path):
            if entry.is_dir():
                if entry.name in IGNORED_DIRS or entry.name.startswith("."):
                    continue
                md_files.extend(get_markdown_files_efficient(Path(entry.path)))
            elif entry.is_file() and entry.name.endswith(".md") and not entry.name.startswith("."):
                md_files.append(Path(entry.path))
    except (PermissionError, FileNotFoundError):
        pass
    return md_files


def parse_section_links(content: str) -> dict[str | None, list[str]]:
    """Extreu wikilinks del cos del .md agrupats per heading.

    Retorna {heading_str: [link, ...], None: [link, ...]}
    on None = links anteriors al primer heading.
    Ignora blocs :::gnosi-ignore i ```code``` per no duplicar artefactes Notion.
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

        # Track :::gnosi-ignore blocks (Notion artefacts — no compten per al graf)
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
            # El despullat dels wikilinks de relació ('[[Títol|id]]' → id) es fa
            # al caller amb l'ESQUEMA de la taula: aquí (funció lliure) no es
            # coneix quins camps són de relació.
            return metadata, body
        except yaml.YAMLError as e:
            # Rescat tolerant IGUAL que el Vault (vault_routes.parse_frontmatter):
            # sense això, una pàgina amb YAML lleugerament malformat (cometa sense
            # tancar, tab, indicador reservat…) sortia BUIDA al graf (sense títol/
            # tipus/color) tot i llegir-se bé al Vault.
            fallback_metadata = parse_frontmatter_fallback(yaml_content)
            if fallback_metadata:
                return fallback_metadata, body
            location = f" in {file_path}" if file_path else ""
            # debug level to avoid log spam if some pages have bad frontmatter
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content

class GraphService:
    # Class-level cache for node count to avoid heavy scanning on every 2s poll
    _node_count_cache = 0
    _last_count_time = 0
    _CACHE_TTL = 60 # seconds
    
    # Cache for the full graph
    _graph_cache = None
    _last_graph_time = 0
    _GRAPH_CACHE_TTL = 30  # seconds — prou per evitar rebuilds continus però reactiu als canvis

    # Class-level Persistent Node Data Cache (metadata, links, etc.)
    # Format: { path_str: { mtime: float, metadata: dict, size: int, links: list, kind: str, color: str, title: str } }
    _NODE_DATA_CACHE = {}

    # Global ID to Path index for fast lookups
    # Format: { node_id: path_str_relative_to_vault }
    _ID_TO_PATH_CACHE = {}
    
    # Class-level Layout Cache to avoid recalcing layout if not needed
    _LAYOUT_CACHE = {}
    _LAYOUT_HASH: Optional[str] = None

    # Persistència del _NODE_DATA_CACHE a disc: evita rellegir milers de fitxers
    # del vault al primer build després de reiniciar el backend (cold start
    # ~10s -> ~1s). La invalidació per mtime (a _add_page_nodes) garanteix
    # coherència: els fitxers canviats es rellegeixen igualment.
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
        """Carrega _NODE_DATA_CACHE de disc un sol cop (cold start). Best-effort."""
        if cls._NODE_CACHE_LOADED:
            return
        cls._NODE_CACHE_LOADED = True
        if cls._NODE_DATA_CACHE:
            return  # ja poblat en memòria
        p = cls._node_cache_path()
        if not p or not p.exists():
            return
        try:
            import json
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cls._NODE_DATA_CACHE.update(data)
                log.info(f"📥 Graph node cache: {len(data)} entrades carregades de disc")
        except Exception as e:
            log.warning(f"No s'ha pogut carregar el graph node cache: {e}")

    @classmethod
    def _save_node_cache(cls):
        """Persisteix _NODE_DATA_CACHE a disc (escriptura atòmica). Best-effort."""
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
            log.warning(f"No s'ha pogut desar el graph node cache: {e}")

    _LAYOUT_CACHE_LOADED = False

    @classmethod
    def _load_layout_cache(cls):
        """Carrega el layout (posicions) de disc un cop. El layout (igraph) és
        la part més lenta del cold start; persistir-lo evita recalcular-lo si
        l'estructura del graf no ha canviat (mateix hash). Best-effort."""
        if cls._LAYOUT_CACHE_LOADED:
            return
        cls._LAYOUT_CACHE_LOADED = True
        if cls._LAYOUT_CACHE:
            return
        try:
            base = load_params(strict_env=False).paths.get("LOCAL_CACHE")
            p = (base / "graph_layout_cache.json") if base else None
            if not p or not p.exists():
                return
            import json
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            cls._LAYOUT_HASH = data.get("hash")
            cls._LAYOUT_CACHE = {k: tuple(v) for k, v in (data.get("pos") or {}).items()}
            if cls._LAYOUT_CACHE:
                log.info(f"📥 Graph layout cache: {len(cls._LAYOUT_CACHE)} posicions de disc")
        except Exception as e:
            log.warning(f"No s'ha pogut carregar el graph layout cache: {e}")

    @classmethod
    def _save_layout_cache(cls):
        """Persisteix el layout a disc (escriptura atòmica). Best-effort."""
        if not cls._LAYOUT_CACHE or not cls._LAYOUT_HASH:
            return
        try:
            base = load_params(strict_env=False).paths.get("LOCAL_CACHE")
            p = (base / "graph_layout_cache.json") if base else None
            if not p:
                return
            import json
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(
                    {"hash": cls._LAYOUT_HASH,
                     "pos": {k: [float(v[0]), float(v[1])] for k, v in cls._LAYOUT_CACHE.items()}},
                    f,
                )
            tmp.replace(p)
        except Exception as e:
            log.warning(f"No s'ha pogut desar el graph layout cache: {e}")

    def __init__(self):
        self.registry = self._load_registry()
        
    def _load_registry(self) -> Dict[str, Any]:
        """Loads the database and table registry from file or memory."""
        cfg = load_params(strict_env=False)
        
        # Safety check for VAULT path
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            log.warning("VAULT path not configured in cfg.paths. Skipping registry load.")
            return {"databases": [], "tables": [], "views": []}

        registry_path = cfg.paths.get("REGISTRY")
        if not registry_path and vault_path:
            registry_path = vault_path / "vault_db_registry.json"
        
        if registry_path and registry_path.exists():
            try:
                with open(registry_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                log.error(f"Error loading vault_db_registry.json: {e}")
        
        return {"databases": [], "tables": [], "views": []}

    def _compute_graph_hash(self, G: "nx.Graph") -> str:
        """Hash estable del graf basat en nodes+edges. Detecta canvis estructurals."""
        nodes = sorted(str(n) for n in G.nodes())
        edges = sorted((str(s), str(t)) for s, t in G.edges())
        payload = json.dumps({"n": nodes, "e": edges}, sort_keys=True).encode()
        return hashlib.sha256(payload).hexdigest()

    def _compute_layout(self, G: "nx.Graph") -> Dict[str, Tuple[float, float]]:
        """Calcula posicions amb igraph Fruchterman-Reingold (ràpid, qualitat alta).
        Falla amb fallback a networkx spring_layout si igraph no està disponible.
        Retorna dict {node_id: (x, y)} en l'espai original (pre-escalat al render).
        """
        n_nodes = G.number_of_nodes()
        if n_nodes == 0:
            return {}

        if _HAS_IGRAPH:
            node_list = list(G.nodes())
            idx = {n: i for i, n in enumerate(node_list)}
            # Fem servir NOMÉS edges "link" (wikilinks reals) per al layout, igual que Obsidian.
            # Els edges "relation" (inferits per tags) creen una xarxa artificialment densa
            # que col·lapsa tots els nodes en un sol clúster.
            layout_edges = [
                (idx[s], idx[t])
                for s, t, d in G.edges(data=True)
                if d.get('kind', 'link') == 'link'
            ]
            ig_graph = ig.Graph(n=n_nodes, edges=layout_edges)
            n_iter = max(500, min(3000, n_nodes * 5))
            import random as _rnd
            _rnd.seed(42)
            layout = ig_graph.layout_fruchterman_reingold(niter=n_iter)
            coords = layout.coords
            # Normalitzem a un espai fix de 10000 × 10000 centrat a l'origen
            raw_xs = [float(coords[i][0]) for i in range(n_nodes)]
            raw_ys = [float(coords[i][1]) for i in range(n_nodes)]
            xmin, xmax = min(raw_xs), max(raw_xs)
            ymin, ymax = min(raw_ys), max(raw_ys)
            xrange = (xmax - xmin) or 1.0
            yrange = (ymax - ymin) or 1.0
            CANVAS = 10000.0
            pos = {
                node_list[i]: (
                    (raw_xs[i] - xmin) / xrange * CANVAS - CANVAS / 2,
                    (raw_ys[i] - ymin) / yrange * CANVAS - CANVAS / 2,
                )
                for i in range(n_nodes)
            }
        else:
            log.warning("python-igraph not available; using networkx spring_layout (slower)")
            pos_raw = nx.spring_layout(G, seed=42, iterations=300)
            pos = {n: (float(p[0]), float(p[1])) for n, p in pos_raw.items()}

        # Col·loquem nodes orfes (degree 0) en una corona externa al voltant del component connectat.
        connected = [n for n in G.nodes() if G.degree(n) > 0]
        orphans = [n for n in G.nodes() if G.degree(n) == 0]
        if connected and orphans:
            xs = [pos[n][0] for n in connected]
            ys = [pos[n][1] for n in connected]
            cx = sum(xs) / len(xs)
            cy = sum(ys) / len(ys)
            half_w = (max(xs) - min(xs)) / 2 or 1.0
            half_h = (max(ys) - min(ys)) / 2 or 1.0
            base_r = max(half_w, half_h) * 1.4 + max(half_w, half_h) * 0.3
            ring_depth = base_r * 0.5
            import math, random
            rnd = random.Random(42)
            for i, node in enumerate(orphans):
                angle = (i / len(orphans)) * 2 * math.pi + (rnd.random() - 0.5) * 0.2
                r = base_r + rnd.random() * ring_depth
                pos[node] = (cx + math.cos(angle) * r, cy + math.sin(angle) * r)

        return pos

    def build_unified_graph(self) -> Dict[str, Any]:
        """
        Builds a unified graph including 4-layer structure and content nodes.
        Returns a Sigma.js compatible format.
        """
        now = time.time()
        if self._graph_cache and (now - self._last_graph_time < self._GRAPH_CACHE_TTL):
            log.info("Serving graph from cache")
            return self._graph_cache

        # 0. Load live config
        cfg = load_params(strict_env=False)
        self.registry = self._load_registry()
        
        graph_config = cfg.params.get("graph", {})
        self.visible_dbs = set(graph_config.get("visible_databases", []))
        self.visible_tables = set(graph_config.get("visible_tables", []))

        log.info(f"Building unified graph (Visible DBs: {self.visible_dbs}, Tables: {self.visible_tables})...")
        G = nx.Graph()

        # Registry nodes (database/table/view) are metadata-only — add them temporarily
        # so that _add_structural_edges can resolve parent IDs, then strip them before export.
        self._add_registry_nodes(G)

        # Cold start: carrega el node cache de disc per no rellegir milers de
        # fitxers després d'un reinici (la invalidació per mtime es manté).
        GraphService._load_node_cache()
        GraphService._load_layout_cache()
        page_nodes = self._add_page_nodes(G)
        GraphService._save_node_cache()
        self._add_contact_nodes(G)
        self._add_structural_edges(G, page_nodes)

        # Remove structural registry nodes: they are never rendered as content
        registry_nodes = [n for n, d in G.nodes(data=True) if d.get("kind") in ("database", "table", "view")]
        G.remove_nodes_from(registry_nodes)
        
        # 4. Generate Layout — calculat al backend amb igraph (Fruchterman-Reingold)
        # Caché per hash de l'estructura del graf (nodes + edges). Si no canvia, no recalcula.
        graph_hash = self._compute_graph_hash(G)
        if GraphService._LAYOUT_HASH == graph_hash and GraphService._LAYOUT_CACHE:
            log.info(f"Reusing cached layout (hash={graph_hash[:8]}, {len(G.nodes())} nodes)")
            pos = GraphService._LAYOUT_CACHE
        else:
            log.info(f"Computing new layout for {len(G.nodes())} nodes / {len(G.edges())} edges...")
            t0 = time.time()
            pos = self._compute_layout(G)
            log.info(f"Layout computed in {time.time() - t0:.2f}s")
            GraphService._LAYOUT_CACHE = pos
            GraphService._LAYOUT_HASH = graph_hash
            GraphService._save_layout_cache()

        nodes = []
        for node_id in G.nodes():
            attrs = G.nodes[node_id]
            meta = attrs.get("metadata", {}) or {}
            nodes.append({
                "id": node_id,
                "key": node_id,
                "label": attrs.get("label", node_id),
                "x": float(pos[node_id][0]),
                "y": float(pos[node_id][1]),
                "size": attrs.get("size", 10),
                "color": attrs.get("color", COLOR_PALETTE.get(attrs.get("kind"), COLOR_PALETTE["default"])),
                "kind": attrs.get("kind", "page"),
                "metadata": meta,
                # Atributs addicionals necessaris per la categorització al frontend (graphFilters.js)
                "path": attrs.get("path", ""),
                "table_id": attrs.get("table_id") or meta.get("table_id") or meta.get("database_table_id"),
                "database_id": attrs.get("database_id") or meta.get("database_id"),
            })
            
        edges = []
        for u, v in G.edges():
            edge_attrs = G.edges[u, v]
            edges.append({
                "id": f"e_{u}_{v}",
                "source": u,
                "target": v,
                "color": edge_attrs.get("color", "#cbd5e1"),
                "size": edge_attrs.get("size", 1),
                "dashed": edge_attrs.get("dashed", False),
                "kind": edge_attrs.get("kind", "structural"),
                "reason": edge_attrs.get("reason", "")
            })
            
        # Legend generation (Dynamic based on discovered kinds)
        legend_kinds = []
        kind_counts = {}
        kind_colors = {}
        
        for n in nodes:
            k = n.get("kind")
            if k:
                kind_counts[k] = kind_counts.get(k, 0) + 1
                if k not in kind_colors:
                    kind_colors[k] = n.get("color", COLOR_PALETTE.get(k, COLOR_PALETTE["default"]))
        
        for k, count in kind_counts.items():
            label = k.capitalize()
            legend_kinds.append({
                "label": label, 
                "color": kind_colors[k],
                "count": count
            })
        
        result = {
            "nodes": nodes,
            "edges": edges,
            "legend": {
                "kinds": legend_kinds
            }
        }
        
        GraphService._graph_cache = result
        GraphService._last_graph_time = time.time()  # temps DESPRÉS del build, no abans
        return result

    def _add_registry_nodes(self, G: nx.Graph):
        # Databases
        for db in self.registry.get("databases", []):
            db_id = db.get("id")
            if self.visible_dbs and db_id not in self.visible_dbs:
                continue
            G.add_node(db_id, 
                       label=db.get("name", "DB"), 
                       kind="database", 
                       color=COLOR_PALETTE["database"],
                       size=15,
                       metadata=db)
            
        # Tables
        for table in self.registry.get("tables", []):
            table_id = table.get("id")
            db_id = table.get("database_id")
            
            # Table is visible if:
            # 1. It's explicitly selected
            # 2. Its parent DB is selected
            # 3. No explicit selections exist at all
            is_explicit = self.visible_tables and table_id in self.visible_tables
            is_db_explicit = self.visible_dbs and db_id in self.visible_dbs
            
            if (self.visible_tables or self.visible_dbs):
                if not (is_explicit or is_db_explicit):
                    continue
            
                
            G.add_node(table_id, 
                       label=table.get("name", "Table"), 
                       kind="table", 
                       color=COLOR_PALETTE["table"],
                       size=12,
                       metadata=table)
            
        # Views
        for view in self.registry.get("views", []):
            view_id = view.get("id")
            table_id = view.get("table_id")
            
            if table_id not in G:
                continue
                
            G.add_node(view_id, 
                       label=view.get("name", "View"), 
                       kind="view", 
                       color=COLOR_PALETTE["view"],
                       size=11,
                       metadata=view)

    def _add_page_nodes(self, G: nx.Graph) -> List[Dict[str, Any]]:
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        page_nodes = []
        if not vault_path or not vault_path.exists():
            return []

        # Build folder→table_id lookup so BD page nodes get table_id even without frontmatter
        folder_to_table_id: dict = {}
        folder_to_db_id: dict = {}
        for t in self.registry.get("tables", []):
            folder = t.get("folder")
            if folder:
                folder_to_table_id[folder] = t["id"]
                folder_to_db_id[folder] = t.get("database_id", "")

        # Recursive scan for all .md files - EFFICIENT VERSION
        all_md_files = get_markdown_files_efficient(vault_path)
        
        for file_path in all_md_files:
            path_str = str(file_path.relative_to(vault_path))
            mtime = os.path.getmtime(file_path)
            
            # Use cached data if mtime hasn't changed
            cache_entry = GraphService._NODE_DATA_CACHE.get(path_str)
            if cache_entry and cache_entry.get("mtime") == mtime:
                metadata = cache_entry["metadata"]
                id_to_use = cache_entry["id"]
                title = cache_entry["title"]
                kind = cache_entry["kind"]
                color = cache_entry["color"]
                pass  # size llegit des de cache_entry["size"] al G.add_node
            else:
                # Cache miss - Read and parse file
                try:
                    raw_content = file_path.read_text(encoding="utf-8")
                    metadata, body = parse_frontmatter(raw_content, file_path)
                    
                    file_id = file_path.stem
                    id_to_use = metadata.get("id") or file_id
                    title = metadata.get("title") or file_id
                    
                    # Extract kind
                    app_cfg = cfg.get("app", {})
                    type_prop = app_cfg.get("type_property", "note_type")
                    raw_kind = metadata.get("note_type") or metadata.get(type_prop) or metadata.get("type") or "page"
                    
                    norm_kind = str(raw_kind)
                    kind = "page"
                    for pattern, kind_value in _KIND_PATTERNS:
                        if pattern.search(norm_kind):
                            kind = kind_value
                            break

                    # Fallback: detectar per ruta si el frontmatter no especifica el tipus
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

                    # PRE-EXTRACT WIKILINKS per secció (evita re-lectura al pas d'edges)
                    section_links = parse_section_links(raw_content)
                    # Flat list per compatibilitat backward
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
                    GraphService._NODE_DATA_CACHE[path_str] = cache_entry
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

            # Camps de relació → ids nets ('[[Títol|id]]' → id) segons l'ESQUEMA
            # de la taula. Les arestes es creen a _add_structural_edges; aquí es
            # neteja el metadata del node (sobre una còpia, mai el cache).
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
            
            # Update Global Index (ID -> Relative Path string)
            # This allows find_page_path to be O(1)
            GraphService._ID_TO_PATH_CACHE[id_to_use] = path_str
            
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
                
        return page_nodes

    def _add_contact_nodes(self, G: nx.Graph):
        """Afegeix contactes des de management.sqlite (BD local, NO el vault).

        El model Contact viu a management_db.Base (management.sqlite) — la
        mateixa BD que serveix /api/contacts via get_mgmt_db. Abans s'obria la
        BD del vault (get_engine_for_path), que NO té la taula 'contacts' →
        'no such table: contacts' i cap contacte al graf.
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

    def _add_media_nodes(self, G: nx.Graph) -> List[Dict[str, Any]]:
        """Scans Vault/Images for media nodes using MediaService."""
        from backend.services.media_service import MediaService
        service = MediaService()
        
        result = service.get_all_media(limit=500)
        media_list = result.get("items", [])
        media_nodes = []

        for media in media_list:
            # We only show media with tags or description by default to avoid clutter
            # unless a global setting says otherwise.
            if not media.get("tags") and not media.get("description"):
                continue
                
            media_id = f"media_{media['id']}"
            title = media.get("filename")
            
            # Metadata for sigma
            metadata = {
                "id": media["id"],
                "title": title,
                "kind": "media",
                "url": media.get("url"),
                "album": media.get("album"),
                "tags": media.get("tags", []),
                "description": media.get("description", ""),
                "created_time": media.get("date_taken") or media.get("last_modified")
            }
            
            G.add_node(media_id, 
                       label=title, 
                       kind="media", 
                       color=COLOR_PALETTE["media"],
                       size=10, # Slightly larger than pages
                       metadata=metadata,
                       url=media.get("url")) # Direct URL for frontend preview
            
            media_nodes.append({
                "id": media_id,
                "title": title,
                "tags": media.get("tags", []),
                "metadata": metadata
            })
            
        return media_nodes

    def _add_structural_edges(self, G: nx.Graph, page_nodes: List[Dict[str, Any]]):
        # 1. Frontmatter relation detection (Already loaded in node attributes).
        # Reconeix els camps de relació per l'ESQUEMA (type=relation, nom+àlies),
        # sigui quin sigui el nom de la columna. Vegeu vault_relation_inverse_sync.md
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
                G.add_edge(parent_id, node_id, kind="structural", color="#94a3b8", size=1)

            tid = metadata.get("table_id") or metadata.get("database_table_id")
            rel_keys = rel_keys_by_table.get(tid)
            # Scan for relation fields (per esquema)
            for key, value in metadata.items():
                if is_relation_key(key, rel_keys):
                    targets = value if isinstance(value, list) else [value]
                    for t in targets:
                        t_id = strip_item(t)  # `[[Títol|id]]` → id (o id tal qual)
                        if isinstance(t_id, str) and G.has_node(t_id):
                            G.add_edge(node_id, t_id, kind="relation", color="#6366f1", size=1.5)

        # 2. Wikipedia-style links from cached link data (NO NEW FILE READS!)
        # Títols genèrics de Notion que NO han de ser hubs (artefactes d'exportació)
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

        # Pre-build table_id → {heading: section_config} per classificar edges
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
                return target_key
            return label_to_id.get(target_lower) or stem_to_id.get(target_lower)

        for page in page_nodes:
            node_id = page["id"]
            table_id = page.get("table_id") or G.nodes[node_id].get("table_id")
            db_view_headings = table_sections_map.get(table_id, {}) if table_id else {}

            section_links = page.get("section_links") or {}

            # Processa primer les seccions db_view per garantir kind='relation' si hi ha conflicte
            ordered_headings = sorted(
                section_links.keys(),
                key=lambda h: (0 if h in db_view_headings else 1),
            )

            for heading in ordered_headings:
                links = section_links[heading]
                is_db_view = heading in db_view_headings

                for target_label in links:
                    resolved = resolve_link(target_label)
                    if not resolved or resolved == node_id or not G.has_node(resolved):
                        continue
                    if G.has_edge(node_id, resolved):
                        # Si ja existeix com a link simple però ara és db_view, promou-lo
                        if is_db_view and G.edges[node_id, resolved].get("kind") == "link":
                            G.edges[node_id, resolved]["kind"] = "relation"
                            G.edges[node_id, resolved]["color"] = "#6366f1"
                            G.edges[node_id, resolved]["size"] = 1.5
                        continue
                    if is_db_view:
                        G.add_edge(node_id, resolved, kind="relation", color="#6366f1", size=1.5)
                    else:
                        G.add_edge(node_id, resolved, kind="link", color="#10b981", size=1.2)

    
    def _add_suggestion_edges(self, G: nx.Graph):
        """Loads AI suggestions from suggestions.json in vault root."""
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            return
            
        suggestions_path = vault_path / "suggestions.json"
        
        if not suggestions_path.exists():
            return
            
        try:
            data = json.loads(suggestions_path.read_text(encoding="utf-8"))
            # Expected format: { "source_id": [ {"target_id": "...", "reason": "...", "score": 0.8}, ... ] }
            for source_id, suggestions in data.items():
                if not G.has_node(source_id): continue
                
                for sug in suggestions:
                    target_id = sug.get("target_id")
                    if target_id and G.has_node(target_id):
                        # Don't overwrite existing explicit links
                        if G.has_edge(source_id, target_id): continue
                        
                        G.add_edge(source_id, target_id, 
                                   kind="suggestion", 
                                   color="#FF4081", 
                                   size=1, 
                                   dashed=True,
                                   reason=sug.get("reason", "AI Suggested"))
        except Exception as e:
            log.error(f"Error loading AI suggestions: {e}")

    def _add_tag_inference_edges(self, G: nx.Graph, page_nodes: List[Dict[str, Any]]):
        """Adds edges between pages that share common tags, creating tag nodes."""
        tag_map = {}
        for page in page_nodes:
            tags_raw = page.get("tags") or []
            if isinstance(tags_raw, str):
                tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
            elif isinstance(tags_raw, list):
                tags = [str(t).strip() for t in tags_raw if t]
            else:
                tags = []
            
            for tag in tags:
                if not tag: continue
                if tag not in tag_map:
                    tag_map[tag] = []
                tag_map[tag].append(page["id"])
        
        for tag, pages in tag_map.items():
            if len(pages) < 2: continue 
            
            tag_node_id = f"tag_{tag}"
            if not G.has_node(tag_node_id):
                G.add_node(tag_node_id, label=f"#{tag}", kind="tag", color=COLOR_PALETTE["tag"], size=6)
            
            for p_id in pages:
                if G.has_node(p_id):
                    G.add_edge(tag_node_id, p_id, kind="tag_connection", color="#f59e0b", size=0.8, dashed=True)

    def accept_suggestion(self, source_id: str, target_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        """Accepts an AI suggestion. Currently disabled — SuggestionHandler
        module no és present en aquest build.

        Bug previ: el cos sencer estava dins una triple-comilla com a
        "docstring" → la funció retornava None i el caller crashejava
        amb TypeError quan feia `result["success"]`. Ara retorna un
        dict explícit perquè el caller mostri l'error 400 net.
        """
        _ = (source_id, target_id, reason)
        return {
            "success": False,
            "message": "SuggestionHandler module not available in this build",
            "updated_file": None,
            "new_relations": [],
        }


    def get_node_count(self) -> int:
        """
        Calculates the total number of 'memories' (Registry items + MD files + Media).
        Uses a short-lived class cache for performance.
        """
        now = time.time()
        if now - self._last_count_time < self._CACHE_TTL:
            return self._node_count_cache

        try:
            # 1. Registry items
            reg = self._load_registry()
            count = len(reg.get("databases", [])) + len(reg.get("tables", [])) + len(reg.get("views", []))

            # 2. Vault content (Pages + Media)
            # Use Cache if already populated and not stale
            if GraphService._NODE_DATA_CACHE:
                count += len(GraphService._NODE_DATA_CACHE)
                
                # Still need media count from disk or separate cache
                cfg = load_params(strict_env=False)
                vault_path = cfg.paths.get("VAULT")
                img_path = vault_path / "Images" if vault_path else None
                media_count = 0
                if img_path and img_path.exists():
                    try:
                        media_count = sum(1 for p in os.scandir(img_path) if p.is_file() and p.name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
                    except Exception as e:
                        log.debug(f"media scan (cached path) failed at {img_path}: {e}")
                count += media_count
            else:
                # Fallback to disk scan - EFFICIENT
                cfg = load_params(strict_env=False)
                vault_path = cfg.paths.get("VAULT")

                if vault_path and vault_path.exists():
                    all_md = get_markdown_files_efficient(vault_path)
                    md_count = len(all_md)

                    img_path = vault_path / "Images"
                    media_count = 0
                    if img_path.exists():
                        try:
                            media_count = sum(1 for p in os.scandir(img_path) if p.is_file() and p.name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
                        except Exception as e:
                            log.debug(f"media scan (fallback) failed at {img_path}: {e}")
                    count += md_count + media_count

            GraphService._node_count_cache = count
            GraphService._last_count_time = now
            return count
        except Exception as e:
            log.error(f"Error counting nodes: {e}")
            return GraphService._node_count_cache

# graph_service = GraphService()
