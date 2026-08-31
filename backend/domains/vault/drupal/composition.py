"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

import importlib as _legacy_importlib
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import BackgroundTasks

from backend.domains.vault.drupal.core import Metadata
from backend.domains.vault.drupal.matching import DrupalMatchingDependencies
from backend.domains.vault.drupal.service import DrupalSyncDependencies, Result
from backend.domains.vault.schemas.pages import PageInfo

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")


def _drupal_sync_dependencies() -> DrupalSyncDependencies:
    drupal = _legacy._drupal_client_module()
    return _legacy.drupal_service.DrupalSyncDependencies(
        sync_error=drupal.DrupalSyncError,
        not_found_error=drupal.DrupalNotFound,
        find_page=lambda page_id: _legacy.find_page_path(page_id),
        materialize=lambda path, label: _legacy._materialize_if_online_only(path, label),
        parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
        table_id=lambda metadata: _legacy.get_table_id(metadata),
        table_by_id=lambda table_id: _legacy._table_by_id(table_id),
        inject_virtual_fields=lambda table, page_id, metadata, loader: (
            _legacy._vf_inject_for_single_page(table, page_id, metadata, loader)
        ),
        virtual_page_loader=lambda page_id: _legacy._vf_page_loader(page_id),
        check_requires=lambda table, action, metadata: _legacy.action_rules_service.check_requires(
            table, action, metadata
        ),
        action_sync_drupal=_legacy.action_rules_service.ACTION_SYNC_DRUPAL,
        props_by_ref=lambda table: _drupal_props_by_ref(table),
        list_fields=lambda bundle: drupal.list_fields(bundle),
        build_fields=lambda **kwargs: _drupal_build_fields(**kwargs),
        resolve_langcode=lambda metadata: _drupal_resolve_langcode(metadata),
        image_mapping=lambda mapping, field_meta: _drupal_image_mapping(mapping, field_meta),
        field_translatable=lambda bundle, field: _drupal_field_translatable(bundle, field),
        read_prop_value=lambda metadata, prop: _drupal_read_prop_value(metadata, prop),
        upload_field_image=lambda value, bundle, field, metadata, cache: _drupal_upload_field_image(
            value, bundle, field, metadata, cache
        ),
        uuid_to_fid=lambda file_uuid: _drupal_uuid_to_fid(file_uuid),
        row_image_alt=lambda metadata, props, image_ref: _drupal_row_image_alt(
            metadata, props, image_ref
        ),
        find_nodes_by_title=lambda bundle, title: drupal.find_nodes_by_title(bundle, title),
        add_translation=lambda uuid, language, fields: drupal.add_translation(
            uuid, language, fields
        ),
        base_url=lambda: drupal.base_url(),
        create_node=lambda bundle, attributes, relationships, language: drupal.create_node(
            bundle, attributes, relationships, langcode=language
        ),
        update_node=lambda uuid, bundle, attributes, relationships: drupal.update_node(
            uuid, bundle, attributes, relationships
        ),
        media_signatures=lambda mapping, props, fields, metadata: _drupal_media_signatures(
            mapping, props, fields, metadata
        ),
        existing_translations=lambda origin_id: _legacy._get_existing_translations(origin_id),
        pages_for_table=lambda table_id: _legacy._get_pages_for_table(table_id),
        identity_metadata=lambda table, uuid, nid, url: _drupal_identity_meta(
            table, uuid, nid, url
        ),
        status_effect=lambda table, action, target: _legacy.action_rules_service.status_effect(
            table, action, target
        ),
        effect_write_key=lambda metadata, prop: _legacy.action_rules_service.effect_write_key(
            metadata, prop
        ),
        persist_status_options=lambda table_id, values: _legacy._ensure_status_options_persisted(
            table_id, values
        ),
        patch_page=lambda page_id, request, tasks: _legacy.patch_page(page_id, request, tasks),
        logger=_legacy.log,
    )


def _drupal_matching_dependencies() -> DrupalMatchingDependencies:
    drupal = _legacy._drupal_client_module()
    return _legacy.drupal_matching.DrupalMatchingDependencies(
        sync_error=drupal.DrupalSyncError,
        table_by_id=lambda table_id: _legacy._table_by_id(table_id),
        pages_for_table=lambda table_id: _legacy._get_pages_for_table(table_id),
        find_nodes_by_title=lambda bundle, title: drupal.find_nodes_by_title(bundle, title),
        identity_metadata=lambda table, uuid, nid, url: _drupal_identity_meta(
            table, uuid, nid, url
        ),
        patch_page=lambda page_id, request, tasks: _legacy.patch_page(page_id, request, tasks),
    )


DRUPAL_BODY_REF = "__body__"


def _drupal_props_by_ref(table: Metadata) -> dict[str, Metadata]:
    """Index of the table's properties by stable id and by name."""
    return _legacy.drupal_core.props_by_ref(table)


def _drupal_find_column(
    table: Metadata, name: str
) -> Metadata | None:
    """Property by name (case-insensitive); for the NID/URL columns."""
    return _legacy.drupal_core.find_column(table, name)


