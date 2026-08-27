"""Application startup, maintenance and shutdown lifecycle."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI

from backend.config.app_config import load_params
from backend.config.mcp_config import MCP_SERVERS
from backend.mcp.client import MultiServerMCPClient
from backend.agent.factory import create_agent_workflow

from backend.api import vault_routes
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
        for (value,) in database.query(Vault.path_override).filter(Vault.path_override.isnot(None)):
            if str(value or "").strip():
                paths.add(Path(value).resolve())
    except Exception as exc:
        log.warning("Could not list registered Vaults for maintenance: %s", exc)
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
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not maintain agent action state: %s", exc)
        await asyncio.sleep(10 * 60)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # STARTUP
    log.info("🚀 Starting Gnosi Agent (FastAPI Port)...")

    # 0. Bring every existing first-party SQLite store to its explicit head
    # before schedulers, workers or request handlers can open a writer.
    from backend.config.data_dir import resolve_data_dir
    from backend.migrations.coordinator import migrate_existing_databases

    migrated_databases = migrate_existing_databases(resolve_data_dir())
    log.info("Database schema verification complete (%s stores).", len(migrated_databases))

    # 0a. Fail fast if an exposed deployment is missing a real JWT secret.
    # Signing sessions with the public dev fallback would be an auth bypass.
    from backend.services.auth_service import assert_signing_secret_safe

    assert_signing_secret_safe()

    # 0b. Start Scheduler
    scheduler_manager.start()
    from backend.services.durable_job_worker import durable_job_worker

    durable_job_worker.start()
    confirmation_maintenance_task = asyncio.create_task(_confirmation_maintenance_loop())
    plugin_state = vault_routes._load_plugins_state()
    ai_platform_enabled = vault_routes.builtin_plugins.is_enabled(plugin_state, "ai-platform")
    mail_enabled = vault_routes.builtin_plugins.is_enabled(plugin_state, "mail")

    # 0c. Reconcile declarative plugin contributions before any agent graph is
    # built. This applies the idempotent Brain migration and restores/suspends
    # third-party managed profiles without discarding user overrides.
    try:
        from backend.services.llm_wiki_agent import transition_agent
        from backend.services.plugin_ai_contributions import (
            reconcile_plugin_ai_contributions,
        )

        if ai_platform_enabled and vault_routes._llm_wiki_enabled(plugin_state):
            transition_agent(True)
        reconcile_plugin_ai_contributions()
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not reconcile plugin AI contributions: %s", exc)

    # 1. Init MCP Client
    mcp_client = MultiServerMCPClient(MCP_SERVERS)
    if ai_platform_enabled:
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
    else:
        app.state.tools_list = []
        log.info("AI platform plugin is disabled; MCP and agent startup are paused.")

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
    if mail_enabled:
        try:
            from backend.services.imap_idle_service import idle_manager

            idle_manager.start_all()
            log.info("📬 IMAP IDLE workers started.")
        except Exception as e:
            log.warning(f"⚠️ Could not start IMAP IDLE workers: {e}")

    yield

    # SHUTDOWN
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
    if hasattr(app.state, "mcp_client"):
        # Timeout: if the MCP client stop hangs (servers not responding),
        # it does not block the worker's shutdown (and with it the --reload reload).
        try:
            await asyncio.wait_for(app.state.mcp_client.stop(), timeout=5)
            log.info("✅ MCP Client stopped.")
        except Exception as e:
            log.warning(f"⚠️ MCP Client stop timed out/failed: {e}")
