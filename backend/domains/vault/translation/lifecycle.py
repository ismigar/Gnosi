"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

import importlib as _legacy_importlib
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import httpx
from fastapi import BackgroundTasks

from backend.domains.vault.drupal.fields import DrupalFieldDependencies
from backend.domains.vault.drupal.media import DrupalUploadDependencies
from backend.domains.vault.translation.adapters import DetectLanguage
from backend.domains.vault.translation.types import Metadata, Result, TranslateText

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")


class DrupalConnector(Protocol):
    """Real connector capabilities consumed by the lazy media factories."""

    @property
    def DrupalSyncError(self) -> type[Exception]: ...

    def _client(self) -> httpx.AsyncClient: ...

    def markdown_to_full_html(self, md: str, /) -> str: ...

    async def find_existing_file(
        self, filename: str, filesize: int | None = None, /
    ) -> str | None: ...

    async def upload_image(
        self, bundle: str, field_name: str, filename: str, data: bytes, /
    ) -> str: ...

    async def resolve_or_create_term(
        self, vocabulary: str, name: str, /, *, cache: dict[str, str] | None = None
    ) -> str: ...


def _read_deepl_key() -> str:
    """DeepL API key from the macOS Keychain (preferred), env fallback.

    Returns "" when unavailable — the skills degrade to free providers /
    visible placeholders rather than failing.
    """
    return _legacy.translation_adapters.read_deepl_key(_legacy.log)


def _load_translate_row_skill() -> tuple[TranslateText, DetectLanguage]:
    """Lazy import of the row skill (translate, detect_source_lang).

    Deferred so a missing optional dependency never breaks app startup —
    translation is opt-in per table.
    """
    return _legacy.translation_adapters.load_translate_row_skill(_legacy.log)


async def _get_existing_translations(origin_id: str) -> dict[str, object]:
    """Return ``{lang: PageInfo}`` of translation children already created for an
    origin. Powers idempotent re-translation: a language that already has a
    subitem/subpage is updated in place instead of duplicated. The lookup runs
    over the TTL-cached page snapshot (in-memory) so it adds no disk I/O.
    """
    return await _legacy.translation_lookup.existing_translations(
        origin_id, _TRANSLATION_LOOKUP_DEPENDENCIES
    )


async def _recover_translations_from_disk(
    origin_id: str, table_dir: Path, known_langs: Iterable[object]
) -> dict[str, object]:
    """Safety net for translate-row idempotency under OneDrive.

    Scans the table directory only when the in-memory snapshot misses a target
    language, materializes cloud files and repairs the canonical page index.
    """
    return await _legacy.translation_lookup.recover_translations_from_disk(
        origin_id, table_dir, known_langs, _TRANSLATION_LOOKUP_DEPENDENCIES
    )


def _ensure_status_options_persisted(table_id: str, values: list[object]) -> None:
    """Best-effort: ensures in the ON-DISK registry that the status field has the
    `values` options (directive §4.1.5: a rule never fails due to an
    incomplete catalog). Called when an action_rules effect has had to create an
    option on the table's in-memory copy — it reapplies the change
    on a fresh load and persists it."""
    dependencies = _legacy.table_status_options.StatusOptionDependencies(
        registry_mutation=lambda: _legacy.registry_mutation(),
        load_registry=lambda: _legacy.load_registry(),
        save_registry=lambda registry: _legacy.save_registry(registry),
        find_role_property=lambda table, role: _legacy.option_catalogs_service.find_role_prop(
            table, role
        ),
        status_role=_legacy.option_catalogs_service.ROLE_STATUS,
        is_global_status_property=lambda prop: (
            _legacy.option_catalogs_service.is_global_status_prop(prop)
        ),
        status_catalog_reference=_legacy.option_catalogs_service.STATUS_CATALOG_REF,
        normalize_options=lambda options: _legacy.option_catalogs_service.normalize_options(
            options
        ),
        auto_color=lambda value: _legacy.option_catalogs_service.auto_color(value),
        ensure_options_exist=lambda prop, wanted: (
            _legacy.option_catalogs_service.ensure_options_exist(prop, wanted)
        ),
        logger=_legacy.log,
    )
    _legacy.table_status_options.ensure_status_options_persisted(table_id, values, dependencies)