def _drupal_identity_meta(
    table: Metadata, uuid: object, nid: object, url: object
) -> Metadata:
    """Drupal identity metadata to write to the row."""
    return _legacy.drupal_core.identity_metadata(table, uuid, nid, url)


def _drupal_read_prop_value(
    metadata: Metadata, prop: Metadata | None
) -> object:
    """Value of a property in the frontmatter, prioritized title→id→name."""
    return _legacy.drupal_core.read_prop_value(metadata, prop)


def _drupal_coerce_scalar(value: object, field_type: str | None) -> object:
    """Adapts a Gnosi scalar value to the Drupal field type."""
    return _legacy.drupal_core.coerce_scalar(value, field_type)


def _drupal_reanchor_home(p: Path) -> Path:
    """Re-anchors an absolute File Provider path to the real HOME."""
    return _legacy.drupal_media.reanchor_home(p, _legacy._DRUPAL_PATH_DEPENDENCIES)


def _drupal_resolve_local_path(value: object) -> Path | None:
    """Resolves the value of an image/file field to a local path on disk."""
    return _legacy.drupal_media.resolve_local_path(value, _legacy._DRUPAL_PATH_DEPENDENCIES)


_DRUPAL_IMAGE_MAX_BYTES = 1900000
_DRUPAL_IMAGE_WEB_TARGET = 450000
_DRUPAL_IMAGE_MAX_DIM = 1600
_DRUPAL_JPEG_QUALITY = 82


def _drupal_shrink_image(data: bytes, filename: str) -> tuple[bytes, str]:
    """Optimizes an image for web and returns ``(bytes, filename)``."""
    return _legacy.drupal_media.shrink_image(
        data,
        filename,
        _legacy.drupal_media.DrupalImageSettings(
            max_bytes=_DRUPAL_IMAGE_MAX_BYTES,
            web_target=_DRUPAL_IMAGE_WEB_TARGET,
            max_dimension=_DRUPAL_IMAGE_MAX_DIM,
            jpeg_quality=_DRUPAL_JPEG_QUALITY,
        ),
    )


_DRUPAL_GS_PDF_SETTING = "/ebook"


def _drupal_shrink_pdf(data: bytes, filename: str) -> tuple[bytes, str]:
    """Compresses a PDF with Ghostscript if it reduces the size."""
    return _legacy.drupal_media.shrink_pdf(data, filename, _legacy.log, _DRUPAL_GS_PDF_SETTING)


async def _drupal_upload_field_image(
    value: object,
    bundle: str,
    drupal_field: str,
    metadata: Metadata,
    image_cache: dict[str, object],
) -> Result | None:
    """Uploads a local file to an image/file field and returns its relationship."""
    return await _legacy.drupal_media.upload_field_image(
        value, bundle, drupal_field, metadata, image_cache, _legacy._drupal_upload_dependencies()
    )


_DRUPAL_EMBED_RE = _legacy.re.compile("!\\[\\[([^\\]]+)\\]\\]")
_DRUPAL_WIKILINK_RE = _legacy.re.compile("\\[\\[([^\\]]+)\\]\\]")
_DRUPAL_UUID_RE = _legacy.re.compile("^[0-9a-fA-F-]{32,36}$")


def _drupal_resolve_title_to_id(title: str) -> str | None:
    """Title → page_id via the in-memory index (like /resolve-by-title)."""
    return _legacy.drupal_markdown.resolve_title_to_id(title, _legacy._DRUPAL_MARKDOWN_DEPENDENCIES)


def _drupal_wikilink_url(target: str, cache: dict[str, str | None]) -> str | None:
    """Drupal URL of a wikilink target's node (title or uuid), or None."""
    return _legacy.drupal_markdown.wikilink_url(target, cache, _legacy._DRUPAL_MARKDOWN_DEPENDENCIES)


def _drupal_preprocess_md(md: str, *, cache: dict[str, str | None] | None = None) -> str:
    """Adapts Gnosi markdown for Drupal: strips embeds and resolves wikilinks."""
    return _legacy.drupal_markdown.preprocess_markdown(
        md, _legacy._DRUPAL_MARKDOWN_DEPENDENCIES, cache=cache
    )


def _drupal_md_to_html(text: str, wl_cache: dict[str, str | None]) -> str:
    """Preprocesses wikilinks/embeds and converts to HTML with pandoc."""
    return _legacy.drupal_markdown.markdown_to_html(
        text, wl_cache, _legacy._DRUPAL_MARKDOWN_DEPENDENCIES
    )


def _drupal_media_signatures(
    mapping: object, props_by_ref: dict[str, Metadata], field_meta: dict[str, Metadata], metadata: Metadata
) -> dict[str, str]:
    """Signature for non-text fields to detect changes between syncs."""
    return _legacy.drupal_media.media_signatures(
        mapping,
        props_by_ref,
        field_meta,
        metadata,
        _legacy.drupal_media.MediaSignatureDependencies(
            read_prop_value=lambda page_metadata, prop: _drupal_read_prop_value(
                page_metadata, prop
            ),
            resolve_local_path=lambda value: _drupal_resolve_local_path(value),
        ),
    )


