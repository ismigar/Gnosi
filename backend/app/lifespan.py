"""Application startup, maintenance and shutdown lifecycle."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from backend.agent.factory import create_agent_workflow
from backend.api import vault_routes
from backend.config.app_config import load_params
from backend.config.mcp_config import MCP_SERVERS
from backend.mcp.client import MultiServerMCPClient
from backend.scheduler.manager import scheduler_manager


log = logging.getLogger(__name__)


def _registered_vault_paths() -> set[Path]:
    """Return default and workspace-registered Vault paths for maintenance."""
    paths: set[Path] = set()
    default_vault = load_params(strict_env=False).paths.get("VAULT")
    if default_vault:
        paths.add(Path(default_vault).resolve())

    from backend.data.management_db import get_mgmt_session
    from backend.models.management import Vault

    database = None
    try:
        database = get_mgmt_session()
        query = database.query(Vault.path_override).filter(Vault.path_override.isnot(None))
        for (value,) in query:
            if str(value or "").strip():
                paths.add(Path(value).resolve())
    except Exception as error:
        log.warning("Could not list registered Vaults for maintenance: %s", error)
    finally:
        if database is not None:
            database.close()
    return paths


async def _confirmation_maintenance_loop() -> None:
    """Enforce bounded agent-state retention without user traffic."""
    from backend.agent.action_confirmations import maintain_confirmation_store
    from backend.api.vault_routes import cleanup_pending_table_asset_quarantines
    from backend.services.agent_stream_journal import cleanup as cleanup_agent_streams

    while True:
        try:
            await asyncio.to_thread(maintain_confirmation_store)
            await asyncio.to_thread(cleanup_agent_streams)
            vault_paths = await asyncio.to_thread(_registered_vault_paths)
            for vault_path in vault_paths:
                await asyncio.to_thread(
                    cleanup_pending_table_asset_quarantines,
                    vault_path,
                )
        except Exception as error:
            log.warning("Could not maintain agent action state: %s", error)
        await asyncio.sleep(10 * 60)


def _reconcile_plugin_contributions(
    plugin_state: dict[str, Any],
    *,
    ai_platform_enabled: bool,
) -> None:
    """Reconcile built-in and third-party AI contributions without blocking startup."""
    try:
        from backend.services.llm_wiki_agent import transition_agent
        from backend.services.plugin_ai_contributions import (
            reconcile_plugin_ai_contributions,
        )

        if ai_platform_enabled and vault_routes._llm_wiki_enabled(plugin_state):
            transition_agent(True)
        reconcile_plugin_ai_contributions()
    except Exception as error:
        log.warning("Could not reconcile plugin AI contributions: %s", error)


async def _start_agent_runtime(
    app: FastAPI,
    mcp_client: MultiServerMCPClient,
    *,
    enabled: bool,
) -> None:
    """Start MCP discovery and compile the default agent workflow when enabled."""
    if not enabled:
        app.state.tools_list = []
        log.info("AI platform plugin is disabled; MCP and agent startup are paused.")
        return
    try:
        await mcp_client.start()
        log.info("✅ MCP Client started.")
        app.state.mcp_client = mcp_client

        log.info("🔍 Discovering tools...")
        tools_list = await mcp_client.get_all_tools()
        log.info("🛠️ Found %s tools.", len(tools_list))
        app.state.tools_list = tools_list

        workflow, _ = await create_agent_workflow(
            tools_list,
            mcp_client,
            agent_id="gnosy",
        )
        if workflow:
            app.state.agent_workflow = workflow
            app.state.agent_app = workflow.compile()
            log.info("🧠 Agent Graph built and ready.")
    except Exception as error:
        log.error("❌ Error during startup: %s", error)


def _warm_vault_indexes() -> None:
    """Load persisted Vault indexes and start safe asynchronous refreshes."""
    try:
        from backend.api.vault_routes import (
            _load_body_cache_from_disk,
            _load_parsed_doc_cache_from_disk,
            kickoff_index_warmup,
            kickoff_link_index_rebuild,
            preload_page_index_from_disk,
        )
        from backend.config.app_config import load_params as load_current_params

        vault_path = load_current_params(strict_env=False).paths.get("VAULT")
        if not vault_path:
            return
        loaded = preload_page_index_from_disk(Path(vault_path))
        if loaded:
            log.info("⚡ Sync page-index preload completed for %s", vault_path)
        else:
            log.info("ℹ️ No disk page-index cache found for %s", vault_path)
        kickoff_index_warmup(vault_path)
        _load_persistent_document_caches(
            _load_body_cache_from_disk,
            _load_parsed_doc_cache_from_disk,
        )
        kickoff_link_index_rebuild()
        log.info("🔗 Link-index rebuild kickstarted at lifespan startup")

        from backend.services.vault_warmup import kickoff_critical_warmup

        kickoff_critical_warmup(str(vault_path))
        log.info("☁️ Critical-vault warmup kicked off for %s", vault_path)
    except Exception as error:
        log.warning("⚠️ Could not launch indexer warmup: %s", error)


def _load_persistent_document_caches(
    load_body_cache: Any,
    load_parsed_cache: Any,
) -> None:
    """Load independent caches without allowing one failure to hide the other."""
    try:
        load_body_cache()
    except Exception as error:
        log.warning("body-cache load skipped: %s", error)
    try:
        load_parsed_cache()
    except Exception as error:
        log.warning("parsed-doc-cache load skipped: %s", error)


def _wire_plugin_system() -> None:
    """Connect the plugin event bus while leaving failures non-fatal."""
    try:
        from backend.services.plugin_dispatcher import wire

        wire()
        log.info("🧩 Plugin system connected")
    except Exception as error:
        log.warning("⚠️ Could not connect the plugin system: %s", error)


def _start_file_index() -> None:
    """Start the independent Vault filename index."""
    try:
        from backend.services.vault_file_index import kickoff_file_index_rebuild

        kickoff_file_index_rebuild()
    except Exception as error:
        log.warning("⚠️ Could not launch vault file-index: %s", error)


def _repair_main_views() -> None:
    """Ensure every registered table has a main view under one mutation lock."""
    try:
        from backend.api.vault_routes import (
            _ensure_main_view,
            load_registry,
            registry_mutation,
            save_registry,
        )

        with registry_mutation():
            registry = load_registry()
            repaired: list[str] = []
            for table in registry.get("tables", []):
                table_id = table.get("id")
                if not table_id:
                    continue
                if _ensure_main_view(registry, table_id):
                    repaired.append(str(table.get("name") or table_id))
            if repaired:
                save_registry(registry)
                log.info(
                    "🛠️ Repaired %s table(s) without a main view: %s",
                    len(repaired),
                    ", ".join(repaired),
                )
    except Exception as error:
        log.warning("⚠️ Could not run main-view repair pass: %s", error)


def _start_mail_idle(*, enabled: bool) -> None:
    """Start IMAP IDLE workers only while the mail plugin is enabled."""
    if not enabled:
        return
    try:
        from backend.services.imap_idle_service import idle_manager

        idle_manager.start_all()
        log.info("📬 IMAP IDLE workers started.")
    except Exception as error:
        log.warning("⚠️ Could not start IMAP IDLE workers: %s", error)


async def _shutdown_runtime(
    app: FastAPI,
    confirmation_maintenance_task: asyncio.Task[None],
) -> None:
    """Stop workers and MCP without allowing one shutdown path to hang reload."""
    from backend.services.durable_job_worker import durable_job_worker

    log.info("🛑 Shutting down...")
    durable_job_worker.stop()
    confirmation_maintenance_task.cancel()
    with suppress(asyncio.CancelledError):
        await confirmation_maintenance_task
    try:
        from backend.services.imap_idle_service import idle_manager

        idle_manager.stop_all()
    except Exception:
        pass
    if not hasattr(app.state, "mcp_client"):
        return
    try:
        await asyncio.wait_for(app.state.mcp_client.stop(), timeout=5)
        log.info("✅ MCP Client stopped.")
    except Exception as error:
        log.warning("⚠️ MCP Client stop timed out/failed: %s", error)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Bring Gnosi runtime services up and down in a deterministic order."""
    log.info("🚀 Starting Gnosi Agent (FastAPI Port)...")

    from backend.config.data_dir import resolve_data_dir
    from backend.migrations.coordinator import migrate_existing_databases
    from backend.services.auth_service import assert_signing_secret_safe
    from backend.services.durable_job_worker import durable_job_worker

    migrated_databases = migrate_existing_databases(resolve_data_dir())
    log.info("Database schema verification complete (%s stores).", len(migrated_databases))
    assert_signing_secret_safe()

    scheduler_manager.start()
    durable_job_worker.start()
    confirmation_task = asyncio.create_task(_confirmation_maintenance_loop())

    plugin_state = vault_routes._load_plugins_state()
    ai_enabled = vault_routes.builtin_plugins.is_enabled(plugin_state, "ai-platform")
    mail_enabled = vault_routes.builtin_plugins.is_enabled(plugin_state, "mail")
    _reconcile_plugin_contributions(plugin_state, ai_platform_enabled=ai_enabled)

    mcp_client = MultiServerMCPClient(MCP_SERVERS)
    await _start_agent_runtime(app, mcp_client, enabled=ai_enabled)
    _warm_vault_indexes()
    _wire_plugin_system()
    _start_file_index()
    _repair_main_views()
    _start_mail_idle(enabled=mail_enabled)

    try:
        yield
    finally:
        await _shutdown_runtime(app, confirmation_task)


__all__ = ["lifespan"]
