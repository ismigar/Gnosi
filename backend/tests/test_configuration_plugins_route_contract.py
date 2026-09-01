"""Frozen HTTP contract for the configuration plugin extraction."""

from __future__ import annotations

from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.configuration.api import plugin_models
from backend.domains.configuration.api import plugins as plugins_api
from backend.services.workspace_service import get_workspace_context

RouteFingerprint = tuple[str, str, str, str]

EXPECTED_ROUTES: tuple[RouteFingerprint, ...] = (
    ("GET", "/plugins", "get_plugins_state", "get_plugins_state_plugins_get"),
    ("PUT", "/plugins", "set_plugins_state", "set_plugins_state_plugins_put"),
    (
        "POST",
        "/plugins/{plugin_id}/lifecycle",
        "set_plugin_lifecycle",
        "set_plugin_lifecycle_plugins__plugin_id__lifecycle_post",
    ),
    (
        "POST",
        "/plugins/llm-wiki/lifecycle",
        "set_llm_wiki_lifecycle",
        "set_llm_wiki_lifecycle_plugins_llm_wiki_lifecycle_post",
    ),
    (
        "GET",
        "/plugins/catalog",
        "get_plugins_catalog",
        "get_plugins_catalog_plugins_catalog_get",
    ),
    (
        "GET",
        "/plugins/installed",
        "get_installed_plugins",
        "get_installed_plugins_plugins_installed_get",
    ),
    (
        "POST",
        "/plugins/{plugin_id}/permissions",
        "set_plugin_permissions",
        "set_plugin_permissions_plugins__plugin_id__permissions_post",
    ),
    (
        "GET",
        "/plugins/{plugin_id}/settings",
        "get_plugin_settings",
        "get_plugin_settings_plugins__plugin_id__settings_get",
    ),
    (
        "PUT",
        "/plugins/{plugin_id}/settings",
        "set_plugin_settings",
        "set_plugin_settings_plugins__plugin_id__settings_put",
    ),
    (
        "POST",
        "/plugins/{plugin_id}/network/fetch",
        "fetch_for_ui_plugin",
        "fetch_for_ui_plugin_plugins__plugin_id__network_fetch_post",
    ),
    (
        "POST",
        "/plugins/vault-summary/summarize",
        "summarize_with_vault_plugin",
        "summarize_with_vault_plugin_plugins_vault_summary_summarize_post",
    ),
    (
        "GET",
        "/plugins/{plugin_id}/asset/{asset_path:path}",
        "get_plugin_asset",
        "get_plugin_asset_plugins__plugin_id__asset__asset_path__get",
    ),
    (
        "POST",
        "/plugins/install",
        "install_plugin",
        "install_plugin_plugins_install_post",
    ),
    (
        "DELETE",
        "/plugins/{plugin_id}",
        "uninstall_plugin",
        "uninstall_plugin_plugins__plugin_id__delete",
    ),
    (
        "POST",
        "/plugins/{plugin_id}/export",
        "export_plugin_package",
        "export_plugin_package_plugins__plugin_id__export_post",
    ),
    (
        "POST",
        "/plugins/{plugin_id}/submissions",
        "submit_plugin_package",
        "submit_plugin_package_plugins__plugin_id__submissions_post",
    ),
    (
        "GET",
        "/plugins/catalog/list",
        "list_plugin_catalog",
        "list_plugin_catalog_plugins_catalog_list_get",
    ),
    (
        "POST",
        "/plugins/catalog/install",
        "install_from_catalog",
        "install_from_catalog_plugins_catalog_install_post",
    ),
    (
        "GET",
        "/plugins/trust",
        "list_trusted_keys",
        "list_trusted_keys_plugins_trust_get",
    ),
    (
        "POST",
        "/plugins/trust",
        "add_trusted_key",
        "add_trusted_key_plugins_trust_post",
    ),
    (
        "DELETE",
        "/plugins/trust/{name}",
        "remove_trusted_key",
        "remove_trusted_key_plugins_trust__name__delete",
    ),
    (
        "GET",
        "/plugins/registry-url",
        "get_registry_url",
        "get_registry_url_plugins_registry_url_get",
    ),
    (
        "PUT",
        "/plugins/registry-url",
        "set_registry_url",
        "set_registry_url_plugins_registry_url_put",
    ),
)

