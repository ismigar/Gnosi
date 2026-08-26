"""Tests for the versioned built-in plugin capability registry."""

import asyncio
from contextvars import ContextVar
import json
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.testclient import TestClient

from backend.services import builtin_plugins


def test_legacy_state_migrates_to_core_only_without_losing_configuration():
    raw = {
        "disabled": ["daily-notes"],
        "settings": {"project-planning": {"hours_per_day": 5}},
        "granted": {"community-plugin": ["vault:read"]},
        "profiles": {"community-plugin": {"account": "preserved"}},
        "registry_url": "https://plugins.example/index.json",
    }

    state, changed = builtin_plugins.normalize_state(raw)

    assert changed is True
    assert state["schema_version"] == builtin_plugins.PLUGIN_STATE_VERSION
    assert state["enabled_builtin"] == ["resources"]
    assert state["enabled_third_party"] == []
    assert set(state["disabled"]) >= builtin_plugins.BUILTIN_PLUGIN_IDS - {"resources"}
    assert "resources" not in state["disabled"]
    assert state["settings"] == raw["settings"]
    assert state["granted"] == raw["granted"]
    assert state["profiles"] == raw["profiles"]
    assert state["registry_url"] == raw["registry_url"]


def test_normalized_state_is_idempotent_and_future_builtins_stay_off():
    first, _ = builtin_plugins.normalize_state({})
    second, changed = builtin_plugins.normalize_state(first)

    assert second == first
    assert changed is False
    assert not builtin_plugins.is_enabled(second, "mail")
    assert builtin_plugins.is_enabled(second, "resources")


def test_default_plugin_can_be_explicitly_disabled():
    state, _ = builtin_plugins.normalize_state({})

    state = builtin_plugins.set_enabled(state, "resources", False)
    normalized, changed = builtin_plugins.normalize_state(state)

    assert changed is False
    assert not builtin_plugins.is_enabled(normalized, "resources")
    assert "resources" in normalized["disabled"]


def test_explicit_enablement_keeps_legacy_disabled_field_in_sync():
    state, _ = builtin_plugins.normalize_state({})

    state = builtin_plugins.set_enabled(state, "calendar", True)
    assert builtin_plugins.is_enabled(state, "calendar")
    assert "calendar" not in state["disabled"]

    state = builtin_plugins.set_enabled(state, "calendar", False)
    assert not builtin_plugins.is_enabled(state, "calendar")
    assert "calendar" in state["disabled"]


def test_ai_dependencies_are_transitive_and_disable_in_dependency_order():
    assert builtin_plugins.required_plugins("grounded-notebooks") == ("ai-platform",)

    enabled = {"ai-platform", "grounded-notebooks", "llm-wiki", "mail"}
    assert set(builtin_plugins.dependent_plugins("ai-platform", enabled)) == {
        "grounded-notebooks",
        "llm-wiki",
    }


def test_third_party_plugins_require_explicit_enablement():
    state, _ = builtin_plugins.normalize_state({})
    assert not builtin_plugins.is_enabled(state, "community-plugin")

    enabled = builtin_plugins.set_enabled(state, "community-plugin", True)
    assert builtin_plugins.is_enabled(enabled, "community-plugin")
    assert "community-plugin" not in enabled["disabled"]


