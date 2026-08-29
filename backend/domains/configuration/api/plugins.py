"""HTTP adapters for built-in and third-party plugin configuration."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.params import Depends as DependsParameter
from fastapi.responses import FileResponse, Response

from backend.domains.configuration.api.plugin_models import (
    CatalogInstallRequest,
    ConfigurationInstalledPluginsResponse,
    ConfigurationPluginCatalogResponse,
    ConfigurationPluginNetworkFetchResponse,
    ConfigurationPluginPermissionsCatalogResponse,
    ConfigurationPluginRegistryUrlResponse,
    ConfigurationPluginStateResponse,
    ConfigurationPluginTrustedKeysResponse,
    LlmWikiLifecycleRequest,
    PluginLifecycleRequest,
    PluginNetworkFetchRequest,
    PluginPermissionsRequest,
    PluginSettingsRequest,
    PluginSettingsResponse,
    PluginsUpdateRequest,
    RegistryUrlRequest,
    TrustedKeyRequest,
    VaultPluginSummaryResponse,
    VaultSummaryRequest,
)
from backend.services import builtin_plugins

PluginState = dict[str, Any]
StateLoader = Callable[[], PluginState]
StateSaver = Callable[[PluginState], PluginState]
LifecycleHandler = Callable[
    [str, PluginLifecycleRequest, Request],
    Awaitable[PluginState],
]


@dataclass(frozen=True)
class PluginApiDependencies:
    """Runtime collaborators resolved through the compatibility facade."""

    config_dir: Callable[[], Path]
    load_state: StateLoader
    save_state: StateSaver
    mutation_lock: Callable[[], asyncio.Lock]
    llm_wiki_enabled: Callable[[PluginState], bool]
    reconcile: Callable[[], PluginState]
    change_lifecycle: Callable[[], LifecycleHandler]
    configured_summary_model: Callable[[], tuple[str, str]]
    ai_configuration: Callable[[], PluginState]
    logger: logging.Logger


_dependencies: PluginApiDependencies | None = None


def configure(dependencies: PluginApiDependencies) -> None:
    """Configure the HTTP adapter once from the legacy composition facade."""
    global _dependencies
    if _dependencies is not None:
        raise RuntimeError("Plugin API is already configured")
    _dependencies = dependencies


def _deps() -> PluginApiDependencies:
    if _dependencies is None:
        raise RuntimeError("Plugin API has not been configured")
    return _dependencies


def llm_wiki_enabled(state: PluginState) -> bool:
    """Return whether the built-in LLM Wiki feature is enabled."""
    return builtin_plugins.is_enabled(state, "llm-wiki")


def reconcile_plugin_ai_contributions() -> PluginState:
    """Refresh governed third-party skills, tools, and managed agents."""
    from backend.services.plugin_ai_contributions import (
        reconcile_plugin_ai_contributions as reconcile,
    )

    return dict(reconcile())


def configured_summary_model() -> tuple[str, str]:
    """Return the enabled model selected for the vault-summary plugin."""
    state = _deps().load_state()
    settings = (state.get("settings") or {}).get("vault-summary") or {}
    model_ref = str(settings.get("model") or "").strip()
    provider, separator, model_id = model_ref.partition(":")
    if not separator or not provider or not model_id:
        raise HTTPException(
            status_code=409,
            detail="Configure an active model for the vault-summary plugin first.",
        )

    from backend.agent.model_router import load_registry

    active_models = {
        f"{row.get('provider')}:{row.get('model_id')}"
        for row in load_registry()
        if row.get("enabled", True)
    }
    if model_ref not in active_models:
        raise HTTPException(
            status_code=409,
            detail="The configured vault-summary model is no longer active.",
        )
    return provider, model_id


async def get_plugins_state() -> PluginState:
    """Return versioned plugin state and the built-in capability registry."""
    state = await asyncio.to_thread(_deps().load_state)
    return {**state, "builtins": builtin_plugins.public_registry()}


def _updated_plugin_state(request: PluginsUpdateRequest) -> PluginState:
    current = _deps().load_state()
    requested_disabled = {str(item) for item in (request.disabled or [])}
    requested_state = {
        **current,
        "enabled_builtin": sorted(builtin_plugins.BUILTIN_PLUGIN_IDS - requested_disabled),
        "disabled": sorted(requested_disabled),
    }
    if _deps().llm_wiki_enabled(current) != _deps().llm_wiki_enabled(requested_state):
        raise HTTPException(
            status_code=409,
            detail=("The LLM Wiki plugin must be changed through its confirmed lifecycle."),
        )
    current["disabled"] = sorted(requested_disabled)
    current["enabled_builtin"] = requested_state["enabled_builtin"]
    current["settings"] = request.settings if isinstance(request.settings, dict) else {}
    saved = _deps().save_state(current)
    _deps().reconcile()
    return saved


async def set_plugins_state(request: PluginsUpdateRequest) -> PluginState:
    """Persists which plugins are disabled and their per-plugin settings.

    Preserves `granted` (permissions granted to third-party plugins), which is
    managed by its own endpoint and doesn't travel in this payload.

    """
    async with _deps().mutation_lock():
        return await asyncio.to_thread(_updated_plugin_state, request)


async def set_plugin_lifecycle(
    plugin_id: str,
    payload: PluginLifecycleRequest,
    request: Request,
) -> PluginState:
    """Enable or disable a plugin and its confirmed dependency changes."""
    return await _deps().change_lifecycle()(plugin_id, payload, request)


async def set_llm_wiki_lifecycle(
    payload: LlmWikiLifecycleRequest,
    request: Request,
) -> PluginState:
    """Backward-compatible alias for the general lifecycle endpoint."""
    return await _deps().change_lifecycle()("llm-wiki", payload, request)


async def get_plugins_catalog() -> PluginState:
    """Catalog of available permissions (id → description) + host API version."""
    from backend.services import plugin_system

    return {
        "permissions": plugin_system.PERMISSIONS,
        "apiVersion": plugin_system.PLUGIN_API_VERSION,
    }


def _installed_plugins() -> PluginState:
    from backend.services import plugin_system

    state = _deps().load_state()
    installed: list[PluginState] = []
    for entry in plugin_system.discover_plugins(_deps().config_dir()):
        manifest = entry.get("manifest")
        if not manifest:
            installed.append({"id": entry.get("id"), "error": entry.get("error")})
            continue
        plugin_id = str(manifest["id"])
        installed.append(
            {
                "manifest": manifest,
                "enabled": builtin_plugins.is_enabled(state, plugin_id),
                "granted": plugin_system.granted_permissions(state, plugin_id),
                "provenance": entry.get("provenance") or None,
            }
        )
    return {"plugins": installed}


async def get_installed_plugins() -> PluginState:
    """Lists the installed third-party plugins with manifest + status + permissions."""
    return await asyncio.to_thread(_installed_plugins)


def _set_plugin_permissions(
    plugin_id: str,
    request: PluginPermissionsRequest,
) -> PluginState:
    from backend.services import plugin_system

    manifest = plugin_system.read_manifest(_deps().config_dir(), plugin_id)
    requested = [
        str(permission)
        for permission in (request.permissions or [])
        if permission in plugin_system.PERMISSIONS
    ]
    declared = {str(value) for value in (manifest.get("permissions") or [])}
    clean = [permission for permission in requested if permission in declared]
    state = _deps().load_state()
    new_state = plugin_system.set_granted(state, plugin_id, clean)
    _deps().save_state(new_state)
    _deps().reconcile()
    return {"id": plugin_id, "granted": clean}


async def set_plugin_permissions(
    plugin_id: str,
    request: PluginPermissionsRequest,
) -> PluginState:
    """Grants (or revokes) permissions to a third-party plugin."""
    from backend.services import plugin_system

    try:
        async with _deps().mutation_lock():
            return await asyncio.to_thread(
                _set_plugin_permissions,
                plugin_id,
                request,
            )
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _plugin_settings(plugin_id: str) -> PluginState:
    state = _deps().load_state()
    return {"settings": (state.get("settings") or {}).get(plugin_id) or {}}


async def get_plugin_settings(plugin_id: str) -> PluginState:
    """Returns a plugin's own configuration (`settings[plugin_id]`)."""
    return await asyncio.to_thread(_plugin_settings, plugin_id)


