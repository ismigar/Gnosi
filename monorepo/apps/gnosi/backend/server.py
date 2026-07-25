import sys
from pathlib import Path
import asyncio
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

from fastapi import Depends, FastAPI, Request, BackgroundTasks
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
    reader, meeting_routes, google_auth_routes, integrations_routes,
    auth_routes,
    config_routes, env_routes, credentials_routes, ai_routes,
    workspace_routes, contacts_routes, identity_routes,
    microsoft_auth_routes,
    collab_routes,
    public_routes,
    share_routes,
    notion_routes,
    notion_oauth_routes,
    vaults_routes,
    handwriting_routes,
    planning_routes,
)
from backend.scheduler.manager import scheduler_manager
from backend.models import * # Register all models for SQLAlchemy

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    log.info("🚀 Starting Gnosi Agent (FastAPI Port)...")

    # 0. Fail fast if an exposed deployment is missing a real JWT secret.
    # Signing sessions with the public dev fallback would be an auth bypass.
    from backend.services.auth_service import assert_signing_secret_safe
    assert_signing_secret_safe()

    # 0b. Start Scheduler
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
            _load_body_cache_from_disk,
            _load_parsed_doc_cache_from_disk,
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
            # The warmup used to be commented out here because a macOS
            # File-Provider walk (OneDrive) returned EDEADLK en masse and wedged
            # the indexer. Disabling it unconditionally also punished Docker and
            # Linux self-hosts, which cannot hit that fault. The decision now
            # lives in `_index_warmup_enabled`, which skips the cloud-mount case
            # and runs everywhere else (override: GNOSI_INDEX_WARMUP).
            kickoff_index_warmup(v_path)
            # Load the persisted body + parsed-document caches. They live HERE
            # and not in kickoff_index_warmup precisely because that warmup is
            # disabled above — anything hooked in there never runs.
            #
            # For the body cache this was not merely a lost optimisation: the
            # save writes whatever is in memory, so starting empty every boot
            # meant each flush OVERWROTE the persisted cache with the handful of
            # files read so far. Observed decay 34798 -> 18 entries (5.4MB ->
            # 7.3KB). Loading first makes the save additive again.
            try:
                _load_body_cache_from_disk()
            except Exception as e:
                log.warning(f"body-cache load skipped: {e}")
            try:
                _load_parsed_doc_cache_from_disk()
            except Exception as e:
                log.warning(f"parsed-doc-cache load skipped: {e}")
            # Redundant trigger for the link-index rebuild: if the warmup indexer
            # is slow (OneDrive being slow doing rglob), the wikilinks index starts
            # anyway from here. kickoff_link_index_rebuild does a load-from-disk
            # first (milliseconds) and then rebuilds in the background — this way the
            # automatic wikilink rewriting on rename stays active from
            # from the first instant.
            kickoff_link_index_rebuild()
            log.info("🔗 Link-index rebuild kickstarted at lifespan startup")
            # Proactively materialize the vault's CRITICAL online-only files
            # (BD/ registry + .gnosi/page_meta/) so the first request burst
            # doesn't block on OneDrive on-access downloads and starve the
            # request threadpool (symptom: /api/vaults -> "timeout of 30000ms
            # exceeded" while OneDrive is cold). In-process version of the
            # one-off rehydrate_vault.py incident script. Best-effort, non-blocking.
            # Disabled during the EDEADLK incident, when direct file access to
            # the OneDrive mount deadlocked. It needs no runtime gate of its
            # own: the scan is stat-only (`st_blocks == 0`, which does not
            # trigger an on-access download), and materialization goes through
            # `files_provider`, whose `_default_warmup_mode` already picks the
            # per-runtime path — "open" (LaunchServices) natively on macOS,
            # which is precisely what avoids the deadlock, and "daemon"
            # elsewhere. Best-effort and non-blocking: failures are per-file and
            # the per-request `_materialize_if_online_only` remains the net.
            from backend.services.vault_warmup import kickoff_critical_warmup
            kickoff_critical_warmup(v_path)
            log.info(f"☁️ Critical-vault warmup kicked off for {v_path}")
    except Exception as e:
        log.warning(f"⚠️ Could not launch indexer warmup: {e}")

    # 5. Connects the plugins v2 system (event bus → sandbox of
    #    data). Idempotent; if it fails, the data plugins remain inert but
    #    the rest of the backend starts normally.
    try:
        from backend.services.plugin_dispatcher import wire as wire_plugins
        wire_plugins()
        log.info("🧩 Plugin system connected")
    except Exception as e:
        log.warning("⚠️ Could not connect the plugin system: %s", e)

    # 4b. Index of Vault file/folder names for the picker search
    #     ("Select file or folder"). The host_open_helper (Spotlight) does not
    #     reliably see ~/Library/CloudStorage (OneDrive); this index,
    #     built in the background from the container's /vault mount, makes the
    #     search fast and reliable independent of the helper. See
    #     services/vault_file_index.py.
    try:
        from backend.services.vault_file_index import kickoff_file_index_rebuild
        kickoff_file_index_rebuild()
    except Exception as e:
        log.warning(f"⚠️ Could not launch vault file-index: {e}")

    # 5. Repair invariant: every table in the registry must own at least
    #    one main view. Tables created before the auto-create logic landed
    #    (or whose only view was deleted before the delete-protection was
    #    added) can end up with zero views, leaving the table unrenderable.
    try:
        from backend.api.vault_routes import (
            load_registry,
            save_registry,
            registry_mutation,
            _ensure_main_view,
        )
        # Entire load→modify→save cycle under lock: even though it runs at startup,
        # the IMAP IDLE workers / indexers that follow can now touch the registry.
        with registry_mutation():
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

    # 6. IMAP IDLE workers for real push (new mail notifications).
    #    Each IMAP-eligible account (including Google via XOAUTH2) launches a
    #    daemon thread that keeps an IDLE connection open on INBOX. The
    #    EXISTS/EXPUNGE/FETCH events are published to SSE clients
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
        # Timeout: if the MCP client stop hangs (servers not responding),
        # it does not block the worker's shutdown (and with it the --reload reload).
        try:
            await asyncio.wait_for(app.state.mcp_client.stop(), timeout=5)
            log.info("✅ MCP Client stopped.")
        except Exception as e:
            log.warning(f"⚠️ MCP Client stop timed out/failed: {e}")