_TRANSLATION_LOOKUP_DEPENDENCIES = _legacy.translation_lookup.TranslationLookupDependencies(
    page_snapshot=lambda: _legacy._get_pages_snapshot(),
    find_translations=lambda origin_id, pages: _legacy.find_translations_of(origin_id, pages),
    canonicalize_id=lambda page_id: _legacy._canonicalize_id(page_id),
    materialize=lambda path, label: _legacy._materialize_if_online_only(path, label),
    read_frontmatter_partial=lambda path: _legacy._read_frontmatter_partial(path),
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    build_page_cache_entry=lambda path, stat_result: _legacy._build_page_cache_entry(
        path, stat_result
    ),
    bump_page_index_version=lambda vault_key: _legacy._bump_page_index_version(vault_key),
    invalidate_pages=lambda: _legacy._pages_cache_invalidate_all(),
    page_state=_legacy.page_state,
    logger=_legacy.log,
)
_TRANSLATION_METADATA_DEPENDENCIES = (
    _legacy.translation_metadata_io.TranslationMetadataDependencies(
        parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
        save_page=lambda path, metadata, body: _legacy.save_page_md(path, metadata, body),
        refresh_page_index=lambda path, metadata, body: _legacy._refresh_page_index_entry(
            path, metadata, body
        ),
        invalidate_pages=lambda: _legacy._pages_cache_invalidate_all(),
        effect_write_key=lambda metadata, prop: _legacy.action_rules_service.effect_write_key(
            metadata, prop
        ),
        logger=_legacy.log,
    )
)
_TRANSLATION_STALENESS_DEPENDENCIES = (
    _legacy.translation_staleness.TranslationStalenessDependencies(
        table_id=lambda metadata: _legacy.get_table_id(metadata),
        table_by_id=lambda table_id: _legacy._table_by_id(table_id),
        content_changed=lambda *args, **kwargs: _legacy.translatable_content_changed(
            *args, **kwargs
        ),
        find_translations=lambda origin_id, pages: _legacy.find_translations_of(origin_id, pages),
        page_snapshot=lambda: _legacy._get_pages_snapshot(),
        on_stale_effect=lambda table: _legacy.action_rules_service.on_stale_effect(table),
        persist_status_options=lambda table_id, values: _ensure_status_options_persisted(
            table_id, values
        ),
        find_page=lambda page_id: _legacy.find_page_path(page_id),
        set_stale=lambda page_id, path, status: _set_translation_stale_on_disk(
            page_id, path, stale_status=status
        ),
        logger=_legacy.log,
    )
)
_ROW_TRANSLATION_DEPENDENCIES = _legacy.translation_row_service.RowTranslationDependencies(
    find_page=lambda page_id: _legacy.find_page_path(page_id),
    parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
    table_id=lambda metadata: _legacy.get_table_id(metadata),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    check_requires=lambda table, action, metadata: _legacy.action_rules_service.check_requires(
        table, action, metadata
    ),
    action_translate=_legacy.action_rules_service.ACTION_TRANSLATE,
    detect_record_source_lang=lambda metadata: _legacy.detect_record_source_lang(metadata),
    is_composite_image_value=lambda value: _legacy.is_composite_image_value(value),
    is_image_field_name=lambda name: _legacy.is_image_field_name(name),
    translate_image_field=lambda value, translate_one: _legacy.translate_image_field(
        value, translate_one
    ),
    language_field_assignment=lambda properties, language, metadata: (
        _legacy.language_field_assignment(properties, language, metadata)
    ),
    status_effect=lambda table, action, target: _legacy.action_rules_service.status_effect(
        table, action, target
    ),
    effect_write_key=lambda metadata, prop: _legacy.action_rules_service.effect_write_key(
        metadata, prop
    ),
    persist_status_options=lambda table_id, values: _ensure_status_options_persisted(
        table_id, values
    ),
    write_metadata_key=lambda page_id, path, key, value: _write_metadata_key_on_disk(
        page_id, path, key, value
    ),
    existing_translations=lambda origin_id: _legacy._get_existing_translations(origin_id),
    recover_translations=lambda origin_id, directory, known: _recover_translations_from_disk(
        origin_id, directory, known
    ),
    materialize=lambda path, label: _legacy._materialize_if_online_only(path, label),
    known_translations=lambda origin_id: _legacy.translation_index.get_known_translations(
        origin_id
    ),
    record_translation=lambda origin_id, language, page_id: (
        _legacy.translation_index.record_translation(origin_id, language, page_id)
    ),
    forget_translation=lambda origin_id, language: _legacy.translation_index.forget_translation(
        origin_id, language
    ),
    create_page=lambda request, tasks: _legacy.create_page(request, tasks),
    patch_page=lambda page_id, request, tasks: _legacy.patch_page(page_id, request, tasks),
    load_markdown_translator=lambda: _legacy.translation_adapters.load_translate_page_skill(
        _legacy.log
    )[0],
    logger=_legacy.log,
)
_PAGE_TRANSLATION_DEPENDENCIES = _legacy.translation_page_service.PageTranslationDependencies(
    load_translators=lambda: _legacy.translation_adapters.load_translate_page_skill(_legacy.log),
    read_deepl_key=lambda: _legacy._read_deepl_key(),
    find_page=lambda page_id: _legacy.find_page_path(page_id),
    parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
    detect_record_source_lang=lambda metadata: _legacy.detect_record_source_lang(metadata),
    existing_translations=lambda origin_id: _legacy._get_existing_translations(origin_id),
    create_page=lambda request, tasks: _legacy.create_page(request, tasks),
    patch_page=lambda page_id, request, tasks: _legacy.patch_page(page_id, request, tasks),
    logger=_legacy.log,
)


