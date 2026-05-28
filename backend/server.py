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
from fastapi.middleware.gzip import GZipMiddleware
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
    vault_routes, vault_graph_routes, vault_views_routes, calendar_routes, mail_routes,
    reader, google_auth_routes, integrations_routes,
    config_routes, env_routes, credentials_routes, ai_routes,
    workspace_routes, contacts_routes, identity_routes,
    microsoft_auth_routes,
)
from backend.scheduler.manager import scheduler_manager
from backend.models import * # Register all models for SQLAlchemy

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

    # 4. Warm up the vault page index. We do this in two phases:
    #    a) SYNC: load the persisted disk cache so the very first request
    #       already finds data in memory. Without this step, /pages returns
    #       [] during the few seconds the background indexer takes to load
    #       the 3.6 MB JSON, and the frontend then bursts ~4 retries with
    #       backoff (~12s of dead time before the sidebar populates).
    #    b) ASYNC: kickoff_index_warmup keeps doing its background refresh
    #       against the actual filesystem so external changes get picked up.
    #    Endpoint /api/vault/indexer-status lets the UI poll progress.
    try:
        from backend.api.vault_routes import (
            kickoff_index_warmup,
            kickoff_link_index_rebuild,
            preload_page_index_from_disk,
        )
        from backend.config.app_config import load_params
        cfg = load_params(strict_env=False)
        v_path = cfg.paths.get("VAULT")
        if v_path:
            loaded = preload_page_index_from_disk(Path(v_path))
            if loaded:
                log.info(f"⚡ Sync page-index preload completed for {v_path}")
            else:
                log.info(f"ℹ️ No disk page-index cache found for {v_path}")
            kickoff_index_warmup(v_path)
            log.info(f"🔥 Indexer warmup launched in background for {v_path}")
            # Trigger redundant del link-index rebuild: si l'indexer warmup
            # triga (OneDrive lent fent rglob), l'índex de wikilinks arrenca
            # igualment des d'aquí. kickoff_link_index_rebuild fa load-from-disk
            # primer (mil·lisegons) i després rebuild en background — així la
            # reescriptura automàtica de wikilinks al rename queda activa des
            # del primer instant.
            kickoff_link_index_rebuild()
            log.info("🔗 Link-index rebuild kickstarted at lifespan startup")
    except Exception as e:
        log.warning(f"⚠️ Could not launch indexer warmup: {e}")

    # 5. Repair invariant: every table in the registry must own at least
    #    one main view. Tables created before the auto-create logic landed
    #    (or whose only view was deleted before the delete-protection was
    #    added) can end up with zero views, leaving the table unrenderable.
    try:
        from backend.api.vault_routes import (
            load_registry,
            save_registry,
            _ensure_main_view,
        )
        registry = load_registry()
        repaired = []
        for tbl in registry.get("tables", []):
            tid = tbl.get("id")
            if not tid:
                continue
            created = _ensure_main_view(registry, tid)
            if created:
                repaired.append(tbl.get("name") or tid)
        if repaired:
            save_registry(registry)
            log.info(
                f"🛠️ Repaired {len(repaired)} table(s) without a main view: "
                f"{', '.join(repaired)}"
            )
    except Exception as e:
        log.warning(f"⚠️ Could not run main-view repair pass: {e}")

    # 6. IMAP IDLE workers per push real (notificacions de mail nou).
    #    Cada compte IMAP-eligible (inclou Google via XOAUTH2) llança un
    #    thread daemon que manté una connexió IDLE oberta a INBOX. Els
    #    events EXISTS/EXPUNGE/FETCH es publiquen a clients SSE
    #    (/api/mail/events).
    try:
        from backend.services.imap_idle_service import idle_manager
        idle_manager.start_all()
        log.info("📬 IMAP IDLE workers started.")
    except Exception as e:
        log.warning(f"⚠️ Could not start IMAP IDLE workers: {e}")

    yield

    # SHUTDOWN
    log.info("🛑 Shutting down...")
    try:
        from backend.services.imap_idle_service import idle_manager
        idle_manager.stop_all()
    except Exception:
        pass
    if hasattr(app.state, "mcp_client"):
        await app.state.mcp_client.stop()
        log.info("✅ MCP Client stopped.")

# Instance creation
app = FastAPI(title="Gnosi Agent", version="0.2.0", lifespan=lifespan)

# CORS — `allow_origins=["*"]` + `allow_credentials=True` és invàlid per
# spec (el navegador rebutja la resposta amb CORS error). Si en algun moment
# es necessiten cookies/credentials, cal posar origins explícits aquí.
# En personal mode no usem credentials cross-origin, així que és segur deixar
# wildcard amb credentials=False. CORS_ORIGINS env var permet un override
# explícit (separar amb comes) sense haver de redeploy.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] or ["*"]
_cors_credentials = bool(_cors_origins_env)  # només si l'usuari ha llistat origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip per a respostes grans (`/pages`, `/by-table`, `/global-index`).
# `minimum_size=1024` evita comprimir crides petites on l'overhead de
# compressió no compensa. Per a 300 PageInfo serialitzats (~100-300KB), la
# compressió típica és 8-12x, reduint el temps de transferència al
# frontend significativament en xarxes lentes.
app.add_middleware(GZipMiddleware, minimum_size=1024)

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

    # No retornem `error_detail` al client: pot contenir paths absoluts, fragments
    # de queries SQL, tokens. Tot ja està al log per debugging. El client només
    # rep un missatge genèric + un identificador per poder buscar al log si cal.
    error_id = hex(abs(hash((route, error_detail))) & 0xFFFFFFFF)[2:]
    log.error(f"   error_id={error_id}")
    return _JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_id": error_id},
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
app.include_router(vault_views_routes.router, prefix="/api", tags=["Vault Views"])

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
app.include_router(microsoft_auth_routes.router, tags=["Auth"])
app.include_router(integrations_routes.router, tags=["Integrations"])
app.include_router(config_routes.router, prefix="/api", tags=["Config"])
app.include_router(env_routes.router, prefix="/api", tags=["Env"])
app.include_router(credentials_routes.router, prefix="/api", tags=["Credentials"])
app.include_router(ai_routes.router, prefix="/api", tags=["AI Settings"])
app.include_router(identity_routes.router, tags=["Identity"])

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