def _merge_plugin_settings(
    plugin_id: str,
    request: PluginSettingsRequest,
) -> PluginState:
    state = _deps().load_state()
    settings = dict(state.get("settings") or {})
    patch = request.settings if isinstance(request.settings, dict) else {}
    settings[plugin_id] = {**(settings.get(plugin_id) or {}), **patch}
    state["settings"] = settings
    _deps().save_state(state)
    return {"settings": settings[plugin_id]}


async def set_plugin_settings(
    plugin_id: str,
    request: PluginSettingsRequest,
) -> PluginState:
    """Merges a patch into a plugin's own configuration."""
    async with _deps().mutation_lock():
        return await asyncio.to_thread(_merge_plugin_settings, plugin_id, request)


def _fetch_for_ui_plugin(
    plugin_id: str,
    request: PluginNetworkFetchRequest,
) -> PluginState:
    from backend.services import plugin_dispatcher, plugin_system

    manifest = plugin_system.read_manifest(_deps().config_dir(), plugin_id)
    state = _deps().load_state()
    if "network" not in (manifest.get("permissions") or []):
        raise HTTPException(
            status_code=403,
            detail="Plugin does not declare network access",
        )
    if not plugin_system.has_permission(state, plugin_id, "network"):
        raise HTTPException(
            status_code=403,
            detail="Plugin network permission is not granted",
        )
    return dict(
        plugin_dispatcher.network_fetch(
            {"url": request.url, "opts": request.opts or {}},
            plugin_id,
        )
    )


