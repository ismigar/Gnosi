"""Compatibility contract for the extracted application lifecycle."""

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI

import backend.app.lifespan as lifespan_module
import backend.app.factory as app_factory
from backend.api import vault_routes
from backend.app.lifespan import lifespan as application_lifespan
from backend.config import app_config, data_dir
from backend.migrations import coordinator
from backend.scheduler.manager import scheduler_manager
from backend.server import app
from backend.server import lifespan as legacy_lifespan
from backend.services import (
    auth_service,
    durable_job_worker,
    imap_idle_service,
    llm_wiki_agent,
    plugin_ai_contributions,
    plugin_dispatcher,
    reference_table_config,
    vault_file_index,
)


def test_server_keeps_stable_app_and_lifespan_exports() -> None:
    assert isinstance(app, FastAPI)
    assert legacy_lifespan is application_lifespan
    assert application_lifespan.__module__ == "backend.app.lifespan"


@pytest.mark.parametrize("value", ["1", "true", "YES", "on"])
def test_scheduler_can_be_disabled_for_smoke_tests(
    value: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GNOSI_DISABLE_SCHEDULER", value)

    assert lifespan_module._scheduler_start_enabled() is False


def test_scheduler_remains_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GNOSI_DISABLE_SCHEDULER", raising=False)

    assert lifespan_module._scheduler_start_enabled() is True


def test_agent_workflow_is_deferred_until_first_chat() -> None:
    events: list[str] = []

    class FakeMcpClient:
        async def start(self) -> None:
            events.append("mcp.start")

        async def get_all_tools(self) -> list[dict[str, str]]:
            events.append("mcp.tools")
            return [{"name": "ready"}]

    app = FastAPI()

    async def exercise() -> None:
        client = FakeMcpClient()
        await lifespan_module._start_agent_runtime(app, client, enabled=True)
        assert app.state.mcp_client is client
        assert app.state.tools_list == [{"name": "ready"}]
        assert app.state.agent_cache == {}
        assert not hasattr(app.state, "agent_workflow")
        assert not hasattr(app.state, "agent_app")

    asyncio.run(exercise())

    assert events == ["mcp.start", "mcp.tools"]


def test_lifespan_preserves_startup_and_shutdown_order(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    events: list[str] = []
    fixture_data = tmp_path / "data"
    fixture_data.mkdir()

    def record(event: str) -> None:
        events.append(event)

    def resolve_data_dir() -> Path:
        record("data.resolve")
        return fixture_data

    def migrate_existing_databases(_data_dir: Path) -> list[object]:
        record("migrations")
        return []

    monkeypatch.setattr(
        reference_table_config,
        "assert_reference_config_ready",
        lambda: record("references.ready"),
    )
    monkeypatch.setattr(data_dir, "resolve_data_dir", resolve_data_dir)
    monkeypatch.setattr(
        coordinator,
        "migrate_existing_databases",
        migrate_existing_databases,
    )
    monkeypatch.setattr(
        auth_service,
        "assert_signing_secret_safe",
        lambda: record("auth.secret"),
    )
    monkeypatch.setattr(
        app_factory,
        "refresh_health_snapshot",
        lambda _app: record("health.snapshot"),
    )
    monkeypatch.setattr(
        scheduler_manager,
        "start",
        lambda: record("scheduler.start"),
    )
    # Test the default startup path only after replacing the scheduler itself.
    # Other tests and the outer validation process retain their disabled policy.
    monkeypatch.delenv("GNOSI_DISABLE_SCHEDULER", raising=False)
    monkeypatch.setenv("GNOSI_INTEGRATION_STARTUP_DELAY_SECONDS", "0")
    monkeypatch.setattr(
        durable_job_worker.durable_job_worker,
        "start",
        lambda: record("worker.start"),
    )
    monkeypatch.setattr(
        durable_job_worker.durable_job_worker,
        "stop",
        lambda: record("worker.stop"),
    )

    async def idle_maintenance_loop() -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(
        lifespan_module,
        "_confirmation_maintenance_loop",
        idle_maintenance_loop,
    )

    def load_plugins_state() -> dict[str, object]:
        record("plugins.load")
        return {}

    monkeypatch.setattr(vault_routes, "_load_plugins_state", load_plugins_state)

    def plugin_enabled(_state: object, plugin_id: str) -> bool:
        events.append(f"plugin.enabled:{plugin_id}")
        return False

    monkeypatch.setattr(vault_routes.builtin_plugins, "is_enabled", plugin_enabled)
    monkeypatch.setattr(
        llm_wiki_agent,
        "transition_agent",
        lambda _enabled: record("agent.transition"),
    )
    monkeypatch.setattr(
        plugin_ai_contributions,
        "reconcile_plugin_ai_contributions",
        lambda: record("plugins.reconcile"),
    )

    class FakeMcpClient:
        def __init__(self, _servers: object) -> None:
            record("mcp.create")

    monkeypatch.setattr(lifespan_module, "MultiServerMCPClient", FakeMcpClient)

    def load_params(*, strict_env: bool = False) -> SimpleNamespace:
        _ = strict_env
        record("vault.config")
        return SimpleNamespace(paths={})

    monkeypatch.setattr(
        app_config,
        "load_params",
        load_params,
    )
    # lifespan imports load_params directly, so patch the bound owner as well.
    # Otherwise index warmup can touch the configured real Vault before the
    # facade-level registry doubles below are exercised.
    monkeypatch.setattr(lifespan_module, "load_params", load_params)
    monkeypatch.setattr(
        plugin_dispatcher,
        "wire",
        lambda: record("plugins.wire"),
    )
    monkeypatch.setattr(
        vault_file_index,
        "kickoff_file_index_rebuild",
        lambda: pytest.fail("lifespan must not scan provider trees"),
    )
    def stop_file_index() -> bool:
        record("file-index.stop")
        return True

    monkeypatch.setattr(vault_file_index, "shutdown_file_index", stop_file_index)

    @contextmanager
    def registry_mutation() -> Iterator[None]:
        record("registry.lock")
        yield

    monkeypatch.setattr(vault_routes, "registry_mutation", registry_mutation)

    def load_registry() -> dict[str, list[object]]:
        record("registry.load")
        return {"tables": []}

    monkeypatch.setattr(vault_routes, "load_registry", load_registry)
    monkeypatch.setattr(
        imap_idle_service.idle_manager,
        "stop_all",
        lambda: record("imap.stop"),
    )

    async def exercise() -> None:
        async with application_lifespan(FastAPI()):
            record("yield")
            await asyncio.sleep(0)
            await asyncio.sleep(0)

    asyncio.run(exercise())

    assert events == [
        "references.ready",
        "data.resolve",
        "migrations",
        "auth.secret",
        "health.snapshot",
        "worker.start",
        "plugins.load",
        "plugin.enabled:ai-platform",
        "plugin.enabled:mail",
        "plugins.reconcile",
        "mcp.create",
        "vault.config",
        "plugins.wire",
        "registry.lock",
        "registry.load",
        "yield",
        "scheduler.start",
        "file-index.stop",
        "worker.stop",
        "imap.stop",
    ]