def _write_metadata_key_on_disk(
    page_id: str, file_path: Path, key: str, value: object
) -> bool:
    """Writes a SINGLE metadata key directly to the file (without going through
    the PATCH: no rule engine, no etags, no re-resolution by id — we already have the path).
    Idempotent: if the value is already there, it doesn't write. Refreshes the cache like the
    staleness flag does. Used by action_rules effects on the original."""
    return _legacy.translation_metadata_io.write_metadata_key_on_disk(
        page_id, file_path, key, value, _TRANSLATION_METADATA_DEPENDENCIES
    )


def _set_translation_stale_on_disk(
    page_id: str, file_path: Path, stale_status: tuple[Metadata, object] | None = None
) -> bool:
    """Flag a single translation page as stale on disk. Idempotent.

    Returns True only when it actually wrote (flag flipped). Writes the minimal
    change directly with ``save_page_md`` — NOT through the PATCH handler — so it
    never re-enters the rule engine, etag checks, or this very propagation.
    """
    return _legacy.translation_metadata_io.set_translation_stale_on_disk(
        page_id, file_path, stale_status, _TRANSLATION_METADATA_DEPENDENCIES
    )


def _propagate_translation_staleness(
    origin_id: str,
    old_md: Metadata | None,
    new_md: Metadata | None,
    old_body: str | None,
    new_body: str | None,
) -> None:
    """Background task: flag an original's translations stale after a real edit.

    Guards (all required to keep autosave cheap and avoid loops):
      • The edited page must NOT itself be a translation (`translation_lang`).
      • The change must touch translatable content (`translatable_content_changed`)
        — icon/cover/cursor churn is ignored.
      • Each child write is idempotent (`_set_translation_stale_on_disk`).

    It never regenerates translations (too costly/risky); it only signals that a
    re-translation is due. Re-translation is idempotent, so acting on the signal
    updates in place.
    """
    _legacy.translation_staleness.propagate_translation_staleness(
        origin_id, old_md, new_md, old_body, new_body, _TRANSLATION_STALENESS_DEPENDENCIES
    )