async def fetch_for_ui_plugin(
    plugin_id: str,
    request: PluginNetworkFetchRequest,
) -> PluginState:
    """Proxy UI plugin networking through the backend SSRF and size guard."""
    from backend.services import plugin_system

    try:
        return await asyncio.to_thread(_fetch_for_ui_plugin, plugin_id, request)
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _summary_prompt(request: VaultSummaryRequest, content: str) -> str:
    return (
        "Summarize the following vault record in the requested language. "
        "Return a concise, factual Markdown summary with a short heading and "
        "3–5 bullets. Do not invent facts.\n\n"
        f"Language: {request.language}\n\nRecord:\n{content}"
    )


def _summarize_with_model(
    request: VaultSummaryRequest,
    content: str,
    provider: str,
    model_id: str,
) -> PluginState:
    from langchain_core.messages import HumanMessage

    from backend.agent.factory import get_llm
    from backend.agent.model_router import record_llm_usage, usage_from_message
    from backend.security.ai_credentials import resolve_provider_api_key

    ai_cfg = _deps().ai_configuration()
    provider_cfg = (ai_cfg.get("providers") or {}).get(provider, {}) or {}
    llm = get_llm(
        provider=provider,
        model=model_id,
        api_key=resolve_provider_api_key(provider, provider_cfg),
        base_url=provider_cfg.get("base_url"),
        timeout=60,
    )
    if not llm:
        raise HTTPException(
            status_code=503,
            detail="The configured summary model is unavailable.",
        )
    response = llm.invoke([HumanMessage(content=_summary_prompt(request, content))])
    summary = getattr(response, "content", "") or ""
    if not isinstance(summary, str):
        summary = str(summary)
    usage = usage_from_message(response)
    if usage:
        record_llm_usage(provider, model_id, usage[0], usage[1])
    return {"summary": summary.strip(), "model": f"{provider}:{model_id}"}


