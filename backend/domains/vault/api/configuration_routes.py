"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

from backend.domains.vault.comments import composition as _comment_composition
from backend.domains.vault.comments.api import CommentDependencies as _typed_CommentDependencies
from backend.domains.vault.comments.composition import (
    _get_comments_path as _get_comments_path,
    _load_comments as _load_comments,
    _save_comments as _save_comments,
)

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")


_COMMENTS_DEPENDENCIES: _typed_CommentDependencies = _comment_composition.build_dependencies()
list_page_comments, add_page_comment, update_page_comment, delete_page_comment = (
    _comment_composition.register_page_comments(_COMMENTS_DEPENDENCIES)
)
from backend.domains.configuration import llm_wiki as llm_wiki_configuration
from backend.domains.configuration import llm_wiki_records, llm_wiki_schema, plugin_state
from backend.domains.configuration.api import plugin_lifecycle, plugin_models
from backend.domains.configuration.api import plugins as plugins_api


def _get_plugins_path() -> _legacy.Path:
    return _legacy.get_p("GNOSI_CONFIG") / "plugins.json"


plugin_state.configure(
    plugin_state.PluginStateDependencies(
        path=lambda: _legacy._get_plugins_path(),
        normalize_state=_legacy.builtin_plugins.normalize_state,
        write_json=_legacy.safe_write_json,
        logger=_legacy.log,
    )
)
_plugins_lock = plugin_state.store().lock
_plugins_mutation_lock = plugin_state.store().mutation_lock


def _load_plugins_state() -> dict[str, _LegacyAny]:
    return plugin_state.store().load()


def _save_plugins_state(state: dict[str, _LegacyAny]) -> dict[str, _LegacyAny]:
    return plugin_state.store().save(state)


def _llm_wiki_enabled(state: dict[str, _LegacyAny]) -> bool:
    return plugins_api.llm_wiki_enabled(state)


def _reconcile_plugin_ai_contributions() -> dict[str, _LegacyAny]:
    return plugins_api.reconcile_plugin_ai_contributions()


async def _refresh_plugin_runtime(request: _legacy.Request, state: dict[str, _LegacyAny]) -> None:
    await plugin_lifecycle.refresh_plugin_runtime(request, state, _legacy.log)


def _plugin_lifecycle_dependencies() -> plugin_lifecycle.PluginLifecycleDependencies:
    return plugin_lifecycle.PluginLifecycleDependencies(
        load_state=lambda: _legacy._load_plugins_state(),
        save_state=lambda state: _legacy._save_plugins_state(state),
        mutation_lock=lambda: _legacy._plugins_mutation_lock,
        config_dir=lambda: _legacy._get_plugins_path().parent,
        reconcile=lambda: _legacy._reconcile_plugin_ai_contributions(),
        refresh_runtime=lambda request, state: _legacy._refresh_plugin_runtime(request, state),
        logger=_legacy.log,
    )


async def _change_plugin_lifecycle(
    plugin_id: str, payload: plugin_models.PluginLifecycleRequest, request: _legacy.Request
) -> dict[str, _LegacyAny]:
    return await plugin_lifecycle.change_plugin_lifecycle(
        plugin_id, payload, request, _plugin_lifecycle_dependencies()
    )


def _configured_summary_model() -> tuple[str, str]:
    return plugins_api.configured_summary_model()


def _plugin_ai_configuration() -> dict[str, _LegacyAny]:
    return dict(_legacy.load_params(strict_env=False).get("ai", {}) or {})