PROTECTED_DEPENDENCY_COUNTS = {
    ("PUT", "/plugins"): 2,
    ("POST", "/plugins/{plugin_id}/lifecycle"): 2,
    ("POST", "/plugins/llm-wiki/lifecycle"): 2,
    ("POST", "/plugins/{plugin_id}/permissions"): 2,
    ("PUT", "/plugins/{plugin_id}/settings"): 2,
    ("POST", "/plugins/{plugin_id}/network/fetch"): 2,
    ("POST", "/plugins/vault-summary/summarize"): 3,
    ("POST", "/plugins/install"): 2,
    ("DELETE", "/plugins/{plugin_id}"): 2,
    ("POST", "/plugins/{plugin_id}/export"): 2,
    ("POST", "/plugins/{plugin_id}/submissions"): 2,
    ("POST", "/plugins/catalog/install"): 2,
    ("POST", "/plugins/trust"): 2,
    ("DELETE", "/plugins/trust/{name}"): 2,
    ("PUT", "/plugins/registry-url"): 2,
}


def _plugin_routes() -> list[APIRoute]:
    return [
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.path.startswith("/plugins")
    ]


def test_plugin_route_fingerprint_and_order_are_unchanged() -> None:
    actual: list[RouteFingerprint] = []
    for route in _plugin_routes():
        for method in sorted(route.methods or set()):
            actual.append((method, route.path, route.name, route.unique_id))
    assert tuple(actual) == EXPECTED_ROUTES


def test_plugin_route_status_models_and_dependencies_are_unchanged() -> None:
    response_models = {
        "fetch_for_ui_plugin": plugin_models.ConfigurationPluginNetworkFetchResponse,
        "get_installed_plugins": plugin_models.ConfigurationInstalledPluginsResponse,
        "get_plugins_catalog": (
            plugin_models.ConfigurationPluginPermissionsCatalogResponse
        ),
        "get_plugins_state": plugin_models.ConfigurationPluginStateResponse,
        "get_plugin_settings": plugin_models.PluginSettingsResponse,
        "get_registry_url": plugin_models.ConfigurationPluginRegistryUrlResponse,
        "list_plugin_catalog": plugin_models.ConfigurationPluginCatalogResponse,
        "list_trusted_keys": plugin_models.ConfigurationPluginTrustedKeysResponse,
        "set_plugin_lifecycle": plugin_models.ConfigurationPluginStateResponse,
        "set_plugin_settings": plugin_models.PluginSettingsResponse,
        "summarize_with_vault_plugin": plugin_models.VaultPluginSummaryResponse,
    }
    routes = _plugin_routes()
    assert len(routes) == len(EXPECTED_ROUTES)
    for route in routes:
        assert route.operation_id is None
        assert route.status_code is None
        assert route.response_model is response_models.get(route.endpoint.__name__)
        assert route.response_model_exclude_unset is (
            route.endpoint.__name__ in response_models
        )
        methods = route.methods or set()
        assert len(methods) == 1
        method = next(iter(methods))
        expected_count = PROTECTED_DEPENDENCY_COUNTS.get(
            (method, route.path),
            1,
        )
        assert len(route.dependencies) == expected_count
        assert route.dependencies[0].dependency is get_workspace_context


def test_plugin_handlers_are_canonical_domain_exports() -> None:
    for _method, _path, handler_name, _unique_id in EXPECTED_ROUTES:
        assert getattr(vault_routes, handler_name) is getattr(
            plugins_api,
            handler_name,
        )
