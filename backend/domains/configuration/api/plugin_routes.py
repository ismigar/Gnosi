"""Route composition for the plugin API.

Keeping composition separate from handler implementation prevents the plugin
domain module from growing whenever a route or response contract is added.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter
from fastapi.params import Depends as DependsParameter

from backend.domains.configuration.api.plugin_models import (
    ConfigurationInstalledPluginsResponse,
    ConfigurationPluginCatalogResponse,
    ConfigurationPluginNetworkFetchResponse,
    ConfigurationPluginPermissionsCatalogResponse,
    ConfigurationPluginRegistryUrlResponse,
    ConfigurationPluginStateResponse,
    ConfigurationPluginTrustedKeysResponse,
    PluginSettingsResponse,
    VaultPluginSummaryResponse,
)


Endpoint = Callable[..., Any]


@dataclass(frozen=True)
class PluginRouteHandlers:
    """Handlers composed by the plugin facade without changing operation IDs."""

    add_trusted_key: Endpoint
    export_plugin_package: Endpoint
    fetch_for_ui_plugin: Endpoint
    get_installed_plugins: Endpoint
    get_plugin_asset: Endpoint
    get_plugin_settings: Endpoint
    get_plugins_catalog: Endpoint
    get_plugins_state: Endpoint
    get_registry_url: Endpoint
    install_from_catalog: Endpoint
    install_plugin: Endpoint
    list_plugin_catalog: Endpoint
    list_trusted_keys: Endpoint
    remove_trusted_key: Endpoint
    set_llm_wiki_lifecycle: Endpoint
    set_plugin_lifecycle: Endpoint
    set_plugin_permissions: Endpoint
    set_plugin_settings: Endpoint
    set_plugins_state: Endpoint
    set_registry_url: Endpoint
    submit_plugin_package: Endpoint
    summarize_with_vault_plugin: Endpoint
    uninstall_plugin: Endpoint


def register_plugin_routes(
    router: APIRouter,
    handlers: PluginRouteHandlers,
    *,
    admin_dependencies: Sequence[DependsParameter],
    editor_dependencies: Sequence[DependsParameter],
    summary_dependencies: Sequence[DependsParameter],
) -> None:
    """Register plugin routes in their historical order and position."""
    admin = list(admin_dependencies)
    editor = list(editor_dependencies)
    summary = list(summary_dependencies)
    routes: tuple[
        tuple[str, str, Endpoint, Sequence[DependsParameter]],
        ...,
    ] = (
        ("GET", "/plugins", handlers.get_plugins_state, ()),
        ("PUT", "/plugins", handlers.set_plugins_state, admin),
        (
            "POST",
            "/plugins/{plugin_id}/lifecycle",
            handlers.set_plugin_lifecycle,
            admin,
        ),
        (
            "POST",
            "/plugins/llm-wiki/lifecycle",
            handlers.set_llm_wiki_lifecycle,
            admin,
        ),
        ("GET", "/plugins/catalog", handlers.get_plugins_catalog, ()),
        ("GET", "/plugins/installed", handlers.get_installed_plugins, ()),
        (
            "POST",
            "/plugins/{plugin_id}/permissions",
            handlers.set_plugin_permissions,
            admin,
        ),
        ("GET", "/plugins/{plugin_id}/settings", handlers.get_plugin_settings, ()),
        (
            "PUT",
            "/plugins/{plugin_id}/settings",
            handlers.set_plugin_settings,
            editor,
        ),
        (
            "POST",
            "/plugins/{plugin_id}/network/fetch",
            handlers.fetch_for_ui_plugin,
            editor,
        ),
        (
            "POST",
            "/plugins/vault-summary/summarize",
            handlers.summarize_with_vault_plugin,
            summary,
        ),
        (
            "GET",
            "/plugins/{plugin_id}/asset/{asset_path:path}",
            handlers.get_plugin_asset,
            (),
        ),
        ("POST", "/plugins/install", handlers.install_plugin, admin),
        ("DELETE", "/plugins/{plugin_id}", handlers.uninstall_plugin, admin),
        (
            "POST",
            "/plugins/{plugin_id}/export",
            handlers.export_plugin_package,
            editor,
        ),
        (
            "POST",
            "/plugins/{plugin_id}/submissions",
            handlers.submit_plugin_package,
            admin,
        ),
        ("GET", "/plugins/catalog/list", handlers.list_plugin_catalog, ()),
        (
            "POST",
            "/plugins/catalog/install",
            handlers.install_from_catalog,
            admin,
        ),
        ("GET", "/plugins/trust", handlers.list_trusted_keys, ()),
        ("POST", "/plugins/trust", handlers.add_trusted_key, admin),
        (
            "DELETE",
            "/plugins/trust/{name}",
            handlers.remove_trusted_key,
            admin,
        ),
        ("GET", "/plugins/registry-url", handlers.get_registry_url, ()),
        ("PUT", "/plugins/registry-url", handlers.set_registry_url, admin),
    )
    response_models = {
        handlers.fetch_for_ui_plugin: ConfigurationPluginNetworkFetchResponse,
        handlers.get_installed_plugins: ConfigurationInstalledPluginsResponse,
        handlers.get_plugins_catalog: ConfigurationPluginPermissionsCatalogResponse,
        handlers.get_plugins_state: ConfigurationPluginStateResponse,
        handlers.get_registry_url: ConfigurationPluginRegistryUrlResponse,
        handlers.get_plugin_settings: PluginSettingsResponse,
        handlers.list_plugin_catalog: ConfigurationPluginCatalogResponse,
        handlers.list_trusted_keys: ConfigurationPluginTrustedKeysResponse,
        handlers.set_plugin_lifecycle: ConfigurationPluginStateResponse,
        handlers.set_plugin_settings: PluginSettingsResponse,
        handlers.summarize_with_vault_plugin: VaultPluginSummaryResponse,
    }
    for method, path, endpoint, dependencies in routes:
        router.add_api_route(
            path,
            endpoint,
            methods=[method],
            dependencies=list(dependencies),
            response_model=response_models.get(endpoint),
            response_model_exclude_unset=endpoint in response_models,
        )