def test_generic_lifecycle_returns_structured_dependency_conflicts(monkeypatch):
    from backend.api import vault_routes

    state, _ = builtin_plugins.normalize_state({})
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: dict(state))
    monkeypatch.setattr(
        vault_routes,
        "_save_plugins_state",
        lambda payload: state.update(payload) or dict(state),
    )
    monkeypatch.setattr(vault_routes, "_reconcile_plugin_ai_contributions", lambda: {})
    monkeypatch.setattr(vault_routes, "_plugins_mutation_lock", asyncio.Lock())
    async def no_runtime_refresh(_request, _state):
        return None

    monkeypatch.setattr(vault_routes, "_refresh_plugin_runtime", no_runtime_refresh)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(agent_cache={"stale": True}))
    )

    async def scenario():
        with pytest.raises(HTTPException) as enable_conflict:
            await vault_routes._change_plugin_lifecycle(
                "grounded-notebooks",
                vault_routes.PluginLifecycleRequest(enabled=True),
                request,
            )
        assert enable_conflict.value.detail["enable"] == ["ai-platform"]

        enabled = await vault_routes._change_plugin_lifecycle(
            "grounded-notebooks",
            vault_routes.PluginLifecycleRequest(
                enabled=True,
                confirm_dependencies=True,
            ),
            request,
        )
        assert set(enabled["affected"]) == {"ai-platform", "grounded-notebooks"}

        with pytest.raises(HTTPException) as disable_conflict:
            await vault_routes._change_plugin_lifecycle(
                "ai-platform",
                vault_routes.PluginLifecycleRequest(enabled=False),
                request,
            )
        assert disable_conflict.value.detail["disable"] == ["grounded-notebooks"]

        disabled = await vault_routes._change_plugin_lifecycle(
            "ai-platform",
            vault_routes.PluginLifecycleRequest(enabled=False, confirm_disable=True),
            request,
        )
        assert not builtin_plugins.is_enabled(disabled, "ai-platform")
        assert not builtin_plugins.is_enabled(disabled, "grounded-notebooks")

    asyncio.run(scenario())
    assert request.app.state.agent_cache == {}


def test_route_guard_rejects_disabled_capabilities(monkeypatch):
    from backend.api import vault_routes
    from backend.services.plugin_access import assert_plugins_enabled

    state, _ = builtin_plugins.normalize_state({})
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: dict(state))

    with pytest.raises(HTTPException) as error:
        asyncio.run(assert_plugins_enabled("mail"))
    assert error.value.detail == {
        "code": "plugin_disabled",
        "plugins": ["mail"],
        "settings": {"tab": "plugins", "pluginId": "mail"},
    }

    state.update(builtin_plugins.set_enabled(state, "mail", True))
    asyncio.run(assert_plugins_enabled("mail"))


def test_scheduler_skips_external_work_but_keeps_core_maintenance(monkeypatch):
    from backend.api import vault_routes
    from backend.scheduler.manager import SchedulerManager

    state, _ = builtin_plugins.normalize_state({})
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: dict(state))
    monkeypatch.setattr(
        SchedulerManager,
        "_task_fetch_mail",
        lambda _self: (_ for _ in ()).throw(AssertionError("mail sync started")),
    )
    monkeypatch.setattr(
        SchedulerManager,
        "_task_system_maintenance",
        lambda _self: {"maintained": True},
    )
    manager = object.__new__(SchedulerManager)

    paused = manager._execute_task("fetch_mail")
    assert paused["skipped"] is True
    assert manager._execute_task("system_maintenance") == {"maintained": True}


def test_agent_internal_sources_do_not_touch_disabled_plugins(monkeypatch):
    from backend.agent import internal_sources
    from backend.api import vault_routes

    state, _ = builtin_plugins.normalize_state({})
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: dict(state))
    monkeypatch.setattr(internal_sources, "_reference_table", lambda: None)
    monkeypatch.setattr(
        internal_sources,
        "_reader_session",
        lambda: (_ for _ in ()).throw(AssertionError("Reader database opened")),
    )
    monkeypatch.setattr(
        internal_sources,
        "_planning_snapshot",
        lambda: (_ for _ in ()).throw(AssertionError("Planning state opened")),
    )
    monkeypatch.setattr(
        internal_sources,
        "_configured_accounts",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("Accounts opened")),
    )

    assert internal_sources.internal_source_catalog("personal") == []
    with pytest.raises(PermissionError, match="reader"):
        internal_sources.search_internal_source("reader", {}, "evidence")


def test_ai_automations_pause_without_both_plugins(monkeypatch):
    from backend.api import vault_routes
    from backend.scheduler.manager import SchedulerManager

    state, _ = builtin_plugins.normalize_state({})
    state = builtin_plugins.set_enabled(state, "automations", True)
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: dict(state))
    monkeypatch.setattr(
        SchedulerManager,
        "_task_run_capability_automations",
        lambda _self: (_ for _ in ()).throw(AssertionError("AI automation started")),
    )

    paused = object.__new__(SchedulerManager)._execute_task(
        "run_capability_automations"
    )
    assert paused["skipped"] is True
    assert "ai-platform" in paused["message"]


