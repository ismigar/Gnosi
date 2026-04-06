import sys
from pathlib import Path
import logging
import os
import re

# Configure paths as in the old app.py
BASE_DIR = Path(__file__).resolve().parents[1]  # monorepo/apps/gnosi
BACKEND_DIR = Path(__file__).resolve().parents[0]  # monorepo/apps/gnosi/backend

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from backend.config.app_config import load_params
from backend.config.logger_config import setup_logging
import uvicorn

log = logging.getLogger(__name__)

# Import new and old routes (adapted)
# Import new and old routes (adapted)
from backend.api import agent_routes, system_routes, tools_routes
from backend.api import analytics_routes, sync_routes, scheduler_routes, social_routes
from backend.api import vault_routes, vault_graph_routes, calendar_routes, mail_routes
from backend.api import reader, google_auth_routes, integrations_routes, zotero_routes
from backend.api import config_routes, env_routes, credentials_routes, ai_routes

# Config
setup_logging()
cfg = load_params(strict_env=False)
server_cfg = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
HOST = server_cfg.get("host", "0.0.0.0")
PORT = int(server_cfg.get("backend_port", 5002))

from contextlib import asynccontextmanager
from backend.config.mcp_config import MCP_SERVERS
from backend.mcp.client import MultiServerMCPClient
from backend.agent.factory import create_agent_workflow

# Global variable to store the graph (or use app.state)
# But app.state is better.


@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    log.info("🚀 Starting Digital Brain Agent...")

    # 1. Init MCP Client
    mcp_client = MultiServerMCPClient(MCP_SERVERS)
    try:
        await mcp_client.start()
        log.info("✅ MCP Client started.")
        app.state.mcp_client = mcp_client

        # 2. Discover Tools
        log.info("🔍 Discovering tools...")
        tools_list = await mcp_client.get_all_tools()
        log.info(f"🛠️ Found {len(tools_list)} tools: {[t['name'] for t in tools_list]}")
        app.state.tools_list = tools_list

        # 3. Build Agent Graph
        # Utilitzem un ID per defecte per a l'arrencada
        workflow, _llm_selection = await create_agent_workflow(
            tools_list,
            mcp_client,
            agent_id="gnosy",
        )
        if workflow is None:
            raise RuntimeError("No LLM provider available for startup workflow")
        app.state.agent_workflow = workflow
        app.state.agent_app = workflow.compile()

        log.info("🧠 Agent Graph built and ready.")

    except Exception as e:
        log.error(f"❌ Error during startup: {e}")
        # We don't raise e to not block the whole server,
        # but the agent will not work.

    yield

    # SHUTDOWN
    log.info("🛑 Shutting down...")
    if hasattr(app.state, "mcp_client"):
        await app.state.mcp_client.stop()
        log.info("✅ MCP Client stopped.")