# Instance creation
# `dependencies=` applies to EVERY route, so the default is "authentication
# required" and exceptions have to be written down in auth_public_surface.
# While GNOSI_REQUIRE_AUTH is off this is a no-op.
from backend.services.auth_public_surface import enforce_authentication  # noqa: E402
from backend.services.auth_service import require_auth_enabled  # noqa: E402

app = FastAPI(
    title="Gnosi Agent",
    version="0.2.0",
    lifespan=lifespan,
    dependencies=[Depends(enforce_authentication)],
)

# CORS — the default is every loopback origin, and nothing else.
#
# It used to be `allow_origins=["*"]`, which combined with an API that served
# unauthenticated requests meant ANY page the user had open could read the whole
# vault: `fetch('http://localhost:5002/api/vault/pages')` from an arbitrary site
# got a 200, and the wildcard then authorised that site's JavaScript to read the
# body. Binding to loopback does not help — the browser is already inside.
#
# A regex rather than a fixed list because the local origin legitimately varies:
# the Vite dev server picks a port, `vite preview` picks another, and the Word
# add-in webview arrives from its own. All of them are this machine; a remote
# page is not, and that is the whole distinction being drawn.
#
# Credentials stay OFF unless origins are listed explicitly, which is the rule
# that was already here. Nothing legitimate needs them cross-origin: the
# frontend reaches `/api` through the Vite proxy (same-origin), and the
# non-browser clients authenticate with a PAT in an `Authorization` header,
# which is not an ambient credential and rides no cookie. Allowing them would
# let another page served from this machine — a different local dev server —
# make requests carrying the session cookie AND read the answers, since
# `SameSite=Lax` does not separate two ports of the same host.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
_LOOPBACK_ORIGIN_RE = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=None if _cors_origins else _LOOPBACK_ORIGIN_RE,
    allow_credentials=bool(_cors_origins_env),
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip for large responses (`/pages`, `/by-table`, `/global-index`).
# `minimum_size=1024` avoids compressing small calls where the overhead of
# compression isn't worth it. For 300 serialized PageInfo (~100-300KB), the
# typical compression is 8-12x, reducing transfer time to
# the frontend significantly faster on slow networks.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Multi-vault: sets the ACTIVE vault from X-Vault-Id in a context that propagates to the endpoints
# (a synchronous dependency couldn't achieve this). See services/active_vault_middleware.py.
from backend.services.active_vault_middleware import ActiveVaultMiddleware
app.add_middleware(ActiveVaultMiddleware)