async def summarize_with_vault_plugin(
    request: VaultSummaryRequest,
) -> PluginState:
    """Create a concise summary using the explicitly configured active model."""
    content = request.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Content is required.")
    if len(content) > 60_000:
        raise HTTPException(
            status_code=422,
            detail="Content exceeds the 60,000 character limit.",
        )
    provider, model_id = await asyncio.to_thread(_deps().configured_summary_model)
    return await asyncio.to_thread(
        _summarize_with_model,
        request,
        content,
        provider,
        model_id,
    )


def _resolve_plugin_asset(plugin_id: str, asset_path: str) -> Path:
    from backend.services import plugin_system

    plugin_dir = plugin_system.plugin_dir(
        _deps().config_dir(),
        plugin_id,
    ).resolve()
    target = (plugin_dir / asset_path).resolve()
    if plugin_dir not in target.parents:
        raise HTTPException(status_code=400, detail="Invalid asset path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    return target


async def get_plugin_asset(plugin_id: str, asset_path: str) -> FileResponse:
    """Serves a static file from the plugin's directory (UI entry, etc.).

    Hardened against path-traversal: the id is validated and the resolved file must
    stay INSIDE the plugin's directory.

    """
    from backend.services import plugin_system

    try:
        target = await asyncio.to_thread(
            _resolve_plugin_asset,
            plugin_id,
            asset_path,
        )
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(str(target))


def _quarantine_installed_plugin(plugin_id: str) -> None:
    """Start a newly installed plugin disabled and without permissions."""
    from backend.services import plugin_system

    state = _deps().load_state()
    state = builtin_plugins.set_enabled(state, plugin_id, False)
    state = plugin_system.set_granted(state, plugin_id, [])
    _deps().save_state(state)


async def install_plugin(file: UploadFile = File(...)) -> PluginState:
    """Installs a third-party plugin from an uploaded .zip (with its manifest.json).

    Manifest validation + anti zip-slip extraction. Once installed it stays
    DISABLED and without permissions until the user grants them.

    """
    from backend.services import plugin_system

    data = await file.read()
    try:
        manifest = await asyncio.to_thread(
            plugin_system.install_from_zip,
            _deps().config_dir(),
            data,
            overwrite=True,
        )
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    async with _deps().mutation_lock():
        await asyncio.to_thread(_quarantine_installed_plugin, manifest["id"])
        await asyncio.to_thread(_deps().reconcile)
    return {"installed": manifest}


def _uninstall_plugin(plugin_id: str) -> None:
    from backend.services import plugin_system

    plugin_system.uninstall(_deps().config_dir(), plugin_id)
    state = _deps().load_state()
    state["disabled"] = [value for value in (state.get("disabled") or []) if value != plugin_id]
    state["enabled_third_party"] = [
        value for value in (state.get("enabled_third_party") or []) if value != plugin_id
    ]
    state = plugin_system.set_granted(state, plugin_id, [])
    _deps().save_state(state)
    _deps().reconcile()


async def uninstall_plugin(plugin_id: str) -> PluginState:
    """Uninstall a third-party plugin: delete its folder and clean up its state."""
    from backend.services import plugin_system

    try:
        async with _deps().mutation_lock():
            await asyncio.to_thread(_uninstall_plugin, plugin_id)
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"uninstalled": plugin_id}


async def export_plugin_package(plugin_id: str) -> Response:
    """Download a deterministic package for an installed third-party plugin."""
    from backend.services import plugin_system

    try:
        data = await asyncio.to_thread(
            plugin_system.package_plugin,
            _deps().config_dir(),
            plugin_id,
        )
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": (f'attachment; filename="{plugin_id}.gnosi-plugin.zip"'),
            "X-Content-SHA256": hashlib.sha256(data).hexdigest(),
        },
    )


def _submit_plugin_package(plugin_id: str) -> PluginState:
    from backend.services import marketplace_submission, plugin_system

    manifest = plugin_system.read_manifest(_deps().config_dir(), plugin_id)
    data = plugin_system.package_plugin(_deps().config_dir(), plugin_id)
    return dict(
        marketplace_submission.submit_package(
            kind="plugin",
            filename=(f"{plugin_id}-{manifest['version']}.gnosi-plugin.zip"),
            package=data,
            metadata=manifest,
        )
    )