def test_http_lifecycle_migrates_and_keeps_vault_states_isolated(
    monkeypatch, tmp_path
):
    from backend.api import vault_routes
    from backend.services.plugin_access import require_plugins

    paths = {
        "vault-a": tmp_path / "vault-a" / ".gnosi" / "plugins.json",
        "vault-b": tmp_path / "vault-b" / ".gnosi" / "plugins.json",
    }
    paths["vault-a"].parent.mkdir(parents=True)
    paths["vault-a"].write_text(json.dumps({
        "settings": {"mail": {"account": "preserved@example.test"}},
        "granted": {"community-plugin": ["settings"]},
        "profiles": {"community-plugin": {"profile": "preserved"}},
    }), encoding="utf-8")
    paths["vault-b"].parent.mkdir(parents=True)
    vault_b, _ = builtin_plugins.normalize_state({})
    vault_b = builtin_plugins.set_enabled(vault_b, "calendar", True)
    paths["vault-b"].write_text(json.dumps(vault_b), encoding="utf-8")

    selected_vault = ContextVar("selected_plugin_test_vault", default="vault-a")
    monkeypatch.setattr(
        vault_routes, "_get_plugins_path", lambda: paths[selected_vault.get()]
    )
    monkeypatch.setattr(vault_routes, "_reconcile_plugin_ai_contributions", lambda: {})
    monkeypatch.setattr(vault_routes, "_plugins_mutation_lock", asyncio.Lock())

    async def no_runtime_refresh(_request, _state):
        return None

    monkeypatch.setattr(vault_routes, "_refresh_plugin_runtime", no_runtime_refresh)

    async def select_vault(x_vault_id: str = Header(default="vault-a")):
        token = selected_vault.set(x_vault_id)
        try:
            yield
        finally:
            selected_vault.reset(token)

    app = FastAPI()

    @app.get("/api/vault/plugins", dependencies=[Depends(select_vault)])
    async def plugin_state():
        return await vault_routes.get_plugins_state()

    @app.post(
        "/api/vault/plugins/{plugin_id}/lifecycle",
        dependencies=[Depends(select_vault)],
    )
    async def lifecycle(
        plugin_id: str,
        payload: vault_routes.PluginLifecycleRequest,
        request: Request,
    ):
        return await vault_routes._change_plugin_lifecycle(
            plugin_id, payload, request
        )

    @app.get(
        "/api/mail-surface",
        dependencies=[Depends(select_vault), Depends(require_plugins("mail"))],
    )
    async def mail_surface():
        return {"available": True}

    with TestClient(app) as client:
        migrated = client.get(
            "/api/vault/plugins", headers={"X-Vault-Id": "vault-a"}
        )
        assert migrated.status_code == 200
        migrated_state = migrated.json()
        assert migrated_state["schema_version"] == 2
        assert migrated_state["enabled_builtin"] == ["resources"]
        assert migrated_state["settings"]["mail"]["account"] == "preserved@example.test"
        assert migrated_state["profiles"]["community-plugin"]["profile"] == "preserved"

        enabled = client.post(
            "/api/vault/plugins/mail/lifecycle",
            headers={"X-Vault-Id": "vault-a"},
            json={"enabled": True},
        )
        assert enabled.status_code == 200
        assert "mail" in enabled.json()["enabled_builtin"]
        assert client.get(
            "/api/mail-surface", headers={"X-Vault-Id": "vault-a"}
        ).status_code == 200

        blocked = client.get(
            "/api/mail-surface", headers={"X-Vault-Id": "vault-b"}
        )
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["code"] == "plugin_disabled"
        isolated = client.get(
            "/api/vault/plugins", headers={"X-Vault-Id": "vault-b"}
        ).json()
        assert isolated["enabled_builtin"] == ["calendar", "resources"]