plugins_api.configure(
    plugins_api.PluginApiDependencies(
        config_dir=lambda: _legacy.get_p("GNOSI_CONFIG"),
        load_state=lambda: _legacy._load_plugins_state(),
        save_state=lambda state: _legacy._save_plugins_state(state),
        mutation_lock=lambda: _legacy._plugins_mutation_lock,
        llm_wiki_enabled=lambda state: _legacy._llm_wiki_enabled(state),
        reconcile=lambda: _legacy._reconcile_plugin_ai_contributions(),
        change_lifecycle=lambda: _legacy._change_plugin_lifecycle,
        configured_summary_model=lambda: _legacy._configured_summary_model(),
        ai_configuration=_plugin_ai_configuration,
        logger=_legacy.log,
    )
)
PluginsUpdateRequest = plugin_models.PluginsUpdateRequest
PluginLifecycleRequest = plugin_models.PluginLifecycleRequest
LlmWikiLifecycleRequest = plugin_models.LlmWikiLifecycleRequest
PluginPermissionsRequest = plugin_models.PluginPermissionsRequest
PluginSettingsRequest = plugin_models.PluginSettingsRequest
PluginNetworkFetchRequest = plugin_models.PluginNetworkFetchRequest
VaultSummaryRequest = plugin_models.VaultSummaryRequest
CatalogInstallRequest = plugin_models.CatalogInstallRequest
TrustedKeyRequest = plugin_models.TrustedKeyRequest
RegistryUrlRequest = plugin_models.RegistryUrlRequest
get_plugins_state = plugins_api.get_plugins_state
set_plugins_state = plugins_api.set_plugins_state
set_plugin_lifecycle = plugins_api.set_plugin_lifecycle
set_llm_wiki_lifecycle = plugins_api.set_llm_wiki_lifecycle
get_plugins_catalog = plugins_api.get_plugins_catalog
get_installed_plugins = plugins_api.get_installed_plugins
set_plugin_permissions = plugins_api.set_plugin_permissions
get_plugin_settings = plugins_api.get_plugin_settings
set_plugin_settings = plugins_api.set_plugin_settings
fetch_for_ui_plugin = plugins_api.fetch_for_ui_plugin
summarize_with_vault_plugin = plugins_api.summarize_with_vault_plugin
get_plugin_asset = plugins_api.get_plugin_asset
install_plugin = plugins_api.install_plugin
uninstall_plugin = plugins_api.uninstall_plugin
export_plugin_package = plugins_api.export_plugin_package
submit_plugin_package = plugins_api.submit_plugin_package
list_plugin_catalog = plugins_api.list_plugin_catalog
install_from_catalog = plugins_api.install_from_catalog
list_trusted_keys = plugins_api.list_trusted_keys
add_trusted_key = plugins_api.add_trusted_key
remove_trusted_key = plugins_api.remove_trusted_key
get_registry_url = plugins_api.get_registry_url
set_registry_url = plugins_api.set_registry_url


def _quarantine_installed_plugin(plugin_id: str) -> None:
    plugins_api._quarantine_installed_plugin(plugin_id)


plugins_api.register_routes(
    _legacy.router,
    admin_dependencies=[_legacy.Depends(_legacy.require_role("admin"))],
    editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    summary_dependencies=[
        _legacy.Depends(_legacy.require_role("editor")),
        _legacy.Depends(_legacy.require_plugins("vault-summary", "ai-platform")),
    ],
)


def get_table_id(metadata: dict[_LegacyAny, _LegacyAny] | None) -> str | None:
    """Returns the table_id of a record, looking at both alias keys.

    The codebase has historically written both `database_table_id` (newer,
    preferred) and `table_id` (legacy). PATCH writes both; older imports
    only set one. Centralizing the lookup avoids repeating the
    `or`-chain in 10+ call sites and makes future migrations one-line.
    """
    if not metadata:
        return None
    val = metadata.get("database_table_id") or metadata.get("table_id")
    return str(val) if val else None


def _canonicalize_id(page_id: _LegacyAny) -> str:
    """Returns the canonical form of a UUID-ish id for comparisons.

    Notion exports IDs as 32-char no-dash hex (`df3614865ff34a1490055d9b7b456492`).
    Gnosi/UUID standard form has dashes (`df361486-5ff3-4a14-9005-5d9b7b456492`).
    Some legacy frontmatter, manual edits, parent_id refs, and link resolution
    paths can carry either form. Comparing as raw strings causes silent
    misses ("page not found" when it's there). This helper strips dashes,
    spaces, and case so both forms map to the same canonical key.
    """
    s = str(page_id or "").strip().lower().replace("-", "")
    return s


def find_page_path(page_id: str, *, allow_full_scan: bool = True) -> _legacy.Path | None:
    """Resolve one page through the canonical page-domain resolver."""
    return _legacy.page_resolver.find_page_path(page_id, allow_full_scan=allow_full_scan)


def _find_page_path_for_write(page_id: str) -> _legacy.Path | None:
    """Find a page for a write, repairing a stale index once on a cache miss.

    External OneDrive renames can leave the in-memory page index behind while
    the Markdown file is still present. Read paths should fail fast for stale
    IDs, but a user edit must get one authoritative index refresh before the
    server returns a misleading 404.
    """
    file_path = _legacy.find_page_path(page_id)
    if file_path:
        return file_path
    _legacy.log.info("🔄 Page %s missing from write index; refreshing page index once.", page_id)
    try:
        _legacy._get_cached_page_entries(force_refresh=True)
    except Exception as exc:
        _legacy.log.warning("Page index refresh failed while saving %s: %s", page_id, exc)
        return None
    return _legacy.find_page_path(page_id, allow_full_scan=False)