async def _drupal_build_fields(
    *,
    mapping: object,
    props_by_ref: dict[str, Metadata],
    field_meta: dict[str, Metadata],
    metadata: Metadata,
    body: str,
    bundle: str,
    term_cache: dict[str, object],
    image_cache: dict[str, object],
    text_only: bool = False,
    media_only: bool = False,
) -> tuple[Result, Result, list[Result]]:
    """Builds (attributes, relationships, skipped) for a record."""
    return await _legacy.drupal_fields.build_fields(
        mapping=mapping,
        properties_by_ref=props_by_ref,
        field_metadata=field_meta,
        metadata=metadata,
        body=body,
        bundle=bundle,
        term_cache=term_cache,
        image_cache=image_cache,
        text_only=text_only,
        media_only=media_only,
        dependencies=_legacy._drupal_field_dependencies(),
    )


def _drupal_sibling_rows(
    table_id: str, nid: object, exclude_id: str
) -> list[PageInfo]:
    """Sibling rows linked to the same Drupal node."""
    return _legacy.drupal_service.sibling_rows(
        table_id, nid, exclude_id, _drupal_sync_dependencies()
    )


_DRUPAL_LANGCODES_CACHE: set[str] | None = None


async def _drupal_langcodes() -> set[str]:
    """Langcodes configured in Drupal (process cache). E.g. {'ca','es','en-gb'}."""
    global _DRUPAL_LANGCODES_CACHE
    _legacy.drupal_languages.language_state.langcodes = _DRUPAL_LANGCODES_CACHE
    result = await _legacy.drupal_languages.langcodes(
        _legacy._DRUPAL_LANGUAGE_DEPENDENCIES, _legacy.drupal_languages.language_state
    )
    _DRUPAL_LANGCODES_CACHE = result
    return result


async def _drupal_resolve_langcode(metadata: Metadata) -> str:
    """Maps the row's Language field to the REAL Drupal langcode."""
    configured = await _drupal_langcodes()
    return await _legacy.drupal_languages.resolve_langcode(
        metadata,
        _legacy._DRUPAL_LANGUAGE_DEPENDENCIES,
        _legacy.drupal_languages.language_state,
        configured_langcodes=configured,
    )


_DRUPAL_FIELD_TRANSLATABLE_CACHE: dict[str, bool] = {}


async def _drupal_uuid_to_fid(file_uuid: object) -> object:
    """uuid of a Drupal file → its internal fid."""
    return await _legacy.drupal_languages.uuid_to_fid(
        file_uuid, _legacy._DRUPAL_LANGUAGE_DEPENDENCIES
    )


async def _drupal_field_translatable(bundle: str, field_name: str) -> bool:
    """True if the bundle's field is translatable in Drupal (cache)."""
    _legacy.drupal_languages.language_state.field_translatable = _DRUPAL_FIELD_TRANSLATABLE_CACHE
    return await _legacy.drupal_languages.field_translatable(
        bundle,
        field_name,
        _legacy._DRUPAL_LANGUAGE_DEPENDENCIES,
        _legacy.drupal_languages.language_state,
    )


def _drupal_image_mapping(
    mapping: object, field_meta: dict[str, Metadata]
) -> tuple[str | None, str | None]:
    """First mapped image/file property and Drupal field."""
    return _legacy.drupal_languages.image_mapping(mapping, field_meta)


def _drupal_row_image_alt(
    metadata: Metadata, props_by_ref: dict[str, Metadata], image_ref: str | None
) -> str:
    """Image alt text for a row with legacy fallbacks."""
    return _legacy.drupal_languages.row_image_alt(
        metadata,
        props_by_ref,
        image_ref,
        lambda page_metadata, prop: _drupal_read_prop_value(page_metadata, prop),
    )


async def _drupal_row_text_fields(
    page_id: str,
    *,
    mapping: object,
    props_by_ref: dict[str, Metadata],
    field_meta: dict[str, Metadata],
    bundle: str,
    term_cache: dict[str, object],
    image_cache: dict[str, object],
) -> tuple[Result | None, str | None, Metadata | None]:
    """Reads a row and builds its text fields for add_translation."""
    return await _legacy.drupal_service.row_text_fields(
        page_id,
        mapping=mapping,
        props_by_ref=props_by_ref,
        field_meta=field_meta,
        bundle=bundle,
        term_cache=term_cache,
        image_cache=image_cache,
        dependencies=_drupal_sync_dependencies(),
    )


async def _do_sync_drupal_row(
    item_id: str,
    *,
    background_tasks: BackgroundTasks,
    publish: bool = True,
    scope: str = "all",
    push_media: bool = False,
) -> Result:
    """Creates or updates a row's Drupal node.

    ``scope``:
      - ``"all"``: this row's language + all translations and sibling rows.
      - ``"lang_only"``: only this row's language.
    """
    return await _legacy.drupal_service.sync_drupal_row(
        item_id,
        background_tasks=background_tasks,
        publish=publish,
        scope=scope,
        push_media=push_media,
        dependencies=_drupal_sync_dependencies(),
    )