async def submit_plugin_package(plugin_id: str) -> PluginState:
    """Upload an installed plugin to the configured moderation broker."""
    from backend.services import marketplace_submission, plugin_system

    try:
        return await asyncio.to_thread(_submit_plugin_package, plugin_id)
    except (
        plugin_system.PluginError,
        marketplace_submission.MarketplaceSubmissionError,
    ) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _plugin_catalog() -> PluginState:
    from backend.services import plugin_catalog, plugin_system

    config_dir = _deps().config_dir()
    state = _deps().load_state()
    installed_ids = {
        entry["manifest"]["id"]
        for entry in plugin_system.discover_plugins(config_dir)
        if entry.get("manifest")
    }
    registry_url = state.get("registry_url") or plugin_catalog.default_registry_url()
    catalog = [
        {
            **entry,
            "installed": entry.get("id") in installed_ids,
            "signed": bool(entry.get("signature")),
        }
        for entry in plugin_catalog.load_catalog(
            registry_url,
            config_dir,
            require_index_signature=True,
        )
    ]
    return {"catalog": catalog}


async def list_plugin_catalog() -> PluginState:
    """Lists the plugin catalog entries (gallery), marking their status.

    Adds `installed: bool` to each entry so the UI shows "Install" or
    "Installed".

    """
    return await asyncio.to_thread(_plugin_catalog)


def _install_from_catalog(request: CatalogInstallRequest) -> PluginState:
    from backend.services import plugin_catalog, plugin_system

    config_dir = _deps().config_dir()
    if request.url:
        return dict(
            plugin_catalog.install_from_url(
                config_dir,
                request.url,
                request.sha256,
                request.signature,
                require_integrity=True,
            )
        )
    if request.id:
        state = _deps().load_state()
        registry_url = state.get("registry_url") or plugin_catalog.default_registry_url()
        return dict(
            plugin_catalog.install_catalog_entry(
                config_dir,
                request.id,
                registry_url,
                require_index_signature=True,
            )
        )
    raise plugin_system.PluginError("`id` or `url` is required")


async def install_from_catalog(request: CatalogInstallRequest) -> PluginState:
    """Installs a plugin from the catalog (bundled by `id`, or remote by `url`)."""
    from backend.services import plugin_system

    try:
        manifest = await asyncio.to_thread(_install_from_catalog, request)
    except plugin_system.PluginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    async with _deps().mutation_lock():
        await asyncio.to_thread(_quarantine_installed_plugin, manifest["id"])
        await asyncio.to_thread(_deps().reconcile)
    return {"installed": manifest}


def _trusted_keys() -> PluginState:
    from backend.services import plugin_signing

    keys = plugin_signing.load_trust_store(_deps().config_dir())
    return {
        "keys": [
            {"name": name, "fingerprint": (public_key or "")[:16]}
            for name, public_key in keys.items()
        ]
    }


async def list_trusted_keys() -> PluginState:
    """Lists the NAMES of the trusted keys (doesn't expose the full key material)."""
    return await asyncio.to_thread(_trusted_keys)


def _add_trusted_key(request: TrustedKeyRequest) -> PluginState:
    from backend.services import plugin_signing

    plugin_signing.add_trusted_key(
        _deps().config_dir(),
        request.name,
        request.public_key,
    )
    return {"added": request.name}