async def _materialize_if_online_only(file_path: _legacy.Path, label: str = "") -> None:
    """Materializes the file if OneDrive has it as online-only (`dataless`)
    BEFORE reading it, avoiding the `OSError [Errno 35]` (EDEADLK) that
    occurs when reading it from inside the container.

    Silent no-op if it fails (warmup daemon down, out of scope, etc.): the
    caller keeps its retry loop as a safety net. It's the same
    pattern already followed by `_compute_preview` for previews.

    """
    try:
        provider = _legacy.get_files_provider()
        st = file_path.stat()
        if provider.is_online_only(file_path, st):
            await provider.materialize(file_path)
    except OSError:
        pass
    except Exception as e:
        _legacy.log.debug(f"Proactive warmup failed for {label or file_path}: {e}")


async def _ensure_materialized_or_503(p: _legacy.Path, label: str = "") -> None:
    """File-insert flows: if the picked file is an online-only OneDrive/iCloud
    placeholder, download it now (like Office/Adobe do on open) and WAIT for it.

    Unlike `_materialize_if_online_only` (a best-effort warmup that swallows
    failures), this reports a 503 when the file can't be materialized, so we
    never register a file the reader won't be able to open afterwards.
    """
    provider = _legacy.get_files_provider()
    try:
        st = p.stat()
    except OSError:
        return
    if not provider.is_online_only(p, st):
        return
    _legacy.log.info("☁️ Online-only file during insertion (%s): materializing %s…", label, p.name)
    ok = await provider.materialize(p)
    if not ok:
        raise _legacy.HTTPException(
            status_code=503,
            detail="The file is online-only and could not be downloaded from OneDrive/iCloud. Check that the cloud service is running and try again.",
        )


_legacy.page_queries_api.register_page_route(_legacy.router)
get_page = _legacy.page_queries_api.get_page


def _build_preview_excerpt(body: str, max_chars: int = 320) -> str:
    """Extracts the first meaningful paragraph from the markdown, sanitized for tooltips."""
    if not body:
        return ""
    text = str(body)
    text = _legacy.re.sub("```[\\s\\S]*?```", " ", text)
    text = _legacy.re.sub("<[^>]+>", " ", text)
    text = _legacy.re.sub(
        "\\[\\[([^\\]|#]+)(?:#[^\\]|]+)?(?:\\|([^\\]]+))?\\]\\]",
        lambda m: (m.group(2) or m.group(1)).strip(),
        text,
    )
    text = _legacy.re.sub("\\[([^\\]]+)\\]\\([^)]+\\)", "\\1", text)
    text = _legacy.re.sub("!\\[[^\\]]*\\]\\([^)]*\\)", " ", text)
    text = _legacy.re.sub("^#{1,6}\\s+", "", text, flags=_legacy.re.MULTILINE)
    text = _legacy.re.sub("(\\*\\*|__)(.+?)\\1", "\\2", text)
    text = _legacy.re.sub("(\\*|_)(.+?)\\1", "\\2", text)
    text = _legacy.re.sub("^>\\s?", "", text, flags=_legacy.re.MULTILINE)
    text = _legacy.re.sub("^\\s*[-*+]\\s+", "", text, flags=_legacy.re.MULTILINE)
    text = _legacy.re.sub("^\\s*\\d+\\.\\s+", "", text, flags=_legacy.re.MULTILINE)
    text = _legacy.re.sub("`([^`]+)`", "\\1", text)
    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln and (not _legacy.re.fullmatch("[-=_*]{3,}", ln))]
    text = "\n".join(lines)
    paragraphs = [p.strip() for p in _legacy.re.split("\\n{2,}|\\n", text) if p.strip()]
    if not paragraphs:
        return ""
    excerpt = paragraphs[0]
    idx = 1
    while len(excerpt) < max_chars * 0.6 and idx < len(paragraphs):
        candidate = excerpt + " " + paragraphs[idx]
        if len(candidate) > max_chars * 1.2:
            break
        excerpt = candidate
        idx += 1
    excerpt = _legacy.re.sub("\\s+", " ", excerpt).strip()
    if len(excerpt) > max_chars:
        cut = excerpt[:max_chars]
        last_space = cut.rfind(" ")
        if last_space > max_chars * 0.7:
            cut = cut[:last_space]
        excerpt = cut.rstrip(".,;:") + "…"
    return _strict_cast(str, excerpt)