app = FastAPI(title="Digital Brain Agent", version="0.2.0", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routes
# Inject dependency if needed, but agent_bp can get it from request.app.state

# 4. Include Routers
app.include_router(agent_routes.router, prefix="/api")
app.include_router(system_routes.router, prefix="/api/system")
app.include_router(social_routes.router, prefix="/api/social", tags=["Social"])

# Vault and Graph
app.include_router(vault_routes.router, prefix="/api/vault", tags=["Vault"])
app.include_router(
    vault_graph_routes.router, prefix="/api/vault/graph", tags=["Vault Graph"]
)

# Components (Prefixes defined in files)
app.include_router(calendar_routes.router, tags=["Calendar"])
app.include_router(mail_routes.router, tags=["Mail"])
app.include_router(reader.router, tags=["Reader"])
app.include_router(tools_routes.router, tags=["Tools"])
app.include_router(analytics_routes.router, tags=["Analytics"])
app.include_router(sync_routes.router, tags=["Sync"])
app.include_router(scheduler_routes.router, tags=["Scheduler"])

# Integrations (Prefixes defined in files)
app.include_router(google_auth_routes.router, tags=["Auth"])
app.include_router(integrations_routes.router, tags=["Integrations"])
app.include_router(zotero_routes.router, tags=["Zotero"])
app.include_router(config_routes.router, prefix="/api", tags=["Config"])
app.include_router(env_routes.router, prefix="/api", tags=["Env"])
app.include_router(credentials_routes.router, prefix="/api", tags=["Credentials"])
app.include_router(ai_routes.router, prefix="/api", tags=["AI Settings"])

# TODO: Migrate old Flask routes. For now, if the user needs the graph,
# we can quickly implement the /api/graph route here directly to not break anything.
from fastapi.responses import JSONResponse, Response
import json
import hashlib
from datetime import datetime

# ──────── Graph Generation (Real-time from Vault) ────────

# Color palette for table-based nodes
_TABLE_COLORS = [
    "#4A90D9",
    "#E67E22",
    "#2ECC71",
    "#9B59B6",
    "#E74C3C",
    "#1ABC9C",
    "#F39C12",
    "#3498DB",
    "#8E44AD",
    "#27AE60",
    "#D35400",
    "#16A085",
    "#C0392B",
    "#2980B9",
    "#7D3C98",
]
_WIKI_COLOR = "#9C27B0"


def _build_graph_from_vault() -> dict:
    """Build a Sigma.js-compatible graph from local vault data."""
    from backend.api.vault_routes import _get_pages_snapshot

    pages = _get_pages_snapshot()

    # Load registry for table info and graph filters
    registry_path = cfg.paths.get("REGISTRY")
    table_map = {}
    table_color = {}
    metadata_filters = {}  # table_id -> [ {name, exposed, default_value} ]

    if registry_path and Path(registry_path).exists():
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                registry = json.load(f)
                for table in registry.get("tables", []):
                    tid = table["id"]
                    table_map[tid] = {
                        "name": table.get("name", table["id"]),
                        "database_id": table.get("database_id", ""),
                    }
                    # Assign a color if not present? (Optional, Sigma.js uses node color)
                    # We can use a hash of the table name for consistent colors if not specific

                    # Process graph filters
                    for prop in table.get("properties", []):
                        g_filter = prop.get("graph_filter")
                        if g_filter:
                            if tid not in metadata_filters:
                                metadata_filters[tid] = []
                            metadata_filters[tid].append(
                                {
                                    "name": prop["name"],
                                    "type": prop.get("type", "text"),
                                    "exposed": g_filter.get("exposed", True),
                                    "default_value": g_filter.get("default_value"),
                                }
                            )
        except Exception:
            log.exception("Error loading registry for graph colors/filters")

    # Assign colors to tables
    table_ids = sorted(table_map.keys())
    table_color = {
        tid: _TABLE_COLORS[i % len(_TABLE_COLORS)] for i, tid in enumerate(table_ids)
    }
    # Explicitly set Wiki color to purple
    table_color["__wiki__"] = _WIKI_COLOR


    nodes = []
    edges = []
    page_ids = set()
    kind_set = set()
    cluster_set = set()

    for page in pages:
        pid = page.id
        if not pid:
            continue

        # 1. Apply Implicit Filters (Metadata based filtering from registry)
        # If a property has a graph_filter with exposed=False and default_value,
        # we skip nodes that don't match the default_value.
        table_id = page.resolved_table_id
        if table_id and table_id in metadata_filters:
            skip_node = False
            for f_cfg in metadata_filters[table_id]:
                if not f_cfg["exposed"] and f_cfg["default_value"] is not None:
                    attr_name = f_cfg["name"]
                    # Metadata names in Markdown usually match the registry property name
                    val = page.metadata.get(attr_name)
                    if val is not None and val != f_cfg["default_value"]:
                        skip_node = True
                        break
            if skip_node:
                continue

        # Determine node type and visual properties

        page_ids.add(pid)

        table_id = page.resolved_table_id
        table_info = table_map.get(table_id)

        # Distribute nodes in a basic spiral for initial visibility
        import math
        angle = 0.1 * len(nodes)
        radius = 80 * math.sqrt(len(nodes))
        initial_x = radius * math.cos(angle)
        initial_y = radius * math.sin(angle)

        if table_info:
            kind = table_info["name"]
            database_id = table_info["database_id"]
            color = table_color.get(table_id, "#888888")
            cluster = table_info["name"]
            
            # Robust override for Wiki nodes (Clean v7)
            if kind.lower() == "wiki" or table_id == "wiki":
                kind = "Wiki"
                color = _WIKI_COLOR
                cluster = "Wiki"
                table_id = "__wiki__"

        else:
            # Fallback based on folder OR resolved table ID
            folder = (page.folder or "").lower()
            if folder.startswith("mail"):
                kind = "Mail"
                color = "#FF9900"
                cluster = "Email"
            elif folder.startswith("calendar"):
                kind = "Calendar"
                color = "#4285F4"
                cluster = "Calendar"
            elif folder and folder != "wiki" and folder != "cervell digital":
                # It's a record in a folder, but not a known table in registry
                kind = folder.split("/")[-1].title()
                color = "#888888"
                cluster = kind
            else:
                # True Wiki Page
                kind = "Wiki"
                color = _WIKI_COLOR
                cluster = "Wiki"

            # CRITICAL: Preserve the actual table ID if it exists, otherwise use folder-based ID
            # IMPORTANT: Use a definitive ID for Wiki pages to avoid confusion
            if not page.resolved_table_id:
                if kind == "Wiki":
                    table_id = "__wiki__"
                else:
                    table_id = f"__folder_{folder}__"
            else:
                table_id = page.resolved_table_id
                # Enforce Wiki ID consistency
                if kind == "Wiki":
                    table_id = "__wiki__"

                
            database_id = page.metadata.get("database_id") if page.metadata else None





        kind_set.add(kind)
        cluster_set.add(cluster)

        # Extract metadata fields for filtering
        metadata = {}
        if page.metadata and isinstance(page.metadata, dict):
            for k, v in page.metadata.items():
                if (
                    v is not None
                    and v != ""
                    and k.lower() not in ("id", "title", "type", "key")
                ):
                    # Ensure serializable
                    if isinstance(v, datetime):
                        metadata[k] = v.isoformat()
                    elif isinstance(v, (str, int, float, bool)):
                        metadata[k] = v
                    else:
                        metadata[k] = str(v)

        # Ensure created_time is a string
        created_time = page.last_modified
        if isinstance(created_time, datetime):
            created_time = created_time.isoformat()

        node = {
            **metadata,  # Top-level attributes for easy access
            "metadata": metadata, # Explicit metadata object for shared filters
            "key": pid,
            "label": page.title or "Untitled",
            "kind": kind,
            "cluster": cluster,
            "database_id": database_id,
            "table_id": table_id,
            "database_table_id": table_id,
            "color": color,
            "size": 5,
            "x": initial_x,
            "y": initial_y,
            "created_time": created_time,
        }
        nodes.append(node)


    # Build edges from parent-child relationships
    for page in pages:
        if page.parent_id and page.parent_id in page_ids and page.id in page_ids:
            edges.append(
                {
                    "key": f"{page.parent_id}--{page.id}",
                    "source": page.parent_id,
                    "target": page.id,
                    "kind": "explicit",
                    "label": "parent",
                }
            )

    # Auto-generate edges for Internal Links ([[Link]])
    title_to_id = {p.title.lower().strip(): p.id for p in pages if p.title}

    for page in pages:
        if not page.path or not page.path.endswith(".md"):
            continue

        try:
            # Only read first 10k chars for speed
            with open(page.path, "r", errors="ignore") as f:
                content = f.read(10000)

            # Regex for [[Title]] or [[Title|Alias]]
            links = re.findall(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", content)

            for link_ref in set(links):  # deduplicate per page
                link_title = link_ref.split('#')[0].lower().strip()
                target_id = title_to_id.get(link_title)
                if target_id and target_id in page_ids and target_id != page.id:
                    edges.append(
                        {
                            "key": f"link-{page.id}-{target_id}",
                            "source": page.id,
                            "target": target_id,
                            "kind": "wikilink",
                            "label": "links",
                            "color": "#A0A0A0",  # Soft gray for semantic links
                            "size": 1,
                        }
                    )
        except Exception:
            pass  # Keep it resilient

    # Auto-generate edges for Email threads (based on thread_id metadata)
    threads = {}
    for page in pages:
        tid = page.metadata.get("thread_id")
        if tid and page.id in page_ids:
            if tid not in threads:
                threads[tid] = []
            threads[tid].append(page.id)

    for tid, pids in threads.items():
        if len(pids) > 1:
            # Connect all messages in the thread to the first one (star topology)
            root_id = pids[0]
            for leaf_id in pids[1:]:
                edges.append(
                    {
                        "key": f"thread-{tid}-{root_id}-{leaf_id}",
                        "source": root_id,
                        "target": leaf_id,
                        "kind": "implicit",
                        "label": "thread",
                    }
                )

    # Build legend (As arrays of objects, as expected by frontend)
    kinds_count = {}
    for n in nodes:
        kinds_count[n["kind"]] = kinds_count.get(n["kind"], 0) + 1

    legend_kinds = []
    for kind_name in sorted(kind_set):
        # Find the color for this kind
        if kind_name == "Wiki Pages":
            color = _WIKI_COLOR
        elif kind_name == "Mail":
            color = "#FF9900"
        elif kind_name == "Calendar":
            color = "#4285F4"
        else:
            matching_tables = [
                tid for tid, info in table_map.items() if info["name"] == kind_name
            ]
            color = (
                table_color.get(matching_tables[0], "#888888")
                if matching_tables
                else "#888888"
            )

        legend_kinds.append(
            {"label": kind_name, "color": color, "count": kinds_count.get(kind_name, 0)}
        )

    legend_clusters = []
    clusters_count = {}
    for n in nodes:
        clusters_count[n["cluster"]] = clusters_count.get(n["cluster"], 0) + 1

    for cluster_name in sorted(cluster_set):
        # Find color from kind_name (cluster matches kind name usually)
        color = "#888888"
        if cluster_name == "Wiki":
            color = _WIKI_COLOR
        elif cluster_name == "Email":
            color = "#FF9900"
        elif cluster_name == "Calendari":
            color = "#4285F4"
        else:
            matching_tables = [
                tid for tid, info in table_map.items() if info["name"] == cluster_name
            ]
            if matching_tables:
                color = table_color.get(matching_tables[0], "#888888")

        legend_clusters.append(
            {
                "label": cluster_name,
                "color": color,
                "count": clusters_count.get(cluster_name, 0),
            }
        )

    log.info(f"🕸️ Generated dynamic graph: {len(nodes)} nodes, {len(edges)} edges")

    return {
        "nodes": nodes,
        "edges": edges,
        "legend": {
            "kinds": legend_kinds,
            "clusters": legend_clusters,
            "metadata_filters": metadata_filters,
        },
    }


@app.get("/api/graph")
async def get_graph():
    """Generate graph dynamically from local vault data (Obsidian-style)."""
    try:
        data = _build_graph_from_vault()
        graph_hash = hashlib.md5(json.dumps(data, sort_keys=True).encode()).hexdigest()
        return JSONResponse(content=data, headers={"X-Graph-Version": graph_hash})
    except Exception as e:
        log.exception("Error generating graph from vault")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/graph/version")
async def get_graph_version():
    """Returns a lightweight version hash of the graph."""
    try:
        data = _build_graph_from_vault()
        graph_hash = hashlib.md5(json.dumps(data, sort_keys=True).encode()).hexdigest()
        return {"version": graph_hash}
    except Exception:
        return {"version": "ERROR"}


@app.get("/api/health")
async def health_check():
    vault_path = cfg.paths.get("VAULT")
    return {
        "status": "ok",
        "mode": "FastAPI",
        "vault_configured": vault_path is not None,
    }


@app.get("/api/vault/status")
async def vault_status():
    vault_path = cfg.paths.get("VAULT")
    registry_path = cfg.paths.get("REGISTRY")

    if not vault_path:
        return {"status": "error", "message": "VAULT_PATH not configured in cfg.paths"}

    # Ensure it's a Path object
    v_path = Path(vault_path)
    r_path = Path(registry_path) if registry_path else None

    return {
        "status": "ok",
        "path": str(v_path),
        "exists": v_path.exists(),
        "registry_exists": r_path.exists() if r_path else False,
    }


# Mount Frontend (Static)
frontend_dist = BASE_DIR / "frontend/dist"
if frontend_dist.exists():
    pass
else:
    print(f"Warning: Frontend dist not found at {frontend_dist}")

if __name__ == "__main__":
    uvicorn.run("backend.server:app", host=HOST, port=PORT, reload=True)