async def add_trusted_key(request: TrustedKeyRequest) -> PluginState:
    """Adds a trusted Ed25519 public key (base64). Admin action."""
    try:
        return await asyncio.to_thread(_add_trusted_key, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _remove_trusted_key(name: str) -> PluginState:
    from backend.services import plugin_signing

    plugin_signing.remove_trusted_key(_deps().config_dir(), name)
    return {"removed": name}


async def remove_trusted_key(name: str) -> PluginState:
    """Removes a trusted key by its name."""
    return await asyncio.to_thread(_remove_trusted_key, name)


def _registry_url() -> PluginState:
    from backend.services import plugin_catalog

    return {
        "url": _deps().load_state().get("registry_url") or plugin_catalog.default_registry_url()
    }


async def get_registry_url() -> PluginState:
    """URL of the configured remote plugin index, or the official default."""
    return await asyncio.to_thread(_registry_url)


def _set_registry_url(url: str) -> PluginState:
    state = _deps().load_state()
    state["registry_url"] = url
    _deps().save_state(state)
    return {"url": url}


async def set_registry_url(request: RegistryUrlRequest) -> PluginState:
    """Configures (or clears) the URL of the remote plugin index."""
    url = (request.url or "").strip()
    if url and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=400,
            detail="Registry URL must use HTTP or HTTPS",
        )
    async with _deps().mutation_lock():
        return await asyncio.to_thread(_set_registry_url, url)


def register_routes(
    router: APIRouter,
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
        tuple[str, str, Callable[..., Any], Sequence[DependsParameter]],
        ...,
    ] = (
        ("GET", "/plugins", get_plugins_state, ()),
        ("PUT", "/plugins", set_plugins_state, admin),
        (
            "POST",
            "/plugins/{plugin_id}/lifecycle",
            set_plugin_lifecycle,
            admin,
        ),
        (
            "POST",
            "/plugins/llm-wiki/lifecycle",
            set_llm_wiki_lifecycle,
            admin,
        ),
        ("GET", "/plugins/catalog", get_plugins_catalog, ()),
        ("GET", "/plugins/installed", get_installed_plugins, ()),
        (
            "POST",
            "/plugins/{plugin_id}/permissions",
            set_plugin_permissions,
            admin,
        ),
        ("GET", "/plugins/{plugin_id}/settings", get_plugin_settings, ()),
        (
            "PUT",
            "/plugins/{plugin_id}/settings",
            set_plugin_settings,
            editor,
        ),
        (
            "POST",
            "/plugins/{plugin_id}/network/fetch",
            fetch_for_ui_plugin,
            editor,
        ),
        (
            "POST",
            "/plugins/vault-summary/summarize",
            summarize_with_vault_plugin,
            summary,
        ),
        (
            "GET",
            "/plugins/{plugin_id}/asset/{asset_path:path}",
            get_plugin_asset,
            (),
        ),
        ("POST", "/plugins/install", install_plugin, admin),
        ("DELETE", "/plugins/{plugin_id}", uninstall_plugin, admin),
        (
            "POST",
            "/plugins/{plugin_id}/export",
            export_plugin_package,
            editor,
        ),
        (
            "POST",
            "/plugins/{plugin_id}/submissions",
            submit_plugin_package,
            admin,
        ),
        ("GET", "/plugins/catalog/list", list_plugin_catalog, ()),
        (
            "POST",
            "/plugins/catalog/install",
            install_from_catalog,
            admin,
        ),
        ("GET", "/plugins/trust", list_trusted_keys, ()),
        ("POST", "/plugins/trust", add_trusted_key, admin),
        (
            "DELETE",
            "/plugins/trust/{name}",
            remove_trusted_key,
            admin,
        ),
        ("GET", "/plugins/registry-url", get_registry_url, ()),
        ("PUT", "/plugins/registry-url", set_registry_url, admin),
    )
    response_models = {
        fetch_for_ui_plugin: ConfigurationPluginNetworkFetchResponse,
        get_installed_plugins: ConfigurationInstalledPluginsResponse,
        get_plugins_catalog: ConfigurationPluginPermissionsCatalogResponse,
        get_plugins_state: ConfigurationPluginStateResponse,
        get_registry_url: ConfigurationPluginRegistryUrlResponse,
        get_plugin_settings: PluginSettingsResponse,
        list_plugin_catalog: ConfigurationPluginCatalogResponse,
        list_trusted_keys: ConfigurationPluginTrustedKeysResponse,
        set_plugin_lifecycle: ConfigurationPluginStateResponse,
        set_plugin_settings: PluginSettingsResponse,
        summarize_with_vault_plugin: VaultPluginSummaryResponse,
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