async def _do_translate_row(
    item_id: str,
    target_languages: list[object],
    *,
    translate_fn: TranslateText,
    detect_fn: DetectLanguage,
    deepl_api_key: str,
    background_tasks: BackgroundTasks,
) -> Result:
    """Translate one row's translatable fields into one subitem per language.

    Creates the per-language subitem the first time and UPDATES it in place on
    re-translation (idempotent — keyed by `translation_origin_id` +
    `translation_lang`). Raises HTTPException for caller-visible problems; the
    single endpoint re-raises them, the bulk endpoint catches them per item.
    """
    return await _legacy.translation_row_service.translate_row(
        item_id,
        target_languages,
        translate_fn=translate_fn,
        detect_fn=detect_fn,
        deepl_api_key=deepl_api_key,
        background_tasks=background_tasks,
        dependencies=_ROW_TRANSLATION_DEPENDENCIES,
    )


def _drupal_client_module() -> DrupalConnector:
    """Resolve the compatibility connector lazily for optional Drupal usage."""
    from backend.services import drupal_sync_service as drupal

    return drupal


_DRUPAL_PATH_DEPENDENCIES = _legacy.drupal_media.DrupalPathDependencies(
    assets_root=lambda: _legacy.get_p("ASSETS"),
    home_path=lambda: _legacy.Path(
        _legacy.os.environ.get("HOME_HOST_PATH") or _legacy.os.path.expanduser("~")
    ),
)
_DRUPAL_MARKDOWN_DEPENDENCIES = _legacy.drupal_markdown.DrupalMarkdownDependencies(
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    page_state=_legacy.page_state,
    find_page=lambda page_id: _legacy.find_page_path(page_id),
    parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
    markdown_to_html=lambda markdown: _legacy._drupal_client_module().markdown_to_full_html(
        markdown
    ),
)
_DRUPAL_LANGUAGE_DEPENDENCIES = _legacy.drupal_languages.DrupalLanguageDependencies(
    client=lambda: _legacy._drupal_client_module()._client(),
    detect_record_lang_raw=lambda metadata: _legacy.detect_record_lang_raw(metadata),
    detect_record_source_lang=lambda metadata: _legacy.detect_record_source_lang(metadata),
    logger=_legacy.log,
)


def _drupal_upload_dependencies() -> DrupalUploadDependencies:
    drupal = _legacy._drupal_client_module()
    return _legacy.drupal_media.DrupalUploadDependencies(
        resolve_local_path=lambda value: _legacy._drupal_resolve_local_path(value),
        materialize=lambda path, label: _legacy._materialize_if_online_only(path, label),
        shrink_pdf=lambda data, filename: _legacy._drupal_shrink_pdf(data, filename),
        shrink_image=lambda data, filename: _legacy._drupal_shrink_image(data, filename),
        find_existing_file=lambda filename, size: drupal.find_existing_file(filename, size),
        upload_image=lambda bundle, field, filename, data: drupal.upload_image(
            bundle, field, filename, data
        ),
    )


def _drupal_field_dependencies() -> DrupalFieldDependencies:
    drupal = _legacy._drupal_client_module()
    return _legacy.drupal_fields.DrupalFieldDependencies(
        sync_error=drupal.DrupalSyncError,
        markdown_to_html=lambda markdown, cache: _legacy._drupal_md_to_html(markdown, cache),
        read_prop_value=lambda metadata, prop: _legacy._drupal_read_prop_value(metadata, prop),
        upload_field_image=lambda value, bundle, field, metadata, cache: (
            _legacy._drupal_upload_field_image(value, bundle, field, metadata, cache)
        ),
        resolve_or_create_term=lambda vocabulary, name, cache: drupal.resolve_or_create_term(
            vocabulary, name, cache=cache
        ),
        coerce_scalar=lambda value, field_type: _legacy._drupal_coerce_scalar(value, field_type),
    )
