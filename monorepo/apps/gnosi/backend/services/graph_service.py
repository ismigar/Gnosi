import os
import json
import yaml
import re
import uuid
import logging
import networkx as nx
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
from backend.config.app_config import load_params

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
            return metadata, body
        except Exception as e:
            location = f" in {file_path}" if file_path else ""
            # debug level to avoid log spam if some pages have bad frontmatter
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content

class GraphService:
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

    def build_unified_graph(self) -> Dict[str, Any]:
        """
        Builds a unified graph including 4-layer structure and content nodes.
        Returns a Sigma.js compatible format.
        """
        # 0. Load live config
        cfg = load_params(strict_env=False)
        self.registry = self._load_registry()
        
        graph_config = cfg.params.get("graph", {})
        self.visible_dbs = set(graph_config.get("visible_databases", []))
        self.visible_tables = set(graph_config.get("visible_tables", []))

        log.info(f"Building unified graph (Visible DBs: {self.visible_dbs}, Tables: {self.visible_tables})...")
        G = nx.Graph()
        
        # 1. Add Registry Nodes (Databases, Tables, Views)
        self._add_registry_nodes(G)
        
        # 2. Add Page Nodes (Markdown files in Vault - Recursive)
        page_nodes = self._add_page_nodes(G)
        
        # 2.b Add Media Nodes (Images in Vault/Images)
        media_nodes = self._add_media_nodes(G)
        
        # 3. Add Structural Edges (Hierarchy & Frontmatter Links)
        self._add_structural_edges(G)
        
        # 4. Add AI Suggestion Edges (from suggestions.json)
        self._add_suggestion_edges(G)

        # 5. Add Tag Inference Edges (Tag Overlap)
        self._add_tag_inference_edges(G, page_nodes + media_nodes)
        
        # 6. Generate Layout (Simple Spring Layout for now)
        pos = nx.spring_layout(G, k=0.5, iterations=50)
        
        nodes = []
        for node_id in G.nodes():
            attrs = G.nodes[node_id]
            nodes.append({
                "id": node_id,
                "key": node_id,
                "label": attrs.get("label", node_id),
                "x": pos[node_id][0] * 1000,
                "y": pos[node_id][1] * 1000,
                "size": attrs.get("size", 10),
                "color": attrs.get("color", COLOR_PALETTE["default"]),
                "kind": attrs.get("kind", "page"),
                "metadata": attrs.get("metadata", {})
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
        
        return {
            "nodes": nodes,
            "edges": edges,
            "legend": {
                "kinds": legend_kinds
            }
        }

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
            
            if self.visible_dbs and db_id not in self.visible_dbs:
                continue
                
            if self.visible_tables and table_id not in self.visible_tables:
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
            
        # Recursive scan for all .md files
        for file_path in vault_path.rglob("*.md"):
            # Skip templates or hidden folders
            if "Plantilles" in file_path.parts or file_path.name.startswith("."):
                continue

            file_id = file_path.stem
            # We accept both UUID and non-UUID filenames now for real-time flexibility
            # but we prioritize ID from frontmatter if present.
                
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                metadata, body = parse_frontmatter(raw_content, file_path)
                
                # Use canonical gnosi id (frontmatter id) or filename as primary ID
                id_to_use = metadata.get("id") or file_id
                title = metadata.get("title") or file_id
                
                # Extract kind/note_type
                type_prop = cfg.app.get("type_property", "note_type")
                raw_kind = metadata.get("note_type") or metadata.get(type_prop) or metadata.get("type") or "page"
                
                # Normalize to map with colors
                norm_kind = str(raw_kind).lower()
                if "reading" in norm_kind or "lectura" in norm_kind: kind = "reading"
                elif "permanent" in norm_kind: kind = "permanent"
                elif "index" in norm_kind or "índex" in norm_kind: kind = "index"
                elif "journal" in norm_kind or "diari" in norm_kind or "bitàcora" in norm_kind: kind = "journal"
                elif "dialogue" in norm_kind or "diàleg" in norm_kind or "dialogo" in norm_kind: kind = "dialogue"
                elif "draft" in norm_kind or "esborrany" in norm_kind: kind = "page"
                else: kind = "page"

                # Get color from configuration
                node_colors = cfg.colors.get("node_types", {})
                color_cfg = node_colors.get(kind, node_colors.get("default", {}))
                color = color_cfg.get("bg", COLOR_PALETTE.get(kind, COLOR_PALETTE["page"]))

                # Check for special status based color override
                status = metadata.get("estat") or metadata.get("status") or ""
                status = str(status).lower()
                if "idea" in status: color = "#fcd34d"
                
                # Metadata might contain 📀 fields for links
                G.add_node(id_to_use, 
                           label=title, 
                           kind=kind, 
                           color=color,
                           size=8 + min(len(body) // 1000, 10),
                           metadata=metadata,
                           path=str(file_path.relative_to(vault_path)))
                
                page_nodes.append({
                    "id": id_to_use,
                    "title": title,
                    "tags": metadata.get("tags", []),
                    "metadata": metadata,
                    "path": file_path
                })
            except Exception as e:
                log.error(f"Error processing node {file_id}: {e}")
                
        return page_nodes

    def _add_media_nodes(self, G: nx.Graph) -> List[Dict[str, Any]]:
        """Scans Vault/Images for media nodes using MediaService."""
        from backend.services.media_service import MediaService
        service = MediaService()
        
        media_list = service.get_all_media()
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

    def _add_structural_edges(self, G: nx.Graph):
        # ... (Registry edges already added)
                
        # 2. Folder-based edges (Fall-back hierarchy)
        # 3. Frontmatter 📀 Link detection
        for node_id, attrs in G.nodes(data=True):
            if attrs.get("kind") in ["database", "table", "view"]:
                continue
                
            metadata = attrs.get("metadata", {})
            
            # Explicit notion parent
            parent_id = metadata.get("parent_id")
            if parent_id and G.has_node(parent_id):
                G.add_edge(parent_id, node_id, kind="structural", color="#94a3b8", size=1)
                
            # Scan for 📀 fields (Relations)
            for key, value in metadata.items():
                if "📀" in key:
                    targets = value if isinstance(value, list) else [value]
                    for t_id in targets:
                        if isinstance(t_id, str) and G.has_node(t_id):
                            G.add_edge(node_id, t_id, kind="relation", color="#6366f1", size=1.5)

        # 4. Wikipedia-style links [[Link]] from body
        cfg = load_params(strict_env=False)
        vault_path = cfg.paths.get("VAULT")
        if not vault_path:
            log.warning("VAULT path missing. Skipping wiki-link scanning.")
            return

        for node_id, attrs in G.nodes(data=True):
            if "path" not in attrs: continue
            
            file_path = vault_path / attrs["path"]
            if not file_path.exists(): continue
            try:
                content = file_path.read_text(encoding="utf-8")
                # Extract [[WikiLinks]]
                wiki_links = re.findall(r'\[\[(.*?)\]\]', content)
                for target_label in wiki_links:
                    target_ref = target_label.split('|')[0]
                    target_key = target_ref.split('#')[0].strip()
                    if G.has_node(target_key):
                        G.add_edge(node_id, target_key, kind="link", color="#10b981", size=1.2)
                    else:
                        # Match by title
                        for n_id, n_attrs in G.nodes(data=True):
                            if str(n_attrs.get("label") or "").strip() == target_key:
                                G.add_edge(node_id, n_id, kind="link", color="#10b981", size=1.2)
                                break
                
                # Extract markdown links [text](id)
                md_links = re.findall(r'\[.*?\]\((.*?)\)', content)
                for target_ref in md_links:
                    target_key = target_ref.split('#')[0].strip()
                    if G.has_node(target_key):
                        G.add_edge(node_id, target_key, kind="link", color="#10b981", size=1.2)
            except Exception:
                pass

    
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
        """
        # DISABLED: SuggestionHandler missing
        return {
            "success": False,
            "message": "SuggestionHandler module missing in this build",
            "updated_file": None,
            "new_relations": []
        }
        """
        
        # Original logic commented out
        # try:
        #     relation_key = cfg.params.get("graph", {}).get("relation_key", "📀 Connexions")
        #     handler = SuggestionHandler(vault_path, relation_key=relation_key, dry_run=False)
        #     result = handler.accept_suggestion(source_id, target_id, reason=reason, auto_backup=True)
        #     ...


# graph_service = GraphService()

