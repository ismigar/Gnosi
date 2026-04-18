import sys
from pathlib import Path
import logging
import os
import re
import uvicorn
import hashlib
import json
from datetime import datetime
from contextlib import asynccontextmanager

# Configure paths
BASE_DIR = Path(__file__).resolve().parents[1]  # monorepo/apps/gnosi
BACKEND_DIR = Path(__file__).resolve().parents[0]  # monorepo/apps/gnosi/backend

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config.app_config import load_params
from backend.config.logger_config import setup_logging
from backend.config.mcp_config import MCP_SERVERS
from backend.mcp.client import MultiServerMCPClient
from backend.agent.factory import create_agent_workflow

# Import routes
from backend.api import (
    agent_routes, system_routes, tools_routes,
    analytics_routes,
    scheduler_routes, social_routes,
    vault_routes, vault_graph_routes, calendar_routes, mail_routes,
    reader, google_auth_routes, integrations_routes, zotero_routes,
    config_routes, env_routes, credentials_routes, ai_routes,
    workspace_routes, contacts_routes
)
from backend.scheduler.manager import scheduler_manager

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    log.info("🚀 Starting Gnosi Agent (FastAPI Port)...")

    # 0. Start Scheduler
    scheduler_manager.start()

    # 1. Init MCP Client
    mcp_client = MultiServerMCPClient(MCP_SERVERS)
    try:
        await mcp_client.start()
        log.info("✅ MCP Client started.")
        app.state.mcp_client = mcp_client

        # 2. Discover Tools
        log.info("🔍 Discovering tools...")
        tools_list = await mcp_client.get_all_tools()
        log.info(f"🛠️ Found {len(tools_list)} tools.")
        app.state.tools_list = tools_list

        # 3. Build Agent Graph
        workflow, _ = await create_agent_workflow(
            tools_list,
            mcp_client,
            agent_id="gnosy",
        )
        if workflow:
            app.state.agent_workflow = workflow
            app.state.agent_app = workflow.compile()
            log.info("🧠 Agent Graph built and ready.")

    except Exception as e:
        log.error(f"❌ Error during startup: {e}")

    yield

    # SHUTDOWN
    log.info("🛑 Shutting down...")
    if hasattr(app.state, "mcp_client"):
        await app.state.mcp_client.stop()
        log.info("✅ MCP Client stopped.")

# Instance creation
app = FastAPI(title="Gnosi Agent", version="0.2.0", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────── Global Error Handler ────────────────
try:
    from pipeline.skills.notification_service.scripts.notification_service import notify as _notify_fn
except ImportError:
    _notify_fn = None

from fastapi import Request as _Request
from fastapi.responses import JSONResponse as _JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: _Request, exc: Exception):
    """Captura tots els errors 500 no controlats i els registra al sistema de logs."""
    import traceback
    route = f"{request.method} {request.url.path}"
    error_detail = str(exc)
    tb = traceback.format_exc()
    
    log.error(f"❌ Unhandled exception on {route}: {error_detail}\n{tb}")
    
    if _notify_fn:
        try:
            short_tb = tb.split('\n')[-3] if tb else error_detail
            _notify_fn(
                f"Error de l'Aplicació: {route}",
                f"{error_detail}\n\n{short_tb}",
                level="ERROR"
            )
        except Exception:
            pass  # No deixem que el handler de logs causi un altre error

    return _JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": error_detail}
    )

# --- Register Routers (Order matters!) ---

# Workspace Management (Must be first for middleware/context)
app.include_router(workspace_routes.router, tags=["Workspaces"])

# Core Features
app.include_router(agent_routes.router, prefix="/api")
app.include_router(system_routes.router, prefix="/api/system")
app.include_router(social_routes.router, prefix="/api/social", tags=["Social"])

# Vault and Graph
app.include_router(vault_routes.router, prefix="/api/vault", tags=["Vault"])
app.include_router(vault_graph_routes.router, prefix="/api", tags=["Vault Graph"])

# Components
app.include_router(calendar_routes.router, tags=["Calendar"])
app.include_router(mail_routes.router, tags=["Mail"])
app.include_router(reader.router, tags=["Reader"])
app.include_router(tools_routes.router, tags=["Tools"])
app.include_router(analytics_routes.router, tags=["Analytics"])
# app.include_router(sync_routes.router, tags=["Sync"])
app.include_router(scheduler_routes.router, tags=["Scheduler"])
app.include_router(contacts_routes.router, prefix="/api", tags=["Contacts"])

# Integrations and Config
app.include_router(google_auth_routes.router, tags=["Auth"])
app.include_router(integrations_routes.router, tags=["Integrations"])
app.include_router(zotero_routes.router, tags=["Zotero"])
app.include_router(config_routes.router, prefix="/api", tags=["Config"])
app.include_router(env_routes.router, prefix="/api", tags=["Env"])
app.include_router(credentials_routes.router, prefix="/api", tags=["Credentials"])
app.include_router(ai_routes.router, prefix="/api", tags=["AI Settings"])

@app.get("/api/health")
async def health_check():
    cfg = load_params(strict_env=False)
    return {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": cfg.gnosi_mode,
        "vault_configured": cfg.paths.get("VAULT") is not None,
    }

# Setup logging
setup_logging()

if __name__ == "__main__":
    cfg = load_params(strict_env=False)
    server_cfg = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
    HOST = server_cfg.get("host", "0.0.0.0")
    PORT = int(server_cfg.get("backend_port", 5002))
    uvicorn.run("backend.server:app", host=HOST, port=PORT, reload=True)
