"""Ownership and compatibility seams for the configuration plugin domain."""

from __future__ import annotations

import ast
import asyncio
import inspect
from types import SimpleNamespace
from typing import Any

from backend.api import vault_routes
from backend.domains.configuration import plugin_state
from backend.domains.configuration.api import plugin_lifecycle, plugin_models
from backend.domains.configuration.api import plugins as plugins_api

MODEL_NAMES = (
    "PluginsUpdateRequest",
    "PluginLifecycleRequest",
    "LlmWikiLifecycleRequest",
    "PluginPermissionsRequest",
    "PluginSettingsRequest",
    "PluginNetworkFetchRequest",
    "VaultSummaryRequest",
    "CatalogInstallRequest",
    "TrustedKeyRequest",
    "RegistryUrlRequest",
)
HANDLER_NAMES = frozenset(
    handler_name
    for _method, _path, handler_name, _unique_id in (
        __import__(
            "backend.tests.test_configuration_plugins_route_contract",
            fromlist=["EXPECTED_ROUTES"],
        ).EXPECTED_ROUTES
    )
)


def test_facade_reexports_models_without_duplicate_definitions() -> None:
    for name in MODEL_NAMES:
        assert getattr(vault_routes, name) is getattr(plugin_models, name)

    tree = ast.parse(inspect.getsource(vault_routes))
    classes = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}
    assert classes.isdisjoint(MODEL_NAMES)


def test_facade_does_not_define_public_plugin_handlers() -> None:
    tree = ast.parse(inspect.getsource(vault_routes))
    functions = {
        node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert functions.isdisjoint(HANDLER_NAMES)


def test_plugin_mutable_state_has_one_domain_owner() -> None:
    store = plugin_state.store()
    assert vault_routes._plugins_lock is store.lock
    assert vault_routes._plugins_mutation_lock is store.mutation_lock


def test_domain_modules_do_not_import_the_legacy_facade() -> None:
    for module in (plugin_state, plugin_models, plugin_lifecycle, plugins_api):
        assert "backend.api.vault_routes" not in inspect.getsource(module)


def test_load_save_and_lock_seams_remain_dynamic(monkeypatch: Any) -> None:
    state: dict[str, Any] = {"settings": {"plugin-a": {"old": 1}}}
    saved: list[dict[str, Any]] = []
    monkeypatch.setattr(vault_routes, "_load_plugins_state", lambda: dict(state))
    monkeypatch.setattr(
        vault_routes,
        "_save_plugins_state",
        lambda payload: saved.append(dict(payload)) or dict(payload),
    )
    monkeypatch.setattr(vault_routes, "_plugins_mutation_lock", asyncio.Lock())

    result = asyncio.run(
        vault_routes.set_plugin_settings(
            "plugin-a",
            vault_routes.PluginSettingsRequest(settings={"new": 2}),
        )
    )

    assert result == {"settings": {"old": 1, "new": 2}}
    assert saved[-1]["settings"]["plugin-a"] == {"old": 1, "new": 2}


def test_lifecycle_seam_remains_dynamic(monkeypatch: Any) -> None:
    calls: list[tuple[str, bool]] = []

    async def lifecycle(
        plugin_id: str,
        payload: plugin_models.PluginLifecycleRequest,
        _request: Any,
    ) -> dict[str, Any]:
        calls.append((plugin_id, payload.enabled))
        return {"plugin_id": plugin_id, "enabled": payload.enabled}

    monkeypatch.setattr(vault_routes, "_change_plugin_lifecycle", lifecycle)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    result = asyncio.run(
        vault_routes.set_plugin_lifecycle(
            "mail",
            vault_routes.PluginLifecycleRequest(enabled=True),
            request,
        )
    )

    assert result == {"plugin_id": "mail", "enabled": True}
    assert calls == [("mail", True)]


def test_configured_summary_model_seam_remains_dynamic(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        vault_routes,
        "_configured_summary_model",
        lambda: ("test-provider", "test-model"),
    )
    monkeypatch.setattr(
        plugins_api,
        "_summarize_with_model",
        lambda _request, _content, provider, model: {
            "summary": "ok",
            "model": f"{provider}:{model}",
        },
    )

    result = asyncio.run(
        vault_routes.summarize_with_vault_plugin(
            vault_routes.VaultSummaryRequest(content="content")
        )
    )

    assert result == {
        "summary": "ok",
        "model": "test-provider:test-model",
    }