# ──────────────── Global Error Handler ────────────────
try:
    from pipeline.skills.notification_service.scripts.notification_service import notify as _notify_fn
except ImportError:
    _notify_fn = None

from fastapi import Request as _Request
from fastapi.responses import JSONResponse as _JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: _Request, exc: Exception):
    """Captures all uncontrolled 500 errors and logs them to the logging system."""
    import traceback
    route = f"{request.method} {request.url.path}"
    error_detail = str(exc)
    tb = traceback.format_exc()

    log.error(f"❌ Unhandled exception on {route}: {error_detail}\n{tb}")

    if _notify_fn:
        try:
            short_tb = tb.split('\n')[-3] if tb else error_detail
            _notify_fn(
                f"Application error: {route}",
                f"{error_detail}\n\n{short_tb}",
                level="ERROR"
            )
        except Exception:
            pass  # We don't let the logging handler cause another error

    # We do not return `error_detail` to the client: it may contain absolute paths, fragments
    # of SQL queries, tokens. Everything is already in the log for debugging. The client only
    # receives a generic message + an identifier so it can be searched in the log if needed.
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
app.include_router(planning_routes.router, prefix="/api", tags=["Project Planning"])
app.include_router(handwriting_routes.router, tags=["Handwriting"])
app.include_router(vault_graph_routes.router, prefix="/api", tags=["Vault Graph"])
app.include_router(vault_views_routes.router, prefix="/api", tags=["Vault Views"])

# Real-time collaboration (WebSocket: presence + per-page relay)
app.include_router(collab_routes.router, prefix="/api/vault", tags=["Collaboration"])
# Share links: authenticated endpoints under /api/vault/*, public read at /api/share/{token}
app.include_router(share_routes.router, prefix="/api", tags=["Share"])

# Components
app.include_router(calendar_routes.router, tags=["Calendar"])
app.include_router(mail_routes.router, tags=["Mail"])
app.include_router(reader.router, tags=["Reader"])
app.include_router(meeting_routes.router, tags=["Meetings"])
app.include_router(tools_routes.router, tags=["Tools"])
app.include_router(analytics_routes.router, tags=["Analytics"])
# app.include_router(sync_routes.router, tags=["Sync"])
app.include_router(scheduler_routes.router, tags=["Scheduler"])
app.include_router(contacts_routes.router, prefix="/api", tags=["Contacts"])
app.include_router(public_routes.router, prefix="/api", tags=["Public API / PAT"])

# Integrations and Config
app.include_router(google_auth_routes.router, tags=["Auth"])
app.include_router(microsoft_auth_routes.router, tags=["Auth"])
app.include_router(integrations_routes.router, tags=["Integrations"])
app.include_router(auth_routes.router, tags=["Auth"])
app.include_router(config_routes.router, prefix="/api", tags=["Config"])
app.include_router(env_routes.router, prefix="/api", tags=["Env"])
app.include_router(credentials_routes.router, prefix="/api", tags=["Credentials"])
app.include_router(ai_routes.router, prefix="/api", tags=["AI Settings"])
app.include_router(notion_routes.router, prefix="/api", tags=["Notion Import"])
app.include_router(notion_oauth_routes.router, prefix="/api", tags=["Notion MCP OAuth"])
app.include_router(vaults_routes.router, prefix="/api", tags=["Vaults"])
app.include_router(identity_routes.router, tags=["Identity"])

@app.get("/api/health")
async def health_check():
    cfg = load_params(strict_env=False)
    return {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": cfg.gnosi_mode,
        # The frontend gates the login screen on this (App.jsx). It reports the
        # EFFECTIVE policy, not the env var: on a local single-user install the
        # answer is False and the app opens without a login screen, and it flips
        # to True on its own once the install stops being one — a second
        # account, org mode, or a Docker deployment.
        "require_auth": require_auth_enabled(),
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
